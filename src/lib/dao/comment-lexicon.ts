export interface CommentTags {
  hasTroubleInRunning: boolean;
  hasTravelledWell: boolean;
  hasWeakened: boolean;
  hasGreenness: boolean;
  // null iff the input comment was null/empty — no signal available, distinct
  // from a present-but-neutral comment (no phrase matched any category),
  // which yields 0.
  excuseScore: number | null;
}

// Racing Post-style in-running commentary uses a fairly fixed vocabulary.
// Each category is a single combined regex; a category is "true" if ANY of
// its phrases appears anywhere in the comment (not phrase-count-weighted —
// weighting by count would just reward verbose comments, not stronger
// signal).
//
// Deliberate exclusion: "held" is NOT in WEAKENED. "held up" is a common
// *neutral* early-race positioning phrase (ridden patiently towards the
// rear/mid-pack), not a sign the horse ran out of gas — do not "fix" this by
// adding a bare "held" match, it would misclassify a large fraction of
// comments that simply describe a patient early ride.

const TROUBLE_IN_RUNNING_PHRASES = [
  "hampered",
  "checked",
  "blocked",
  "shut off",
  "boxed in",
  "no room",
  "denied a run",
  "carried wide",
  "stumbled",
  "squeezed",
  "unbalanced",
  "bumped",
  "tightened",
  "short of room",
  "impeded",
  "clipped heels",
  "slipped",
];

const TRAVELLED_WELL_PHRASES = [
  "travelled strongly",
  "travelled well",
  "travelling strongly",
  "travelling well",
  "travelling easily",
  "going easily",
  "going well",
  "in command",
  "quickened",
  "asserted",
  "ridden clear",
  "comfortably",
  "in control",
  "soon clear",
  "always going well",
];

const WEAKENED_PHRASES = [
  "no extra",
  "found little",
  "weakened",
  "one paced",
  "one pace",
  "faded",
  "no impression",
  "never on terms",
  "never a threat",
  "never a factor",
  "tailed off",
  "outpaced",
  "dropped away",
];

const GREEN_INEXPERIENCE_PHRASES = [
  "green",
  "novicey",
  "reluctant",
  "ungenuine",
  "hung left",
  "hung right",
  "ran freely",
  "raced freely",
  "missed the break",
  "slowly away",
  "awkward start",
  "refused",
];

function toRegex(phrases: string[]): RegExp {
  return new RegExp(phrases.join("|"), "i");
}

const TROUBLE_IN_RUNNING_RE = toRegex(TROUBLE_IN_RUNNING_PHRASES);
const TRAVELLED_WELL_RE = toRegex(TRAVELLED_WELL_PHRASES);
const WEAKENED_RE = toRegex(WEAKENED_PHRASES);
const GREEN_INEXPERIENCE_RE = toRegex(GREEN_INEXPERIENCE_PHRASES);

/**
 * Tags a Racing Post-style free-text in-running race comment into four
 * boolean categories plus a composite excuseScore, for use as raw material
 * for a horse's *trailing* form (see precompute-horse-form.ts) — never as a
 * feature describing the current race's own comment, since that would leak
 * the outcome of the very race being predicted.
 *
 * excuseScore = (troubleInRunning ? 2 : 0) + (weakened ? 1 : 0) +
 *               (greenness ? 1 : 0) - (travelledWell ? 2 : 0)
 * Range -2..4 when a comment is present (categories are independent, not
 * mutually exclusive — a comment can note both trouble AND recovering well,
 * for instance). null iff the input is null/empty.
 */
export function tagComment(comment: string | null | undefined): CommentTags {
  const trimmed = (comment ?? "").trim();
  if (!trimmed) {
    return {
      hasTroubleInRunning: false,
      hasTravelledWell: false,
      hasWeakened: false,
      hasGreenness: false,
      excuseScore: null,
    };
  }

  const hasTroubleInRunning = TROUBLE_IN_RUNNING_RE.test(trimmed);
  const hasTravelledWell = TRAVELLED_WELL_RE.test(trimmed);
  const hasWeakened = WEAKENED_RE.test(trimmed);
  const hasGreenness = GREEN_INEXPERIENCE_RE.test(trimmed);

  const excuseScore =
    (hasTroubleInRunning ? 2 : 0) +
    (hasWeakened ? 1 : 0) +
    (hasGreenness ? 1 : 0) -
    (hasTravelledWell ? 2 : 0);

  return { hasTroubleInRunning, hasTravelledWell, hasWeakened, hasGreenness, excuseScore };
}
