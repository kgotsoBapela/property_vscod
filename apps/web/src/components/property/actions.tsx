"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function WatchButton({ propertyId, initial }: { propertyId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const m = useMutation({
    mutationFn: () => postJson(`/api/properties/${propertyId}/watchlist`),
    onSuccess: (r: { watching: boolean }) => setOn(r.watching),
  });
  return (
    <Button variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
      {on ? <BookmarkCheck /> : <Bookmark />} {on ? "Tracking" : "Track"}
    </Button>
  );
}

/** Super Admin live refresh. Returns a job id immediately; progress is shown in the sync center. */
export function RefreshButtons({ propertyId, integrationId }: { propertyId: string; integrationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (scope: "subject_property" | "nearby_sales") =>
      postJson("/api/sync/jobs", { integration_id: integrationId, scope, target_property_id: propertyId, params: {} }),
    onSuccess: (job: { id: string }) => router.push(`/sync/${job.id}`),
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => m.mutate("subject_property")} disabled={m.isPending}>
          <RefreshCw /> Refresh property
        </Button>
        <Button variant="secondary" onClick={() => m.mutate("nearby_sales")} disabled={m.isPending}>
          <RefreshCw /> Refresh nearby sales
        </Button>
      </div>
      {error && (
        <p className="text-xs text-critical">
          {error} <Link href="/sync" className="underline">Sync center</Link>
        </p>
      )}
    </div>
  );
}
