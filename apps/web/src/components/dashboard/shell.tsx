"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Building2,
  ClipboardCheck,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  PlugZap,
  RefreshCw,
  ScrollText,
  Search,
  Calculator,
  Landmark,
  Users,
  FlaskConical,
} from "lucide-react";
import { can, ROLE_LABELS, ROLES, type Capability, type Role } from "@propintel/shared";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/primitives";

const NAV: { href: string; label: string; icon: React.ElementType; cap?: Capability }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/search", label: "Property search", icon: Search },
  { href: "/auctions", label: "Auctions", icon: Gavel },
  { href: "/sheriffs", label: "Sheriffs", icon: Landmark },
  { href: "/scenarios", label: "Scenario calculator", icon: Calculator },
  { href: "/review", label: "Identity review", icon: ClipboardCheck, cap: "identity:review" },
  { href: "/sync", label: "Sync center", icon: RefreshCw, cap: "sync:read" },
  { href: "/admin/integrations", label: "Integrations", icon: PlugZap, cap: "integration:read" },
  { href: "/admin/users", label: "Team & roles", icon: Users, cap: "users:invite_viewer" },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export function Shell({ role, label, mode, children }: { role: Role; label: string; mode: "demo" | "supabase"; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function switchRole(next: string) {
    await fetch("/api/demo-role", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: next }) });
    router.refresh();
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/sign-in");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {NAV.filter((n) => !n.cap || can(role, n.cap)).map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      {mode === "demo" && (
        <div className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-demo px-4 py-1.5 text-center text-xs text-demo-foreground">
          <FlaskConical className="size-3.5" />
          <span>
            <strong>Demo mode:</strong> all properties, sales, auctions and sheriff details are synthetic fixture data. No authentication, no
            provider calls. Data resets on server restart.
          </span>
        </div>
      )}
      <div className="flex flex-1">
        <aside className="no-print hidden w-60 shrink-0 border-r bg-card md:block">
          <div className="flex h-14 items-center gap-2 border-b px-5 font-semibold">
            <Building2 className="size-5 text-primary" /> Property Intelligence
          </div>
          {nav}
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
            <aside className="h-full w-64 bg-card" onClick={(e) => e.stopPropagation()}>
              <div className="flex h-14 items-center gap-2 border-b px-5 font-semibold">
                <Building2 className="size-5 text-primary" /> Property Intelligence
              </div>
              {nav}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print flex h-14 items-center justify-between gap-3 border-b bg-card px-4 md:px-6">
            <button className="rounded-md p-2 hover:bg-muted md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="size-5" />
            </button>
            <div className="hidden text-xs text-muted-foreground md:block">Decision support only. Not a certified appraisal, legal opinion or guarantee of auction status.</div>
            <div className="flex items-center gap-3">
              {mode === "demo" ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  View as
                  <NativeSelect className="h-8 w-36" value={role} onChange={(e) => switchRole(e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    {label} · {ROLE_LABELS[role]}
                  </span>
                  <button onClick={signOut} className="rounded-md p-2 hover:bg-muted" aria-label="Sign out">
                    <LogOut className="size-4" />
                  </button>
                </>
              )}
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
