import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  if (!isDemoMode()) await (await createSupabaseServerClient()).auth.signOut();
  return NextResponse.json({ ok: true });
}
