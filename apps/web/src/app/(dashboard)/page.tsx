import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { can, formatZar, SYNC_STATUS_LABELS } from "@propintel/shared";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { AuctionStatusBadge, EmptyState, PageHeader, PropertyLink, Stat } from "@/components/dashboard/bits";
import { SearchBox } from "@/components/property/search-box";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { fmtDateTime, isStale, relativeAge, STALE_AFTER_HOURS } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const viewer = await requireViewer();
  const o = await getRepository().getOverview(viewer);
  const stale = o.freshness.filter((f) => isStale(f.last_success_at));
  const failed = o.recent_jobs.filter((j) => j.status === "failed");

  return (
    <>
      <PageHeader title="Overview" description="Tracked assets, market summary, upcoming auctions and data freshness." />
      <div className="mb-6 max-w-2xl">
        <SearchBox />
      </div>

      {(stale.length > 0 || failed.length > 0) && can(viewer.role, "sync:read") && (
        <Alert tone="warning" className="mb-6 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            {stale.map((f) => (
              <div key={f.provider}>
                <strong>{f.display_name}</strong> has not synced successfully in over {STALE_AFTER_HOURS} hours (last success: {relativeAge(f.last_success_at)}).
              </div>
            ))}
            {failed.length > 0 && (
              <div>
                {failed.length} recent sync job(s) failed. Prior data was preserved. <Link className="underline" href="/sync">Open sync center</Link>
              </div>
            )}
          </div>
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Properties on record" value={o.counts.properties.toLocaleString("en-ZA")} />
        <Stat label="Verified registered transfers" value={o.counts.registered_sales.toLocaleString("en-ZA")} />
        <Stat label="Upcoming / recent auctions" value={o.counts.upcoming_auctions} />
        <Stat
          label="Awaiting identity review"
          value={o.counts.open_reviews + o.counts.lots_needing_review}
          hint={can(viewer.role, "identity:review") ? <Link className="underline" href="/review">Review queue</Link> : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming auctions</CardTitle>
            <CardDescription>Always confirm dates and status with the sheriff or auctioneer.</CardDescription>
          </CardHeader>
          <CardContent>
            {o.upcoming.length === 0 ? (
              <EmptyState title="No upcoming auctions on record" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Auction</TH>
                    <TH>Status</TH>
                    <TH>Match</TH>
                  </TR>
                </THead>
                <TBody>
                  {o.upcoming.map((u) => (
                    <TR key={u.auction.id}>
                      <TD className="whitespace-nowrap">{fmtDateTime(u.auction.event_at)}</TD>
                      <TD>
                        <Link href={`/auctions/${u.auction.id}`} className="font-medium text-primary hover:underline">
                          {u.auction.title}
                        </Link>
                      </TD>
                      <TD>
                        <AuctionStatusBadge status={u.auction.status} />
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {u.lots.some((l) => l.review_status === "needs_review") ? "Needs review" : u.lots.some((l) => l.property_id) ? "Matched" : "Unmatched"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <Link href="/auctions" className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">
              All auctions <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data freshness</CardTitle>
            <CardDescription>Stale after {STALE_AFTER_HOURS} h (proposed threshold).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {o.freshness.length === 0 && <EmptyState title="No active integrations" />}
            {o.freshness.map((f) => (
              <div key={f.provider} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.display_name}</span>
                  {isStale(f.last_success_at) ? <Badge variant="warning">Stale</Badge> : <Badge variant="good">Fresh</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Last success {fmtDateTime(f.last_success_at)}
                  <br />
                  Last failure {f.last_failure_at ? fmtDateTime(f.last_failure_at) : "none recorded"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Market summary (last 12 months)</CardTitle>
            <CardDescription>Median of verified arm&apos;s-length registered transfers. Medians need at least 3 sales.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Suburb</TH>
                  <TH className="text-right">Registered sales</TH>
                  <TH className="text-right">Median registered transfer</TH>
                </TR>
              </THead>
              <TBody>
                {o.suburbs.map((s) => (
                  <TR key={s.suburb}>
                    <TD>{s.suburb}</TD>
                    <TD className="tabular text-right">{s.sales_12m}</TD>
                    <TD className="tabular text-right">{s.median_12m != null ? formatZar(s.median_12m) : <span className="text-muted-foreground">Insufficient sales</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your watchlist</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {o.watchlist.length === 0 ? (
              <EmptyState title="Nothing tracked yet">Use “Track” on a property page.</EmptyState>
            ) : (
              o.watchlist.map((p) => (
                <div key={p.id}>
                  <PropertyLink id={p.id}>{p.normalized_address}</PropertyLink>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {can(viewer.role, "sync:read") && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Recent sync jobs</CardTitle>
            </CardHeader>
            <CardContent>
              {o.recent_jobs.length === 0 ? (
                <EmptyState title="No jobs yet" />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Created</TH>
                      <TH>Scope</TH>
                      <TH>Trigger</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Upserted / failed</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {o.recent_jobs.map((j) => (
                      <TR key={j.id}>
                        <TD>
                          <Link href={`/sync/${j.id}`} className="text-primary hover:underline">
                            {fmtDateTime(j.created_at)}
                          </Link>
                        </TD>
                        <TD>{j.scope.replaceAll("_", " ")}</TD>
                        <TD>{j.trigger}</TD>
                        <TD>{SYNC_STATUS_LABELS[j.status]}</TD>
                        <TD className="tabular text-right">
                          {j.records_upserted} / {j.records_failed}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
