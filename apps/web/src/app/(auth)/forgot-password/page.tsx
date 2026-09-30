import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Reset your password</h1>
      <ForgotPasswordForm />
    </>
  );
}
