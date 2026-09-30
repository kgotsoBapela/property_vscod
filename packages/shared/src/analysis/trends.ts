import type { PropertySale } from "../types/domain";
import { monthsBetween } from "./comparables";

export interface AppreciationPoint {
  from_date: string;
  to_date: string;
  from_amount: number;
  to_amount: number;
  total_change_pct: number;
  cagr_pct: number | null; // null when the holding period is under a year (annualising is misleading)
}

/** Appreciation between consecutive verified arm's-length registered transfers of the same property. */
export function appreciationBetweenSales(sales: PropertySale[]): AppreciationPoint[] {
  const usable = sales
    .filter((s) => s.verification_status === "verified" && s.is_arms_length && s.transfer_amount && s.registration_date)
    .sort((a, b) => a.registration_date!.localeCompare(b.registration_date!));
  const points: AppreciationPoint[] = [];
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1]!;
    const cur = usable[i]!;
    const years = monthsBetween(prev.registration_date!, cur.registration_date!) / 12;
    const ratio = cur.transfer_amount! / prev.transfer_amount!;
    points.push({
      from_date: prev.registration_date!,
      to_date: cur.registration_date!,
      from_amount: prev.transfer_amount!,
      to_amount: cur.transfer_amount!,
      total_change_pct: (ratio - 1) * 100,
      cagr_pct: years >= 1 ? (ratio ** (1 / years) - 1) * 100 : null,
    });
  }
  return points;
}

/** Most recent N verified registered transfers, newest first, plus how many exist in total. */
export function recentRegisteredTransfers(sales: PropertySale[], limit = 5) {
  const registered = sales
    .filter((s) => s.verification_status === "verified" && s.registration_date)
    .sort((a, b) => b.registration_date!.localeCompare(a.registration_date!));
  return { transfers: registered.slice(0, limit), available: registered.length, requested: limit };
}

/** Annual growth rate implied by two median observations, or null if not computable. */
export function annualisedGrowth(fromMedian: number | null, toMedian: number | null, months: number): number | null {
  if (!fromMedian || !toMedian || months < 6) return null;
  return (toMedian / fromMedian) ** (12 / months) - 1;
}
