import Link from "next/link";
import { Card, CardContent, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { DemoBadge, EmptyState, PageHeader, VerificationBadge } from "@/components/dashboard/bits";
import { getRepository, requireViewer } from "@/lib/auth/session";

export const metadata = { title: "Sheriffs" };

export default async function SheriffsPage() {
  await requireViewer();
  const offices = await getRepository().listSheriffOffices();
  return (
    <>
      <PageHeader
        title="Sheriff directory"
        description="Sheriff offices referenced by sale-in-execution notices. Contact details are shown only when they come from a source; unverified details are flagged."
      />
      <Card>
        <CardContent className="pt-4">
          {offices.length === 0 ? (
            <EmptyState title="No sheriff offices on record" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Office</TH>
                  <TH>Jurisdiction</TH>
                  <TH>Contact status</TH>
                  <TH className="text-right">Upcoming sales</TH>
                </TR>
              </THead>
              <TBody>
                {offices.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/sheriffs/${o.id}`} className="font-medium text-primary hover:underline">
                        {o.name}
                      </Link>{" "}
                      <DemoBadge show={o.provenance.is_demo} />
                    </TD>
                    <TD className="text-sm">
                      {o.jurisdiction}, {o.province}
                    </TD>
                    <TD>
                      <VerificationBadge status={o.verification_status} />
                    </TD>
                    <TD className="tabular text-right">{o.upcoming}</TD>
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
