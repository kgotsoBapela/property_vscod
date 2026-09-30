import { ExternalLink } from "lucide-react";
import { Alert, Badge, Card, CardContent, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { PageHeader } from "@/components/dashboard/bits";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Integrations" };

const STATUS_VARIANT = { active: "good", sandbox: "default", in_discussion: "outline", candidate: "muted", suspended: "warning", rejected: "critical" } as const;

export default async function IntegrationsPage() {
  await requireCapabilityPage("integration:read");
  const integrations = await getRepository().listIntegrations();
  return (
    <>
      <PageHeader
        title="Integrations & provider matrix"
        description="Candidate data providers and their verification status. The full matrix (auth, fields, coverage, quotas, costs, rights) lives in docs/provider-matrix.md."
      />
      <Alert tone="warning" className="mb-4">
        No commercial provider is integrated yet. API availability, pricing, display/retention rights and permitted automated refresh are unverified for
        every candidate. Credentials are held in the worker&apos;s secrets manager and never shown here.
      </Alert>
      <Card>
        <CardContent className="pt-4">
          <Table>
            <THead>
              <TR>
                <TH>Provider</TH>
                <TH>Category</TH>
                <TH>Status</TH>
                <TH>Capabilities</TH>
                <TH>Last success</TH>
                <TH>Notes</TH>
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
                    <Badge variant={STATUS_VARIANT[i.status]}>{i.status.replace("_", " ")}</Badge>
                  </TD>
                  <TD className="text-xs">{i.capabilities.length ? i.capabilities.map((c) => c.replaceAll("_", " ")).join(", ") : <span className="text-muted-foreground">Unverified</span>}</TD>
                  <TD className="whitespace-nowrap text-xs">{i.last_success_at ? fmtDateTime(i.last_success_at) : "—"}</TD>
                  <TD className="max-w-sm text-xs text-muted-foreground">{i.notes}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
