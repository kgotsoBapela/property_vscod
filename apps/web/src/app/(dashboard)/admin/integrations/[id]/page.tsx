import Link from "next/link";
import { notFound } from "next/navigation";
import { can, formatZar, hasAdapter, INTEGRATION_STATUS_LABELS } from "@propintel/shared";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { PageHeader } from "@/components/dashboard/bits";
import { CredentialsPanel, IntegrationEditForm } from "@/components/integrations/integration-forms";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Integration" };

const unknown = <span className="text-muted-foreground">Unknown</span>;

export default async function IntegrationPage(props: PageProps<"/admin/integrations/[id]">) {
  const { id } = await props.params;
  const viewer = await requireCapabilityPage("integration:read");
  const manage = can(viewer.role, "integration:manage");
  const repo = getRepository();
  const integration = await repo.getIntegration(id);
  if (!integration) notFound();
  const connector = hasAdapter(integration.provider_key);
  const secrets = manage ? await repo.listIntegrationSecrets(id) : [];

  return (
    <>
      <PageHeader
        title={integration.display_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{integration.provider_key}</span>
            <Badge variant="outline">{INTEGRATION_STATUS_LABELS[integration.status]}</Badge>
            {connector ? <Badge variant="good">Connector built</Badge> : <Badge variant="warning">No connector yet</Badge>}
            <Link href="/admin/integrations" className="text-primary hover:underline">
              All integrations
            </Link>
          </span>
        }
      />

      {!connector && (
        <Alert tone="warning" className="mb-6">
          This provider cannot sync yet. Next steps: obtain documentation, sample data and access; record what you learn below; store credentials;
          then a connector is built and the provider can move to Sandbox for testing.
        </Alert>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Provider details</CardTitle>
            <CardDescription>
              Last success {fmtDateTime(integration.last_success_at)} · last failure {integration.last_failure_at ? fmtDateTime(integration.last_failure_at) : "none"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {manage ? (
              <IntegrationEditForm integration={integration} hasConnector={connector} />
            ) : (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Supplies</dt>
                <dd>{integration.capabilities.join(", ").replaceAll("_", " ") || unknown}</dd>
                <dt className="text-muted-foreground">Auth method</dt>
                <dd>{integration.auth_method ?? unknown}</dd>
                <dt className="text-muted-foreground">Coverage</dt>
                <dd>
                  {integration.geographic_coverage ?? "Geography unknown"} · {integration.historical_coverage ?? "history unknown"}
                </dd>
                <dt className="text-muted-foreground">Costs</dt>
                <dd>
                  {integration.cost_per_call_zar != null ? `${formatZar(integration.cost_per_call_zar)} per call` : "Per-call cost unknown"} ·{" "}
                  {integration.monthly_cost_zar != null ? `${formatZar(integration.monthly_cost_zar)} per month` : "monthly cost unknown"}
                </dd>
                <dt className="text-muted-foreground">Rights</dt>
                <dd>
                  Display: {integration.display_rights ?? "unknown"} · Retention: {integration.retention_rights ?? "unknown"}
                </dd>
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{integration.notes ?? "—"}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        {manage && (
          <Card>
            <CardHeader>
              <CardTitle>API credentials</CardTitle>
              <CardDescription>Write-only. Stored encrypted in Supabase Vault.</CardDescription>
            </CardHeader>
            <CardContent>
              <CredentialsPanel integrationId={integration.id} secrets={secrets} demo={repo.mode === "demo"} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
