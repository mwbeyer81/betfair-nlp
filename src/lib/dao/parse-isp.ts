export interface ParsedIsp {
  odds: number | null;
  isFavourite: boolean;
}

const FRACTION_RE = /^(\d+)\/(\d+)/;
const EVENS_RE = /^ev(en)?s?/i;

// F = favourite, JF = joint favourite, C = co-favourite (tied for favourite).
// A bare "J" (joint, no F) is not treated as a favourite marker on its own.
function isFavouriteSuffix(suffix: string): boolean {
  return /[fc]/i.test(suffix);
}

/**
 * Parse a Racing Post "sp" (Industry Starting Price) string into decimal odds.
 * Fractional format e.g. "5/1", "13/5F" (trailing letters mark favourite/joint-
 * favourite/co-favourite — F/JF/J/C — and are otherwise ignored for odds value).
 * Textual "Evens"/"Evs" (optionally suffixed the same way) means 1/1.
 * Anything else (blank, garbage, non-runner) yields odds: null.
 */
export function parseIsp(raw: string | null | undefined): ParsedIsp {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { odds: null, isFavourite: false };

  const fractionMatch = trimmed.match(FRACTION_RE);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (denominator === 0) return { odds: null, isFavourite: false };
    const suffix = trimmed.slice(fractionMatch[0].length);
    return { odds: numerator / denominator + 1, isFavourite: isFavouriteSuffix(suffix) };
  }

  if (EVENS_RE.test(trimmed)) {
    const suffix = trimmed.replace(EVENS_RE, "");
    return { odds: 2, isFavourite: isFavouriteSuffix(suffix) };
  }

  return { odds: null, isFavourite: false };
}
