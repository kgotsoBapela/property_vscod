"use client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { bidSteps, calculateAcquisition, formatZar, sensitivity, type AcquisitionInputs } from "@propintel/shared";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type NullableKeys =
  | "buyer_commission_pct"
  | "conveyancing_fees"
  | "bond_costs"
  | "rates_arrears"
  | "levy_arrears"
  | "sheriff_or_auction_fees"
  | "renovation_allowance"
  | "holding_costs"
  | "other_costs";

const FIELDS: { key: NullableKeys; label: string; hint: string }[] = [
  { key: "buyer_commission_pct", label: "Buyer's commission / premium (%)", hint: "From the conditions of sale" },
  { key: "conveyancing_fees", label: "Conveyancing fees (R)", hint: "Obtain a quote" },
  { key: "bond_costs", label: "Bond registration costs (R)", hint: "Enter 0 for a cash purchase" },
  { key: "rates_arrears", label: "Rates & services arrears (R)", hint: "Municipal statement" },
  { key: "levy_arrears", label: "Levy arrears (R)", hint: "Body corporate / HOA" },
  { key: "sheriff_or_auction_fees", label: "Sheriff / auctioneer fees (R)", hint: "Conditions of sale" },
  { key: "renovation_allowance", label: "Renovation allowance (R)", hint: "Your estimate" },
  { key: "holding_costs", label: "Holding costs (R)", hint: "Until occupation or resale" },
  { key: "other_costs", label: "Other costs (R)", hint: "Anything else known" },
];

export interface ValuationRef {
  label: string;
  low: number | null;
  point: number | null;
  high: number | null;
}

export function ScenarioCalculator({ defaultPrice, valuations, isDemo }: { defaultPrice: number | null; valuations: ValuationRef[]; isDemo: boolean }) {
  const [price, setPrice] = useState(defaultPrice ? String(Math.round(defaultPrice)) : "");
  const [route, setRoute] = useState<AcquisitionInputs["purchase_route"]>("sheriff_sale");
  const [vat, setVat] = useState(false);
  const [vals, setVals] = useState<Record<NullableKeys, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, ""])) as Record<NullableKeys, string>);
  const [valIdx, setValIdx] = useState(0);

  const parsed = Number(price.replace(/[^\d.]/g, ""));
  const inputs: AcquisitionInputs | null =
    parsed > 0
      ? {
          purchase_price: parsed,
          purchase_route: route,
          as_of_date: new Date().toISOString().slice(0, 10),
          vat_transaction: vat,
          vat_rate: 0.15,
          ...(Object.fromEntries(FIELDS.map((f) => [f.key, vals[f.key].trim() === "" ? null : Number(vals[f.key].replace(/[^\d.]/g, ""))])) as Record<NullableKeys, number | null>),
        }
      : null;

  const result = inputs ? calculateAcquisition(inputs) : null;
  const valuation = valuations[valIdx] ?? null;
  const rows = inputs && valuation ? sensitivity(inputs, valuation, bidSteps(inputs.purchase_price)) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
          <CardDescription>Leave a field blank if the figure is unknown. Blank means unknown, not zero.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="price">Bid / offer price (R)</Label>
            <Input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="route">Purchase route</Label>
              <NativeSelect id="route" value={route} onChange={(e) => setRoute(e.target.value as AcquisitionInputs["purchase_route"])}>
                <option value="sheriff_sale">Sheriff sale</option>
                <option value="auction">Private / online auction</option>
                <option value="private_treaty">Private treaty</option>
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-xs">
              <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} /> Seller is a VAT vendor
            </label>
          </div>
          {FIELDS.filter((f) => !(route === "private_treaty" && (f.key === "buyer_commission_pct" || f.key === "sheriff_or_auction_fees"))).map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input id={f.key} inputMode="decimal" placeholder={`Unknown · ${f.hint}`} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6 lg:col-span-3">
        {isDemo && <Alert tone="demo">Valuation references come from synthetic demo data.</Alert>}
        <Card>
          <CardHeader>
            <CardTitle>Total acquisition cost</CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-muted-foreground">Enter a bid or offer price.</p>
            ) : (
              <>
                <Table>
                  <TBody>
                    {result.line_items.map((i) => (
                      <TR key={i.key}>
                        <TD>
                          {i.label}
                          {i.note && <div className="text-[11px] text-muted-foreground">{i.note}</div>}
                        </TD>
                        <TD className="tabular text-right align-top">
                          {i.status === "unknown" ? (
                            <Badge variant="warning">
                              <AlertTriangle className="size-3 text-warning" /> Unknown
                            </Badge>
                          ) : i.status === "not_applicable" ? (
                            <span className="text-muted-foreground">n/a</span>
                          ) : (
                            formatZar(i.amount)
                          )}
                        </TD>
                      </TR>
                    ))}
                    <TR className="font-semibold">
                      <TD>{result.total_is_complete ? "Total acquisition cost" : "Known costs (total is at least)"}</TD>
                      <TD className="tabular text-right">{formatZar(result.known_total)}</TD>
                    </TR>
                  </TBody>
                </Table>
                {!result.total_is_complete && (
                  <Alert tone="warning" className="mt-3">
                    {result.unknown_items.length} cost item(s) are unknown and excluded from the total: {result.unknown_items.join(", ")}. The real total will be higher.
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Sensitivity against valuation</CardTitle>
              <CardDescription>Valuation minus known acquisition cost at each bid. Unknown costs would reduce these margins.</CardDescription>
            </div>
            {valuations.length > 1 && (
              <NativeSelect className="w-56" value={valIdx} onChange={(e) => setValIdx(Number(e.target.value))} aria-label="Valuation reference">
                {valuations.map((v, i) => (
                  <option key={v.label} value={i}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </CardHeader>
          <CardContent>
            {!valuation ? (
              <p className="text-sm text-muted-foreground">No valuation reference available for this property. Open the calculator from a property page with an AVM or comparable indication.</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Enter a bid price.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Bid</TH>
                    <TH className="text-right">Known cost</TH>
                    <TH className="text-right">vs low {formatZar(valuation.low)}</TH>
                    <TH className="text-right">vs point {formatZar(valuation.point)}</TH>
                    <TH className="text-right">vs high {formatZar(valuation.high)}</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.bid} className={cn(r.bid === Math.round(parsed / 1000) * 1000 && "bg-accent/50")}>
                      <TD className="tabular">{formatZar(r.bid)}</TD>
                      <TD className="tabular text-right">{formatZar(r.known_total)}</TD>
                      {[r.vs_low, r.vs_point, r.vs_high].map((v, i) => (
                        <TD key={i} className="tabular text-right">
                          {v == null ? "—" : (
                            <span className={v < 0 ? "text-critical" : undefined}>
                              {v < 0 ? "−" : "+"}
                              {formatZar(Math.abs(v))}
                            </span>
                          )}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {valuation && <p className="mt-2 text-xs text-muted-foreground">Reference: {valuation.label}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
