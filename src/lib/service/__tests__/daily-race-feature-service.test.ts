import {
  computeTrailingFormStats,
  computeHorseFormStats,
  toFormCategory,
  TrainerJockeyHistoricalRun,
  HorseHistoricalRun,
} from "../daily-race-feature-service";

describe("toFormCategory", () => {
  it("maps flat (any casing/whitespace) to Flat", () => {
    expect(toFormCategory("Flat")).toBe("Flat");
    expect(toFormCategory(" flat ")).toBe("Flat");
    expect(toFormCategory("FLAT")).toBe("Flat");
  });

  it("maps anything else to Jumps", () => {
    expect(toFormCategory("Hurdle")).toBe("Jumps");
    expect(toFormCategory("Chase")).toBe("Jumps");
    expect(toFormCategory(null)).toBe("Jumps");
    expect(toFormCategory(undefined)).toBe("Jumps");
  });
});

describe("computeTrailingFormStats", () => {
  const asOfDate = "2026-06-03";

  it("counts runs/wins/winRate within the trailing window", () => {
    const history: TrainerJockeyHistoricalRun[] = [
      { raceDate: "2026-05-25", isp: 4.0, status: "WINNER" },
      { raceDate: "2026-05-30", isp: 3.0, status: "LOSER" },
      { raceDate: "2026-05-31", isp: 6.0, status: "LOSER" },
    ];
    const stats = computeTrailingFormStats(history, asOfDate);
    expect(stats.runs).toBe(3);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBeCloseTo((1 / 3) * 100, 5);
  });

  it("computes staked/returns from isp using the $1-stake formula, only for isp > 1", () => {
    const history: TrainerJockeyHistoricalRun[] = [
      { raceDate: "2026-05-25", isp: 4.0, status: "WINNER" }, // staked 1/3, returns 1/3+1
      { raceDate: "2026-05-30", isp: 3.0, status: "LOSER" }, // staked 1/2, returns 0
      { raceDate: "2026-05-31", isp: 1.0, status: "LOSER" }, // isp not > 1, excluded from staked/returns entirely
    ];
    const stats = computeTrailingFormStats(history, asOfDate);
    expect(stats.runs).toBe(3); // still counted in runs/wins
    expect(stats.staked).toBeCloseTo(1 / 3 + 1 / 2, 5);
    expect(stats.returns).toBeCloseTo(1 / 3 + 1, 5);
  });

  it("14-day boundary: a run exactly 14 days back is included, 15 days back is excluded", () => {
    // asOfDate 2026-06-03 minus 14 days = 2026-05-20 (included);
    // minus 15 days = 2026-05-19 (excluded).
    const history: TrainerJockeyHistoricalRun[] = [
      { raceDate: "2026-05-20", isp: 2.0, status: "WINNER" },
      { raceDate: "2026-05-19", isp: 2.0, status: "WINNER" },
    ];
    const stats = computeTrailingFormStats(history, asOfDate);
    expect(stats.runs).toBe(1);
    expect(stats.wins).toBe(1);
  });

  it("excludes a run on asOfDate itself (strictly earlier only)", () => {
    const history: TrainerJockeyHistoricalRun[] = [{ raceDate: asOfDate, isp: 2.0, status: "WINNER" }];
    const stats = computeTrailingFormStats(history, asOfDate);
    expect(stats.runs).toBe(0);
  });

  it("empty history yields null winRate, zero runs/staked/returns", () => {
    const stats = computeTrailingFormStats([], asOfDate);
    expect(stats.runs).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.winRate).toBeNull();
    expect(stats.staked).toBe(0);
    expect(stats.returns).toBe(0);
  });
});

