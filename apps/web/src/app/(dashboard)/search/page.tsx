import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { searchQuerySchema } from "@propintel/shared";
import { Alert, Badge, Card, CardContent, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { DemoBadge, describeIdentifier, EmptyState, PageHeader, VerificationBadge } from "@/components/dashboard/bits";
import { SearchBox } from "@/components/property/search-box";
import { getRepository, requireViewer } from "@/lib/auth/session";

export const metadata = { title: "Property search" };

export default async function SearchPage(props: PageProps<"/search">) {
  await requireViewer();
  const sp = await props.searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const parsed = searchQuerySchema.safeParse({ q: raw });
  const results = parsed.success ? await getRepository().searchProperties(parsed.data.q) : [];
  const sameStreet = new Map<string, number>();
  for (const r of results) {
    const key = `${r.property.street_number} ${r.property.street_name} ${r.property.suburb}`;
    sameStreet.set(key, (sameStreet.get(key) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Property search"
        description="Search by street address, suburb, erf (and portion) or sectional scheme and unit. Legal identifiers are the authoritative match; addresses alone can be ambiguous."
      />
      <div className="mb-6 max-w-2xl">
        <SearchBox initial={raw} />
      </div>

      {raw && !parsed.success && <p className="text-sm text-muted-foreground">{parsed.error.issues[0]?.message}</p>}

      {parsed.success && results.length === 0 && (
        <EmptyState title="No properties on record match this search">
          This does not mean the property does not exist, only that no licensed source has supplied it yet. Try an erf number or a
          different spelling.
        </EmptyState>
      )}

      {results.length > 0 && (
        <>
          {[...sameStreet.values()].some((n) => n > 1) && (
            <Alert tone="warning" className="mb-4 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              Several properties share a street address (for example sectional-title units or erf portions). Pick the correct legal property
              by its identifiers below.
            </Alert>
          )}
          <Card>
            <CardContent className="pt-4">
              <Table>
                <THead>
                  <TR>
                    <TH>Property</TH>
                    <TH>Legal identifiers</TH>
                    <TH>Type</TH>
                    <TH>Why it matched</TH>
                  </TR>
                </THead>
                <TBody>
                  {results.map((r) => (
                    <TR key={r.property.id}>
                      <TD>
                        <Link href={`/properties/${r.property.id}`} className="font-medium text-primary hover:underline">
                          {r.property.normalized_address}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          {r.property.municipality} · {r.property.province} <DemoBadge show={r.property.is_demo} />
                        </div>
                      </TD>
                      <TD className="text-xs">
                        {r.identifiers
                          .filter((i) => i.kind !== "provider_property_id")
                          .map((i) => (
                            <div key={i.id} className="flex items-center gap-2 py-0.5">
                              {describeIdentifier(i)} <VerificationBadge status={i.verification_status} />
                            </div>
                          ))}
                        {r.identifiers.every((i) => i.kind === "provider_property_id") && <span className="text-muted-foreground">No legal identifier on record</span>}
                      </TD>
                      <TD>
                        <Badge variant="muted">{r.property.property_type.replace("_", " ")}</Badge>
                      </TD>
                      <TD className="text-xs text-muted-foreground">{r.match_reasons.join("; ") || "Partial match"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
