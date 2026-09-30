import { haversineMeters } from "../analysis/geo";
import { normalizeAddress } from "./address";

/** Identity facts about one property as described by a provider record or a canonical property. */
export interface IdentityFacts {
  address: string | null;
  erf_number: string | null;
  portion: string | null;
  township: string | null;
  scheme_name: string | null;
  scheme_number: string | null;
  unit_number: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_ids: { provider: string; external_id: string }[];
}

export interface CanonicalCandidate extends IdentityFacts {
  property_id: string;
}

export interface MatchScore {
  property_id: string;
  confidence: number; // 0..1
  evidence: string[];
  conflicts: string[];
  /** A legal identifier proves these are different properties (other unit, portion or township). */
  legally_distinct: boolean;
}

export type MatchDecision =
  | { kind: "auto_match"; property_id: string; confidence: number; evidence: string[] }
  | { kind: "needs_review"; candidates: MatchScore[]; reason: string }
  | { kind: "new_property"; reason: string };

export const AUTO_MATCH_THRESHOLD = 0.95;
export const REVIEW_THRESHOLD = 0.5;

const norm = (v: string | null | undefined) => (v ? v.toLowerCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "") : null);

function isSectional(f: IdentityFacts) {
  return Boolean(f.scheme_name || f.scheme_number || f.unit_number);
}

export function scoreCandidate(record: IdentityFacts, c: CanonicalCandidate): MatchScore {
  const evidence: string[] = [];
  const conflicts: string[] = [];
  let distinct = false;
  let confidence = 0;

  const providerHit = record.provider_ids.find((r) =>
    c.provider_ids.some((p) => p.provider === r.provider && p.external_id === r.external_id),
  );
  if (providerHit) {
    confidence = Math.max(confidence, 0.99);
    evidence.push(`Same ${providerHit.provider} ID ${providerHit.external_id}`);
  }

  // Sectional title: scheme + unit is the legal identity. Different units are never the same property.
  const sameScheme =
    (norm(record.scheme_number) && norm(record.scheme_number) === norm(c.scheme_number)) ||
    (norm(record.scheme_name) && norm(record.scheme_name) === norm(c.scheme_name));
  if (sameScheme) {
    if (norm(record.unit_number) && norm(record.unit_number) === norm(c.unit_number)) {
      confidence = Math.max(confidence, 0.98);
      evidence.push(`Same sectional scheme and unit ${record.unit_number}`);
    } else if (record.unit_number && c.unit_number) {
      conflicts.push(`Same scheme but different unit (${record.unit_number} vs ${c.unit_number})`);
      distinct = true;
    } else {
      conflicts.push("Same scheme but unit number missing on one side");
    }
  } else if (isSectional(record) !== isSectional(c)) {
    if (record.scheme_number || c.scheme_number || record.unit_number || c.unit_number)
      conflicts.push("One record is sectional title, the other is not");
  }

  // Freehold: erf (+ portion) within a township.
  if (norm(record.erf_number) && norm(record.erf_number) === norm(c.erf_number)) {
    const townshipKnown = record.township && c.township;
    const sameTownship = townshipKnown && norm(record.township) === norm(c.township);
    const samePortion = norm(record.portion) === norm(c.portion);
    if (townshipKnown && !sameTownship) {
      conflicts.push(`Erf ${record.erf_number} is in different townships (${record.township} vs ${c.township})`);
      distinct = true;
    } else if (!samePortion) {
      conflicts.push(`Same erf but different portion (${record.portion ?? "none"} vs ${c.portion ?? "none"})`);
      distinct = true;
    } else if (sameTownship) {
      confidence = Math.max(confidence, isSectional(record) || isSectional(c) ? 0.6 : 0.97);
      evidence.push(`Same erf ${record.erf_number}${record.portion ? ` portion ${record.portion}` : ""} in ${record.township}`);
    } else {
      confidence = Math.max(confidence, 0.6);
      evidence.push(`Same erf ${record.erf_number}; township missing on one side`);
    }
  }

  // Address and geolocation are supporting evidence only.
  if (record.address && c.address && normalizeAddress(record.address) === normalizeAddress(c.address)) {
    evidence.push("Normalised street address matches");
    confidence = Math.max(confidence, Math.min(0.9, confidence + 0.55));
  }
  if (record.latitude != null && record.longitude != null && c.latitude != null && c.longitude != null) {
    const d = haversineMeters(record.latitude, record.longitude, c.latitude, c.longitude);
    if (d <= 30) {
      evidence.push(`Coordinates within ${Math.round(d)} m`);
      confidence = Math.max(confidence, Math.min(0.9, confidence + 0.15));
    }
  }

  // Any conflict caps confidence below auto-match so a human reviews it.
  if (conflicts.length > 0) confidence = Math.min(confidence, providerHit ? 0.8 : 0.45);
  return {
    property_id: c.property_id,
    confidence: Number(confidence.toFixed(3)),
    evidence,
    conflicts,
    legally_distinct: distinct && !providerHit,
  };
}

export function resolveIdentity(record: IdentityFacts, candidates: CanonicalCandidate[]): MatchDecision {
  const scored = candidates
    .map((c) => scoreCandidate(record, c))
    // Never merge legally distinct properties (different sectional unit, erf portion or township).
    .filter((s) => !s.legally_distinct)
    .filter((s) => s.confidence > 0 || s.conflicts.length > 0)
    .sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  if (!best || best.confidence < REVIEW_THRESHOLD) {
    const conflicted = scored.filter((s) => s.conflicts.length > 0 && s.evidence.length > 0);
    if (conflicted.length > 0) {
      return { kind: "needs_review", candidates: conflicted, reason: "Partial identifier match with conflicts" };
    }
    return { kind: "new_property", reason: best ? "No candidate above review threshold" : "No candidates" };
  }
  const runnerUp = scored[1];
  if (best.confidence >= AUTO_MATCH_THRESHOLD && best.conflicts.length === 0 && !(runnerUp && runnerUp.confidence >= 0.8)) {
    return { kind: "auto_match", property_id: best.property_id, confidence: best.confidence, evidence: best.evidence };
  }
  return {
    kind: "needs_review",
    candidates: scored.filter((s) => s.confidence >= REVIEW_THRESHOLD),
    reason: runnerUp && runnerUp.confidence >= 0.8 ? "Multiple strong candidates" : "Confidence below auto-match threshold",
  };
}
