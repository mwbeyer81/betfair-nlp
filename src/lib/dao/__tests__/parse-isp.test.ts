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

  it("maps a known legacy country suffix", () => {
    expect(deriveCountryCode("Tramore (IRE)")).toEqual({ course: "Tramore", countryCode: "IE" });
    expect(deriveCountryCode("Auteuil (FR)")).toEqual({ course: "Auteuil", countryCode: "FR" });
  });

  it("defaults known Irish courses to IE when no suffix is present", () => {
    expect(deriveCountryCode("Fairyhouse")).toEqual({ course: "Fairyhouse", countryCode: "IE" });
    expect(deriveCountryCode("curragh")).toEqual({ course: "curragh", countryCode: "IE" });
  });

  it("defaults everything else to GB", () => {
    expect(deriveCountryCode("Ascot")).toEqual({ course: "Ascot", countryCode: "GB" });
    expect(deriveCountryCode("Compiegne")).toEqual({ course: "Compiegne", countryCode: "GB" });
  });
});
