import { MfaForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Two-factor verification" };

export default function MfaPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Two-factor verification</h1>
      <p className="mb-4 text-sm text-muted-foreground">Super Admin accounts require an authenticator app.</p>
      <MfaForm />
    </>
  );
}
