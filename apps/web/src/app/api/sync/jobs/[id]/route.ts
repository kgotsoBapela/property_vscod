import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";

export async function GET(_req: Request, ctx: RouteContext<"/api/sync/jobs/[id]">) {
  return handle(async () => {
    await requireCapability("sync:read");
    const { id } = await ctx.params;
    const job = await getRepository().getJob(id);
    if (!job) throw new HttpError(404, "Job not found");
    return job;
  });
}

/** Cancel: queued jobs are cancelled immediately; running jobs stop at the next page boundary. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/sync/jobs/[id]">) {
  return handle(async () => {
    const viewer = await requireCapability("sync:trigger");
    const { id } = await ctx.params;
    await getRepository().cancelJob(id, viewer);
    return { ok: true };
  });
}
