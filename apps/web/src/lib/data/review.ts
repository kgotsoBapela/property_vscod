/** Human-readable legal identity of an incoming record or auction lot, e.g. "Erf 450, Sample Heights Ext 1". */
export function describeLegalIdentity(r: {
  erf_number?: string | null;
  portion?: string | null;
  township?: string | null;
  scheme_name?: string | null;
  scheme_number?: string | null;
  unit_number?: string | null;
}): string | null {
  if (r.scheme_name || r.scheme_number) {
    return `${r.scheme_name ?? "Scheme"}${r.scheme_number ? ` (${r.scheme_number})` : ""}, unit ${r.unit_number ?? "unknown"}`;
  }
  if (r.erf_number) return `Erf ${r.erf_number}${r.portion ? ` portion ${r.portion}` : ""}${r.township ? `, ${r.township}` : ""}`;
  return null;
}
