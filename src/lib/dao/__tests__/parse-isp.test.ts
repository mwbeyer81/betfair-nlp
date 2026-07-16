import { parseIsp } from "../parse-isp";
import { deriveCountryCode } from "../course-country";

describe("parseIsp", () => {
  it("parses a plain fraction", () => {
    expect(parseIsp("5/1")).toEqual({ odds: 6, isFavourite: false });
  });

  it("parses a fraction with a favourite marker", () => {
    expect(parseIsp("13/5F")).toEqual({ odds: 3.6, isFavourite: true });
  });

  it("parses joint-favourite and co-favourite markers as favourite", () => {
    expect(parseIsp("7/2JF")).toEqual({ odds: 4.5, isFavourite: true });
    expect(parseIsp("7/2JC")).toEqual({ odds: 4.5, isFavourite: true });
    expect(parseIsp("7/2C")).toEqual({ odds: 4.5, isFavourite: true });
  });

  it("does not treat a bare joint marker (J, no F/C) as favourite", () => {
    expect(parseIsp("7/2J")).toEqual({ odds: 4.5, isFavourite: false });
  });

  it("parses textual evens forms", () => {
    expect(parseIsp("Evens")).toEqual({ odds: 2, isFavourite: false });
    expect(parseIsp("Evs")).toEqual({ odds: 2, isFavourite: false });
    expect(parseIsp("EvensF")).toEqual({ odds: 2, isFavourite: true });
    expect(parseIsp("EvsJ")).toEqual({ odds: 2, isFavourite: false });
  });

  it("returns null odds for blank input", () => {
    expect(parseIsp("")).toEqual({ odds: null, isFavourite: false });
    expect(parseIsp(undefined)).toEqual({ odds: null, isFavourite: false });
    expect(parseIsp(null)).toEqual({ odds: null, isFavourite: false });
  });

  it("returns null odds for unparseable garbage", () => {
    expect(parseIsp("F")).toEqual({ odds: null, isFavourite: false });
    expect(parseIsp("N/M")).toEqual({ odds: null, isFavourite: false });
  });

  it("guards against a zero denominator", () => {
    expect(parseIsp("5/0")).toEqual({ odds: null, isFavourite: false });
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
