import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { can, INTEGRATION_STATUS_LABELS } from "@propintel/shared";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { PageHeader } from "@/components/dashboard/bits";
import { AddIntegrationForm } from "@/components/integrations/integration-forms";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Integrations" };

const STATUS_VARIANT = { active: "good", sandbox: "default", in_discussion: "outline", candidate: "muted", suspended: "warning", rejected: "critical" } as const;

export default async function IntegrationsPage() {
  const viewer = await requireCapabilityPage("integration:read");
  const manage = can(viewer.role, "integration:manage");
  const integrations = await getRepository().listIntegrations();
  return (
    <>
      <PageHeader
        title="Integrations & provider matrix"
        description="Data providers, their verification status and what they may be used for. Only Super Admins can edit providers or set credentials."
      />
      <Alert tone="warning" className="mb-4">
        A provider only syncs once it has a connector built from its documentation and is set to Sandbox or Active. Entering credentials alone is
        not enough. Credentials are encrypted in Supabase Vault and never shown again.
      </Alert>
      {manage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add an integration</CardTitle>
            <CardDescription>New providers start as candidates. The key is used by the connector code and cannot be changed later.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddIntegrationForm />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-4">
          <Table>
            <THead>
              <TR>
                <TH>Provider</TH>
                <TH>Category</TH>
                <TH>Status</TH>
                <TH>Supplies</TH>
                <TH>Last success</TH>
                <TH>Notes</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {integrations.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <div className="font-medium">{i.display_name}</div>
                    {i.website && (
                      <a href={i.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <ExternalLink className="size-3" /> website
                      </a>
                    )}
                  </TD>
                  <TD className="text-xs">{i.category.replace("_", " ")}</TD>
                  <TD>
                    <Badge variant={STATUS_VARIANT[i.status]}>{INTEGRATION_STATUS_LABELS[i.status]}</Badge>
                  </TD>
                  <TD className="text-xs">{i.capabilities.length ? i.capabilities.map((c) => c.replaceAll("_", " ")).join(", ") : <span className="text-muted-foreground">Unverified</span>}</TD>
                  <TD className="whitespace-nowrap text-xs">{i.last_success_at ? fmtDateTime(i.last_success_at) : "—"}</TD>
                  <TD className="max-w-sm text-xs text-muted-foreground">{i.notes}</TD>
                  <TD>
                    <Link href={`/admin/integrations/${i.id}`} className="text-sm font-medium text-primary hover:underline">
                      {manage ? "Manage" : "View"}
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
