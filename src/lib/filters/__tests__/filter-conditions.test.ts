import { buildDynamicRunnerConds, buildDynamicRaceConds } from "../filter-conditions";
import { parseDynamicFilters } from "../dynamic-filter-params";

function condsFor(query: Record<string, string>) {
  const { filters } = parseDynamicFilters(query);
  return { runner: buildDynamicRunnerConds(filters), race: buildDynamicRaceConds(filters) };
}

describe("buildDynamicRunnerConds / buildDynamicRaceConds", () => {
  it("emits nothing when no filters are set", () => {
    const { runner, race } = condsFor({});
    expect(runner).toEqual([]);
    expect(race).toEqual([]);
  });

  it("routes a runner field to the runner conditions, $$r-bound", () => {
    const { runner, race } = condsFor({ minOfficialRating: "90" });
    expect(race).toEqual([]);
    expect(runner).toEqual([
      { $and: [{ $isNumber: "$$r.officialRating" }, { $gte: ["$$r.officialRating", 90] }] },
    ]);
  });

  it("routes a race field to the race conditions, $-bound", () => {
    // A race-scoped condition evaluated inside the $filter over `runners` would
    // be merely wasteful; a runner-scoped one evaluated on the race document
    // reads $$r outside its binding and throws. Hence the split.
    const { runner, race } = condsFor({ minRan: "12" });
    expect(runner).toEqual([]);
    expect(race).toEqual([{ $and: [{ $isNumber: "$ran" }, { $gte: ["$ran", 12] }] }]);
  });

  it("always guards a numeric bound with $isNumber", () => {
    // Without it, BSON's cross-type ordering puts null below every number, so
    // `{$lte: [null, 4]}` is TRUE and maxDraw=4 would match every drawless
    // (i.e. every jumps) runner. Measured against production: 257,374 runners
    // with the guard, 600,370 without.
    const { runner } = condsFor({ maxDraw: "4" });
    expect(runner[0]).toEqual({
      $and: [{ $isNumber: "$$r.draw" }, { $lte: ["$$r.draw", 4] }],
    });
  });

  it("emits both bounds for a two-sided range", () => {
    const { runner } = condsFor({ minAge: "3", maxAge: "5" });
    expect(runner[0]).toEqual({
      $and: [{ $isNumber: "$$r.age" }, { $gte: ["$$r.age", 3] }, { $lte: ["$$r.age", 5] }],
    });
  });

  it("uses $in for an equality enum", () => {
    const { runner } = condsFor({ sexes: "F,M" });
    expect(runner[0]).toEqual({ $in: ["$$r.sex", ["F", "M"]] });
  });

  it("uses a substring test for headgear, so a combination still matches", () => {
    // Headgear is a SET rendered as a string: blinkers + tongue tie is "tb".
    // Equality would find 45,693 runners and miss the 13,382 wearing blinkers
    // alongside something else.
    const { runner } = condsFor({ headgear: "b" });
    expect(runner[0]).toEqual({
      $or: [{ $gte: [{ $indexOfCP: [{ $ifNull: ["$$r.hg", ""] }, "b"] }, 0] }],
    });
  });

  it("builds ROI from the stored accumulators, guarding a zero denominator", () => {
    // $divide by 0 raises in MongoDB, and null (rather than 0) keeps "never had
    // a qualifying runner" distinct from "broke even" — same rule as
    // ml/features.py's _safe_ratio.
    const { runner } = condsFor({ minTrainerFormROI: "1.5" });
    const roi = {
      $cond: [
        { $gt: ["$$r.trainerFormStaked", 0] },
        { $divide: [{ $ifNull: ["$$r.trainerFormReturns", 0] }, "$$r.trainerFormStaked"] },
        null,
      ],
    };
    expect(runner[0]).toEqual({ $and: [{ $isNumber: roi }, { $gte: [roi, 1.5] }] });
  });

  it("emits one condition per field when several are active", () => {
    const { runner, race } = condsFor({ minOfficialRating: "90", maxAge: "4", minRan: "8" });
    expect(runner).toHaveLength(2);
    expect(race).toHaveLength(1);
  });
});
