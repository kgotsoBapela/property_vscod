import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink, FileText } from "lucide-react";
import { Alert, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AuctionStatusBadge, DemoBadge, EmptyState, PageHeader, PriceTag, PropertyLink, SourceNote } from "@/components/dashboard/bits";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { fmtDateTime, isFuture, isStale } from "@/lib/utils";

export const metadata = { title: "Auction" };

const PRICE_ORDER = ["auction_guide", "auction_reserve", "opening_bid", "confirmed_hammer"] as const;

export default async function AuctionPage(props: PageProps<"/auctions/[id]">) {
  const { id } = await props.params;
  await requireViewer();
  const d = await getRepository().getAuction(id);
  if (!d) notFound();
  const a = d.auction;
  const upcoming = isFuture(a.event_at);

  return (
    <>
      <PageHeader
        title={a.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AuctionStatusBadge status={a.status} /> {fmtDateTime(a.event_at)} · {a.venue ?? "Venue not published"} <DemoBadge show={a.provenance.is_demo} />
          </span>
        }
      />

      {(a.status === "postponed" || a.status === "cancelled" || a.status === "unknown") && (
        <Alert tone={a.status === "cancelled" ? "critical" : "warning"} className="mb-4 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            This event is <strong>{a.status}</strong>.{" "}
            {a.status_history.at(-1)?.note ? `Note: ${a.status_history.at(-1)!.note}. ` : ""}
            Confirm the current position with the {a.kind === "sheriff_sale" ? "sheriff" : "auctioneer"}.
          </div>
        </Alert>
      )}
      {upcoming && (!a.last_verified_at || isStale(a.last_verified_at)) && (
        <Alert tone="warning" className="mb-4">
          Status was last verified {a.last_verified_at ? fmtDateTime(a.last_verified_at) : "never"}. Re-check before relying on it.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Published prices</CardTitle>
            <CardDescription>Each figure is shown under its own meaning. A reserve is not a guide price, and neither is a sale price.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {PRICE_ORDER.map((k) => {
              const p = a.prices.find((x) => x.kind === k);
              return <PriceTag key={k} kind={k} amount={p?.amount ?? null} published={p ? p.published : true} />;
            })}
          </CardContent>
          <CardContent className="grid gap-4 border-t pt-4 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Deposit / payment terms</div>
              <div>{a.deposit_terms ?? <span className="text-muted-foreground">Not published; see conditions of sale</span>}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Conditions summary</div>
              <div>{a.conditions_summary ?? <span className="text-muted-foreground">Not summarised; read the conditions of sale</span>}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Case / reference</div>
              <div>{a.case_reference ?? <span className="text-muted-foreground">Not available</span>}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{a.kind === "sheriff_sale" ? "Sheriff" : "Auctioneer"}</div>
              <div>
                {a.kind === "sheriff_sale" ? (
                  d.sheriff ? (
                    <Link href={`/sheriffs/${d.sheriff.id}`} className="text-primary hover:underline">
                      {d.sheriff.name}
                    </Link>
                  ) : (
                    "Unknown"
                  )
                ) : (
                  a.auction_house_name ?? "Unknown"
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <SourceNote sources={[a.provenance]} />
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents & status history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {a.notice_url && (
              <a href={a.notice_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3.5" /> Original notice
              </a>
            )}
            {d.documents.length === 0 ? (
              <EmptyState title="No documents on record" />
            ) : (
              d.documents.map((doc) => (
                <div key={doc.id} className="flex items-start gap-2">
                  <FileText className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    {doc.url ? (
                      <a href={doc.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                        {doc.title}
                      </a>
                    ) : (
                      doc.title
                    )}
                    <div className="text-xs text-muted-foreground">
                      {doc.kind.replaceAll("_", " ")} · published {fmtDateTime(doc.published_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Status history (as observed)</div>
              {a.status_history.map((h, i) => (
                <div key={i} className="text-xs">
                  {fmtDateTime(h.at)}: <strong>{h.status}</strong>
                  {h.note ? ` (${h.note})` : ""}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Lots & property matching</CardTitle>
            <CardDescription>Matches are automatic only when legal identifiers agree; anything else waits for human review.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {d.lots.map((l, i) => (
              <div key={i} className="rounded-md border p-3">
                <div className="font-medium">
                  Lot {l.lot_number ?? i + 1}: {l.described_address}
                </div>
                {l.property ? (
                  <div className="mt-1 text-xs">
                    Matched to <PropertyLink id={l.property.id}>{l.property.normalized_address}</PropertyLink> ({Math.round(l.match_confidence * 100)}%):{" "}
                    <span className="text-muted-foreground">{l.match_evidence.join("; ")}</span>
                  </div>
                ) : (
                  <div className="mt-1 text-xs">
                    <AlertTriangle className="inline size-3 text-warning" /> Not matched to a single property. {l.match_evidence.join("; ")}
                    {l.candidates.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        Candidates:
                        {l.candidates.map((c) => (
                          <PropertyLink key={c.id} id={c.id}>
                            {c.normalized_address}
                          </PropertyLink>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
