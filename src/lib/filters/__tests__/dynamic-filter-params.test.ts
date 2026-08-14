import {
  parseDynamicFilters,
  serializeDynamicFilters,
  hasActiveDynamicFilters,
  DYNAMIC_FILTER_PARAM_NAMES,
} from "../dynamic-filter-params";
import { FILTER_FIELDS, getFilterField } from "../field-registry";

describe("field registry", () => {
  it("gives every field either a stored path or an expression, never both and never neither", () => {
    for (const field of FILTER_FIELDS) {
      const hasPath = field.path != null;
      const hasExpr = field.expr != null;
      expect([field.name, hasPath !== hasExpr]).toEqual([field.name, true]);
    }
  });

  it("has no duplicate field names", () => {
    const names = FILTER_FIELDS.map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("produces no colliding query-param names", () => {
    expect(new Set(DYNAMIC_FILTER_PARAM_NAMES).size).toBe(DYNAMIC_FILTER_PARAM_NAMES.length);
  });

  it("never spells an enum param as name + 's' when that would read badly", () => {
    // `sex` -> "sexes", not "sexs". The registry has to say so explicitly.
    const enums = FILTER_FIELDS.filter(f => f.type === "enum");
    expect(enums.length).toBeGreaterThan(0);
    for (const field of enums) {
      expect(field.enumParam).toBeTruthy();
      expect(field.enumValues?.length).toBeGreaterThan(0);
    }
  });

  it("marks the three comment-derived fields disabled, since they are 100% null in production", () => {
    for (const name of ["horseAvgExcuseScore", "horseTroubleInRunningRate", "horseTravelledWellRate"]) {
      const field = getFilterField(name);
      expect(field?.enabled).toBe(false);
      expect(field?.coverage).toBe(0);
    }
  });

  it("carries a note on every field whose coverage is materially below 100%", () => {
    // A sparse field without an explanation is the trap this whole feature is
    // trying to avoid — see field-registry.ts's header.
    for (const field of FILTER_FIELDS) {
      if (field.coverage < 95) expect([field.name, field.note != null]).toEqual([field.name, true]);
    }
  });
});

describe("parseDynamicFilters", () => {
  it("returns nothing for a query with no registry params", () => {
    const { filters, errors } = parseDynamicFilters({ minIsp: "2", page: "3" });
    expect(filters).toEqual({});
    expect(errors).toEqual([]);
    expect(hasActiveDynamicFilters(filters)).toBe(false);
  });

  it("reads a min bound, a max bound, and both together", () => {
    expect(parseDynamicFilters({ minOfficialRating: "90" }).filters).toEqual({ officialRating: { min: 90 } });
    expect(parseDynamicFilters({ maxOfficialRating: "70" }).filters).toEqual({ officialRating: { max: 70 } });
    expect(parseDynamicFilters({ minAge: "3", maxAge: "5" }).filters).toEqual({ age: { min: 3, max: 5 } });
  });

  it("keeps a zero bound instead of treating it as unset", () => {
    // `parseFloat(x) || fallback` — the idiom used for the hand-written params
    // — eats a legitimate 0. minAge=0 and minDraw=0 are real bounds.
    expect(parseDynamicFilters({ minAge: "0" }).filters).toEqual({ age: { min: 0 } });
    expect(parseDynamicFilters({ maxDraw: "0" }).filters).toEqual({ draw: { max: 0 } });
  });

  it("swaps an inverted range rather than returning an empty result", () => {
    expect(parseDynamicFilters({ minAge: "8", maxAge: "2" }).filters).toEqual({ age: { min: 2, max: 8 } });
  });

  it("accepts a valid enum selection and rejects an unknown value", () => {
    expect(parseDynamicFilters({ sexes: "F,M" }).filters).toEqual({ sex: { values: ["F", "M"] } });
    const { filters, errors } = parseDynamicFilters({ sexes: "Z" });
    expect(filters).toEqual({});
    expect(errors[0]).toContain("unknown value(s) Z");
  });

  it("errors on a misspelled field rather than silently ignoring it", () => {
    // The failure this guards against is a filtered-looking result that was
    // never filtered — worse than an error, because the number looks usable.
    const { errors } = parseDynamicFilters({ minOffcialRating: "80" });
    expect(errors).toEqual(["minOffcialRating: unknown filter field"]);
  });

  it("does not mistake the hand-written min*/max* params for registry typos", () => {
    const { filters, errors } = parseDynamicFilters({
      minRunners: "5", maxRunners: "12", minIsp: "2", maxIsp: "10",
      minInIspRange: "1", maxInIspRange: "8", minDate: "2024-01-01", maxDate: "2024-01-31",
      minModelWinProbability: "40", minModelSpEdgePts: "5",
    });
    expect(errors).toEqual([]);
    expect(filters).toEqual({});
  });

  it("errors on a supplied-but-unparseable bound instead of defaulting it away", () => {
    expect(parseDynamicFilters({ minAge: "abc" }).errors).toEqual(["minAge: not a number"]);
  });

  it("refuses a filter on a disabled field", () => {
    const { filters, errors } = parseDynamicFilters({ minHorseAvgExcuseScore: "1" });
    expect(filters).toEqual({});
    expect(errors[0]).toContain("not filterable");
  });

  it("round-trips through serializeDynamicFilters", () => {
    const query = { minOfficialRating: "90", maxAge: "6", sexes: "G", headgear: "b,t" };
    const { filters } = parseDynamicFilters(query);
    expect(serializeDynamicFilters(filters)).toEqual(query);
  });
});
