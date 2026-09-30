import { can, inviteUserSchema } from "@propintel/shared";
import { handle } from "@/lib/auth/api";
import { getRepository, HttpError, requireCapability } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  return handle(async () => {
    const viewer = await requireCapability("users:invite_viewer");
    const input = inviteUserSchema.parse(await req.json());
    if (input.role !== "viewer" && !can(viewer.role, "users:manage")) throw new HttpError(403, "Admins may only invite Viewers");
    if (isDemoMode()) throw new HttpError(400, "Invitations require Supabase Auth");

    const admin = createSupabaseAdminClient();
    // The "Invite user" email template links to {{ .SiteURL }}/auth/confirm (see README), so no redirectTo is needed.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email);
    if (error) throw new HttpError(400, error.message);
    // Role goes into app_metadata (service-role only) and user_roles. The DB trigger reads app_metadata for new users.
    await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: input.role, invited_by: viewer.id } });
    await admin.from("user_roles").upsert({ user_id: data.user.id, role: input.role, granted_by: viewer.id });
    await getRepository().writeAudit(viewer, "user.invite", data.user.id, { role: input.role });
    return { ok: true };
  });
}
