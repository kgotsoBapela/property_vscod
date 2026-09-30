import { z } from "zod";
import { can, inviteUserSchema } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bodySchema = inviteUserSchema.extend({ delivery: z.enum(["email", "link"]).default("email") });

/**
 * Invites a user. Two deliveries:
 * - "email": Supabase sends its default invite email; the link returns to /auth/callback (an allowed Redirect URL).
 * - "link": no email is sent; returns a one-time /auth/confirm link for the admin to share by another channel.
 *   /auth/confirm only uses the token after the invitee clicks Continue, so email link scanners cannot consume it.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const viewer = await requireCapability("users:invite_viewer");
    const input = bodySchema.parse(await req.json());
    if (input.role !== "viewer" && !can(viewer.role, "users:manage")) throw new HttpError(403, "Admins may only invite Viewers");
    if (isDemoMode()) throw new HttpError(400, "Invitations require Supabase Auth");

    const admin = createSupabaseAdminClient();
    const origin = new URL(req.url).origin;
    let userId: string;
    let shareLink: string | null = null;

    if (input.delivery === "email") {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo: `${origin}/auth/callback` });
      if (error) throw new HttpError(400, error.message);
      userId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: input.email });
      if (error) throw new HttpError(400, error.message);
      userId = data.user.id;
      shareLink = `${origin}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
    }

    // Role goes into app_metadata (service-role only) and user_roles.
    await admin.auth.admin.updateUserById(userId, { app_metadata: { role: input.role, invited_by: viewer.id } });
    await admin.from("user_roles").upsert({ user_id: userId, role: input.role, granted_by: viewer.id });
    await admin.from("profiles").upsert({ id: userId, email: input.email });
    await getRepository().writeAudit(viewer, "user.invite", userId, { role: input.role, delivery: input.delivery });
    return { ok: true, share_link: shareLink };
  });
}
