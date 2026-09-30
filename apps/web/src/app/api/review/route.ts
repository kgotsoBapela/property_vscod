import { z } from "zod";
import { handle } from "@/lib/auth/api";
import { getRepository, requireCapability } from "@/lib/auth/session";

const uuidish = z.string().min(1).max(100);

const decisionSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("identity"), id: uuidish, action: z.enum(["merge", "create_new", "reject"]), property_id: uuidish.nullable().default(null) }),
    z.object({
      kind: z.literal("auction_lot"),
      auction_id: uuidish,
      lot_index: z.number().int().min(0),
      action: z.enum(["confirm", "reject"]),
      property_id: uuidish.nullable().default(null),
    }),
  ])
  .refine((d) => !((d.action === "merge" || d.action === "confirm") && !d.property_id), {
    message: "Choose a property",
    path: ["property_id"],
  });

/** Resolves an identity review item or an ambiguous auction lot (Admin / Super Admin). */
export async function POST(req: Request) {
  return handle(async () => {
    const viewer = await requireCapability("identity:review");
    const decision = decisionSchema.parse(await req.json());
    const propertyId = await getRepository().resolveReview(decision, viewer);
    return { ok: true, property_id: propertyId };
  });
}
