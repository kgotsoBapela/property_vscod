import type { SourceAdapter, FetchRequest } from "../adapters/types";
import { AdapterError } from "../adapters/types";
import type { CanonicalCandidate, IdentityFacts, MatchDecision } from "../matching/identity";
import { resolveIdentity } from "../matching/identity";
import { streetAddressKey } from "../matching/address";
import type { NormalizedAuction, NormalizedProperty } from "../schemas/normalized";
import { normalizedRecordSchema } from "../schemas/normalized";
import type { SyncJob, SyncStatus } from "../types/domain";
import { contentHash } from "./hash";
import { DEFAULT_RETRY, type RetryOptions, toAdapterError, withRetry } from "./retry";

export interface SourceRecordInput {
  provider: string;
  external_id: string;
  content_hash: string;
  raw: unknown | null; // only stored when licensing permits
  retrieved_at: string;
  retention_until: string | null;
  is_demo: boolean;
}

export interface PropertyResolution {
  /** Existing canonical property, or null to create a new one. */
  property_id: string | null;
  confidence: number;
  evidence: string[];
  /** Present when a human must decide; the record is stored but not merged. */
  review: { candidates: { property_id: string; confidence: number; evidence: string[]; conflicts: string[] }[]; reason: string } | null;
}

export interface LotResolution {
  lot_index: number;
  /** Set only on an unambiguous auto-match; ambiguous lots list candidates instead of guessing. */
  property_id: string | null;
  candidate_property_ids: string[];
  confidence: number;
  evidence: string[];
  review_status: "auto_matched" | "needs_review";
}

export type CommitItem =
  | { kind: "property"; job_id: string; integration_id: string; source: SourceRecordInput; record: NormalizedProperty; resolution: PropertyResolution }
  | { kind: "auction"; job_id: string; integration_id: string; source: SourceRecordInput; record: NormalizedAuction; lots: LotResolution[] }
  | { kind: "unchanged"; job_id: string; integration_id: string; source: SourceRecordInput };

/**
 * Persistence port implemented by the Supabase store (worker) and the in-memory store (demo/tests).
 * `commitItem` MUST be atomic: source record + normalized entities + identifiers are written together
 * with idempotent upserts keyed on (provider, external_id).
 */
export interface SyncStore {
  getCheckpoint(integrationId: string, scopeKey: string): Promise<string | null>;
  saveCheckpoint(integrationId: string, scopeKey: string, cursor: string | null): Promise<void>;
  getSourceHash(provider: string, externalId: string): Promise<string | null>;
  findCandidates(facts: IdentityFacts): Promise<CanonicalCandidate[]>;
  commitItem(item: CommitItem): Promise<{ property_id: string | null }>;
  appendEvent(jobId: string, level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): Promise<void>;
  updateJob(jobId: string, patch: Partial<SyncJob>): Promise<void>;
  isCancellationRequested(jobId: string): Promise<boolean>;
}

export interface RunOptions {
  retry?: RetryOptions;
  maxPages?: number;
  maxPaidCalls?: number | null;
  now?: () => Date;
}

export interface RunResult {
  status: SyncStatus;
  fetched: number;
  upserted: number;
  failed: number;
  unchanged: number;
  review: number;
  paid_calls: number;
  error_category: string | null;
  error_message: string | null;
}

export function factsFromProperty(r: NormalizedProperty, provider: string): IdentityFacts {
  return {
    address: streetAddressKey(r.street_number, r.street_name, r.suburb) ?? r.address,
    erf_number: r.erf_number,
    portion: r.portion,
    township: r.township,
    scheme_name: r.scheme_name,
    scheme_number: r.scheme_number,
    unit_number: r.unit_number,
    latitude: r.latitude,
    longitude: r.longitude,
    provider_ids: [{ provider, external_id: r.external_id }],
  };
}

function toResolution(d: MatchDecision): PropertyResolution {
  switch (d.kind) {
    case "auto_match":
      return { property_id: d.property_id, confidence: d.confidence, evidence: d.evidence, review: null };
    case "new_property":
      return { property_id: null, confidence: 1, evidence: [d.reason], review: null };
    case "needs_review":
      return { property_id: null, confidence: d.candidates[0]?.confidence ?? 0, evidence: [], review: { candidates: d.candidates, reason: d.reason } };
  }
}

