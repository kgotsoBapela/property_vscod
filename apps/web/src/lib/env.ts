// Demo mode runs entirely on synthetic fixture data with no authentication.
// It is active whenever Supabase is not configured, and can never be enabled in production by accident:
// production builds refuse to start in demo mode unless ALLOW_DEMO_MODE=true is set explicitly.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isDemoMode(): boolean {
  const demo = !SUPABASE_URL || !SUPABASE_ANON_KEY;
  if (demo && process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_MODE !== "true" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, or ALLOW_DEMO_MODE=true for a labelled demo deployment.");
  }
  return demo;
}
