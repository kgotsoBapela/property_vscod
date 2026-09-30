import type { z } from "zod";
import type { NormalizedRecord } from "../schemas/normalized";
import type { SyncScope } from "../types/domain";

export type AdapterErrorCategory =
  | "rate_limited"
  | "transient"
  | "timeout"
  | "auth"
  | "quota_exceeded"
  | "validation"
  | "permanent";

export class AdapterError extends Error {
  constructor(
    public readonly category: AdapterErrorCategory,
    message: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "AdapterError";
  }
  get retryable() {
    return this.category === "rate_limited" || this.category === "transient" || this.category === "timeout";
  }
}

export interface FetchRequest {
  scope: SyncScope;
  cursor: string | null;
  /** Subject lookups: legal identifiers + address of the canonical property. */
  subject?: {
    address: string;
    erf_number: string | null;
    portion: string | null;
    township: string | null;
    scheme_name: string | null;
    scheme_number: string | null;
    unit_number: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  radius_m?: number;
  since?: string | null;
  params: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface AdapterPage {
  records: unknown[]; // raw provider payloads, validated by `rawSchema`
  next_cursor: string | null;
  /** Cursor to persist once this page is durably committed (may differ from next_cursor). */
  checkpoint: string | null;
  paid_calls: number;
}

/**
 * Provider-agnostic contract. Real providers (Lightstone, WinDeed, ...) implement this once their
 * documentation, credentials, pricing and licensing are verified. See docs/provider-matrix.md.
 */
export interface SourceAdapter<Raw = unknown> {
  readonly key: string;
  readonly displayName: string;
  readonly isDemo: boolean;
  readonly scopes: readonly SyncScope[];
  readonly rawSchema: z.ZodType<Raw>;
  /** Estimated paid-call cost in ZAR, or null if unknown. Never guess a price. */
  estimateCostZar(req: FetchRequest): number | null;
  fetchPage(req: FetchRequest): Promise<AdapterPage>;
  normalize(raw: Raw): NormalizedRecord;
  /** Stable external id for a raw record (used for source_records uniqueness). */
  externalId(raw: Raw): string;
  /** Licensing metadata stored alongside each source record. */
  licensing: { may_store_raw: boolean; retention_days: number | null; display_rights: string };
}
