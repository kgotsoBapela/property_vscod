"use client";
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, Check, X } from "lucide-react";
import { formatZar, type ComparableAnalysis, type ComparableResult } from "@propintel/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { ConfidenceBadge, EmptyState } from "@/components/dashboard/bits";
import { CompsScatter } from "@/components/charts/charts";
import { cn, fmtDate } from "@/lib/utils";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
const helper = createColumnHelper<typeof features, ComparableResult>();

interface Filters {
  radius_m: number;
  lookback_months: number;
  type: string;
  min_floor_m2: string;
  max_floor_m2: string;
  include_non_arms_length: boolean;
  verified_only: boolean;
}

export function ComparablesExplorer({ propertyId, subjectType, canReview }: { propertyId: string; subjectType: string; canReview: boolean }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    radius_m: 1500,
    lookback_months: 24,
    type: subjectType,
    min_floor_m2: "",
    max_floor_m2: "",
    include_non_arms_length: false,
    verified_only: true,
  });
  const [showExcluded, setShowExcluded] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: "distance_m", desc: false }]);

  const params = new URLSearchParams({
    radius_m: String(filters.radius_m),
    lookback_months: String(filters.lookback_months),
    include_non_arms_length: String(filters.include_non_arms_length),
    verified_only: String(filters.verified_only),
    ...(filters.min_floor_m2 ? { min_floor_m2: filters.min_floor_m2 } : {}),
    ...(filters.max_floor_m2 ? { max_floor_m2: filters.max_floor_m2 } : {}),
  });
  if (filters.type !== "all") params.append("type", filters.type);
  else ["freehold", "sectional_title", "vacant_land", "agricultural", "commercial"].forEach((t) => params.append("type", t));

  const query = useQuery({
    queryKey: ["comparables", propertyId, params.toString()],
    queryFn: async (): Promise<{ analysis: ComparableAnalysis; trend: { annual_rate: number | null; basis: string } }> => {
      const res = await fetch(`/api/properties/${propertyId}/comparables?${params}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load comparables");
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const override = useMutation({
    mutationFn: async (v: { sale_id: string; value: "include" | "exclude" | null }) => {
      const res = await fetch(`/api/properties/${propertyId}/comparables`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparables", propertyId] }),
  });

  const analysis = query.data?.analysis;
  const rows = useMemo(() => (analysis?.comps ?? []).filter((c) => showExcluded || c.included), [analysis, showExcluded]);

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("included", {
          header: "Status",
          sortFn: "basic",
          cell: (info) => {
            const r = info.row.original;
            return (
              <div className="flex flex-col gap-1">
                {r.included ? <Badge variant="good">Included</Badge> : <Badge variant="muted">Excluded</Badge>}
                {r.manually_overridden && <span className="text-[11px] text-muted-foreground">Analyst override</span>}
              </div>
            );
          },
        }),
        helper.accessor("address", { header: "Address", sortFn: "alphanumeric" }),
        helper.accessor("distance_m", { header: "Distance", sortFn: "basic", cell: (i) => (i.getValue() != null ? `${i.getValue()} m` : "Unknown") }),
        helper.accessor("registration_date", { header: "Registered", sortFn: "alphanumeric", cell: (i) => fmtDate(i.getValue()) }),
        helper.accessor("sale_price", {
          header: "Registered transfer",
          sortFn: "basic",
          cell: (i) => (i.getValue() != null ? formatZar(i.getValue()) : "Not disclosed"),
        }),
        helper.accessor("floor_size_m2", { header: "Floor m²", sortFn: "basic", cell: (i) => i.getValue() ?? "—" }),
        helper.accessor("adjusted_price", {
          header: "Adjusted",
          sortFn: "basic",
          cell: (info) => {
            const r = info.row.original;
            if (!r.included) return <span className="text-xs text-muted-foreground">{r.exclusion_reasons.join("; ")}</span>;
            return (
              <div>
                <div className="tabular font-medium">{formatZar(r.adjusted_price)}</div>
                {r.adjustments.map((a) => (
                  <div key={a.factor} className="text-[11px] text-muted-foreground">
                    {a.amount >= 0 ? "+" : ""}
                    {formatZar(a.amount)} {a.factor.replace("_", " ")}: {a.explanation}
                  </div>
                ))}
              </div>
            );
          },
        }),
        helper.display({
          id: "actions",
          header: "",
          cell: (info) => {
            const r = info.row.original;
            if (!canReview) return null;
            if (r.manually_overridden)
              return (
                <Button size="sm" variant="ghost" onClick={() => override.mutate({ sale_id: r.sale_id, value: null })}>
                  Reset
                </Button>
              );
            return r.included ? (
              <Button size="sm" variant="ghost" onClick={() => override.mutate({ sale_id: r.sale_id, value: "exclude" })}>
                <X /> Exclude
              </Button>
            ) : r.sale_price != null && !r.exclusion_reasons.includes("Subject property itself") ? (
              <Button size="sm" variant="ghost" onClick={() => override.mutate({ sale_id: r.sale_id, value: "include" })}>
                <Check /> Include
              </Button>
            ) : null;
          },
        }),
      ]),
    [canReview, override],
  );

  const table = useTable({ features, columns, data: rows, state: { sorting }, onSortingChange: setSorting });
  const ind = analysis?.indication;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-5 md:grid-cols-4 lg:grid-cols-7">
          <div className="flex flex-col gap-1">
            <Label htmlFor="radius">Radius (m)</Label>
            <NativeSelect id="radius" value={filters.radius_m} onChange={(e) => setFilters({ ...filters, radius_m: Number(e.target.value) })}>
              {[500, 1000, 1500, 2500, 5000].map((v) => (
                <option key={v} value={v}>
                  {v.toLocaleString("en-ZA")}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lookback">Lookback</Label>
            <NativeSelect id="lookback" value={filters.lookback_months} onChange={(e) => setFilters({ ...filters, lookback_months: Number(e.target.value) })}>
              {[6, 12, 24, 36, 60].map((v) => (
                <option key={v} value={v}>
                  {v} months
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ptype">Property type</Label>
            <NativeSelect id="ptype" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="freehold">Freehold</option>
              <option value="sectional_title">Sectional title</option>
              <option value="vacant_land">Vacant land</option>
              <option value="all">All types</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="minf">Min floor m²</Label>
            <Input id="minf" inputMode="numeric" value={filters.min_floor_m2} onChange={(e) => setFilters({ ...filters, min_floor_m2: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="maxf">Max floor m²</Label>
            <Input id="maxf" inputMode="numeric" value={filters.max_floor_m2} onChange={(e) => setFilters({ ...filters, max_floor_m2: e.target.value.replace(/\D/g, "") })} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-xs">
            <input type="checkbox" checked={filters.include_non_arms_length} onChange={(e) => setFilters({ ...filters, include_non_arms_length: e.target.checked })} />
            Include non-arm&apos;s-length
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-xs">
            <input type="checkbox" checked={filters.verified_only} onChange={(e) => setFilters({ ...filters, verified_only: e.target.checked })} />
            Verified only
          </label>
        </CardContent>
      </Card>

      {query.isError && <p className="text-sm text-critical">{(query.error as Error).message}</p>}

      {analysis && ind && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Comparable indication</CardTitle>
              <CardDescription>Adjusted registered transfers of included comparables. Not an appraisal.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-2">
                <ConfidenceBadge confidence={ind.confidence} />
                <span className="text-xs text-muted-foreground">{ind.sample_count} included</span>
              </div>
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-muted-foreground">Median adjusted</dt>
                <dd className="tabular text-right font-semibold">{formatZar(ind.median_adjusted)}</dd>
                <dt className="text-muted-foreground">Weighted mean</dt>
                <dd className="tabular text-right">{formatZar(ind.weighted_mean)}</dd>
                <dt className="text-muted-foreground">25th–75th pct.</dt>
                <dd className="tabular text-right">
                  {formatZar(ind.range_low)} – {formatZar(ind.range_high)}
                </dd>
                <dt className="text-muted-foreground">Median R/m²</dt>
                <dd className="tabular text-right">{formatZar(ind.median_price_per_m2)}</dd>
              </dl>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {ind.explanation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Distance vs price</CardTitle>
              <CardDescription>A relative plot. A licensed map layer is not yet configured (geocoding and map-display rights unconfirmed).</CardDescription>
            </CardHeader>
            <CardContent>
              {analysis.comps.some((c) => c.distance_m != null && c.sale_price != null) ? (
                <CompsScatter
                  subjectEstimate={ind.median_adjusted}
                  points={analysis.comps
                    .filter((c) => c.distance_m != null && (c.included ? c.adjusted_price : c.sale_price) != null)
                    .map((c) => ({
                      distance_m: c.distance_m!,
                      price: (c.included ? c.adjusted_price : c.sale_price)!,
                      address: c.address,
                      date: fmtDate(c.registration_date),
                      included: c.included,
                    }))}
                />
              ) : (
                <EmptyState title="No candidate sales in range" />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Candidate sales {query.isFetching && <span className="text-xs font-normal text-muted-foreground">updating…</span>}</CardTitle>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} /> Show excluded
          </label>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="No candidate sales">Widen the radius or lookback period.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {table.getHeaderGroups().map((g) => (
                    <tr key={g.id} className="border-b">
                      {g.headers.map((h) => (
                        <th key={h.id} className="h-9 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                          {h.isPlaceholder ? null : h.column.getCanSort() ? (
                            <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                              <table.FlexRender header={h} />
                              <ArrowUpDown className="size-3" />
                            </button>
                          ) : (
                            <table.FlexRender header={h} />
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className={cn("border-b align-top hover:bg-muted/50", !row.original.included && "text-muted-foreground")}>
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2">
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {override.isError && <p className="mt-2 text-xs text-critical">{(override.error as Error).message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
