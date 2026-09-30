import { can } from "@propintel/shared";
import { Card, CardContent, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { EmptyState, PageHeader } from "@/components/dashboard/bits";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const viewer = await requireViewer();
  const all = can(viewer.role, "audit:read_all");
  const logs = await getRepository().listAuditLogs(viewer, all);
  return (
    <>
      <PageHeader title="Audit log" description={all ? "All privileged and data-export actions." : "Your own audited actions. Super Admins see everyone's."} />
      <Card>
        <CardContent className="pt-4">
          {logs.length === 0 ? (
            <EmptyState title="No audited actions yet" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Target</TH>
                  <TH>Details</TH>
                </TR>
              </THead>
              <TBody>
                {logs.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-xs">{fmtDateTime(l.at)}</TD>
                    <TD className="text-xs">{l.actor_label}</TD>
                    <TD className="font-mono text-xs">{l.action}</TD>
                    <TD className="font-mono text-xs">{l.target ?? "—"}</TD>
                    <TD className="max-w-md truncate font-mono text-xs text-muted-foreground">{l.details ? JSON.stringify(l.details) : ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
