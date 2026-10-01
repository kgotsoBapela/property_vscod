import { runSyncJob, SqlSyncStore, type FetchRequest, type SqlExec, type SyncJob } from "@propintel/shared";
import { AdapterNotConfiguredError, getAdapter } from "../adapters/registry";

interface SubjectRow {
  normalized_address: string;
  latitude: number | null;
  longitude: number | null;
  erf_number: string | null;
  portion: string | null;
  township: string | null;
  scheme_name: string | null;
  scheme_number: string | null;
  unit_number: string | null;
}

async function loadSubject(exec: SqlExec, propertyId: string): Promise<FetchRequest["subject"]> {
  const rows = await exec<SubjectRow>(
    `select p.normalized_address, p.latitude, p.longitude, i.erf_number, i.portion, i.township, i.scheme_name, i.scheme_number, i.unit_number
       from public.properties p
       left join lateral (
         select * from public.property_identifiers x where x.property_id = p.id and x.kind in ('sectional_scheme_unit', 'erf')
          order by (x.kind = 'sectional_scheme_unit') desc limit 1) i on true
      where p.id = $1`,
    [propertyId],
  );
  const r = rows[0];
  if (!r) return undefined;
  return { ...r, address: r.normalized_address };
}

export async function executeJob(exec: SqlExec, job: SyncJob, log: (msg: string) => void) {
  const store = new SqlSyncStore(exec);
  const integration = (
    await exec<{ provider_key: string; max_paid_calls_per_job: number | null }>(
      "select provider_key, max_paid_calls_per_job from public.integrations where id = $1",
      [job.integration_id],
    )
  )[0];
  if (!integration) throw new Error(`Integration ${job.integration_id} not found`);

  let adapter;
  try {
    // Decrypted only here, in the worker, for the duration of the job. Never logged.
    const [secrets] = await exec<{ s: Record<string, string> | string }>("select public.get_integration_secrets($1) as s", [job.integration_id]);
    const credentials = typeof secrets?.s === "string" ? (JSON.parse(secrets.s) as Record<string, string>) : (secrets?.s ?? {});
    adapter = getAdapter(integration.provider_key, credentials);
  } catch (e) {
    if (!(e instanceof AdapterNotConfiguredError)) throw e;
    await store.appendEvent(job.id, "error", e.message);
    await store.updateJob(job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_category: "not_configured",
      error_message: e.message,
    });
    return;
  }

  const subject = job.target_property_id ? await loadSubject(exec, job.target_property_id) : undefined;
  const radius = typeof job.params.radius_m === "number" ? job.params.radius_m : 1500;
  log(`job ${job.id} ${job.scope} via ${adapter.key}`);
  const result = await runSyncJob(job, adapter, store, { subject, radius_m: radius }, { maxPaidCalls: integration.max_paid_calls_per_job });
  log(`job ${job.id} -> ${result.status} (fetched ${result.fetched}, upserted ${result.upserted}, failed ${result.failed})`);
}
