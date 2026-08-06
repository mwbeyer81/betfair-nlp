import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO, ModelVsSpParams, ModelVsSpSort } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
// A uniquely-named throwaway database — same reasoning as
// industry-sp-dao-model-version-filter.integration.test.ts: a standalone file
// rather than a new describe block in industry-sp-dao.integration.test.ts,
// which AGENTS.md flags as contested.
const DB_NAME = `betfair_nlp_test_model_vs_sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Every seeded edge below is exact by construction, so the assertions can be
// literal numbers rather than tolerances:
//
//   isp 4    -> implied 25%   | model 40 -> edge +15
//   isp 2    -> implied 50%   | model 50 -> edge   0   (the boundary case)
//   isp 1.25 -> implied 80%   | model 20 -> edge -60
//   isp 5    -> implied 20%   | model 30 -> edge +10
//   isp 10   -> implied 10%   | model  5 -> edge  -5
function params(overrides: Partial<ModelVsSpParams> = {}): ModelVsSpParams {
  return {
    page: 1,
    limit: 100,
    sort: "date_asc",
    minRaceTime: "2000-01-01",
    maxRaceTime: "2099-12-31T23:59:59.999",
    minModelProb: 0,
    maxModelProb: 100,
    minImpliedProb: 0,
    maxImpliedProb: 100,
    minAbsEdge: 0,
    maxAbsEdge: 100,
    minIsp: 1,
    maxIsp: 1000,
    minRunners: 1,
    maxRunners: 100,
    countries: [],
    includeTotal: true,
    ...overrides,
  };
}

function race(
  id: number,
  raceTime: string,
  runners: Record<string, unknown>[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    _id: id,
    raceId: id,
    meetingId: `m${id}`,
    meetingName: "Test Meeting",
    course: "Testcourse",
    countryCode: "GB",
    raceTime,
    raceDate: raceTime.slice(0, 10),
    raceName: `Test Race ${id}`,
    raceType: "Flat",
    raceClass: "Class 3",
    going: "Good",
    ran: runners.length,
    // Precomputed at import time over the isp > 1 runner set — the leading
    // $match filters on it directly, so a seed doc without it matches nothing.
    runnersWithIspCount: runners.filter(r => typeof r.isp === "number" && (r.isp as number) > 1).length,
    runners,
    ...overrides,
  };
}

describe("IndustrySpDAO.getModelVsSpRunners (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
    await dao.createIndexes();

    // Cast to `any[]` — these seed docs use plain numeric _ids (matching how
    // import-industry-sp.ts actually writes this collection), not the ObjectId
    // the driver's default Document type expects.
    await db.collection("industry_starting_prices").insertMany([
      race(1, "2024-01-10T14:00:00.000Z", [
        // edge +15
        { id: 101, name: "Edge Plus Fifteen", num: 1, draw: 1, status: "WINNER", sortPriority: 2, isp: 4, ispFraction: "3/1", isFavourite: false, jockey: "J One", trainer: "T One", modelWinProbabilityOos: 40, modelVersionId: "xgb-v1" },
        // edge exactly 0 — must be RETURNED, not silently dropped
        { id: 102, name: "Edge Exactly Zero", num: 2, draw: 2, status: "LOSER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, jockey: "J Two", trainer: "T Two", modelWinProbabilityOos: 50, modelVersionId: "xgb-v1" },
      ]),
      race(2, "2024-02-20T15:30:00.000Z", [
        // edge -60
        { id: 201, name: "Edge Minus Sixty", num: 1, draw: 1, status: "LOSER", sortPriority: 1, isp: 1.25, ispFraction: "1/4", isFavourite: true, modelWinProbabilityOos: 20, modelVersionId: "xgb-v1" },
        // edge +10
        { id: 202, name: "Edge Plus Ten", num: 2, draw: 2, status: "PLACED", sortPriority: 2, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbabilityOos: 30, modelVersionId: "xgb-v2" },
        // Excluded: no modelWinProbabilityOos field at all (a CSV-imported runner)
        { id: 203, name: "No Model Field", num: 3, draw: 3, status: "LOSER", sortPriority: 3, isp: 6, ispFraction: "5/1", isFavourite: false },
        // Excluded: modelWinProbabilityOos explicitly null
        { id: 204, name: "Model Null", num: 4, draw: 4, status: "LOSER", sortPriority: 4, isp: 7, ispFraction: "6/1", isFavourite: false, modelWinProbabilityOos: null },
        // Excluded: no isp
        { id: 205, name: "No Isp", num: 5, draw: 5, status: "NON_FINISHER", sortPriority: 5, isp: null, ispFraction: null, isFavourite: false, modelWinProbabilityOos: 25 },
        // Excluded: isp === 1 (would make 100/isp = 100 and the $divide degenerate)
        { id: 206, name: "Isp Exactly One", num: 6, draw: 6, status: "LOSER", sortPriority: 6, isp: 1, ispFraction: null, isFavourite: false, modelWinProbabilityOos: 30 },
      ]),
      race(3, "2025-03-05T16:00:00.000Z", [
        // edge -5
        { id: 301, name: "Edge Minus Five", num: 1, draw: 1, status: "LOSER", sortPriority: 1, isp: 10, ispFraction: "9/1", isFavourite: false, modelWinProbabilityOos: 5, modelVersionId: "xgb-v2" },
      ]),
      // An IE race, so the country filter has something to exclude.
      race(4, "2025-03-06T16:00:00.000Z", [
        { id: 401, name: "Irish Runner", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 4, ispFraction: "3/1", isFavourite: true, modelWinProbabilityOos: 40, modelVersionId: "xgb-v2" },
      ], { countryCode: "IE", course: "Irishcourse" }),
    ] as any[]);
  }, 20000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  // Every qualifying runner across all four seeded races.
  const ALL_EDGES = [15, 0, -60, 10, -5, 15];

  describe("row selection", () => {
    it("returns one row per qualifying runner, not one per race", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params());
      expect(rows).toHaveLength(ALL_EDGES.length);
      expect(total).toBe(ALL_EDGES.length);
      // Race 1 alone contributes two rows — proof the unit is the runner.
      expect(rows.filter(r => r.raceId === 1)).toHaveLength(2);
    });

    it("excludes a runner with no modelWinProbabilityOos field at all", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      expect(rows.map(r => r.runnerId)).not.toContain(203);
    });

    it("excludes a runner whose modelWinProbabilityOos is explicitly null", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      expect(rows.map(r => r.runnerId)).not.toContain(204);
    });

    it("excludes a runner with no isp, and one whose isp is exactly 1", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      expect(rows.map(r => r.runnerId)).not.toContain(205);
      expect(rows.map(r => r.runnerId)).not.toContain(206);
    });

    it("computes impliedSpProbability as 100/isp and edge as model minus implied", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      const plus15 = rows.find(r => r.runnerId === 101)!;
      expect(plus15.isp).toBe(4);
      expect(plus15.modelWinProbability).toBe(40);
      expect(plus15.impliedSpProbability).toBeCloseTo(25, 10);
      expect(plus15.edge).toBeCloseTo(15, 10);

      const minus60 = rows.find(r => r.runnerId === 201)!;
      expect(minus60.impliedSpProbability).toBeCloseTo(80, 10);
      expect(minus60.edge).toBeCloseTo(-60, 10);
    });

    it("returns an edge of exactly 0 rather than omitting the row, when model equals implied", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      const zero = rows.find(r => r.runnerId === 102);
      expect(zero).toBeDefined();
      expect(zero!.edge).toBeCloseTo(0, 10);
      expect(zero!.impliedSpProbability).toBeCloseTo(50, 10);
    });

    it("carries the race and runner context each row needs to be rendered and linked", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      const row = rows.find(r => r.runnerId === 101)!;
      expect(row).toMatchObject({
        raceId: 1,
        raceDate: "2024-01-10",
        meetingId: "m1",
        meetingName: "Test Meeting",
        course: "Testcourse",
        countryCode: "GB",
        raceName: "Test Race 1",
        raceType: "Flat",
        raceClass: "Class 3",
        going: "Good",
        runnerName: "Edge Plus Fifteen",
        num: 1,
        draw: 1,
        status: "WINNER",
        ispFraction: "3/1",
        isFavourite: false,
        jockey: "J One",
        trainer: "T One",
        modelVersionId: "xgb-v1",
      });
    });

    it("normalizes absent optional runner fields to null rather than omitting them", async () => {
      const { rows } = await dao.getModelVsSpRunners(params());
      const noJockey = rows.find(r => r.runnerId === 201)!;
      expect(noJockey.jockey).toBeNull();
      expect(noJockey.trainer).toBeNull();
    });
  });

  describe("difference (absolute edge) filter", () => {
    // The whole point of the filter being unsigned: a runner the model rates 15
    // points ABOVE its SP and one it rates 5 points BELOW are both "close" or
    // "far" purely by magnitude. Seeded edges are +15, 0, -60, +10, -5, +15.
    it("matches on the size of the gap regardless of direction", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params({ minAbsEdge: 5, maxAbsEdge: 15 }));
      // |−5|, |+10|, |+15|, |+15| qualify; 0 is too small and |−60| too large.
      expect(rows.map(r => r.edge).sort((a, b) => a - b)).toEqual([-5, 10, 15, 15]);
      expect(total).toBe(4);
    });

    it("keeps a negative row when the band is expressed in positive numbers", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ minAbsEdge: 50, maxAbsEdge: 100 }));
      expect(rows.map(r => r.runnerId)).toEqual([201]);
      expect(rows[0].edge).toBeCloseTo(-60, 10);
    });

    it("minAbsEdge=0 keeps everything, including the exactly-zero row", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params({ minAbsEdge: 0 }));
      expect(total).toBe(ALL_EDGES.length);
      expect(rows.map(r => r.runnerId)).toContain(102);
    });

    it("maxAbsEdge=0 keeps exactly the zero-gap row", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params({ maxAbsEdge: 0 }));
      expect(rows).toHaveLength(1);
      expect(rows[0].runnerId).toBe(102);
      expect(total).toBe(1);
    });

    it("excludes rows on both sides of a narrow band", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ minAbsEdge: 11, maxAbsEdge: 20 }));
      expect(rows.map(r => r.runnerId).sort()).toEqual([101, 401]);
    });

    it("returns nothing and a total of 0 when the band is above every row's gap", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params({ minAbsEdge: 90 }));
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });

  describe("summary", () => {
    // Seeded absolute gaps across the six qualifying runners: 15, 0, 60, 10, 5, 15.
    // Bands are [0,2) [2,5) [5,10) [10,20) [20,50) [50,∞):
    //   within ±2   -> 0        (one row)
    //   ±2 to ±5    -> none
    //   ±5 to ±10   -> 5        (one row)
    //   ±10 to ±20  -> 10,15,15 (three rows)
    //   ±20 to ±50  -> none
    //   beyond ±50  -> 60       (one row)
    it("buckets every runner's gap by magnitude", async () => {
      const { summary } = await dao.getModelVsSpRunners(params());
      expect(summary).not.toBeNull();
      expect(summary!.allRunners).toBe(6);
      expect(summary!.bands.map(b => b.count)).toEqual([1, 0, 1, 3, 0, 1]);
    });

    it("reports the cumulative share the user asked for — how many are within ±N", async () => {
      const { summary } = await dao.getModelVsSpRunners(params());
      // within ±10 = the 0 row and the 5 row = 2 of 6.
      expect(summary!.bands[2].cumulativePercent).toBeCloseTo(33.3, 1);
      // within ±20 = those plus 10, 15, 15 = 5 of 6.
      expect(summary!.bands[3].cumulativePercent).toBeCloseTo(83.3, 1);
    });

    it("computes the mean absolute gap over every runner", async () => {
      const { summary } = await dao.getModelVsSpRunners(params());
      // (15 + 0 + 60 + 10 + 5 + 15) / 6 = 17.5
      expect(summary!.meanAbsEdge).toBeCloseTo(17.5, 1);
    });

    // The denominator deliberately ignores the difference filter, so narrowing
    // that filter doesn't move its own baseline to 100%.
    it("keeps allRunners as the unfiltered population when a difference band is applied", async () => {
      const { summary, total } = await dao.getModelVsSpRunners(params({ minAbsEdge: 11, maxAbsEdge: 20 }));
      expect(summary!.allRunners).toBe(6);
      expect(summary!.matchedRunners).toBe(2);
      expect(summary!.matchedPercent).toBeCloseTo(33.3, 1);
      expect(total).toBe(2);
      // The bands still describe all six runners, not just the two matched.
      expect(summary!.bands.reduce((sum, b) => sum + b.count, 0)).toBe(6);
    });

    it("still narrows with the other filters, which DO move the denominator", async () => {
      const { summary } = await dao.getModelVsSpRunners(params({ countries: ["IE"] }));
      expect(summary!.allRunners).toBe(1);
      expect(summary!.bands.reduce((sum, b) => sum + b.count, 0)).toBe(1);
    });

    it("is null, alongside total, when the count is skipped", async () => {
      const { summary, total } = await dao.getModelVsSpRunners(params({ includeTotal: false }));
      expect(summary).toBeNull();
      expect(total).toBeNull();
    });

    it("returns zeroed bands rather than NaN for an empty window", async () => {
      const { summary } = await dao.getModelVsSpRunners(
        params({ minRaceTime: "2019-01-01", maxRaceTime: "2019-12-31T23:59:59.999" })
      );
      expect(summary!.allRunners).toBe(0);
      expect(summary!.matchedPercent).toBe(0);
      expect(summary!.meanAbsEdge).toBe(0);
      expect(summary!.bands.every(b => b.percent === 0)).toBe(true);
    });

    it("agrees with total — matchedRunners is the same number pagination uses", async () => {
      for (const band of [
        { minAbsEdge: 0, maxAbsEdge: 100 },
        { minAbsEdge: 5, maxAbsEdge: 15 },
        { minAbsEdge: 90, maxAbsEdge: 100 },
      ]) {
        const { summary, total } = await dao.getModelVsSpRunners(params(band));
        expect(summary!.matchedRunners).toBe(total);
      }
    });
  });

  describe("model and implied probability range filters", () => {
    it("minModelProb excludes runners the model rates below it", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ minModelProb: 40 }));
      expect(rows.map(r => r.modelWinProbability).sort((a, b) => a - b)).toEqual([40, 40, 50]);
    });

    it("maxModelProb excludes runners the model rates above it", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ maxModelProb: 25 }));
      expect(rows.map(r => r.runnerId).sort()).toEqual([201, 301]);
    });

    it("minImpliedProb / maxImpliedProb filter on 100/isp, not on isp itself", async () => {
      // implied >= 25% means isp <= 4: runners 101 (25%), 102 (50%), 201 (80%), 401 (25%)
      const { rows } = await dao.getModelVsSpRunners(params({ minImpliedProb: 25 }));
      expect(rows.map(r => r.runnerId).sort()).toEqual([101, 102, 201, 401]);

      // implied <= 20% means isp >= 5: runners 202 (20%), 301 (10%)
      const narrow = await dao.getModelVsSpRunners(params({ maxImpliedProb: 20 }));
      expect(narrow.rows.map(r => r.runnerId).sort()).toEqual([202, 301]);
    });

    it("applies the model and implied ranges jointly, not independently", async () => {
      // model >= 40 alone would keep 101/102/401; implied <= 30 alone would keep
      // 101/202/301/401. Only 101 and 401 satisfy both.
      const { rows } = await dao.getModelVsSpRunners(params({ minModelProb: 40, maxImpliedProb: 30 }));
      expect(rows.map(r => r.runnerId).sort()).toEqual([101, 401]);
    });
  });

  describe("sorting", () => {
    it("date_asc orders by raceTime, and by sortPriority within a race", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ sort: "date_asc" }));
      expect(rows.map(r => r.runnerId)).toEqual([102, 101, 201, 202, 301, 401]);
    });

    it("date_desc reverses the race order while keeping racecard order within a race", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ sort: "date_desc" }));
      expect(rows.map(r => r.raceId)).toEqual([4, 3, 2, 2, 1, 1]);
      // Within race 1, sortPriority still ascends (102 has priority 1).
      expect(rows.slice(4).map(r => r.runnerId)).toEqual([102, 101]);
    });

    it("edge_desc puts the biggest positive gap first and edge_asc the most negative", async () => {
      const desc = await dao.getModelVsSpRunners(params({ sort: "edge_desc" }));
      expect(desc.rows.map(r => r.edge)).toEqual([15, 15, 10, 0, -5, -60]);

      const asc = await dao.getModelVsSpRunners(params({ sort: "edge_asc" }));
      expect(asc.rows.map(r => r.edge)).toEqual([-60, -5, 0, 10, 15, 15]);
    });

    it("rehydrates the correct runner after the slim-doc edge sort", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ sort: "edge_asc", limit: 1 }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ runnerId: 201, runnerName: "Edge Minus Sixty", edge: -60, isp: 1.25 });
    });

    it("breaks edge ties deterministically by raceTime then runnerId", async () => {
      // Runners 101 and 401 both have an edge of exactly +15. Race 1 is earlier
      // than race 4, so 101 must always come first regardless of sort direction.
      for (const sort of ["edge_desc", "edge_asc"] as ModelVsSpSort[]) {
        const { rows } = await dao.getModelVsSpRunners(params({ sort }));
        const tied = rows.filter(r => r.edge === 15).map(r => r.runnerId);
        expect(tied).toEqual([101, 401]);
      }
    });
  });

  describe("pagination", () => {
    it("total counts every qualifying runner, independent of page and limit", async () => {
      const firstPage = await dao.getModelVsSpRunners(params({ page: 1, limit: 2 }));
      expect(firstPage.rows).toHaveLength(2);
      expect(firstPage.total).toBe(6);

      const lastPage = await dao.getModelVsSpRunners(params({ page: 3, limit: 2 }));
      expect(lastPage.rows).toHaveLength(2);
      expect(lastPage.total).toBe(6);
    });

    it.each(["date_asc", "date_desc", "edge_desc", "edge_asc"] as ModelVsSpSort[])(
      "walking every page at limit 2 yields exactly total rows with no duplicates (%s)",
      async sort => {
        const seen: string[] = [];
        for (let page = 1; page <= 3; page++) {
          const { rows } = await dao.getModelVsSpRunners(params({ sort, page, limit: 2 }));
          for (const r of rows) seen.push(`${r.raceId}-${r.runnerId}`);
        }
        expect(seen).toHaveLength(6);
        expect(new Set(seen).size).toBe(6);
      }
    );

    it.each(["date_asc", "edge_desc"] as ModelVsSpSort[])(
      "paged results are identical to the same rows read in one page (%s)",
      async sort => {
        const whole = await dao.getModelVsSpRunners(params({ sort, limit: 100 }));
        const paged: number[] = [];
        for (let page = 1; page <= 6; page++) {
          const { rows } = await dao.getModelVsSpRunners(params({ sort, page, limit: 1 }));
          paged.push(...rows.map(r => r.runnerId));
        }
        expect(paged).toEqual(whole.rows.map(r => r.runnerId));
      }
    );

    it("a page beyond the last returns no rows but the same total", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params({ page: 99, limit: 2 }));
      expect(rows).toEqual([]);
      expect(total).toBe(6);
    });

    it("returns total: null when includeTotal is false, with identical rows", async () => {
      const withTotal = await dao.getModelVsSpRunners(params({ page: 2, limit: 2 }));
      const without = await dao.getModelVsSpRunners(params({ page: 2, limit: 2, includeTotal: false }));
      expect(without.total).toBeNull();
      expect(without.rows).toEqual(withTotal.rows);
    });
  });

  describe("date window", () => {
    it("bounds the rows and the total together", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(
        params({ minRaceTime: "2024-01-01", maxRaceTime: "2024-12-31T23:59:59.999" })
      );
      expect(rows.map(r => r.raceId).sort()).toEqual([1, 1, 2, 2]);
      expect(total).toBe(4);
    });

    it("narrows to a single day inclusively", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(
        params({ minRaceTime: "2024-02-20", maxRaceTime: "2024-02-20T23:59:59.999" })
      );
      expect(rows.map(r => r.runnerId).sort()).toEqual([201, 202]);
      expect(total).toBe(2);
    });

    it("returns nothing for a window with no races", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(
        params({ minRaceTime: "2019-01-01", maxRaceTime: "2019-12-31T23:59:59.999" })
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });

  describe("race-level filters", () => {
    it("countries narrows rows the same way it narrows /api/industry-sp", async () => {
      const { rows, total } = await dao.getModelVsSpRunners(params({ countries: ["IE"] }));
      expect(rows.map(r => r.runnerId)).toEqual([401]);
      expect(total).toBe(1);
    });

    it("the isp range excludes runners priced outside it", async () => {
      const { rows } = await dao.getModelVsSpRunners(params({ minIsp: 4, maxIsp: 5 }));
      expect(rows.map(r => r.runnerId).sort()).toEqual([101, 202, 401]);
    });

    it("the runner-count range filters on the race's own field size", async () => {
      // Race 2 has 6 isp-bearing runners; the others have 1-2.
      const { rows } = await dao.getModelVsSpRunners(params({ minRunners: 3 }));
      expect(rows.every(r => r.raceId === 2)).toBe(true);
      expect(rows.map(r => r.runnerId).sort()).toEqual([201, 202]);
    });
  });

  // The Mongo expression and the client-side modelSpEdge helper can't share
  // code, so this pins the aggregation's arithmetic to independently hand-derived
  // values. If someone changes the $divide/$subtract shape, this fails here
  // rather than silently disagreeing with what the UI renders.
  it("agrees with the 100/isp definition of implied probability to 10 decimal places", async () => {
    const { rows } = await dao.getModelVsSpRunners(params({ sort: "date_asc" }));
    for (const row of rows) {
      expect(row.impliedSpProbability).toBeCloseTo(100 / row.isp, 10);
      expect(row.edge).toBeCloseTo(row.modelWinProbability - 100 / row.isp, 10);
    }
  });
});
