import { Card, CardContent, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { EmptyState, PageHeader, PropertyLink } from "@/components/dashboard/bits";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Identity review" };

export default async function ReviewPage() {
  await requireCapabilityPage("identity:review");
  const items = await getRepository().listReviewQueue();
  return (
    <>
      <PageHeader
        title="Identity review queue"
        description="Records whose legal identity could not be resolved automatically. Nothing here has been merged; ambiguous records are never silently combined."
      />
      <Card>
        <CardContent className="pt-4">
          {items.length === 0 ? (
            <EmptyState title="Nothing awaiting review" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Record</TH>
                  <TH>Reason</TH>
                  <TH>Candidate properties</TH>
                  <TH>Received</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <div className="font-medium">{i.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.provider} · {i.external_id}
                      </div>
                    </TD>
                    <TD className="text-sm">{i.reason}</TD>
                    <TD className="text-xs">
                      {i.candidates.length === 0 && <span className="text-muted-foreground">None</span>}
                      <div className="flex max-w-md flex-wrap gap-x-3 gap-y-1">
                        {i.candidates.map((c) => (
                          <PropertyLink key={c.property_id} id={c.property_id}>
                            {c.property_id.slice(-6)} ({Math.round(c.confidence * 100)}%)
                          </PropertyLink>
                        ))}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDateTime(i.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Resolution actions (merge, create new, reject) are planned for Phase 2 alongside the first licensed adapter, once real ambiguity patterns are known.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
