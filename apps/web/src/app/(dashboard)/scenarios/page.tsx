import Link from "next/link";
import { PageHeader } from "@/components/dashboard/bits";
import { ScenarioCalculator, type ValuationRef } from "@/components/property/scenario-calculator";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { comparableAnalysisFor } from "@/lib/analysis";

export const metadata = { title: "Scenario calculator" };

export default async function ScenariosPage(props: PageProps<"/scenarios">) {
  const viewer = await requireViewer();
  const sp = await props.searchParams;
  const propertyId = typeof sp.property === "string" ? sp.property : null;
  const repo = getRepository();
  const detail = propertyId ? await repo.getProperty(propertyId, viewer) : null;

  const refs: ValuationRef[] = [];
  let defaultPrice: number | null = null;
  if (detail) {
    const v = detail.valuations[0];
    if (v?.point_estimate) refs.push({ label: `AVM estimate (${v.model}, ${v.as_of_date})`, low: v.range_low, point: v.point_estimate, high: v.range_high });
    const { analysis } = await comparableAnalysisFor(repo, detail);
    const ind = analysis.indication;
    if (ind.median_adjusted) refs.push({ label: `Comparable indication (${ind.sample_count} sales, ${ind.confidence.replace("_", " ")})`, low: ind.range_low, point: ind.median_adjusted, high: ind.range_high });
    // Pre-fill with a published reserve if there is an upcoming auction; otherwise leave the price for the user.
    const reserve = detail.auctions.flatMap((a) => a.auction.prices).find((p) => p.kind === "auction_reserve" && p.amount != null);
    defaultPrice = reserve?.amount ?? null;
  }

  return (
    <>
      <PageHeader
        title="Investment scenario calculator"
        description={
          detail ? (
            <>
              For{" "}
              <Link href={`/properties/${detail.property.id}`} className="text-primary hover:underline">
                {detail.property.normalized_address}
              </Link>
              . Transfer duty uses the versioned SARS table; everything else is your input.
            </>
          ) : (
            "Open from a property page to compare against its valuation references. Transfer duty uses the versioned SARS table."
          )
        }
      />
      <ScenarioCalculator defaultPrice={defaultPrice} valuations={refs} isDemo={detail?.property.is_demo ?? false} />
    </>
  );
}
