"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { rememberAuthNext } from "./auth-callback";
import { siteUrl } from "@/lib/env";

function Field(props: React.ComponentProps<typeof Input> & { label: string }) {
  const { label, id, ...rest } = props;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...rest} />
    </div>
  );
}

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Invitation tokens arrive in the URL fragment, which survives the redirect to sign-in: hand them to the callback.
  useEffect(() => {
    if (/access_token=|error_description=/.test(window.location.hash)) router.replace(`/auth/callback${window.location.hash}`);
  }, [router]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
        setBusy(false);
        if (error) return setError("Sign-in failed. Check your email and password.");
        router.push("/");
        router.refresh();
      }}
    >
      <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="text-sm text-critical">{error}</p>}
      <Button type="submit" disabled={busy}>
        Sign in
      </Button>
      <Link href="/forgot-password" className="text-center text-xs text-primary hover:underline">
        Forgot password?
      </Link>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) return <p className="text-sm">If an account exists for that address, a reset link has been sent.</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        // Works with Supabase's default email template: the link returns to /auth/callback (must be an allowed
        // Redirect URL, exactly, with no query string), which then continues to /reset-password.
        rememberAuthNext("/reset-password");
        await createSupabaseBrowserClient().auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl(window.location.origin)}/auth/callback` });
        setSent(true); // same message whether or not the account exists
      }}
    >
      <Field id="email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button type="submit">Send reset link</Button>
    </form>
  );
}

/**
 * Consumes an invitation / recovery token only when the person clicks, so email security scanners that
 * pre-open links cannot use up the one-time token.
 */
export function ConfirmEmailLink({ tokenHash, type }: { tokenHash: string; type: "invite" | "recovery" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {type === "invite" ? "Continue to activate your account and choose a password." : "Continue to choose a new password."}
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token_hash: tokenHash, type }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setError(body.error ?? "Verification failed");
          router.push(body.next ?? "/reset-password");
          router.refresh();
        }}
      >
        Continue
      </Button>
      {error && (
        <p className="text-sm text-critical">
          {error}{" "}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        </p>
      )}
    </div>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < 12) return setError("Use at least 12 characters.");
        const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
        if (error) {
          return setError(
            /session/i.test(error.message)
              ? "Your link has expired or was already used. Request a new reset email from the sign-in page."
              : error.message,
          );
        }
        router.push("/");
        router.refresh();
      }}
    >
      <Field id="password" label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="text-sm text-critical">{error}</p>}
      <Button type="submit">Set password</Button>
    </form>
  );
}

/** Super Admin MFA: enrol a TOTP factor on first use, then verify to reach AAL2. */
export function MfaForm() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    (async () => {
      const { data } = await db.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      const { data: enrolled, error } = await db.auth.mfa.enroll({ factorType: "totp" });
      if (error) return setError(error.message);
      setFactorId(enrolled.id);
      setQr(enrolled.totp.qr_code);
    })();
  }, []);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!factorId) return;
        const { error } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId, code });
        if (error) return setError("Invalid code. Try again.");
        router.push("/");
        router.refresh();
      }}
    >
      {qr && (
        <div className="flex flex-col items-center gap-2 text-sm">
          <p>Scan with your authenticator app to enrol:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="TOTP enrolment QR code" className="size-44 rounded bg-white p-2" />
        </div>
      )}
      <Field id="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
      {error && <p className="text-sm text-critical">{error}</p>}
      <Button type="submit" disabled={!factorId}>
        Verify
      </Button>
    </form>
  );
}
