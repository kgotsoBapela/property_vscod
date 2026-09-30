import { can, ROLE_LABELS } from "@propintel/shared";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { PageHeader } from "@/components/dashboard/bits";
import { InviteForm } from "@/components/dashboard/invite-form";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Team & roles" };

export default async function UsersPage() {
  const viewer = await requireCapabilityPage("users:invite_viewer");
  const repo = getRepository();
  const users = await repo.listUsers();
  return (
    <>
      <PageHeader title="Team & roles" description="Invitation-only access. Super Admins manage all roles; Admins may invite Viewers." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH>Joined</TH>
                </TR>
              </THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD>{u.email}</TD>
                    <TD>{u.role ? <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge> : <Badge variant="warning">No role (no access)</Badge>}</TD>
                    <TD className="text-xs">{fmtDate(u.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invite a user</CardTitle>
            <CardDescription>Super Admin accounts must enrol MFA at first sign-in.</CardDescription>
          </CardHeader>
          <CardContent>
            {repo.mode === "demo" ? (
              <Alert tone="demo">Invitations need Supabase Auth. Configure Supabase to enable them.</Alert>
            ) : (
              <InviteForm allowedRoles={can(viewer.role, "users:manage") ? ["viewer", "admin", "super_admin"] : ["viewer"]} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