describe("computeHorseFormStats", () => {
  const asOfDate = "2026-06-03";

  function run(overrides: Partial<HorseHistoricalRun>): HorseHistoricalRun {
    return { raceDate: "2026-05-01", status: "LOSER", rpr: null, ts: null, beatenDistance: null, comment: null, ...overrides };
  }

  it("computes daysSinceLastRun from the most recent prior run", () => {
    const history = [run({ raceDate: "2026-05-30" }), run({ raceDate: "2026-05-20" })];
    const stats = computeHorseFormStats(history, asOfDate);
    expect(stats.daysSinceLastRun).toBe(4); // 2026-05-30 -> 2026-06-03
  });

  it("returns null daysSinceLastRun and zero career runs with no prior history", () => {
    const stats = computeHorseFormStats([], asOfDate);
    expect(stats.daysSinceLastRun).toBeNull();
    expect(stats.horseCareerRuns).toBe(0);
    expect(stats.horseCareerWinRate).toBeNull();
    expect(stats.horseAvgRPR).toBeNull();
  });

  it("horseCareerRuns/WinRate are all-time (not windowed), unlike trainer/jockey form", () => {
    // 5 runs spanning well over 14 days back — all must count.
    const history = [
      run({ raceDate: "2025-01-01", status: "WINNER" }),
      run({ raceDate: "2025-06-01", status: "LOSER" }),
      run({ raceDate: "2025-12-01", status: "LOSER" }),
      run({ raceDate: "2026-03-01", status: "WINNER" }),
      run({ raceDate: "2026-05-01", status: "LOSER" }),
    ];
    const stats = computeHorseFormStats(history, asOfDate);
    expect(stats.horseCareerRuns).toBe(5);
    expect(stats.horseCareerWinRate).toBeCloseTo((2 / 5) * 100, 5);
  });

  it("averages RPR/TS/beatenDistance over only the last 3 prior runs, chronologically", () => {
    const history = [
      run({ raceDate: "2026-01-01", rpr: 100, ts: 50, beatenDistance: 10 }), // outside last-3, excluded
      run({ raceDate: "2026-02-01", rpr: 110, ts: 60, beatenDistance: 5 }),
      run({ raceDate: "2026-03-01", rpr: 120, ts: 70, beatenDistance: 3 }),
      run({ raceDate: "2026-04-01", rpr: 130, ts: 80, beatenDistance: 1 }),
    ];
    const stats = computeHorseFormStats(history, asOfDate);
    expect(stats.horseAvgRPR).toBeCloseTo((110 + 120 + 130) / 3, 5);
    expect(stats.horseAvgTS).toBeCloseTo((60 + 70 + 80) / 3, 5);
    expect(stats.horseAvgBeatenDistance).toBeCloseTo((5 + 3 + 1) / 3, 5);
  });

  it("sorts unordered input chronologically before taking the last-3 window", () => {
    // Deliberately out of order — the function must sort by raceDate itself.
    const history = [
      run({ raceDate: "2026-04-01", rpr: 130 }),
      run({ raceDate: "2026-01-01", rpr: 100 }),
      run({ raceDate: "2026-03-01", rpr: 120 }),
      run({ raceDate: "2026-02-01", rpr: 110 }),
    ];
    const stats = computeHorseFormStats(history, asOfDate);
    // last 3 chronologically: Feb(110), Mar(120), Apr(130)
    expect(stats.horseAvgRPR).toBeCloseTo((110 + 120 + 130) / 3, 5);
  });

  it("computes comment-derived fields only from the last-3-runs subset that had a tagged comment", () => {
    const history = [
      run({ raceDate: "2026-01-01", comment: "hampered" }), // outside last-3
      run({ raceDate: "2026-02-01", comment: null }), // in last-3, but no comment -> excluded from comment stats
      run({ raceDate: "2026-03-01", comment: "travelled well throughout" }),
      run({ raceDate: "2026-04-01", comment: "hampered and checked" }),
    ];
    const stats = computeHorseFormStats(history, asOfDate);
    // last-3 = Feb(null), Mar(travelled well -> hasTravelledWell), Apr(hampered -> hasTroubleInRunning)
    // runsWithComment = Mar + Apr only (Feb has no comment)
    expect(stats.horseTroubleInRunningRate).toBeCloseTo(50, 5); // 1 of 2
    expect(stats.horseTravelledWellRate).toBeCloseTo(50, 5); // 1 of 2
    // excuseScore: Mar = -2 (travelledWell), Apr = 2 (trouble) -> mean 0
    expect(stats.horseAvgExcuseScore).toBeCloseTo(0, 5);
  });

  it("returns null comment-derived fields when no prior run had a comment", () => {
    const history = [run({ raceDate: "2026-05-01", comment: null })];
    const stats = computeHorseFormStats(history, asOfDate);
    expect(stats.horseAvgExcuseScore).toBeNull();
    expect(stats.horseTroubleInRunningRate).toBeNull();
    expect(stats.horseTravelledWellRate).toBeNull();
  });

  it("excludes a run on asOfDate itself (strictly earlier only)", () => {
    const stats = computeHorseFormStats([run({ raceDate: asOfDate })], asOfDate);
    expect(stats.horseCareerRuns).toBe(0);
  });
});
