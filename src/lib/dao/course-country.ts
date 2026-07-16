export interface DerivedCourse {
  course: string;
  countryCode: string | null;
}

// All-weather surface marker — not a country, just strip it.
const NON_COUNTRY_SUFFIXES = new Set(["AW"]);

// The 59 racecourses currently licensed by the British Horseracing Authority
// in Great Britain (England/Scotland/Wales) — sourced from
// britishhorseracing.com and cross-checked against Wikipedia's "List of
// British racecourses", using the short course-name forms (no "Park"/"City"/
// "-on-Avon" suffixes) that match how this dataset's `course` field is
// written (e.g. "Kempton" not "Kempton Park", "Sandown" not "Sandown Park").
//
// This is a strict allowlist, not a heuristic: a course not on this list is
// not imported at all, regardless of what suffix (or lack of one) it carries
// in the source data. Deliberately excludes Down Royal/Downpatrick (Northern
// Ireland — administered by Horse Racing Ireland, not the BHA), since the
// requirement is Great Britain only, not "anything under the UK state".
const UK_RACECOURSES = new Set([
  "aintree", "ascot", "ayr", "bangor-on-dee", "bath", "beverley", "brighton",
  "carlisle", "cartmel", "catterick", "chelmsford", "cheltenham", "chepstow", "chester",
  "doncaster", "epsom", "exeter", "fakenham", "ffos las", "fontwell", "goodwood",
  "hamilton", "haydock", "hereford", "hexham", "huntingdon",
  "kelso", "kempton", "leicester", "lingfield", "ludlow",
  "market rasen", "musselburgh", "newbury", "newcastle", "newmarket", "newton abbot",
  "nottingham", "perth", "plumpton", "pontefract", "redcar", "ripon",
  "salisbury", "sandown", "sedgefield", "southwell", "stratford", "taunton", "thirsk",
  "uttoxeter", "warwick", "wetherby", "wincanton", "windsor", "wolverhampton", "worcester",
  "yarmouth", "york",
]);

const SUFFIX_RE = /\s*\(([A-Za-z]+)\)\s*$/;

/**
 * Strips any trailing "(XX)" marker (all-weather surface, or a country/
 * region suffix in older rows) from the course name, then checks the
 * cleaned name against the UK racecourse allowlist. countryCode is "GB"
 * for an allowlisted course, or null if the course isn't recognised as a
 * Great Britain racecourse — callers should skip the race entirely in
 * that case, not import it with a guessed or default country.
 */
export function deriveCountryCode(rawCourse: string): DerivedCourse {
  let course = (rawCourse ?? "").trim();

  const match = course.match(SUFFIX_RE);
  if (match && NON_COUNTRY_SUFFIXES.has(match[1].toUpperCase())) {
    course = course.slice(0, match.index).trim();
  }

  const countryCode = UK_RACECOURSES.has(course.toLowerCase()) ? "GB" : null;

  return { course, countryCode };
}
