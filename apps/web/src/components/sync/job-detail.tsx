"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleStop } from "lucide-react";
import type { SyncJob, SyncJobEvent } from "@propintel/shared";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Stat } from "@/components/dashboard/bits";
import { cn, fmtDateTime } from "@/lib/utils";
import { JobStatusBadge } from "./sync-center";

const ACTIVE = ["queued", "running", "cancellation_requested"];

export function JobDetail({ initial, canCancel }: { initial: { job: SyncJob; events: SyncJobEvent[] }; canCancel: boolean }) {
  const q = useQuery({
    queryKey: ["job", initial.job.id],
    queryFn: async () => {
      const res = await fetch(`/api/sync/jobs/${initial.job.id}`);
      if (!res.ok) throw new Error("Failed to load job");
      return (await res.json()) as { job: SyncJob; events: SyncJobEvent[] };
    },
    initialData: initial,
    refetchInterval: (query) => (ACTIVE.includes(query.state.data?.job.status ?? "") ? 1000 : false),
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sync/jobs/${initial.job.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Cancel failed");
    },
    onSuccess: () => q.refetch(),
  });
  const { job, events } = q.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <JobStatusBadge status={job.status} />
        <span className="text-sm text-muted-foreground">
          {job.scope.replaceAll("_", " ")} · {job.trigger} · created {fmtDateTime(job.created_at)}
        </span>
        {canCancel && ["queued", "running"].includes(job.status) && (
          <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            <CircleStop /> Cancel
          </Button>
        )}
      </div>
      {job.status === "failed" && (
        <div className="rounded-lg border border-critical/60 bg-card px-4 py-3 text-sm">
          <strong>Failed ({job.error_category}).</strong> {job.error_message} Previously stored data was not modified; the checkpoint was not advanced past the
          last committed page.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fetched" value={job.records_fetched} />
        <Stat label="Upserted" value={job.records_upserted} />
        <Stat label="Failed validation" value={job.records_failed} />
        <Stat label="Estimated cost" value={job.estimated_cost_zar == null ? "Unknown" : `R${job.estimated_cost_zar}`} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Event log {ACTIVE.includes(job.status) && <span className="text-xs font-normal text-muted-foreground">live</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-1 font-mono text-xs">
            {events.map((e) => (
              <li key={e.id} className={cn("rounded px-2 py-1", e.level === "error" ? "bg-critical/10" : e.level === "warn" ? "bg-warning/15" : "")}>
                <span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg" })}</span>{" "}
                <span className="uppercase">{e.level}</span> {e.message}
                {e.data && <span className="text-muted-foreground"> {JSON.stringify(e.data)}</span>}
              </li>
            ))}
            {events.length === 0 && <li className="text-muted-foreground">Waiting for the worker to pick up this job…</li>}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
