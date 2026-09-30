import { Shell } from "@/components/dashboard/shell";
import { requireViewer } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  return (
    <Shell role={viewer.role} label={viewer.label} mode={viewer.mode}>
      {children}
    </Shell>
  );
}
