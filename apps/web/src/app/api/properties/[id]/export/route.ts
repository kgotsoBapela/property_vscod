import { NextResponse } from "next/server";
import { recentRegisteredTransfers, TRANSFER_TYPE_LABELS } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";
import { comparableAnalysisFor } from "@/lib/analysis";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request, ctx: RouteContext<"/api/properties/[id]/export">) {
  return handle(async () => {
    const viewer = await requireCapability("report:export");
    const { id } = await ctx.params;
    const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
    const repo = getRepository();
    const d = await repo.getProperty(id, viewer);
    if (!d) throw new HttpError(404, "Property not found");
    const { analysis } = await comparableAnalysisFor(repo, d);
    await repo.writeAudit(viewer, "report.export", id, { format });
    const generatedAt = new Date().toISOString();
    const demo = d.property.is_demo;

    if (format === "json") {
      // Owner/debtor personal information is never included; only property-level data and provenance.
      const body = {
        generated_at: generatedAt,
        disclaimer: "Decision support only. Not a certified appraisal, legal opinion or guarantee of auction status.",
        synthetic_demo_data: demo,
        property: d.property,
        identifiers: d.identifiers.map(({ provenance, ...i }) => ({ ...i, source: provenance.provider, retrieved_at: provenance.retrieved_at })),
        registered_transfers: recentRegisteredTransfers(d.sales, 5),
        valuations: d.valuations,
        comparable_analysis: { filters: analysis.filters, indication: analysis.indication, comps: analysis.comps.filter((c) => c.included) },
        auctions: d.auctions.map((a) => ({ ...a.auction, match_review_status: a.review_status, match_evidence: a.match_evidence })),
        sources: d.sources,
      };
      return new NextResponse(JSON.stringify(body, null, 2), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="property-${id}.json"` },
      });
    }

    const lines: string[][] = [
      ["section", "field", "value", "price_meaning", "effective_date", "source", "retrieved_at"],
      ["meta", "generated_at", generatedAt, "", "", "", ""],
      ["meta", "synthetic_demo_data", String(demo), "", "", "", ""],
      ["property", "address", d.property.normalized_address, "", "", "", ""],
      ...d.identifiers
        .filter((i) => i.kind !== "provider_property_id")
        .map((i) => ["identifier", i.kind, [i.erf_number, i.portion, i.township, i.scheme_name, i.scheme_number, i.unit_number].filter(Boolean).join(" / "), "", "", i.provenance.provider, i.provenance.retrieved_at]),
      ...recentRegisteredTransfers(d.sales, 5).transfers.map((s) => [
        "transfer",
        TRANSFER_TYPE_LABELS[s.transfer_type],
        s.transfer_amount == null ? "not disclosed" : String(s.transfer_amount),
        "registered_transfer",
        s.registration_date ?? "",
        s.provenance.provider,
        s.provenance.retrieved_at,
      ]),
      ...d.valuations.map((v) => ["valuation", `${v.model} (${v.confidence})`, `${v.point_estimate ?? ""} [${v.range_low ?? ""}-${v.range_high ?? ""}]`, "avm_estimate", v.as_of_date, v.provenance.provider, v.provenance.retrieved_at]),
      ["comparables", "median_adjusted", String(analysis.indication.median_adjusted ?? "insufficient data"), "comparable indication", analysis.as_of, "derived", ""],
      ...analysis.comps
        .filter((c) => c.included)
        .map((c) => ["comparable", c.address, String(c.adjusted_price), "adjusted registered_transfer", c.registration_date ?? "", "derived", ""]),
    ];
    const csv = lines.map((l) => l.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="property-${id}.csv"` },
    });
  });
}
