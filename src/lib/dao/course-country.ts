export interface DerivedCourse {
  course: string;
  countryCode: string;
}

// Historical Racing Post suffix codes (present in older rows; the 2026 trial
// window carries none of these, but keep for forward-compat if older data is
// ever imported) mapped to ISO-3166 alpha-2.
const SUFFIX_TO_COUNTRY: Record<string, string> = {
  IRE: "IE",
  FR: "FR",
  GER: "DE",
  ITY: "IT",
  USA: "US",
  UAE: "AE",
  AUS: "AU",
  SAF: "ZA",
  JER: "JE",
  GUE: "GG",
  IOM: "IM",
  NZ: "NZ",
  CAN: "CA",
  SWE: "SE",
  QAT: "QA",
  HK: "HK",
  JPN: "JP",
};

// All-weather surface marker — not a country, just strip it.
const NON_COUNTRY_SUFFIXES = new Set(["AW"]);

// Well-known Irish racecourses that carry no explicit country suffix in the
// 2026 data (verified — see plan doc). Anything not in this list, and with no
// recognised country suffix, defaults to GB. This is a deliberate trial-scope
// approximation: non-UK/IRE fixtures (French, US, Australian, etc. meetings
// that appear in the data) will be mislabeled GB.
const IRISH_COURSES = new Set([
  "ballinrobe",
  "bellewstown",
  "clonmel",
  "cork",
  "curragh",
  "down royal",
  "downpatrick",
  "dundalk",
  "fairyhouse",
  "galway",
  "gowran park",
  "kilbeggan",
  "killarney",
  "laytown",
  "leopardstown",
  "limerick",
  "listowel",
  "naas",
  "navan",
  "punchestown",
  "roscommon",
  "sligo",
  "thurles",
  "tipperary",
  "tramore",
  "wexford",
]);

const SUFFIX_RE = /\s*\(([A-Za-z]+)\)\s*$/;

export function deriveCountryCode(rawCourse: string): DerivedCourse {
  let course = (rawCourse ?? "").trim();
  let countryCode: string | null = null;

  const match = course.match(SUFFIX_RE);
  if (match) {
    const code = match[1].toUpperCase();
    if (NON_COUNTRY_SUFFIXES.has(code)) {
      course = course.slice(0, match.index).trim();
    } else if (SUFFIX_TO_COUNTRY[code]) {
      countryCode = SUFFIX_TO_COUNTRY[code];
      course = course.slice(0, match.index).trim();
    }
  }

  if (!countryCode) {
    countryCode = IRISH_COURSES.has(course.toLowerCase()) ? "IE" : "GB";
  }

  return { course, countryCode };
}
