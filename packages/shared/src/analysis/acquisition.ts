/**
 * Acquisition cost and sensitivity analysis.
 * Unknown costs stay `null` and are listed explicitly; they are never treated as zero.
 */

export interface TransferDutyBracket {
  from: number; // exclusive lower bound (value above this)
  to: number | null;
  base: number;
  rate: number;
}

export interface TransferDutyTable {
  effective_from: string;
  source: string;
  verify_note: string;
  brackets: TransferDutyBracket[];
}

// Individuals and entities, non-VAT transactions. Keep versioned; update on each Budget.
export const TRANSFER_DUTY_TABLES: TransferDutyTable[] = [
  {
    effective_from: "2025-04-01",
    source: "https://www.sars.gov.za/tax-rates/transfer-duty/",
    verify_note: "Confirm current brackets with SARS or the conveyancer before relying on this figure.",
    brackets: [
      { from: 0, to: 1_210_000, base: 0, rate: 0 },
      { from: 1_210_000, to: 1_663_800, base: 0, rate: 0.03 },
      { from: 1_663_800, to: 2_329_300, base: 13_614, rate: 0.06 },
      { from: 2_329_300, to: 2_994_800, base: 53_544, rate: 0.08 },
      { from: 2_994_800, to: 13_310_000, base: 106_784, rate: 0.11 },
      { from: 13_310_000, to: null, base: 1_241_456, rate: 0.13 },
    ],
  },
];

export function transferDutyTableFor(date: string): TransferDutyTable | null {
  const applicable = TRANSFER_DUTY_TABLES.filter((t) => t.effective_from <= date).sort((a, b) =>
    b.effective_from.localeCompare(a.effective_from),
  );
  return applicable[0] ?? null;
}

export function calculateTransferDuty(price: number, table: TransferDutyTable): number {
  for (const b of table.brackets) {
    if (price > b.from && (b.to === null || price <= b.to)) {
      return Math.round(b.base + (price - b.from) * b.rate);
    }
  }
  return 0;
}

export interface AcquisitionInputs {
  purchase_price: number;
  purchase_route: "auction" | "sheriff_sale" | "private_treaty";
  as_of_date: string;
  vat_transaction: boolean; // if true, VAT is payable instead of transfer duty (seller is a VAT vendor)
  buyer_commission_pct: number | null; // auction buyer's premium, % excl. VAT
  vat_rate: number; // e.g. 0.15
  conveyancing_fees: number | null;
  bond_costs: number | null;
  rates_arrears: number | null;
  levy_arrears: number | null;
  sheriff_or_auction_fees: number | null;
  renovation_allowance: number | null;
  holding_costs: number | null;
  other_costs: number | null;
}

export type LineItemStatus = "calculated" | "entered" | "unknown" | "not_applicable";

export interface LineItem {
  key: string;
  label: string;
  amount: number | null;
  status: LineItemStatus;
  note: string | null;
}

export interface AcquisitionResult {
  line_items: LineItem[];
  known_total: number;
  unknown_items: string[];
  total_is_complete: boolean;
  transfer_duty_table: TransferDutyTable | null;
}

function entered(key: string, label: string, value: number | null, note: string | null = null): LineItem {
  return value == null
    ? { key, label, amount: null, status: "unknown", note: note ?? "Not provided; obtain a quote or statement" }
    : { key, label, amount: value, status: "entered", note };
}

