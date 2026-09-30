import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isRole } from "@propintel/shared";
import { DEMO_ROLE_COOKIE } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";

/** Demo mode only: switch the simulated role to exercise permissions. Disabled when Supabase is configured. */
export async function POST(req: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const { role } = (await req.json().catch(() => ({}))) as { role?: unknown };
  if (!isRole(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  (await cookies()).set(DEMO_ROLE_COOKIE, role, { httpOnly: true, sameSite: "lax", path: "/" });
  return NextResponse.json({ ok: true });
}
