// South African address normalisation. Addresses are supporting evidence only:
// legal identifiers (erf/portion/township, sectional scheme/unit) take precedence.

const STREET_SUFFIXES: Record<string, string> = {
  st: "street", str: "street", street: "street", straat: "street",
  rd: "road", road: "road", weg: "road",
  ave: "avenue", av: "avenue", avenue: "avenue", laan: "avenue",
  dr: "drive", drive: "drive", rylaan: "drive",
  cres: "crescent", crescent: "crescent", singel: "crescent",
  ln: "lane", lane: "lane",
  cl: "close", close: "close",
  pl: "place", place: "place",
};

export function normalizeWhitespace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeAddress(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,#]/g, " ");
  return normalizeWhitespace(
    cleaned
      .split(" ")
      .map((w) => STREET_SUFFIXES[w] ?? w)
      .join(" "),
  );
}

export interface ParsedQuery {
  raw: string;
  normalized: string;
  erf_number: string | null;
  portion: string | null;
  unit_number: string | null;
  scheme_number: string | null; // e.g. SS 123/2004
  street_number: string | null;
}

/** Extracts legal identifiers typed into the search box, e.g. "erf 1234", "portion 5", "unit 12", "SS 45/1998". */
export function parseSearchQuery(raw: string): ParsedQuery {
  const q = raw.toLowerCase();
  const erf = q.match(/\berf\s*(?:no\.?|number)?\s*(\d+)/);
  const portion = q.match(/\b(?:portion|ptn)\s*(\d+)/);
  const unit = q.match(/\b(?:unit|door|flat)\s*(\d+[a-z]?)/);
  const scheme = q.match(/\bss\s*(\d+\s*\/\s*\d{4})/);
  const street = q.match(/^\s*(\d+[a-z]?)\s+[a-z]/);
  return {
    raw,
    normalized: normalizeAddress(raw),
    erf_number: erf?.[1] ?? null,
    portion: portion?.[1] ?? null,
    unit_number: unit?.[1] ?? null,
    scheme_number: scheme?.[1]?.replace(/\s/g, "") ?? null,
    street_number: street?.[1] ?? null,
  };
}

/**
 * Street-level address ("12 sample avenue, sample heights") without unit/complex, used as supporting
 * identity evidence. Units in one scheme share this key, which is why it is never sufficient alone.
 */
export function streetAddressKey(number: string | null, street: string | null, suburb: string | null): string | null {
  if (!number || !street) return null;
  return normalizeAddress(`${number} ${street}${suburb ? `, ${suburb}` : ""}`);
}
