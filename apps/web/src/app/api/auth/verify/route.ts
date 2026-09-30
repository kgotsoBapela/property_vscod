import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  token_hash: z.string().min(10).max(500),
  type: z.enum(["invite", "recovery"]),
});

/**
 * Verifies an invitation or password-recovery token from an email link and starts a session (cookies).
 * Called by POST from /auth/confirm only after the person clicks "Continue", so email link scanners
 * that merely open the URL cannot consume the one-time token.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { error } = await db.auth.verifyOtp({ token_hash: parsed.data.token_hash, type: parsed.data.type });
  if (error) {
    return NextResponse.json({ error: "This link is invalid or has expired. Ask for a new invitation or reset email." }, { status: 400 });
  }
  return NextResponse.json({ next: "/reset-password" });
}
