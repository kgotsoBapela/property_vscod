import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { formatZar, PRICE_KIND_LABELS } from "@propintel/shared";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { AuctionStatusBadge, DemoBadge, EmptyState } from "@/components/dashboard/bits";
import type { AuctionListItem } from "@/lib/data/types";
import { fmtDateTime, relativeAge } from "@/lib/utils";

export function AuctionTable({ items }: { items: AuctionListItem[] }) {
  if (items.length === 0) return <EmptyState title="No auctions match" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Event</TH>
          <TH>Auction</TH>
          <TH>Status</TH>
          <TH>Published prices</TH>
          <TH>Property match</TH>
          <TH>Verified</TH>
        </TR>
      </THead>
      <TBody>
        {items.map(({ auction: a, sheriff, lots }) => (
          <TR key={a.id}>
            <TD className="whitespace-nowrap">{fmtDateTime(a.event_at)}</TD>
            <TD>
              <Link href={`/auctions/${a.id}`} className="font-medium text-primary hover:underline">
                {a.title}
              </Link>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {a.kind === "sheriff_sale" ? (sheriff ? sheriff.name : "Sheriff unknown") : a.auction_house_name ?? "Auctioneer unknown"}
                <DemoBadge show={a.provenance.is_demo} />
              </div>
            </TD>
            <TD>
              <AuctionStatusBadge status={a.status} />
            </TD>
            <TD className="text-xs">
              {a.prices.length === 0 && <span className="text-muted-foreground">None published</span>}
              {a.prices.map((p) => (
                <div key={p.kind}>
                  <span className="text-muted-foreground">{PRICE_KIND_LABELS[p.kind]}:</span>{" "}
                  <span className="tabular">{p.amount != null ? formatZar(p.amount) : "Not disclosed"}</span>
                </div>
              ))}
            </TD>
            <TD className="text-xs">
              {lots.map((l, i) =>
                l.property_id ? (
                  <Link key={i} href={`/properties/${l.property_id}`} className="block text-primary hover:underline">
                    {l.described_address}
                  </Link>
                ) : (
                  <div key={i}>
                    <AlertTriangle className="inline size-3 text-warning" /> {l.described_address}
                    <span className="text-muted-foreground"> · {l.candidate_count > 0 ? `${l.candidate_count} candidates, needs review` : "unmatched"}</span>
                  </div>
                ),
              )}
            </TD>
            <TD className="whitespace-nowrap text-xs text-muted-foreground">{a.last_verified_at ? relativeAge(a.last_verified_at) : "Unverified"}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