function checkpointKey(job: SyncJob): string | null {
  if (job.scope === "provider_incremental" || job.scope === "auctions" || job.scope === "full_reconciliation") return job.scope;
  return null; // subject/nearby lookups are one-shot
}

/**
 * Runs one sync job end to end:
 * fetch (retry/backoff/timeout) → validate (Zod) → provenance → identity resolution → idempotent upsert
 * → checkpoint ONLY after every record of the page is durably committed → operational events.
 * On failure the previously committed dataset is untouched and the checkpoint stays at the last good page.
 */
export async function runSyncJob(
  job: SyncJob,
  adapter: SourceAdapter,
  store: SyncStore,
  baseRequest: Omit<FetchRequest, "cursor" | "scope" | "params">,
  opts: RunOptions = {},
): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const retry = { ...DEFAULT_RETRY, ...opts.retry };
  const key = checkpointKey(job);
  const result: RunResult = {
    status: "running",
    fetched: 0,
    upserted: 0,
    failed: 0,
    unchanged: 0,
    review: 0,
    paid_calls: 0,
    error_category: null,
    error_message: null,
  };

  const finish = async (status: SyncStatus) => {
    result.status = status;
    await store.updateJob(job.id, {
      status,
      finished_at: now().toISOString(),
      records_fetched: result.fetched,
      records_upserted: result.upserted,
      records_failed: result.failed,
      error_category: result.error_category,
      error_message: result.error_message,
    });
    await store.appendEvent(job.id, status === "failed" ? "error" : "info", `Job ${status}`, {
      fetched: result.fetched,
      upserted: result.upserted,
      unchanged: result.unchanged,
      failed: result.failed,
      needs_review: result.review,
      paid_calls: result.paid_calls,
    });
    return result;
  };

  if (!adapter.scopes.includes(job.scope)) {
    result.error_category = "unsupported_scope";
    result.error_message = `${adapter.displayName} does not support ${job.scope}`;
    return finish("failed");
  }

  await store.updateJob(job.id, { status: "running", started_at: now().toISOString() });
  let cursor = key && job.scope !== "full_reconciliation" ? await store.getCheckpoint(job.integration_id, key) : null;
  await store.appendEvent(job.id, "info", `Started ${job.scope} using ${adapter.displayName}`, {
    resume_from: cursor,
    demo: adapter.isDemo,
  });

  for (let page = 0; page < (opts.maxPages ?? 1000); page++) {
    if (await store.isCancellationRequested(job.id)) {
      await store.appendEvent(job.id, "warn", "Cancellation requested; stopping before next page");
      return finish("cancelled");
    }
    if (opts.maxPaidCalls != null && result.paid_calls >= opts.maxPaidCalls) {
      result.error_category = "quota_exceeded";
      result.error_message = `Stopped at configured quota of ${opts.maxPaidCalls} paid calls`;
      await store.appendEvent(job.id, "warn", result.error_message);
      return finish("partially_completed");
    }

    let fetched;
    try {
      const req: FetchRequest = { ...baseRequest, scope: job.scope, cursor, params: job.params };
      fetched = await withRetry((signal) => adapter.fetchPage({ ...req, signal }), {
        ...retry,
        onRetry: (attempt, err, delay) => {
          void store.appendEvent(job.id, "warn", `Retry ${attempt} after ${err.category}`, { delay_ms: delay, error: err.message });
        },
      });
    } catch (e) {
      const err = toAdapterError(e);
      result.error_category = err.category;
      result.error_message = redact(err.message);
      await store.appendEvent(job.id, "error", `Fetch failed on page ${page + 1}; prior data preserved, checkpoint not advanced`, {
        category: err.category,
        checkpoint: cursor,
      });
      return finish(result.upserted > 0 || result.unchanged > 0 ? "partially_completed" : "failed");
    }

    result.paid_calls += fetched.paid_calls;
    result.fetched += fetched.records.length;
    const retrievedAt = now().toISOString();

    try {
      for (const raw of fetched.records) {
        await processRecord(raw);
      }
    } catch (e) {
      // A commit failure is fatal for this page: do not advance the checkpoint.
      const err = e instanceof AdapterError ? e : new AdapterError("permanent", e instanceof Error ? e.message : String(e));
      result.error_category = "storage";
      result.error_message = redact(err.message);
      await store.appendEvent(job.id, "error", "Commit failed; checkpoint not advanced", { checkpoint: cursor });
      return finish("failed");
    }

    // Every record in this page is durably committed → safe to advance.
    if (key && fetched.checkpoint !== cursor) {
      await store.saveCheckpoint(job.integration_id, key, fetched.checkpoint);
    }
    await store.updateJob(job.id, {
      records_fetched: result.fetched,
      records_upserted: result.upserted,
      records_failed: result.failed,
    });
    await store.appendEvent(job.id, "info", `Page ${page + 1} committed`, {
      records: fetched.records.length,
      checkpoint: fetched.checkpoint,
    });

    if (!fetched.next_cursor) break;
    cursor = fetched.next_cursor;

    async function processRecord(raw: unknown) {
      const parsedRaw = adapter.rawSchema.safeParse(raw);
      if (!parsedRaw.success) {
        result.failed++;
        await store.appendEvent(job.id, "warn", "Raw record failed validation; skipped", {
          issues: parsedRaw.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return;
      }
      const externalId = adapter.externalId(parsedRaw.data);
      const normalized = normalizedRecordSchema.safeParse(adapter.normalize(parsedRaw.data));
      if (!normalized.success) {
        result.failed++;
        await store.appendEvent(job.id, "warn", `Normalized record ${externalId} invalid; skipped`, {
          issues: normalized.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return;
      }

      const hash = contentHash(parsedRaw.data);
      const source: SourceRecordInput = {
        provider: adapter.key,
        external_id: externalId,
        content_hash: hash,
        raw: adapter.licensing.may_store_raw ? parsedRaw.data : null,
        retrieved_at: retrievedAt,
        retention_until:
          adapter.licensing.retention_days == null
            ? null
            : new Date(now().getTime() + adapter.licensing.retention_days * 86_400_000).toISOString(),
        is_demo: adapter.isDemo,
      };

      const base = { job_id: job.id, integration_id: job.integration_id, source };
      if ((await store.getSourceHash(adapter.key, externalId)) === hash) {
        await store.commitItem({ kind: "unchanged", ...base });
        result.unchanged++;
        return;
      }

      const rec = normalized.data;
      if (rec.type === "property") {
        const facts = factsFromProperty(rec, adapter.key);
        const resolution = toResolution(resolveIdentity(facts, await store.findCandidates(facts)));
        if (resolution.review) result.review++;
        await store.commitItem({ kind: "property", ...base, record: rec, resolution });
      } else {
        const lots: LotResolution[] = [];
        for (const [i, lot] of rec.lots.entries()) {
          const facts: IdentityFacts = {
            address: lot.described_address,
            erf_number: lot.erf_number,
            portion: lot.portion,
            township: lot.township,
            scheme_name: lot.scheme_name,
            scheme_number: lot.scheme_number,
            unit_number: lot.unit_number,
            latitude: lot.latitude,
            longitude: lot.longitude,
            provider_ids: [],
          };
          const d = resolveIdentity(facts, await store.findCandidates(facts));
          if (d.kind === "auto_match") {
            lots.push({
              lot_index: i,
              property_id: d.property_id,
              candidate_property_ids: [d.property_id],
              confidence: d.confidence,
              evidence: d.evidence,
              review_status: "auto_matched",
            });
          } else {
            const candidates = d.kind === "needs_review" ? d.candidates : [];
            const top = candidates[0];
            lots.push({
              lot_index: i,
              property_id: null,
              candidate_property_ids: candidates.map((c) => c.property_id),
              confidence: top?.confidence ?? 0,
              evidence: [
                d.reason,
                ...(top ? [...top.evidence, ...top.conflicts.map((c) => `Conflict: ${c}`)] : []),
                ...(candidates.length > 1 ? [`${candidates.length} candidate properties`] : []),
              ],
              review_status: "needs_review",
            });
            result.review++;
          }
        }
        await store.commitItem({ kind: "auction", ...base, record: rec, lots });
      }
      result.upserted++;
    }
  }

  return finish(result.failed > 0 ? "partially_completed" : "completed");
}

/** Strip anything that looks like a credential before it reaches logs. */
export function redact(message: string): string {
  return message
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/(api[_-]?key|token|secret|password)(["'\s:=]+)([^\s"'&]+)/gi, "$1$2[REDACTED]");
}
