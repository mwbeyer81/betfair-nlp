export interface ParsedIsp {
  odds: number | null;
  isFavourite: boolean;
  fraction: string | null;
}

const FRACTION_RE = /^(\d+)\/(\d+)/;
const EVENS_RE = /^ev(en)?s?/i;

// F = favourite, JF = joint favourite, C = co-favourite (tied for favourite).
// A bare "J" (joint, no F) is not treated as a favourite marker on its own.
function isFavouriteSuffix(suffix: string): boolean {
  return /[fc]/i.test(suffix);
}

// Odds are rounded to 2dp for storage/display — matches how Industry SP is
// conventionally quoted (nobody publishes odds to 15 decimal places), and
// avoids storing raw IEEE-754 division artifacts like 1.5333333333333332
// (8/15 + 1) as if they were meaningful precision.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse a Racing Post "sp" (Industry Starting Price) string into decimal
 * odds and a clean fractional display string, storing both since the
 * industry convention is to quote odds as a fraction ("8/15") and decimal
 * ("1.53") is the derived/secondary form, not the other way around.
 * Fractional format e.g. "5/1", "13/5F" (trailing letters mark favourite/joint-
 * favourite/co-favourite — F/JF/J/C — and are otherwise ignored for odds value).
 * The fraction is returned exactly as written in the source (not reduced to
 * lowest terms), just with the favourite-marker suffix stripped, to stay
 * faithful to how it's actually published.
 * Textual "Evens"/"Evs" (optionally suffixed the same way) means 1/1,
 * returned as fraction "Evens" (the conventional display form, not "1/1").
 * Anything else (blank, garbage, non-runner) yields odds/fraction: null.
 */
export function parseIsp(raw: string | null | undefined): ParsedIsp {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { odds: null, isFavourite: false, fraction: null };

  const fractionMatch = trimmed.match(FRACTION_RE);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (denominator === 0) return { odds: null, isFavourite: false, fraction: null };
    const suffix = trimmed.slice(fractionMatch[0].length);
    return {
      odds: round2(numerator / denominator + 1),
      isFavourite: isFavouriteSuffix(suffix),
      fraction: `${numerator}/${denominator}`,
    };
  }

  if (EVENS_RE.test(trimmed)) {
    const suffix = trimmed.replace(EVENS_RE, "");
    return { odds: 2, isFavourite: isFavouriteSuffix(suffix), fraction: "Evens" };
  }

  return { odds: null, isFavourite: false, fraction: null };
}
