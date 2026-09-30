import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Calculator, FileText, Scale } from "lucide-react";
import {
  appreciationBetweenSales,
  can,
  formatZar,
  PRICE_KIND_LABELS,
  recentRegisteredTransfers,
  TRANSFER_TYPE_LABELS,
} from "@propintel/shared";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import {
  AuctionStatusBadge,
  ConfidenceBadge,
  DemoBadge,
  describeIdentifier,
  EmptyState,
  PageHeader,
  PriceTag,
  SourceNote,
  VerificationBadge,
} from "@/components/dashboard/bits";
import { MarketChart, TransferHistoryChart } from "@/components/charts/charts";
import { RefreshButtons, WatchButton } from "@/components/property/actions";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { comparableAnalysisFor } from "@/lib/analysis";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/properties/[id]">) {
  const { id } = await props.params;
  const viewer = await requireViewer();
  const d = await getRepository().getProperty(id, viewer);
  return { title: d?.property.normalized_address ?? "Property" };
}

export default async function PropertyPage(props: PageProps<"/properties/[id]">) {
  const { id } = await props.params;
  const viewer = await requireViewer();
  const repo = getRepository();
  const d = await repo.getProperty(id, viewer);
  if (!d) notFound();
  const { property: p } = d;

  const recent = recentRegisteredTransfers(d.sales, 5);
  const otherTransfers = d.sales.filter((s) => !recent.transfers.includes(s) && !(s.verification_status === "verified" && s.registration_date));
  const appreciation = appreciationBetweenSales(d.sales);
  const valuation = d.valuations[0] ?? null;
  const { analysis, trend } = await comparableAnalysisFor(repo, d);
  const ind = analysis.indication;
  const integrations = can(viewer.role, "sync:trigger") ? await repo.listIntegrations() : [];
  const syncIntegration = integrations.find((i) => ["active", "sandbox"].includes(i.status) && i.capabilities.includes("subject_property"));
  const chartPoints = recent.transfers
    .concat(d.sales.filter((s) => s.verification_status === "verified" && s.registration_date && !recent.transfers.includes(s)))
    .filter((s) => s.transfer_amount != null)
    .map((s) => ({ t: Date.parse(s.registration_date!), amount: s.transfer_amount!, label: `${fmtDate(s.registration_date)} · ${TRANSFER_TYPE_LABELS[s.transfer_type]}` }))
    .sort((a, b) => a.t - b.t);
  const legal = d.identifiers.filter((i) => i.kind !== "provider_property_id");

  return (
    <>
      <PageHeader
        title={p.normalized_address}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.suburb}, {p.municipality ?? "municipality unknown"}, {p.province}
            <Badge variant="muted">{p.property_type.replace("_", " ")}</Badge>
            <DemoBadge show={p.is_demo} />
          </span>
        }
        actions={
          <>
            <WatchButton propertyId={p.id} initial={d.watchlisted} />
            <Button variant="outline" asChild>
              <Link href={`/properties/${p.id}/comparables`}>
                <Scale /> Comparables
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/scenarios?property=${p.id}`}>
                <Calculator /> Scenario
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/properties/${p.id}/report`}>
                <FileText /> Report
              </Link>
            </Button>
          </>
        }
      />

      {syncIntegration && (
        <div className="mb-4 flex justify-end">
          <RefreshButtons propertyId={p.id} integrationId={syncIntegration.id} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Legal identity & attributes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {legal.length === 0 ? (
              <Alert tone="warning">No legal identifier (erf or sectional scheme/unit) on record. Identity is address-based and unconfirmed.</Alert>
            ) : (
              legal.map((i) => (
                <div key={i.id} className="flex flex-col gap-1">
                  <span className="font-medium">{describeIdentifier(i)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <VerificationBadge status={i.verification_status} /> via {i.provenance.provider}
                  </span>
                </div>
              ))
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Erf size</dt>
              <dd className="tabular">{p.erf_size_m2 ? `${fmtNumber(p.erf_size_m2)} m²` : "Not available"}</dd>
              <dt className="text-muted-foreground">Floor size</dt>
              <dd className="tabular">{p.floor_size_m2 ? `${fmtNumber(p.floor_size_m2)} m²` : "Not available"}</dd>
              <dt className="text-muted-foreground">Bedrooms / baths</dt>
              <dd className="tabular">{p.bedrooms ?? "—"} / {p.bathrooms ?? "—"}</dd>
              <dt className="text-muted-foreground">Coordinates</dt>
              <dd className="tabular text-xs">{p.latitude != null ? `${p.latitude.toFixed(4)}, ${p.longitude?.toFixed(4)}` : "Not licensed / unavailable"}</dd>
            </dl>
          </CardContent>
        </Card>

        {/* Valuation */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Valuation estimates</CardTitle>
            <CardDescription>Estimates, not appraisals. Each figure is labelled with what it is and where it came from.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <div className="text-sm font-medium">Provider AVM</div>
              {valuation ? (
                <>
                  <PriceTag kind="avm_estimate" amount={valuation.point_estimate} />
                  <div className="text-sm">
                    Range <span className="tabular">{formatZar(valuation.range_low)} – {formatZar(valuation.range_high)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <ConfidenceBadge confidence={valuation.confidence} /> {valuation.model} · as of {fmtDate(valuation.as_of_date)}
                  </div>
                  {valuation.confidence_notes && <p className="text-xs text-muted-foreground">{valuation.confidence_notes}</p>}
                </>
              ) : (
                <EmptyState title="No AVM available">No licensed automated valuation has been supplied for this property.</EmptyState>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-sm font-medium">Comparable-sales indication</div>
              {ind.median_adjusted != null ? (
                <>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Median adjusted {PRICE_KIND_LABELS.registered_transfer.toLowerCase()} of comparables</span>
                    <span className="tabular text-base font-semibold">{formatZar(ind.median_adjusted)}</span>
                  </div>
                  <div className="text-sm">
                    Interquartile range <span className="tabular">{formatZar(ind.range_low)} – {formatZar(ind.range_high)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <ConfidenceBadge confidence={ind.confidence} /> {ind.sample_count} sales within {analysis.filters.radius_m} m, {analysis.filters.lookback_months} months
                  </div>
                </>
              ) : (
                <EmptyState title="Insufficient comparable sales">{ind.explanation.slice(0, 2).join(" ")}</EmptyState>
              )}
              <Link href={`/properties/${p.id}/comparables`} className="text-xs text-primary hover:underline">
                See how this was calculated →
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Transfers */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Most recent verified registered transfers</CardTitle>
            <CardDescription>
              {recent.available >= 5
                ? `Showing the 5 most recent of ${recent.available} verified registered transfers.`
                : recent.available === 0
                  ? "No verified registered transfers are available from licensed sources."
                  : `Only ${recent.available} verified registered transfer${recent.available === 1 ? " is" : "s are"} available (up to 5 requested).`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            {recent.transfers.length === 0 ? (
              <EmptyState title="No transfer history">Missing history is shown as missing; nothing is estimated in its place.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Registered</TH>
                    <TH>Sale date</TH>
                    <TH className="text-right">Registered transfer</TH>
                    <TH>Type</TH>
                    <TH>Title deed</TH>
                  </TR>
                </THead>
                <TBody>
                  {recent.transfers.map((s) => (
                    <TR key={s.id}>
                      <TD className="whitespace-nowrap">{fmtDate(s.registration_date)}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{s.sale_date ? fmtDate(s.sale_date) : "Unknown"}</TD>
                      <TD className="tabular text-right">{s.transfer_amount != null ? formatZar(s.transfer_amount) : <span className="text-muted-foreground">Not disclosed</span>}</TD>
                      <TD>
                        {TRANSFER_TYPE_LABELS[s.transfer_type]}
                        {!s.is_arms_length && (
                          <Badge variant="warning" className="ml-1">
                            <AlertTriangle className="size-3 text-warning" /> Not arm&apos;s length
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-xs text-muted-foreground">{s.title_deed ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <div className="flex flex-col gap-3">
              {chartPoints.length >= 2 ? <TransferHistoryChart points={chartPoints} /> : <EmptyState title="Not enough transfers to chart" />}
              {appreciation.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Appreciation between arm&apos;s-length registered transfers</div>
                  {appreciation.map((a) => (
                    <div key={a.to_date} className="tabular">
                      {fmtDate(a.from_date)} → {fmtDate(a.to_date)}: {a.total_change_pct >= 0 ? "+" : ""}
                      {a.total_change_pct.toFixed(1)}%{a.cagr_pct != null ? ` (${a.cagr_pct.toFixed(1)}% p.a.)` : " (under 1 year; not annualised)"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
          {otherTransfers.length > 0 && (
            <CardContent className="text-xs text-muted-foreground">
              {otherTransfers.length} further transfer record(s) are unverified or lack a registration date and are excluded above.
            </CardContent>
          )}
          <CardFooter>
            <SourceNote sources={d.sources} />
          </CardFooter>
        </Card>

        {/* Market */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {p.suburb}: median registered price per m² ({p.property_type.replace("_", " ")})
            </CardTitle>
            <CardDescription>
              Derived from verified arm&apos;s-length registered transfers on record. {trend.annual_rate != null ? `Trend ${(trend.annual_rate * 100).toFixed(1)}% p.a. (${trend.basis}).` : trend.basis + "."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.market_series.length === 0 ? (
              <EmptyState title="No market data for this segment" />
            ) : (
              <MarketChart series={d.market_series.map((m) => ({ period: m.period, median_price_per_m2: m.median_price_per_m2, sample_count: m.sample_count }))} />
            )}
          </CardContent>
        </Card>

        {/* Auctions */}
        <Card>
          <CardHeader>
            <CardTitle>Auction & sheriff notices</CardTitle>
            <CardDescription>Potential matches. Confirm with the sheriff or auctioneer.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {d.auctions.length === 0 ? (
              <EmptyState title="No matching auction notices on record" />
            ) : (
              d.auctions.map((a) => (
                <div key={a.auction.id} className="rounded-md border p-3">
                  <Link href={`/auctions/${a.auction.id}`} className="font-medium text-primary hover:underline">
                    {a.auction.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <AuctionStatusBadge status={a.auction.status} /> {fmtDateTime(a.auction.event_at)}
                  </div>
                  <div className="mt-1 text-xs">
                    {a.review_status === "needs_review" ? (
                      <span className="text-foreground">
                        <AlertTriangle className="inline size-3 text-warning" /> Possible match only: needs human review ({a.described_address})
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Matched ({Math.round(a.match_confidence * 100)}%): {a.match_evidence.join("; ")}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
