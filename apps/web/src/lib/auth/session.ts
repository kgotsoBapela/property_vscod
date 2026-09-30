import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, isRole, ROLE_LABELS, type Capability, type Role } from "@propintel/shared";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DemoRepository } from "@/lib/data/demo";
import { SupabaseRepository } from "@/lib/data/supabase";
import type { Actor, DataRepository } from "@/lib/data/types";

export const DEMO_ROLE_COOKIE = "propintel_demo_role";

export interface Viewer extends Actor {
  mode: "demo" | "supabase";
  email: string | null;
  mfaSatisfied: boolean;
}

/** The signed-in user and their role, or null. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (isDemoMode()) {
    const store = await cookies();
    const raw = store.get(DEMO_ROLE_COOKIE)?.value;
    const role: Role = isRole(raw) ? raw : "super_admin";
    return { mode: "demo", id: `demo-${role}`, label: `Demo ${ROLE_LABELS[role]}`, role, email: null, mfaSatisfied: true };
  }
  const db = await createSupabaseServerClient();
  const { data } = await db.auth.getUser(); // verifies the JWT with Supabase Auth
  if (!data.user) return null;
  const { data: roleRow } = await db.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
  const role = isRole(roleRow?.role) ? roleRow.role : null;
  if (!role) return null; // invitation-only: an account without a role has no access
  let mfaSatisfied = true;
  if (role === "super_admin") {
    const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaSatisfied = aal?.currentLevel === "aal2";
  }
  return { mode: "supabase", id: data.user.id, label: data.user.email ?? data.user.id, role, email: data.user.email ?? null, mfaSatisfied };
});

/** For pages: redirect to sign-in (or MFA for Super Admin) when needed. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  if (!viewer.mfaSatisfied) redirect("/mfa");
  return viewer;
}

export async function requireCapabilityPage(capability: Capability): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!can(viewer.role, capability)) redirect(`/forbidden?need=${capability}`);
  return viewer;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** For route handlers: throws HttpError(401/403). UI hiding is never the security boundary. */
export async function requireCapability(capability: Capability): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new HttpError(401, "Not signed in");
  if (!viewer.mfaSatisfied) throw new HttpError(401, "MFA required");
  if (!can(viewer.role, capability)) throw new HttpError(403, `Missing permission: ${capability}`);
  return viewer;
}

export function getRepository(): DataRepository {
  return isDemoMode() ? new DemoRepository() : new SupabaseRepository();
}
