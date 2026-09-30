import { can, createSyncJobSchema } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";

export async function GET() {
  return handle(async () => {
    await requireCapability("sync:read");
    return { jobs: await getRepository().listJobs(50) };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const viewer = await requireCapability("sync:trigger");
    const input = createSyncJobSchema.parse(await req.json());
    if (input.scope === "full_reconciliation") {
      // High-cost full refreshes need an explicit, audited approval.
      if (!can(viewer.role, "sync:approve_full_refresh")) throw new HttpError(403, "Missing permission: sync:approve_full_refresh");
      if (!input.approve_high_cost) throw new HttpError(400, "Full reconciliation requires explicit approval of potential provider costs.");
    }
    const job = await getRepository().createJob(input, viewer);
    return job; // returned promptly; progress is polled separately
  });
}
