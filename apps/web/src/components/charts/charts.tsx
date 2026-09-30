"use client";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { formatZar } from "@propintel/shared";

// Chart conventions (dataviz skill): one y-axis, thin 2px lines, >=8px markers, recessive grid/axes,
// text in text tokens (never series colour), single series needs no legend, tooltips on every mark.

const axisProps = {
  stroke: "var(--chart-grid)",
  tick: { fill: "var(--chart-axis)", fontSize: 11 },
  tickLine: false,
} as const;

const compactZar = (v: number) =>
  v >= 1_000_000 ? `R${(v / 1_000_000).toFixed(1)}m` : v >= 1_000 ? `R${Math.round(v / 1_000)}k` : `R${v}`;

function TooltipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 text-muted-foreground">
          <span>{k}</span>
          <span className="tabular text-foreground">{v}</span>
        </div>
      ))}
    </div>
  );
}

export interface TransferPoint {
  t: number; // epoch ms of registration date
  amount: number;
  label: string;
}

/** Registered transfers of the subject over time (single series: registered transfer prices only). */
export function TransferHistoryChart({ points }: { points: TransferPoint[] }) {
  return (
    <div className="h-56 w-full rounded-md bg-[var(--chart-surface)]" role="img" aria-label="Registered transfer prices over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => String(new Date(t).getUTCFullYear())}
            {...axisProps}
          />
          <YAxis tickFormatter={compactZar} width={56} {...axisProps} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as TransferPoint | undefined) : undefined;
              return p ? <TooltipBox title={p.label} rows={[["Registered transfer", formatZar(p.amount)]]} /> : null;
            }}
          />
          <Line
            type="linear"
            dataKey="amount"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--chart-surface)", strokeWidth: 2 }}
            activeDot={{ r: 6, stroke: "var(--chart-surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface MarketPointView {
  period: string;
  median_price_per_m2: number | null;
  sample_count: number;
}

/** Suburb median registered price per m², half-yearly. Periods with too few sales show as gaps. */
export function MarketChart({ series }: { series: MarketPointView[] }) {
  return (
    <div className="h-56 w-full rounded-md bg-[var(--chart-surface)]" role="img" aria-label="Suburb median price per square metre by half-year">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="period" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tickFormatter={(v: number) => `R${Math.round(v / 1000)}k`} width={48} {...axisProps} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as MarketPointView | undefined) : undefined;
              return p ? (
                <TooltipBox
                  title={p.period}
                  rows={[
                    ["Median R/m²", p.median_price_per_m2 != null ? formatZar(p.median_price_per_m2) : "Insufficient sales"],
                    ["Sales in period", String(p.sample_count)],
                  ]}
                />
              ) : null;
            }}
          />
          <Line
            type="linear"
            dataKey="median_price_per_m2"
            stroke="var(--series-1)"
            strokeWidth={2}
            connectNulls={false}
            dot={{ r: 3, fill: "var(--series-1)", stroke: "var(--chart-surface)", strokeWidth: 1 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CompPoint {
  distance_m: number;
  price: number;
  address: string;
  date: string;
  included: boolean;
}

/** Comparable sales: distance vs price. Two series (included / excluded) with a legend. */
export function CompsScatter({ points, subjectEstimate }: { points: CompPoint[]; subjectEstimate: number | null }) {
  const included = points.filter((p) => p.included);
  const excluded = points.filter((p) => !p.included);
  return (
    <div className="h-64 w-full rounded-md bg-[var(--chart-surface)]" role="img" aria-label="Comparable sales by distance and price">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 16, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" />
          <XAxis dataKey="distance_m" type="number" name="Distance" unit=" m" {...axisProps} />
          <YAxis dataKey="price" type="number" name="Price" tickFormatter={compactZar} width={56} {...axisProps} axisLine={false} />
          <ZAxis range={[64, 64]} />
          <Tooltip
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as CompPoint | undefined) : undefined;
              return p ? (
                <TooltipBox
                  title={p.address}
                  rows={[
                    [p.included ? "Adjusted registered price" : "Registered transfer", formatZar(p.price)],
                    ["Registered", p.date],
                    ["Distance", `${p.distance_m} m`],
                    ["Status", p.included ? "Included" : "Excluded"],
                  ]}
                />
              ) : null;
            }}
          />
          <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12, color: "var(--chart-axis)" }} />
          <Scatter name="Included (adjusted)" data={included} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} />
          <Scatter name="Excluded (unadjusted)" data={excluded} fill="var(--series-muted)" stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} />
          {subjectEstimate != null && (
            <Scatter
              name="Comparable indication (median)"
              data={[{ distance_m: 0, price: subjectEstimate, address: "Subject: comparable indication", date: "—", included: true }]}
              fill="var(--series-2)"
              shape="diamond"
              isAnimationActive={false}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
