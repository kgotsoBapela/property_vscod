"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/** Set before requesting a password-reset email so the callback knows where to send the user. */
export const AUTH_NEXT_KEY = "propintel_auth_next";

export function rememberAuthNext(path: string) {
  try {
    window.localStorage.setItem(AUTH_NEXT_KEY, path);
  } catch {
    // Storage unavailable: the callback falls back to the overview.
  }
}

function takeAuthNext(): string | null {
  try {
    const v = window.localStorage.getItem(AUTH_NEXT_KEY);
    window.localStorage.removeItem(AUTH_NEXT_KEY);
    return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
  } catch {
    return null;
  }
}

/**
 * Completes sign-in from Supabase's default email templates:
 * - PKCE links (password reset requested from this browser) arrive as ?code=…
 * - Invitation links (implicit flow) arrive as #access_token=…&refresh_token=…&type=invite
 * - Expired or already-used links arrive as #error=…&error_description=…
 */
export function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    // Handle the URL explicitly (no auto-detection) so a stale session can never be mistaken for the new one.
    const db = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      isSingleton: false,
      auth: { detectSessionInUrl: false },
    });

    (async () => {
      const linkError = hash.get("error_description") ?? query.get("error_description");
      if (linkError) {
        const expired = (hash.get("error_code") ?? query.get("error_code")) === "otp_expired";
        return setError(
          expired
            ? "This link has expired or was already used. Email security scanners sometimes open links before you do; ask your administrator for a shareable invite link, or request a new reset email."
            : linkError,
        );
      }

      let type: string | null = hash.get("type") ?? query.get("type");
      const code = query.get("code");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (code) {
        const { error } = await db.auth.exchangeCodeForSession(code);
        if (error) return setError("This link could not be used. It may have expired, or it was opened in a different browser from the one that requested it.");
      } else if (accessToken && refreshToken) {
        const { error } = await db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return setError("This link could not be used. It may have expired.");
      } else {
        return setError("This link is incomplete. Open the link from your email again.");
      }

      // Remove tokens from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname);
      const remembered = takeAuthNext();
      if (remembered === "/reset-password") type = type ?? "recovery";
      router.replace(type === "invite" || type === "recovery" ? "/reset-password" : remembered ?? "/");
      router.refresh();
    })();
  }, [router]);

  return error ? (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-critical">{error}</p>
      <Link href="/forgot-password" className="text-primary underline">
        Request a new reset email
      </Link>
      <Link href="/sign-in" className="text-primary underline">
        Back to sign in
      </Link>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">Signing you in…</p>
  );
}
