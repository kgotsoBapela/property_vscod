import { integrationCreateSchema } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, requireCapability } from "@/lib/auth/session";

/** Adds a provider as a candidate. It cannot sync until a connector exists and it is moved to sandbox/active. */
export async function POST(req: Request) {
  return handle(async () => {
    const viewer = await requireCapability("integration:manage");
    const input = integrationCreateSchema.parse(await req.json());
    return getRepository().createIntegration(input, viewer);
  });
}
