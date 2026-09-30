import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat("en-ZA", { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Johannesburg" });
const dateTimeFmt = new Intl.DateTimeFormat("en-ZA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${dateTimeFmt.format(d)} SAST`;
}

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-ZA", { maximumFractionDigits: digits });
}

export function relativeAge(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const ms = now - new Date(value).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Proposed stale-data threshold from CLAUDE.md. */
export const STALE_AFTER_HOURS = 36;

export function isStale(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return true;
  return now - new Date(value).getTime() > STALE_AFTER_HOURS * 3_600_000;
}

export function isFuture(value: string | null | undefined, now = Date.now()): boolean {
  return !!value && new Date(value).getTime() > now;
}
