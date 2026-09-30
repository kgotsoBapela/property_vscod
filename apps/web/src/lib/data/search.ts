import { normalizeAddress, parseSearchQuery, type Property, type PropertyIdentifier } from "@propintel/shared";
import type { SearchResult } from "./types";

/**
 * Ranks properties for a free-text query. Legal identifiers (erf/portion, scheme/unit) outrank address text,
 * and every result carries the reasons it matched so the identity picker can show them.
 */
export function rankProperties(q: string, properties: Iterable<Property>, identifiersFor: (id: string) => PropertyIdentifier[]): SearchResult[] {
  const parsed = parseSearchQuery(q);
  const tokens = normalizeAddress(q)
    .split(" ")
    .filter((t) => t.length > 1 && !["erf", "portion", "ptn", "unit", "ss", "door", "flat"].includes(t));
  const out: SearchResult[] = [];

  for (const p of properties) {
    const ids = identifiersFor(p.id);
    const reasons: string[] = [];
    let score = 0;
    const legal = ids.filter((i) => i.kind === "erf" || i.kind === "sectional_scheme_unit");

    if (parsed.erf_number) {
      const hit = legal.find((i) => i.erf_number === parsed.erf_number && (!parsed.portion || i.portion === parsed.portion));
      if (!hit) continue;
      score += 60;
      reasons.push(`Erf ${hit.erf_number}${hit.portion ? ` portion ${hit.portion}` : ""}, ${hit.township ?? "township unknown"}`);
    }
    if (parsed.scheme_number) {
      const hit = legal.find((i) => i.scheme_number?.replace(/^ss/i, "").replace(/\s/g, "") === parsed.scheme_number);
      if (!hit) continue;
      score += 60;
      reasons.push(`Scheme ${hit.scheme_name ?? ""} ${hit.scheme_number}`.trim());
    }
    if (parsed.unit_number) {
      if (p.unit_number?.toLowerCase() !== parsed.unit_number) continue;
      score += 30;
      reasons.push(`Unit ${p.unit_number}`);
    }

    const haystack = normalizeAddress(`${p.normalized_address} ${p.complex_name ?? ""} ${p.suburb} ${p.municipality ?? ""}`);
    const textTokens = tokens.filter((t) => !(parsed.erf_number && t === parsed.erf_number) && !(parsed.unit_number && t === parsed.unit_number) && !(parsed.portion && t === parsed.portion));
    const matched = textTokens.filter((t) => haystack.split(" ").some((w) => w === t || (t.length >= 3 && w.startsWith(t))));
    if (textTokens.length > 0) {
      if (matched.length < textTokens.length) {
        if (score === 0) continue; // text-only search: every token must match
      } else {
        score += 10 * matched.length;
        reasons.push("Address text matches");
      }
    }
    if (parsed.street_number && p.street_number?.toLowerCase() === parsed.street_number) score += 15;
    if (score > 0) out.push({ property: p, identifiers: ids, match_reasons: reasons, score });
  }
  return out.sort((a, b) => b.score - a.score || a.property.normalized_address.localeCompare(b.property.normalized_address)).slice(0, 50);
}
