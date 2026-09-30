import { ConfirmEmailLink } from "@/components/auth/auth-forms";

export const metadata = { title: "Continue" };

/**
 * Landing page for invitation and password-reset emails. The Supabase email templates link here with
 * ?token_hash=…&type=invite|recovery (see README "Email templates").
 */
export default async function ConfirmPage(props: PageProps<"/auth/confirm">) {
  const sp = await props.searchParams;
  const tokenHash = typeof sp.token_hash === "string" ? sp.token_hash : "";
  const type = sp.type === "invite" || sp.type === "recovery" ? sp.type : null;
  return (
    <>
      <h1 className="mb-2 text-lg font-semibold">{type === "invite" ? "Accept your invitation" : "Reset your password"}</h1>
      {tokenHash && type ? (
        <ConfirmEmailLink tokenHash={tokenHash} type={type} />
      ) : (
        <p className="text-sm text-muted-foreground">This link is incomplete. Open the link from your email again, or ask for a new one.</p>
      )}
    </>
  );
}
