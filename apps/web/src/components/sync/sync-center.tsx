"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Save } from "lucide-react";
import { SYNC_STATUS_LABELS, type Integration, type SyncJob, type SyncScope } from "@propintel/shared";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { EmptyState } from "@/components/dashboard/bits";
import type { SyncScheduleRow } from "@/lib/data/types";
import { fmtDateTime } from "@/lib/utils";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function JobStatusBadge({ status }: { status: SyncJob["status"] }) {
  const variant =
    status === "completed" ? "good" : status === "failed" ? "critical" : status === "partially_completed" || status === "cancellation_requested" ? "warning" : status === "running" ? "default" : "muted";
  return <Badge variant={variant}>{SYNC_STATUS_LABELS[status]}</Badge>;
}

export function JobsTable({ initial }: { initial: SyncJob[] }) {
  const q = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => (await json<{ jobs: SyncJob[] }>(await fetch("/api/sync/jobs"))).jobs,
    initialData: initial,
    refetchInterval: (query) => (query.state.data?.some((j) => ["queued", "running", "cancellation_requested"].includes(j.status)) ? 1500 : 10_000),
  });
  if (q.data.length === 0) return <EmptyState title="No sync jobs yet" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Created</TH>
          <TH>Scope</TH>
          <TH>Trigger</TH>
          <TH>Status</TH>
          <TH className="text-right">Fetched</TH>
          <TH className="text-right">Upserted</TH>
          <TH className="text-right">Failed</TH>
          <TH>Duration</TH>
          <TH>Error</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.map((j) => (
          <TR key={j.id}>
            <TD className="whitespace-nowrap">
              <Link href={`/sync/${j.id}`} className="text-primary hover:underline">
                {fmtDateTime(j.created_at)}
              </Link>
            </TD>
            <TD>{j.scope.replaceAll("_", " ")}</TD>
            <TD>{j.trigger}</TD>
            <TD>
              <JobStatusBadge status={j.status} />
            </TD>
            <TD className="tabular text-right">{j.records_fetched}</TD>
            <TD className="tabular text-right">{j.records_upserted}</TD>
            <TD className="tabular text-right">{j.records_failed}</TD>
            <TD className="tabular text-xs">{j.started_at && j.finished_at ? `${((Date.parse(j.finished_at) - Date.parse(j.started_at)) / 1000).toFixed(1)} s` : "—"}</TD>
            <TD className="text-xs text-muted-foreground">{j.error_category ?? ""}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

const SCOPES: { value: SyncScope; label: string; needsTarget: boolean }[] = [
  { value: "auctions", label: "Auction refresh", needsTarget: false },
  { value: "provider_incremental", label: "Provider incremental sync", needsTarget: false },
  { value: "full_reconciliation", label: "Full reconciliation (high cost)", needsTarget: false },
  { value: "subject_property", label: "Subject property refresh", needsTarget: true },
  { value: "nearby_sales", label: "Nearby sales refresh", needsTarget: true },
];

export function TriggerForm({ integrations, demo }: { integrations: Integration[]; demo: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const active = integrations.filter((i) => ["active", "sandbox"].includes(i.status));
  const [integrationId, setIntegrationId] = useState(active[0]?.id ?? "");
  const [scope, setScope] = useState<SyncScope>("auctions");
  const [target, setTarget] = useState("");
  const [failure, setFailure] = useState("none");
  const [approve, setApprove] = useState(false);
  const integ = active.find((i) => i.id === integrationId);
  const scopeDef = SCOPES.find((s) => s.value === scope)!;

  const m = useMutation({
    mutationFn: async () =>
      json<SyncJob>(
        await fetch("/api/sync/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            integration_id: integrationId,
            scope,
            target_property_id: scopeDef.needsTarget ? target.trim() || null : null,
            params: integ?.is_demo && failure !== "none" ? { simulate_failure: failure } : {},
            approve_high_cost: approve,
          }),
        }),
      ),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      router.push(`/sync/${job.id}`);
    },
  });

  if (active.length === 0) return <Alert tone="warning">No active integrations. Provider agreements must be in place before syncing.</Alert>;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="integ">Integration</Label>
        <NativeSelect id="integ" value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
          {active.map((i) => (
            <option key={i.id} value={i.id}>
              {i.display_name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="scope">Scope</Label>
        <NativeSelect id="scope" value={scope} onChange={(e) => setScope(e.target.value as SyncScope)}>
          {SCOPES.filter((s) => !integ || integ.capabilities.includes(s.value)).map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {scopeDef.needsTarget && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="target">Target property ID</Label>
          <Input id="target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Tip: use Refresh on a property page" />
        </div>
      )}
      {integ?.is_demo && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="fail">Failure injection (demo provider only)</Label>
          <NativeSelect id="fail" value={failure} onChange={(e) => setFailure(e.target.value)}>
            <option value="none">None</option>
            <option value="first_page">Fail on first page</option>
            <option value="after_first_page">Fail after first page</option>
          </NativeSelect>
        </div>
      )}
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        Estimated provider cost:{" "}
        <span className="text-foreground">{integ?.is_demo ? "R0 (synthetic provider)" : "Unknown: pricing not yet verified with this provider"}</span>
      </div>
      {scope === "full_reconciliation" && (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="mt-0.5" />I approve a full reconciliation and accept any
          provider costs it incurs. This approval is audited.
        </label>
      )}
      <Button type="submit" disabled={m.isPending || (scopeDef.needsTarget && !target.trim()) || (scope === "full_reconciliation" && !approve)}>
        <Play /> Queue job
      </Button>
      {m.isError && <p className="text-xs text-critical">{(m.error as Error).message}</p>}
      {demo && <p className="text-xs text-muted-foreground">Demo mode runs jobs in-process. In production the separate worker claims jobs from the queue.</p>}
    </form>
  );
}

export function ScheduleEditor({ schedules, canManage }: { schedules: SyncScheduleRow[]; canManage: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(Object.fromEntries(schedules.map((s) => [s.id, { cron: s.cron, enabled: s.enabled }])));
  const m = useMutation({
    mutationFn: async (id: string) => json(await fetch(`/api/sync/schedules/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(draft[id]) })),
    onSuccess: () => router.refresh(),
  });
  if (schedules.length === 0) return <EmptyState title="No schedules configured" />;
  return (
    <div className="flex flex-col gap-3">
      {schedules.map((s) => (
        <div key={s.id} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
          <div className="min-w-40 flex-1">
            <div className="text-sm font-medium">{s.scope.replaceAll("_", " ")}</div>
            <div className="text-xs text-muted-foreground">
              {s.timezone} · next run {s.enabled ? fmtDateTime(s.next_run_at) : "disabled"}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`cron-${s.id}`}>Cron</Label>
            <Input id={`cron-${s.id}`} className="w-40 font-mono" disabled={!canManage} value={draft[s.id]!.cron} onChange={(e) => setDraft({ ...draft, [s.id]: { ...draft[s.id]!, cron: e.target.value } })} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs">
            <input type="checkbox" disabled={!canManage} checked={draft[s.id]!.enabled} onChange={(e) => setDraft({ ...draft, [s.id]: { ...draft[s.id]!, enabled: e.target.checked } })} />
            Enabled
          </label>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => m.mutate(s.id)} disabled={m.isPending}>
              <Save /> Save
            </Button>
          )}
        </div>
      ))}
      {m.isError && <p className="text-xs text-critical">{(m.error as Error).message}</p>}
    </div>
  );
}

export function SchedulesCard({ schedules, canManage }: { schedules: SyncScheduleRow[]; canManage: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedules</CardTitle>
        <CardDescription>Default daily 02:00 Africa/Johannesburg. More frequent auction checks only where provider terms permit.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScheduleEditor schedules={schedules} canManage={canManage} />
      </CardContent>
    </Card>
  );
}
