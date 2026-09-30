import type { PriceKind, SyncStatus, TransferType } from "./types/domain";

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  partially_completed: "Partially completed",
  failed: "Failed",
  cancellation_requested: "Cancellation requested",
  cancelled: "Cancelled",
};

// Every price shown in the UI is labelled with its meaning. Never substitute one for another.
export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  registered_transfer: "Registered transfer",
  asking_price: "Asking price",
  avm_estimate: "AVM estimate",
  auction_guide: "Auction guide price",
  auction_reserve: "Reserve price",
  opening_bid: "Opening bid",
  confirmed_hammer: "Confirmed hammer price",
};

export const TRANSFER_TYPE_LABELS: Record<TransferType, string> = {
  market_sale: "Market sale",
  sale_in_execution: "Sale in execution",
  deceased_estate: "Deceased estate",
  donation: "Donation",
  related_party: "Related-party transfer",
  divorce: "Divorce settlement",
  other: "Other",
};

const zar = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });

export function formatZar(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "Not available";
  return zar.format(amount);
}