export function calculateAcquisition(input: AcquisitionInputs): AcquisitionResult {
  const items: LineItem[] = [{ key: "purchase_price", label: "Bid / offer price", amount: input.purchase_price, status: "entered", note: null }];

  const table = transferDutyTableFor(input.as_of_date);
  if (input.vat_transaction) {
    items.push({
      key: "transfer_duty",
      label: "Transfer duty",
      amount: null,
      status: "not_applicable",
      note: "VAT transaction: VAT is payable instead of transfer duty; confirm whether price is VAT-inclusive",
    });
  } else if (table) {
    items.push({
      key: "transfer_duty",
      label: "Transfer duty",
      amount: calculateTransferDuty(input.purchase_price, table),
      status: "calculated",
      note: `SARS table effective ${table.effective_from}. ${table.verify_note}`,
    });
  } else {
    items.push({ key: "transfer_duty", label: "Transfer duty", amount: null, status: "unknown", note: "No duty table for this date" });
  }

  if (input.purchase_route === "private_treaty") {
    items.push({ key: "buyer_commission", label: "Buyer's commission", amount: null, status: "not_applicable", note: "Private treaty" });
  } else if (input.buyer_commission_pct == null) {
    items.push({
      key: "buyer_commission",
      label: "Buyer's commission / premium",
      amount: null,
      status: "unknown",
      note: "Check the conditions of sale for the buyer's commission",
    });
  } else {
    const excl = input.purchase_price * (input.buyer_commission_pct / 100);
    items.push({
      key: "buyer_commission",
      label: "Buyer's commission / premium (incl. VAT)",
      amount: Math.round(excl * (1 + input.vat_rate)),
      status: "calculated",
      note: `${input.buyer_commission_pct}% + ${(input.vat_rate * 100).toFixed(0)}% VAT`,
    });
  }

  items.push(entered("conveyancing_fees", "Conveyancing / transfer attorney fees", input.conveyancing_fees));
  items.push(entered("bond_costs", "Bond registration costs", input.bond_costs, input.bond_costs == null ? "Not provided (enter 0 if cash purchase)" : null));
  items.push(entered("rates_arrears", "Municipal rates & services arrears", input.rates_arrears, input.rates_arrears == null ? "Unknown: obtain municipal statement/clearance figures" : null));
  items.push(entered("levy_arrears", "Body corporate / HOA levy arrears", input.levy_arrears, input.levy_arrears == null ? "Unknown: obtain levy clearance figures if sectional title/estate" : null));
  if (input.purchase_route !== "private_treaty") {
    items.push(entered("sheriff_or_auction_fees", "Sheriff / auctioneer fees", input.sheriff_or_auction_fees, input.sheriff_or_auction_fees == null ? "Check conditions of sale" : null));
  }
  items.push(entered("renovation_allowance", "Renovation allowance", input.renovation_allowance));
  items.push(entered("holding_costs", "Holding costs until occupation/resale", input.holding_costs));
  items.push(entered("other_costs", "Other costs", input.other_costs, input.other_costs == null ? "Not provided" : null));

  const known_total = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const unknown_items = items.filter((i) => i.status === "unknown").map((i) => i.label);
  return { line_items: items, known_total, unknown_items, total_is_complete: unknown_items.length === 0, transfer_duty_table: table };
}

export interface SensitivityRow {
  bid: number;
  known_total: number;
  vs_low: number | null;
  vs_point: number | null;
  vs_high: number | null;
  margin_vs_point_pct: number | null;
}

/** Equity position of each bid against the valuation range. Positive = valuation exceeds known cost. */
export function sensitivity(
  base: AcquisitionInputs,
  valuation: { low: number | null; point: number | null; high: number | null },
  bidSteps: number[],
): SensitivityRow[] {
  return bidSteps.map((bid) => {
    const r = calculateAcquisition({ ...base, purchase_price: bid });
    const diff = (v: number | null) => (v == null ? null : v - r.known_total);
    return {
      bid,
      known_total: r.known_total,
      vs_low: diff(valuation.low),
      vs_point: diff(valuation.point),
      vs_high: diff(valuation.high),
      margin_vs_point_pct: valuation.point ? (valuation.point - r.known_total) / valuation.point : null,
    };
  });
}

export function bidSteps(center: number, stepPct = 0.05, steps = 3): number[] {
  const out: number[] = [];
  for (let i = -steps; i <= steps; i++) out.push(Math.round((center * (1 + i * stepPct)) / 1000) * 1000);
  return out.filter((v) => v > 0);
}
