import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Alert, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/primitives";
import { DemoBadge, PageHeader, SourceNote, VerificationBadge } from "@/components/dashboard/bits";
import { AuctionTable } from "@/components/auction/auction-table";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Sheriff office" };

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value ?? <span className="text-muted-foreground">Not available from source</span>}</div>
    </div>
  );
}

export default async function SheriffPage(props: PageProps<"/sheriffs/[id]">) {
  const { id } = await props.params;
  await requireViewer();
  const d = await getRepository().getSheriffOffice(id);
  if (!d) notFound();
  const o = d.office;
  return (
    <>
      <PageHeader
        title={o.name}
        description={
          <span className="flex items-center gap-2">
            {o.jurisdiction}, {o.province} <DemoBadge show={o.provenance.is_demo} />
          </span>
        }
      />
      {o.verification_status !== "verified" && (
        <Alert tone="warning" className="mb-4">
          Contact details for this office have not been verified. Obtain them from an official source before relying on them.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Office details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2">
              <VerificationBadge status={o.verification_status} />
              <span className="text-xs text-muted-foreground">{o.contact_verified_at ? `Verified ${fmtDateTime(o.contact_verified_at)}` : "Never verified"}</span>
            </div>
            <Field label="Physical address" value={o.physical_address} />
            <Field label="Telephone" value={o.phone} />
            <Field label="Email" value={o.email} />
            {o.source_url && (
              <a href={o.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3.5" /> Source
              </a>
            )}
          </CardContent>
          <CardFooter>
            <SourceNote sources={[o.provenance]} />
          </CardFooter>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Notices from this office</CardTitle>
          </CardHeader>
          <CardContent>
            <AuctionTable items={d.auctions} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
