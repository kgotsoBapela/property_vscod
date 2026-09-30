import { can } from "@propintel/shared";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { PageHeader } from "@/components/dashboard/bits";
import { JobsTable, SchedulesCard, TriggerForm } from "@/components/sync/sync-center";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";
import { fmtDateTime, isStale } from "@/lib/utils";

export const metadata = { title: "Sync center" };

export default async function SyncPage() {
  const viewer = await requireCapabilityPage("sync:read");
  const repo = getRepository();
  const [jobs, integrations, schedules] = await Promise.all([repo.listJobs(50), repo.listIntegrations(), repo.listSchedules()]);
  const active = integrations.filter((i) => ["active", "sandbox"].includes(i.status));

  return (
    <>
      <PageHeader title="Sync center" description="Source health, job history, manual triggers and schedules. All jobs go through one durable queue." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Source health</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {active.map((i) => (
              <div key={i.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{i.display_name}</span>
                  {isStale(i.last_success_at) ? <Badge variant="warning">Stale</Badge> : <Badge variant="good">Healthy</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Last success {fmtDateTime(i.last_success_at)} · last failure {i.last_failure_at ? fmtDateTime(i.last_failure_at) : "none"}
                  <br />
                  Quota: not configured · cost per call: {i.is_demo ? "R0" : "unknown"}
                </div>
              </div>
            ))}
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {integrations.length - active.length} candidate provider(s) are awaiting verified access and are not synced. See Integrations.
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Manual trigger</CardTitle>
            <CardDescription>Returns a job ID immediately; progress is shown on the job page.</CardDescription>
          </CardHeader>
          <CardContent>
            {can(viewer.role, "sync:trigger") ? (
              <TriggerForm integrations={integrations} demo={repo.mode === "demo"} />
            ) : (
              <p className="text-sm text-muted-foreground">Only Super Admins can trigger syncs.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Job history</CardTitle>
          </CardHeader>
          <CardContent>
            <JobsTable initial={jobs} />
          </CardContent>
        </Card>
        <div className="lg:col-span-3">
          <SchedulesCard schedules={schedules} canManage={can(viewer.role, "schedule:manage")} />
        </div>
      </div>
    </>
  );
}
