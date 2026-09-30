import { streetAddressKey, normalizeAddress } from "../matching/address";
import type { CanonicalCandidate, IdentityFacts } from "../matching/identity";
import type { SyncJob } from "../types/domain";
import type { CommitItem, SyncStore } from "./pipeline";

/**
 * Minimal SQL executor: `$1`-style positional parameters, returns rows.
 * JSON is passed as a string and cast with `$n::text::jsonb`: some drivers (postgres.js) otherwise send it as a JSON *string* scalar.
 */
export type SqlExec = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

const JOB_COLUMNS = new Set([
  "status",
  "started_at",
  "finished_at",
  "records_fetched",
  "records_upserted",
  "records_failed",
  "error_category",
  "error_message",
]);

/**
 * PostgreSQL implementation of SyncStore used by the worker (direct connection with the service role).
 * Atomic writes happen inside `commit_sync_item` (supabase/migrations/..._functions.sql).
 */
export class SqlSyncStore implements SyncStore {
  constructor(private readonly exec: SqlExec) {}

  async getCheckpoint(integrationId: string, scopeKey: string) {
    const rows = await this.exec<{ cursor: string | null }>(
      "select cursor from public.sync_checkpoints where integration_id = $1 and scope_key = $2",
      [integrationId, scopeKey],
    );
    return rows[0]?.cursor ?? null;
  }

  async saveCheckpoint(integrationId: string, scopeKey: string, cursor: string | null) {
    await this.exec(
      `insert into public.sync_checkpoints (integration_id, scope_key, cursor, updated_at) values ($1, $2, $3, now())
       on conflict (integration_id, scope_key) do update set cursor = excluded.cursor, updated_at = now()`,
      [integrationId, scopeKey, cursor],
    );
  }

  async getSourceHash(provider: string, externalId: string) {
    // Records awaiting identity review are re-evaluated on every sync, even when unchanged.
    const rows = await this.exec<{ content_hash: string }>(
      `select s.content_hash from public.source_records s
        where s.provider = $1 and s.external_id = $2
          and not exists (select 1 from public.identity_review_queue q
                           where q.provider = s.provider and q.external_id = s.external_id and q.status = 'open')`,
      [provider, externalId],
    );
    return rows[0]?.content_hash ?? null;
  }

  async findCandidates(facts: IdentityFacts): Promise<CanonicalCandidate[]> {
    const payload = { ...facts, street_key: facts.address ? normalizeAddress(facts.address) : null };
    const rows = await this.exec<{ c: CanonicalCandidate[] | string }>("select public.find_property_candidates($1::text::jsonb) as c", [
      JSON.stringify(payload),
    ]);
    const c = rows[0]?.c ?? [];
    return typeof c === "string" ? (JSON.parse(c) as CanonicalCandidate[]) : c;
  }

  async commitItem(item: CommitItem) {
    const payload =
      item.kind === "property"
        ? { ...item, street_key: streetAddressKey(item.record.street_number, item.record.street_name, item.record.suburb) }
        : item;
    const rows = await this.exec<{ id: string | null }>("select public.commit_sync_item($1::text::jsonb) as id", [JSON.stringify(payload)]);
    return { property_id: rows[0]?.id ?? null };
  }

  async appendEvent(jobId: string, level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
    await this.exec("insert into public.sync_job_events (job_id, level, message, data) values ($1, $2, $3, $4::text::jsonb)", [
      jobId,
      level,
      message,
      data ? JSON.stringify(data) : null,
    ]);
  }

  async updateJob(jobId: string, patch: Partial<SyncJob>) {
    const entries = Object.entries(patch).filter(([k]) => JOB_COLUMNS.has(k));
    const sets = entries.map(([k], i) =>
      // Never overwrite a pending cancellation with "running".
      k === "status"
        ? `status = case when status = 'cancellation_requested' and $${i + 2} = 'running' then status else $${i + 2} end`
        : `${k} = $${i + 2}`,
    );
    sets.push("heartbeat_at = now()");
    await this.exec(`update public.sync_jobs set ${sets.join(", ")} where id = $1`, [jobId, ...entries.map(([, v]) => v)]);
    if (patch.status === "completed" || patch.status === "partially_completed") {
      await this.exec("update public.integrations set last_success_at = now() where id = (select integration_id from public.sync_jobs where id = $1)", [jobId]);
    } else if (patch.status === "failed") {
      await this.exec("update public.integrations set last_failure_at = now() where id = (select integration_id from public.sync_jobs where id = $1)", [jobId]);
    }
  }

  async isCancellationRequested(jobId: string) {
    const rows = await this.exec<{ status: string }>("select status from public.sync_jobs where id = $1", [jobId]);
    return rows[0]?.status === "cancellation_requested";
  }
}
