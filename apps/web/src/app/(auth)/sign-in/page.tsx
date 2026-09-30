import { SignInForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      <SignInForm />
    </>
  );
}
