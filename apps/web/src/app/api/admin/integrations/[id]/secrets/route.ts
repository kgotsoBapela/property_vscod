import { credentialSetSchema } from "@propintel/shared";
import { z } from "zod";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";

// Credentials are write-only: these routes never return or log values. Values go straight to Supabase Vault.

export async function PUT(req: Request, ctx: RouteContext<"/api/admin/integrations/[id]/secrets">) {
  return handle(async () => {
    const viewer = await requireCapability("integration:manage");
    const { id } = await ctx.params;
    const parsed = credentialSetSchema.safeParse(await req.json().catch(() => null));
    // Report the problem without echoing the submitted value back.
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.path[0] === "value" ? "Value must be 1–8192 characters" : "Invalid credential name");
    await getRepository().setIntegrationSecret(id, parsed.data.name, parsed.data.value, viewer);
    return { ok: true };
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/admin/integrations/[id]/secrets">) {
  return handle(async () => {
    const viewer = await requireCapability("integration:manage");
    const { id } = await ctx.params;
    const name = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).parse(new URL(req.url).searchParams.get("name"));
    await getRepository().deleteIntegrationSecret(id, name, viewer);
    return { ok: true };
  });
}
