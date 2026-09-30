import { z } from "zod";
import { parseCron } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";

const bodySchema = z.object({ cron: z.string().trim().min(9).max(100), enabled: z.boolean() });

export async function PATCH(req: Request, ctx: RouteContext<"/api/sync/schedules/[id]">) {
  return handle(async () => {
    const viewer = await requireCapability("schedule:manage");
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json());
    try {
      parseCron(body.cron);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Invalid cron expression");
    }
    await getRepository().updateSchedule(id, body, viewer);
    return { ok: true };
  });
}
