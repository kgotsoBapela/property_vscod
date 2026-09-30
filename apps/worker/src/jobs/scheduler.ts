import { nextCronRun, type SqlExec } from "@propintel/shared";

interface ScheduleRow {
  id: string;
  integration_id: string;
  scope: string;
  cron: string;
  timezone: string;
  next_run_at: string | null;
}

/**
 * Enqueues due scheduled jobs. The unique partial index on sync_jobs prevents overlap: if a job for the
 * same integration/scope is still active the insert is skipped and the schedule simply advances.
 */
export async function enqueueDueSchedules(exec: SqlExec, now = new Date()): Promise<number> {
  const rows = await exec<ScheduleRow>(
    `select s.id, s.integration_id, s.scope, s.cron, s.timezone, s.next_run_at
       from public.sync_schedules s join public.integrations i on i.id = s.integration_id
      where s.enabled and i.status in ('active', 'sandbox')`,
  );
  let enqueued = 0;
  for (const s of rows) {
    if (!s.next_run_at) {
      await exec("update public.sync_schedules set next_run_at = $2 where id = $1", [s.id, nextCronRun(s.cron, s.timezone, now)]);
      continue;
    }
    if (new Date(s.next_run_at) > now) continue;
    const inserted = await exec(
      `insert into public.sync_jobs (integration_id, scope, trigger, params) values ($1, $2, 'schedule', '{}'::jsonb)
       on conflict do nothing returning id`,
      [s.integration_id, s.scope],
    );
    enqueued += inserted.length;
    await exec("update public.sync_schedules set last_enqueued_at = now(), next_run_at = $2 where id = $1", [
      s.id,
      nextCronRun(s.cron, s.timezone, now),
    ]);
  }
  return enqueued;
}
