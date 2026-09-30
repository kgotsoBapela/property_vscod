/**
 * One-off sync without the polling loop: queues a job for the given integration + scope, runs it, and exits.
 * Usage: DATABASE_URL=… npx tsx src/run-once.ts [scope] [provider_key]
 * e.g.   npx tsx src/run-once.ts full_reconciliation fixture_demo
 */
import type { SyncJob, SyncScope } from "@propintel/shared";
import { connect } from "./db";
import { executeJob } from "./jobs/runner";

const scope = (process.argv[2] ?? "provider_incremental") as SyncScope;
const providerKey = process.argv[3] ?? "fixture_demo";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { sql, exec } = connect(process.env.DATABASE_URL);
try {
  const [job] = await exec<SyncJob>(
    `insert into public.sync_jobs (integration_id, scope, trigger, status, started_at, worker_id)
     select id, $1, 'manual', 'running', now(), 'run-once' from public.integrations where provider_key = $2
     returning *`,
    [scope, providerKey],
  );
  if (!job) throw new Error(`Integration ${providerKey} not found`);
  await executeJob(exec, job, (m) => console.log(m));
} finally {
  await sql.end({ timeout: 5 });
}
