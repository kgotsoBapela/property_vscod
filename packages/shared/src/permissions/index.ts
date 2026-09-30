import type { Role } from "../types/domain";

// Capabilities are checked in server routes AND mirrored in RLS policies
// (supabase/migrations/0002_rls.sql). Hiding UI is never the security boundary.
export const CAPABILITIES = {
  "property:read": ["super_admin", "admin", "viewer"],
  "report:export": ["super_admin", "admin", "viewer"],
  "watchlist:write": ["super_admin", "admin", "viewer"],
  "scenario:write": ["super_admin", "admin", "viewer"],
  "comparable:review": ["super_admin", "admin"],
  "identity:review": ["super_admin", "admin"],
  "users:invite_viewer": ["super_admin", "admin"],
  "users:manage": ["super_admin"],
  "audit:read_all": ["super_admin"],
  "integration:read": ["super_admin", "admin"],
  "integration:manage": ["super_admin"],
  "sync:read": ["super_admin", "admin"],
  "sync:trigger": ["super_admin"],
  "sync:approve_full_refresh": ["super_admin"],
  "schedule:manage": ["super_admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  viewer: "Viewer",
};

export const ROLES: Role[] = ["super_admin", "admin", "viewer"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}
