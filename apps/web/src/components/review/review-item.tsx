"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, FilePlus2, X } from "lucide-react";
import type { PropertyIdentifier } from "@propintel/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import type { ReviewDecision, ReviewQueueItem } from "@/lib/data/types";
import { fmtDateTime } from "@/lib/utils";

function legal(i: PropertyIdentifier) {
  if (i.kind === "sectional_scheme_unit") return `${i.scheme_name ?? "Scheme"} (${i.scheme_number ?? "no SS number"}), unit ${i.unit_number ?? "?"}`;
  if (i.kind === "erf") return `Erf ${i.erf_number}${i.portion ? ` portion ${i.portion}` : ""}, ${i.township ?? "township unknown"}`;
  return i.kind;
}

export function ReviewItem({ item }: { item: ReviewQueueItem }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (decision: ReviewDecision) => {
      const res = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(decision) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the decision");
      return body as { property_id: string | null };
    },
    onSuccess: () => router.refresh(),
  });

  const choose = (propertyId: string) =>
    item.kind === "identity"
      ? m.mutate({ kind: "identity", id: item.id, action: "merge", property_id: propertyId })
      : m.mutate({ kind: "auction_lot", auction_id: item.auction_id, lot_index: item.lot_index, action: "confirm", property_id: propertyId });
  const reject = () =>
    item.kind === "identity"
      ? m.mutate({ kind: "identity", id: item.id, action: "reject", property_id: null })
      : m.mutate({ kind: "auction_lot", auction_id: item.auction_id, lot_index: item.lot_index, action: "reject", property_id: null });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{item.kind === "identity" ? "Property record" : "Auction lot"}</Badge>
          <CardTitle>{item.description}</CardTitle>
        </div>
        <div className="text-xs text-muted-foreground">
          {item.kind === "auction_lot" && (
            <>
              <Link href={`/auctions/${item.auction_id}`} className="text-primary hover:underline">
                {item.auction_title}
              </Link>{" "}
              ·{" "}
            </>
          )}
          {item.provider} · {item.external_id} · received {fmtDateTime(item.created_at)}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Legal identity in record</dt>
          <dd>{item.record_identity ?? <span className="text-muted-foreground">None given (address only)</span>}</dd>
          <dt className="text-muted-foreground">Why it needs review</dt>
          <dd>{item.reason}</dd>
        </dl>

        {item.candidates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              Candidate properties ({item.candidates.length}). Pick the one that is legally the same property, if any.
            </div>
            {item.candidates.map((c) => (
              <div key={c.property_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Link href={`/properties/${c.property_id}`} target="_blank" className="font-medium text-primary hover:underline">
                    {c.address ?? c.property_id}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {c.identifiers.length ? c.identifiers.map(legal).join("; ") : "No legal identifier on record"}
                  </div>
                  {c.conflicts.length > 0 && <div className="text-xs text-foreground">Conflicts: {c.conflicts.join("; ")}</div>}
                </div>
                {confirming === c.property_id ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => choose(c.property_id)} disabled={m.isPending}>
                      <Check /> Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirming(c.property_id)} disabled={m.isPending}>
                    {item.kind === "identity" ? "Same property" : "This is the property"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No candidate properties were found.</p>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          {item.kind === "identity" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={m.isPending}
              onClick={() => m.mutate({ kind: "identity", id: item.id, action: "create_new", property_id: null })}
            >
              <FilePlus2 /> Create as a new property
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={m.isPending} onClick={reject}>
            <X /> {item.kind === "identity" ? "Reject record" : "None of these (no match)"}
          </Button>
        </div>
        {m.isError && <p className="text-xs text-critical">{(m.error as Error).message}</p>}
      </CardContent>
    </Card>
  );
}
