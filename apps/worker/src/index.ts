import { hostname } from "node:os";
import type { SyncJob } from "@propintel/shared";
import { connect } from "./db";
import { executeJob } from "./jobs/runner";
import { enqueueDueSchedules } from "./jobs/scheduler";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (Supabase Postgres connection string with the worker service role).");
  process.exit(1);
}

const workerId = `${hostname()}-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const log = (msg: string) => console.log(`[${new Date().toISOString()}] [${workerId}] ${msg}`);

const { sql, exec } = connect(DATABASE_URL);
let stopping = false;

async function tick(): Promise<boolean> {
  await exec("select public.fail_stale_jobs()");
  const enqueued = await enqueueDueSchedules(exec);
  if (enqueued > 0) log(`enqueued ${enqueued} scheduled job(s)`);

  const [job] = await exec<SyncJob>("select * from public.claim_next_sync_job($1)", [workerId]);
  if (!job) return false;
  const heartbeat = setInterval(() => {
    exec("update public.sync_jobs set heartbeat_at = now() where id = $1", [job.id]).catch(() => {});
  }, 30_000);
  try {
    await executeJob(exec, job, log);
  } catch (e) {
    log(`job ${job.id} crashed: ${e instanceof Error ? e.message : String(e)}`);
    await exec(
      `update public.sync_jobs set status = 'failed', finished_at = now(), error_category = 'worker_error', error_message = $2 where id = $1`,
      [job.id, "Worker error; prior data preserved. See worker logs."],
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

async function main() {
  log("worker started");
  while (!stopping) {
    let worked = false;
    try {
      worked = await tick();
    } catch (e) {
      log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await sql.end({ timeout: 10 });
  log("worker stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`${sig} received; finishing current job`);
    stopping = true;
  });
}

void main();
