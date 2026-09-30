import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { can, formatZar, PRICE_KIND_LABELS, recentRegisteredTransfers, TRANSFER_TYPE_LABELS } from "@propintel/shared";
import { Alert, Button, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { describeIdentifier, PageHeader } from "@/components/dashboard/bits";
import { PrintButton } from "@/components/property/print-button";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { comparableAnalysisFor } from "@/lib/analysis";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Analysis report" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t py-5">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ReportPage(props: PageProps<"/properties/[id]/report">) {
  const { id } = await props.params;
  const viewer = await requireViewer();
  const repo = getRepository();
  const d = await repo.getProperty(id, viewer);
  if (!d) notFound();
  const { analysis, trend } = await comparableAnalysisFor(repo, d);
  const recent = recentRegisteredTransfers(d.sales, 5);
  const v = d.valuations[0] ?? null;
  const ind = analysis.indication;
  const unknowns = [
    ...(recent.available < 5 ? [`Only ${recent.available} verified registered transfer(s) available`] : []),
    ...(v ? [] : ["No provider AVM available"]),
    ...(d.property.floor_size_m2 == null ? ["Floor size unknown"] : []),
    ...(d.property.latitude == null ? ["No licensed coordinates: nearby comparables cannot be located"] : []),
    ...(d.identifiers.some((i) => i.kind !== "provider_property_id") ? [] : ["No legal identifier on record"]),
    ...(trend.annual_rate == null ? ["No area trend: comparables not time-adjusted"] : []),
    "Municipal rates, levies and other arrears are not known from these sources",
    "Physical condition has not been inspected",
  ];

  return (
    <article className="mx-auto max-w-4xl">
      <PageHeader
        title="Property analysis report"
        description={`${d.property.normalized_address}. Generated ${fmtDateTime(new Date().toISOString())} for ${viewer.label}.`}
        actions={
          can(viewer.role, "report:export") ? (
            <>
              <PrintButton />
              <Button variant="outline" asChild>
                <a href={`/api/properties/${id}/export?format=csv`}>
                  <Download /> CSV
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`/api/properties/${id}/export?format=json`}>
                  <Download /> JSON
                </a>
              </Button>
            </>
          ) : null
        }
      />

      {d.property.is_demo && (
        <Alert tone="demo" className="mb-4">
          <strong>SYNTHETIC DEMO DATA.</strong> This report is built from fixture data and describes no real property.
        </Alert>
      )}
      <Alert className="mb-2">
        Decision support only. This is not a certified appraisal, legal opinion or guarantee of auction status. Figures are labelled with their
        meaning, source and date; unknowns are listed explicitly and are not treated as zero.
      </Alert>

      <Section title="1. Property identity">
        <p className="text-sm">{d.property.normalized_address}, {d.property.suburb}, {d.property.province}</p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {d.identifiers.map((i) => (
            <li key={i.id}>
              {describeIdentifier(i)} ({i.verification_status}; source {i.provenance.provider}, retrieved {fmtDate(i.provenance.retrieved_at)})
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`2. Verified registered transfers (${recent.transfers.length} of up to 5 requested; ${recent.available} available)`}>
        {recent.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">None available from licensed sources.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Registered</TH>
                <TH className="text-right">{PRICE_KIND_LABELS.registered_transfer}</TH>
                <TH>Type</TH>
                <TH>Source · retrieved</TH>
              </TR>
            </THead>
            <TBody>
              {recent.transfers.map((s) => (
                <TR key={s.id}>
                  <TD>{fmtDate(s.registration_date)}</TD>
                  <TD className="tabular text-right">{s.transfer_amount != null ? formatZar(s.transfer_amount) : "Not disclosed"}</TD>
                  <TD>
                    {TRANSFER_TYPE_LABELS[s.transfer_type]}
                    {!s.is_arms_length && " (not arm's length)"}
                  </TD>
                  <TD className="text-xs">
                    {s.provenance.provider} · {fmtDate(s.provenance.retrieved_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="3. Valuation">
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="font-medium">{PRICE_KIND_LABELS.avm_estimate}</div>
            {v ? (
              <p>
                {formatZar(v.point_estimate)} (range {formatZar(v.range_low)} – {formatZar(v.range_high)}), {v.confidence} confidence. {v.model}, as of{" "}
                {fmtDate(v.as_of_date)}; source {v.provenance.provider}.
              </p>
            ) : (
              <p className="text-muted-foreground">Not available.</p>
            )}
          </div>
          <div>
            <div className="font-medium">Comparable-sales indication</div>
            {ind.median_adjusted != null ? (
              <p>
                Median adjusted {formatZar(ind.median_adjusted)} (IQR {formatZar(ind.range_low)} – {formatZar(ind.range_high)}) from {ind.sample_count} sales within{" "}
                {analysis.filters.radius_m} m over {analysis.filters.lookback_months} months; {ind.confidence.replace("_", " ")} confidence.
              </p>
            ) : (
              <p className="text-muted-foreground">Insufficient comparable data.</p>
            )}
          </div>
        </div>
        <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
          {ind.explanation.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Section>

      <Section title="4. Included comparables">
        <Table>
          <THead>
            <TR>
              <TH>Address</TH>
              <TH>Registered</TH>
              <TH className="text-right">Distance</TH>
              <TH className="text-right">Registered transfer</TH>
              <TH className="text-right">Adjusted</TH>
            </TR>
          </THead>
          <TBody>
            {analysis.comps
              .filter((c) => c.included)
              .map((c) => (
                <TR key={c.sale_id}>
                  <TD>{c.address}</TD>
                  <TD>{fmtDate(c.registration_date)}</TD>
                  <TD className="tabular text-right">{c.distance_m} m</TD>
                  <TD className="tabular text-right">{formatZar(c.sale_price)}</TD>
                  <TD className="tabular text-right">{formatZar(c.adjusted_price)}</TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </Section>

      <Section title="5. Auction & sheriff notices">
        {d.auctions.length === 0 ? (
          <p className="text-sm text-muted-foreground">None on record.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {d.auctions.map((a) => (
              <li key={a.auction.id}>
                {a.auction.title}: {a.auction.status}, {fmtDateTime(a.auction.event_at)}.{" "}
                {a.auction.prices.map((p) => `${PRICE_KIND_LABELS[p.kind]} ${p.amount != null ? formatZar(p.amount) : "not disclosed"}`).join("; ")}.{" "}
                {a.review_status === "needs_review" ? "Possible match only (needs review). " : ""}
                Last verified {fmtDateTime(a.auction.last_verified_at)}. Notice: {a.auction.notice_url ?? "none"}. Confirm with the sheriff/auctioneer.
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="6. Known unknowns">
        <ul className="list-disc pl-5 text-sm">
          {unknowns.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </Section>

      <Section title="7. Sources">
        <ul className="list-disc pl-5 text-sm">
          {d.sources.map((s) => (
            <li key={s.provider}>
              {s.provider}: retrieved {fmtDateTime(s.retrieved_at)}
              {s.is_demo ? " (synthetic)" : ""}
            </li>
          ))}
          <li>Market trend: {trend.basis}</li>
        </ul>
      </Section>
    </article>
  );
}
