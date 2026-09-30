import { AuthCallback } from "@/components/auth/auth-callback";

export const metadata = { title: "Signing you in" };

/**
 * Where Supabase's default email links land after /auth/v1/verify.
 * Must be listed exactly under Authentication → URL Configuration → Redirect URLs.
 */
export default function CallbackPage() {
  return <AuthCallback />;
}
