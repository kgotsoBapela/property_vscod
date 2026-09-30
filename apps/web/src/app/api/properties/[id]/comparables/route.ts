import { z } from "zod";
import { comparableFiltersSchema } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";
import { comparableAnalysisFor } from "@/lib/analysis";

export async function GET(req: Request, ctx: RouteContext<"/api/properties/[id]/comparables">) {
  return handle(async () => {
    const viewer = await requireCapability("property:read");
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const filters = comparableFiltersSchema.parse({
      radius_m: sp.get("radius_m") ?? undefined,
      lookback_months: sp.get("lookback_months") ?? undefined,
      property_types: sp.getAll("type").length ? sp.getAll("type") : null,
      min_floor_m2: sp.get("min_floor_m2") || null,
      max_floor_m2: sp.get("max_floor_m2") || null,
      include_non_arms_length: sp.get("include_non_arms_length") === "true",
      verified_only: sp.get("verified_only") !== "false",
    });
    const repo = getRepository();
    const detail = await repo.getProperty(id, viewer);
    if (!detail) throw new HttpError(404, "Property not found");
    const { analysis, trend } = await comparableAnalysisFor(repo, detail, filters);
    return { analysis, trend, subject: detail.property };
  });
}

const overrideSchema = z.object({ sale_id: z.string().min(1), value: z.enum(["include", "exclude"]).nullable() });

export async function POST(req: Request, ctx: RouteContext<"/api/properties/[id]/comparables">) {
  return handle(async () => {
    const viewer = await requireCapability("comparable:review");
    const { id } = await ctx.params;
    const body = overrideSchema.parse(await req.json());
    await getRepository().setComparableOverride(id, body.sale_id, body.value, viewer);
    return { ok: true };
  });
}
