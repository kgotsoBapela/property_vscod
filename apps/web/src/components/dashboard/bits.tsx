import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Database, FlaskConical, HelpCircle, PauseCircle } from "lucide-react";
import {
  formatZar,
  PRICE_KIND_LABELS,
  type AuctionStatus,
  type PriceKind,
  type PropertyIdentifier,
  type VerificationStatus,
} from "@propintel/shared";
import { Badge } from "@/components/ui/primitives";
import { cn, fmtDate, fmtDateTime, isStale, relativeAge } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}

/** Every price carries its meaning. A missing amount is an explicit state, never zero. */
export function PriceTag({ kind, amount, published = true, className }: { kind: PriceKind; amount: number | null; published?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-xs text-muted-foreground">{PRICE_KIND_LABELS[kind]}</span>
      <span className="tabular text-base font-semibold">
        {amount != null ? formatZar(amount) : <span className="font-normal text-muted-foreground">{published ? "Not available" : "Not disclosed"}</span>}
      </span>
    </div>
  );
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge variant="demo" title="Synthetic fixture data, not real">
      <FlaskConical className="size-3" /> Demo data
    </Badge>
  );
}

export function SourceNote({ sources, effective }: { sources: { provider: string; retrieved_at: string; is_demo?: boolean }[]; effective?: string | null }) {
  if (sources.length === 0) return <span>No source records.</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Database className="size-3.5" />
      {sources.map((s) => (
        <span key={s.provider}>
          Source: <span className="font-medium text-foreground">{s.provider}</span> · retrieved {fmtDateTime(s.retrieved_at)} ({relativeAge(s.retrieved_at)})
          {isStale(s.retrieved_at) && <span className="ml-1 text-foreground">· <AlertTriangle className="inline size-3 text-warning" /> stale</span>}
          {s.is_demo && <span className="ml-1">· synthetic</span>}
        </span>
      ))}
      {effective && <span>Effective {fmtDate(effective)}</span>}
    </span>
  );
}

const STATUS: Record<AuctionStatus, { label: string; variant: "good" | "warning" | "critical" | "muted" | "outline"; icon: React.ElementType }> = {
  scheduled: { label: "Scheduled", variant: "outline", icon: Clock },
  postponed: { label: "Postponed", variant: "warning", icon: PauseCircle },
  cancelled: { label: "Cancelled", variant: "critical", icon: CircleSlash },
  sold: { label: "Sold", variant: "good", icon: CheckCircle2 },
  no_sale: { label: "No sale", variant: "muted", icon: CircleSlash },
  withdrawn: { label: "Withdrawn", variant: "critical", icon: CircleSlash },
  unknown: { label: "Status unknown", variant: "warning", icon: HelpCircle },
};

export function AuctionStatusBadge({ status }: { status: AuctionStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      <Icon className={cn("size-3", status === "postponed" && "text-warning", status === "cancelled" && "text-critical", status === "sold" && "text-good")} />
      {s.label}
    </Badge>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  if (status === "verified")
    return (
      <Badge variant="good">
        <CheckCircle2 className="size-3 text-good" /> Verified
      </Badge>
    );
  return (
    <Badge variant="warning">
      <AlertTriangle className="size-3 text-warning" /> {status[0]!.toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" | "insufficient_data" }) {
  const map = {
    high: { label: "High confidence", variant: "good" as const },
    medium: { label: "Medium confidence", variant: "outline" as const },
    low: { label: "Low confidence", variant: "warning" as const },
    insufficient_data: { label: "Insufficient data", variant: "critical" as const },
  };
  return <Badge variant={map[confidence].variant}>{map[confidence].label}</Badge>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function describeIdentifier(i: PropertyIdentifier): string {
  switch (i.kind) {
    case "erf":
      return `Erf ${i.erf_number}${i.portion ? ` portion ${i.portion}` : ""}, ${i.township ?? "township unknown"}`;
    case "sectional_scheme_unit":
      return `${i.scheme_name ?? "Scheme"} (${i.scheme_number ?? "no SS number"}), unit ${i.unit_number ?? "?"}`;
    case "provider_property_id":
      return `${i.provider} ID ${i.external_id}`;
    case "title_deed":
      return `Title deed ${i.title_deed}`;
    default:
      return i.kind;
  }
}

export function PropertyLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link href={`/properties/${id}`} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
