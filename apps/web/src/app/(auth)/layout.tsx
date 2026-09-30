import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { isDemoMode } from "@/lib/env";

// Evaluated per request: demo vs Supabase mode is decided by runtime environment variables.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) redirect("/"); // no authentication in demo mode
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-xs">
        <div className="mb-6 flex items-center gap-2 font-semibold">
          <Building2 className="size-5 text-primary" /> Property Intelligence
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">Invitation-only internal tool.</p>
      </div>
    </div>
  );
}
