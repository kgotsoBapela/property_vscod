import { ResetPasswordForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Set password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Set a new password</h1>
      <ResetPasswordForm />
    </>
  );
}
