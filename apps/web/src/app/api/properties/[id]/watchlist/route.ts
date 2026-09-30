import { handle } from "@/lib/auth/api";
import { getRepository, requireCapability } from "@/lib/auth/session";

export async function POST(_req: Request, ctx: RouteContext<"/api/properties/[id]/watchlist">) {
  return handle(async () => {
    const viewer = await requireCapability("watchlist:write");
    const { id } = await ctx.params;
    return { watching: await getRepository().toggleWatchlist(id, viewer) };
  });
}
