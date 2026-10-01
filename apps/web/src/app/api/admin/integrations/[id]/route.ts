import { hasAdapter, integrationUpdateSchema } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";

export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/integrations/[id]">) {
  return handle(async () => {
    const viewer = await requireCapability("integration:manage");
    const { id } = await ctx.params;
    const input = integrationUpdateSchema.parse(await req.json());
    const repo = getRepository();
    const current = await repo.getIntegration(id);
    if (!current) throw new HttpError(404, "Integration not found");
    if ((input.status === "sandbox" || input.status === "active") && !hasAdapter(current.provider_key)) {
      throw new HttpError(
        409,
        `No connector has been built for "${current.provider_key}" yet, so it cannot be set to ${input.status}. Keep it as candidate or in discussion until the connector exists.`,
      );
    }
    await repo.updateIntegration(id, input, viewer);
    return { ok: true };
  });
}
