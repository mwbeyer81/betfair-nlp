import { parseIsp } from "../parse-isp";
import { deriveCountryCode } from "../course-country";

describe("parseIsp", () => {
  it("parses a plain fraction", () => {
    expect(parseIsp("5/1")).toEqual({ odds: 6, isFavourite: false, fraction: "5/1" });
  });

  it("parses a fraction with a favourite marker, stripping the marker from the fraction string", () => {
    expect(parseIsp("13/5F")).toEqual({ odds: 3.6, isFavourite: true, fraction: "13/5" });
  });

  it("parses joint-favourite and co-favourite markers as favourite", () => {
    expect(parseIsp("7/2JF")).toEqual({ odds: 4.5, isFavourite: true, fraction: "7/2" });
    expect(parseIsp("7/2JC")).toEqual({ odds: 4.5, isFavourite: true, fraction: "7/2" });
    expect(parseIsp("7/2C")).toEqual({ odds: 4.5, isFavourite: true, fraction: "7/2" });
  });

  it("does not treat a bare joint marker (J, no F/C) as favourite", () => {
    expect(parseIsp("7/2J")).toEqual({ odds: 4.5, isFavourite: false, fraction: "7/2" });
  });

  it("parses textual evens forms, using the conventional 'Evens' display rather than '1/1'", () => {
    expect(parseIsp("Evens")).toEqual({ odds: 2, isFavourite: false, fraction: "Evens" });
    expect(parseIsp("Evs")).toEqual({ odds: 2, isFavourite: false, fraction: "Evens" });
    expect(parseIsp("EvensF")).toEqual({ odds: 2, isFavourite: true, fraction: "Evens" });
    expect(parseIsp("EvsJ")).toEqual({ odds: 2, isFavourite: false, fraction: "Evens" });
  });

  it("returns null odds and fraction for blank input", () => {
    expect(parseIsp("")).toEqual({ odds: null, isFavourite: false, fraction: null });
    expect(parseIsp(undefined)).toEqual({ odds: null, isFavourite: false, fraction: null });
    expect(parseIsp(null)).toEqual({ odds: null, isFavourite: false, fraction: null });
  });

  it("returns null odds and fraction for unparseable garbage", () => {
    expect(parseIsp("F")).toEqual({ odds: null, isFavourite: false, fraction: null });
    expect(parseIsp("N/M")).toEqual({ odds: null, isFavourite: false, fraction: null });
  });

  it("guards against a zero denominator", () => {
    expect(parseIsp("5/0")).toEqual({ odds: null, isFavourite: false, fraction: null });
  });

  it("rounds decimal odds to 2dp instead of storing raw floating-point division artifacts", () => {
    // 8/15 + 1 = 1.5333333333333333 in exact math, but IEEE-754 double
    // division actually yields 1.5333333333333332 — both should round to
    // the same clean 2dp value.
    expect(parseIsp("8/15")).toEqual({ odds: 1.53, isFavourite: false, fraction: "8/15" });
    expect(parseIsp("100/3")).toEqual({ odds: 34.33, isFavourite: false, fraction: "100/3" });
  });

  it("preserves the fraction exactly as written, not reduced to lowest terms", () => {
    expect(parseIsp("10/20")).toEqual({ odds: 1.5, isFavourite: false, fraction: "10/20" });
  });
});

describe("deriveCountryCode", () => {
  it("strips the (AW) all-weather marker without treating it as a country", () => {
    expect(deriveCountryCode("Lingfield (AW)")).toEqual({ course: "Lingfield", countryCode: "GB" });
  });

  it("recognises a genuine UK racecourse regardless of a country-style suffix", () => {
    // The suffix isn't trusted for country determination — only AW is
    // stripped as non-country. A UK course is matched by name either way.
    expect(deriveCountryCode("Ascot")).toEqual({ course: "Ascot", countryCode: "GB" });
    expect(deriveCountryCode("ascot")).toEqual({ course: "ascot", countryCode: "GB" });
  });

  it("rejects (countryCode: null) a known Irish racecourse — not even Ireland is imported", () => {
    expect(deriveCountryCode("Fairyhouse")).toEqual({ course: "Fairyhouse", countryCode: null });
    expect(deriveCountryCode("curragh")).toEqual({ course: "curragh", countryCode: null });
    expect(deriveCountryCode("Tramore (IRE)")).toEqual({ course: "Tramore (IRE)", countryCode: null });
  });

  it("rejects (countryCode: null) an international racecourse, even one previously mislabeled GB by the old default-to-GB heuristic", () => {
    expect(deriveCountryCode("Compiegne")).toEqual({ course: "Compiegne", countryCode: null });
    expect(deriveCountryCode("Sha Tin")).toEqual({ course: "Sha Tin", countryCode: null });
    expect(deriveCountryCode("Auteuil (FR)")).toEqual({ course: "Auteuil (FR)", countryCode: null });
  });

  it("excludes Down Royal and Downpatrick (Northern Ireland, administered by Horse Racing Ireland, not the BHA)", () => {
    expect(deriveCountryCode("Down Royal")).toEqual({ course: "Down Royal", countryCode: null });
    expect(deriveCountryCode("Downpatrick")).toEqual({ course: "Downpatrick", countryCode: null });
  });
});
