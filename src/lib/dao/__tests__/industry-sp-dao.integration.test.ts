import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";

describe("IndustrySpDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns races with total/totalRunners/pnlStats populated", async () => {
    const { data, total, totalRunners, pnlStats } = await dao.getAllRacesByRace(1, 20);
    expect(total).toBeGreaterThan(0);
    expect(totalRunners).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof pnlStats.staked).toBe("number");
    expect(typeof pnlStats.returns).toBe("number");
    expect(typeof pnlStats.pnl).toBe("number");
  });

  it("each race has required fields with correct types", async () => {
    const { data } = await dao.getAllRacesByRace(1, 10);
    for (const race of data) {
      expect(typeof race.raceId).toBe("number");
      expect(typeof race.meetingId).toBe("string");
      expect(typeof race.course).toBe("string");
      expect(typeof race.countryCode).toBe("string");
      expect(typeof race.raceTime).toBe("string");
      expect(Array.isArray(race.runners)).toBe(true);
      for (const runner of race.runners) {
        expect(typeof runner.id).toBe("number");
        expect(typeof runner.name).toBe("string");
        expect(["WINNER", "PLACED", "LOSER", "NON_FINISHER"]).toContain(runner.status);
        expect(runner.isp).not.toBeNull();
        expect(runner.isp as number).toBeGreaterThan(1);
      }
    }
  });

  it("excludes REMOVED-equivalent (null-isp) runners from race counts", async () => {
    const bounds = await dao.getFilterBounds();
    const { data } = await dao.getAllRacesByRace(1, 5, 1, bounds.maxRunnersPerRace, [], bounds.minIsp, bounds.maxIsp);
    for (const race of data) {
      for (const runner of race.runners) {
        expect(runner.isp).toBeGreaterThanOrEqual(bounds.minIsp);
        expect(runner.isp).toBeLessThanOrEqual(bounds.maxIsp);
      }
    }
  });

  it("filters by country code", async () => {
    const countries = await dao.getDistinctCountryCodes();
    expect(countries.length).toBeGreaterThan(0);
    const country = countries[0];
    const { data } = await dao.getAllRacesByRace(1, 20, 1, 100, [country]);
    for (const race of data) {
      expect(race.countryCode).toBe(country);
    }
  });

  it("respects the limit parameter", async () => {
    const { data } = await dao.getAllRacesByRace(1, 3);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("returns empty results for an unknown country", async () => {
    const { data, total } = await dao.getAllRacesByRace(1, 20, 1, 100, ["ZZ"]);
    expect(data).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("sorts by raceTime ascending by default, descending when requested", async () => {
    const asc = await dao.getAllRacesByRace(1, 50, 1, 100, [], 1, 100000, "asc");
    for (let i = 1; i < asc.data.length; i++) {
      expect(new Date(asc.data[i].raceTime).getTime()).toBeGreaterThanOrEqual(
        new Date(asc.data[i - 1].raceTime).getTime()
      );
    }

    const desc = await dao.getAllRacesByRace(1, 50, 1, 100, [], 1, 100000, "desc");
    for (let i = 1; i < desc.data.length; i++) {
      expect(new Date(desc.data[i].raceTime).getTime()).toBeLessThanOrEqual(
        new Date(desc.data[i - 1].raceTime).getTime()
      );
    }
  });

  it("page 1 of an ascending/descending sort actually contains the true first/last race, not just a locally-consistent subset", async () => {
    // Regression test: the aggregation used to sort documents that still
    // carried their full embedded runners array, which risked exceeding
    // Atlas M0's 32MB in-memory sort buffer as the collection grew (the same
    // bug already caused MongoServerError 292 / 500s on the equivalent
    // Betfair-SP query in production). A pipeline bug in that neighborhood —
    // e.g. accidentally paginating before sorting — would still produce a
    // page whose items are consistent with *each other*, which the test
    // above wouldn't catch, while silently omitting the actual first/last
    // race in the full dataset. Comparing against a raw, unpaginated
    // min/max query closes that gap.
    const bounds = await dao.getFilterBounds();
    const rawExtremes = await db
      .collection("industry_starting_prices")
      .aggregate([
        { $match: {} },
        { $group: { _id: null, min: { $min: "$raceTime" }, max: { $max: "$raceTime" } } },
      ])
      .toArray();
    const trueMin = rawExtremes[0]?.min;
    const trueMax = rawExtremes[0]?.max;
    expect(trueMin).toBeTruthy();
    expect(trueMax).toBeTruthy();

    const asc = await dao.getAllRacesByRace(1, 20, 1, bounds.maxRunnersPerRace, [], bounds.minIsp, bounds.maxIsp, "asc");
    expect(asc.data[0]?.raceTime).toBe(trueMin);

    const desc = await dao.getAllRacesByRace(1, 20, 1, bounds.maxRunnersPerRace, [], bounds.minIsp, bounds.maxIsp, "desc");
    expect(desc.data[0]?.raceTime).toBe(trueMax);
  });

  it("a row-range (fromRow/toRow) is computed relative to the current sort order, not natural document order", async () => {
    // Regression test: total/totalRunners/pnlStats used to apply the
    // fromRow/toRow skip+limit without sorting first, so "row 1-5" meant
    // "the first 5 docs in whatever order Mongo happened to store them" —
    // which silently disagreed with the sorted race list actually shown to
    // the user, especially for a descending sort where it should mean "the
    // 5 latest races" but didn't.
    const ascRanged = await dao.getAllRacesByRace(1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, 5);
    expect(ascRanged.total).toBe(5);
    expect(ascRanged.data.map(r => r.raceTime)).toEqual([...ascRanged.data.map(r => r.raceTime)].sort());

    const descRanged = await dao.getAllRacesByRace(1, 20, 1, 100, [], 1, 100000, "desc", 1, 10000, 1, 5);
    expect(descRanged.total).toBe(5);
    // The 5 latest races (desc row-range) must be strictly newer than every
    // one of the 5 earliest races (asc row-range) — the two ranges can only
    // overlap if there are 5 or fewer races in the whole dataset.
    const earliestOfDescRange = descRanged.data[descRanged.data.length - 1].raceTime;
    const latestOfAscRange = ascRanged.data[ascRanged.data.length - 1].raceTime;
    expect(new Date(earliestOfDescRange).getTime()).toBeGreaterThanOrEqual(new Date(latestOfAscRange).getTime());
  });

  // subMinRaceTime/subMaxRaceTime restrict an already row-ranged window to
  // a calendar sub-range without changing what "row N" means — see
  // IspRacesScreen's per-year loading (isp-year-direct-load), which calls
  // this once per expanded year instead of walking the whole row range
  // forward from page 1 to "discover" a distant year.
  it("subMinRaceTime/subMaxRaceTime narrows the row-ranged result, and never returns a race outside the sub-range", async () => {
    const rowRanged = await dao.getAllRacesByRace(1, 50, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, 50);
    expect(rowRanged.data.length).toBeGreaterThan(1);

    const midIndex = Math.floor(rowRanged.data.length / 2);
    const midRaceTime = rowRanged.data[midIndex].raceTime;

    const restricted = await dao.getAllRacesByRace(
      1, 50, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, 50,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false, null,
      midRaceTime, null
    );
    // Strictly narrower than (or equal to, if every race happens to be at
    // or after the midpoint) the unrestricted row range.
    expect(restricted.total).toBeLessThanOrEqual(rowRanged.total);
    expect(restricted.total).toBeGreaterThan(0);
    for (const race of restricted.data) {
      expect(race.raceTime >= midRaceTime).toBe(true);
    }
  });

  it("subMinRaceTime/subMaxRaceTime covering the row range's own full span returns the same total as no sub-range at all", async () => {
    const rowRanged = await dao.getAllRacesByRace(1, 50, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, 50);
    const first = rowRanged.data[0].raceTime;
    const last = rowRanged.data[rowRanged.data.length - 1].raceTime;

    const restricted = await dao.getAllRacesByRace(
      1, 50, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, 50,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false, null,
      first, last
    );
    expect(restricted.total).toBe(rowRanged.total);
  });

  it("a subMinRaceTime after every race in the row range returns an empty result", async () => {
    const restricted = await dao.getAllRacesByRace(
      1, 50, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, 50,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false, null,
      "2099-01-01"
    );
    expect(restricted.total).toBe(0);
    expect(restricted.data).toEqual([]);
  });

  it("getFilterBounds returns sensible bounds", async () => {
    const bounds = await dao.getFilterBounds();
    expect(bounds.maxRunnersPerRace).toBeGreaterThan(0);
    expect(bounds.minIsp).toBeGreaterThan(1);
    expect(bounds.maxIsp).toBeGreaterThan(bounds.minIsp);
  });

  it("an inverted range (toRow < fromRow) returns an empty result instead of throwing", async () => {
    // Regression test: reported live as "Failed to load industry SP".
    // rowLimit = toRow - fromRow + 1 goes negative for an inverted range,
    // and MongoDB's $limit stage throws outright on a negative argument
    // (MongoServerError code 5107201) rather than just returning nothing.
    // Reachable from a stale/hand-edited URL — fromRow/toRow (and
    // fromRowA/toRowA via getSplitStats) come straight from query params.
    const result = await dao.getAllRacesByRace(1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 100, 5);
    expect(result.total).toBe(0);
    expect(result.totalRunners).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.pnlStats).toEqual({ staked: 0, returns: 0, pnl: 0, count: 0 });
  });

  it("fromRow=0 or negative is clamped to 1 instead of producing a negative $skip", async () => {
    const zeroFromRow = await dao.getAllRacesByRace(1, 5, 1, 100, [], 1, 100000, "asc", 1, 10000, 0);
    const explicitFromRowOne = await dao.getAllRacesByRace(1, 5, 1, 100, [], 1, 100000, "asc", 1, 10000, 1);
    expect(zeroFromRow.total).toBe(explicitFromRowOne.total);
    expect(zeroFromRow.data.map(r => r.raceId)).toEqual(explicitFromRowOne.data.map(r => r.raceId));

    const negativeFromRow = await dao.getAllRacesByRace(1, 5, 1, 100, [], 1, 100000, "asc", 1, 10000, -50);
    expect(negativeFromRow.total).toBe(explicitFromRowOne.total);
  });

  it("getDistinctCourses/Goings/RaceClasses/RaceTypes return non-empty sorted lists", async () => {
    const [courses, goings, raceClasses, raceTypes] = await Promise.all([
      dao.getDistinctCourses(),
      dao.getDistinctGoings(),
      dao.getDistinctRaceClasses(),
      dao.getDistinctRaceTypes(),
    ]);
    for (const values of [courses, goings, raceClasses, raceTypes]) {
      expect(values.length).toBeGreaterThan(0);
      expect(values).toEqual([...values].sort());
      expect(values.every(v => typeof v === "string" && v.length > 0)).toBe(true);
    }
  });

  it("filters by course", async () => {
    const courses = await dao.getDistinctCourses();
    const course = courses[0];
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [course]
    );
    for (const race of data) {
      expect(race.course).toBe(course);
    }
  });

  it("filters by going", async () => {
    const goings = await dao.getDistinctGoings();
    const going = goings[0];
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [going]
    );
    for (const race of data) {
      expect(race.going).toBe(going);
    }
  });

  it("filters by raceClass", async () => {
    const raceClasses = await dao.getDistinctRaceClasses();
    const raceClass = raceClasses[0];
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [raceClass]
    );
    for (const race of data) {
      expect(race.raceClass).toBe(raceClass);
    }
  });

  it("filters by raceType", async () => {
    const raceTypes = await dao.getDistinctRaceTypes();
    const raceType = raceTypes[0];
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [raceType]
    );
    for (const race of data) {
      expect(race.raceType).toBe(raceType);
    }
  });

  it("filters by trainer prefix (case-insensitive)", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const trainerName = sample[0]?.runners.find(r => r.trainer)?.trainer;
    if (!trainerName) return; // no trainer data seeded in this environment
    const prefix = trainerName.slice(0, 3);
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [], prefix.toUpperCase()
    );
    for (const race of data) {
      expect(race.runners.some(r => r.trainer?.toLowerCase().startsWith(prefix.toLowerCase()))).toBe(true);
    }
  });

  it("filters by jockey prefix (case-insensitive)", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const jockeyName = sample[0]?.runners.find(r => r.jockey)?.jockey;
    if (!jockeyName) return; // no jockey data seeded in this environment
    const prefix = jockeyName.slice(0, 3);
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [], null, prefix.toUpperCase()
    );
    for (const race of data) {
      expect(race.runners.some(r => r.jockey?.toLowerCase().startsWith(prefix.toLowerCase()))).toBe(true);
    }
  });

  it("returns empty results for an unknown course", async () => {
    const { data, total } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, ["Nonexistent Course XYZ"]
    );
    expect(data).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("minTrainerFormRunners/maxTrainerFormRunners default (0/100) is a no-op vs. omitting the filter entirely", async () => {
    const unfiltered = await dao.getAllRacesByRace(1, 20);
    const withDefaults = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [], null, null, 0, 0, 100
    );
    expect(withDefaults.total).toBe(unfiltered.total);
  });

  it("minModelWinProbability default (0) is a no-op vs. omitting the filter entirely", async () => {
    const unfiltered = await dao.getAllRacesByRace(1, 20);
    const withDefault = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [], null, null, 0, 0, 100, null, 0
    );
    expect(withDefault.total).toBe(unfiltered.total);
  });

  it("onlyModelBeatsSp default (false) is a no-op vs. omitting the filter entirely", async () => {
    const unfiltered = await dao.getAllRacesByRace(1, 20);
    const withDefault = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false
    );
    expect(withDefault.total).toBe(unfiltered.total);
  });

  it("minTrainerFormRunners narrows (or matches) the result vs. no threshold, when trainer-form data is seeded", async () => {
    // Guarded like the trainer/jockey prefix tests above — trainerFormRuns/
    // trainerFormWinRate only exist once src/commands/precompute-trainer-form.ts
    // has been run against this environment's data; skip rather than fail if
    // it hasn't.
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasTrainerFormData = sample[0]?.runners.some(
      r => (r as unknown as { trainerFormRuns?: number }).trainerFormRuns != null
    );
    if (!hasTrainerFormData) return;

    const unfiltered = await dao.getAllRacesByRace(1, 20, 1, 100);
    const narrowed = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null, [], [], [], [], null, null, 50, 1, 30
    );
    expect(narrowed.total).toBeLessThanOrEqual(unfiltered.total);
    for (const race of narrowed.data) {
      const qualifying = race.runners.filter(
        r => (r as unknown as { trainerFormWinRate?: number | null }).trainerFormWinRate != null &&
          (r as unknown as { trainerFormWinRate: number }).trainerFormWinRate >= 50
      );
      expect(qualifying.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("minModelWinProbability narrows (or matches) the result vs. no threshold, when model predictions are seeded", async () => {
    // Guarded like the trainer-form test above — modelWinProbability only
    // exists once ml/train_and_predict.py has been run against this
    // environment's data; skip rather than fail if it hasn't.
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasModelData = sample[0]?.runners.some(
      r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null
    );
    if (!hasModelData) return;

    const unfiltered = await dao.getAllRacesByRace(1, 20, 1, 100);
    const narrowed = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 30
    );
    expect(narrowed.total).toBeLessThanOrEqual(unfiltered.total);
    for (const race of narrowed.data) {
      const qualifying = race.runners.filter(
        r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null &&
          (r as unknown as { modelWinProbability: number }).modelWinProbability >= 30
      );
      expect(qualifying.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("onlyModelBeatsSp narrows (or matches) the result vs. no filter, when model predictions are seeded", async () => {
    // Same guard as the minModelWinProbability test above — skip rather
    // than fail if the model precompute hasn't been run in this environment.
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasModelData = sample[0]?.runners.some(
      r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null
    );
    if (!hasModelData) return;

    const unfiltered = await dao.getAllRacesByRace(1, 20, 1, 100);
    const narrowed = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 0, true
    );
    expect(narrowed.total).toBeLessThanOrEqual(unfiltered.total);
    for (const race of narrowed.data) {
      const qualifying = race.runners.filter(r => {
        const runner = r as unknown as { modelWinProbability?: number | null; isp?: number | null };
        return runner.modelWinProbability != null && runner.isp != null && runner.isp > 0 &&
          runner.modelWinProbability > 100 / runner.isp;
      });
      expect(qualifying.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("minModelSpEdgePts default (0) is a no-op vs. omitting the filter entirely", async () => {
    const unfiltered = await dao.getAllRacesByRace(1, 20);
    const withDefault = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 1000, 1, null, null, null, [], [], [], [], null, null, 0, 0, 100, null, 0,
      false, null, null, null, 0
    );
    expect(withDefault.total).toBe(unfiltered.total);
  });

  it("minModelSpEdgePts applies without onlyModelBeatsSp also being set, and every returned race has a runner clearing it", async () => {
    // Same guard as the minModelWinProbability test above — skip rather
    // than fail if the model precompute hasn't been run in this environment.
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasModelData = sample[0]?.runners.some(
      r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null
    );
    if (!hasModelData) return;

    const unfiltered = await dao.getAllRacesByRace(1, 20, 1, 100);
    // onlyModelBeatsSp deliberately left FALSE here — the points threshold
    // has to activate the filter on its own, which is the whole reason
    // buildQualifyingRaceStages ORs the two rather than gating on the
    // checkbox the way trainer-form's win rate is gated.
    const narrowed = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 0, false, null, null, null, 10
    );
    expect(narrowed.total).toBeLessThanOrEqual(unfiltered.total);
    for (const race of narrowed.data) {
      const qualifying = race.runners.filter(r => {
        const runner = r as unknown as { modelWinProbability?: number | null; isp?: number | null };
        return runner.modelWinProbability != null && runner.isp != null && runner.isp > 0 &&
          runner.modelWinProbability - 100 / runner.isp >= 10;
      });
      expect(qualifying.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("a larger minModelSpEdgePts is monotonically at least as narrow as a smaller one, and both are at most onlyModelBeatsSp alone", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasModelData = sample[0]?.runners.some(
      r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null
    );
    if (!hasModelData) return;

    const call = (edgePts: number, beatsSp: boolean) =>
      dao.getAllRacesByRace(
        1, 1, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
        [], [], [], [], null, null, 0, 0, 100, null, 0, beatsSp, null, null, null, edgePts
      );

    const [beatsSpOnly, edge5, edge20] = await Promise.all([call(0, true), call(5, false), call(20, false)]);
    // "beats SP" is edge > 0, so every points threshold above 0 is a strict
    // subset of it — the ordering that makes the field a tightening of the
    // checkbox rather than an independent filter.
    expect(edge5.total).toBeLessThanOrEqual(beatsSpOnly.total);
    expect(edge20.total).toBeLessThanOrEqual(edge5.total);
  });

  it("totalRunners (qualifyingRunnersCount-based) still matches the isp-range-only count when no optional filter is active", async () => {
    // Fast-path equivalence: buildQualifyingRaceStages' qualifyingRunnersCount
    // reuses inRangeRunnersCount directly whenever none of trainer-form/
    // model/model-beats-SP are active — and with no optional filters, the
    // pnlStats fast path also applies (see below), so the two are the same
    // computation and must be exactly equal.
    const result = await dao.getAllRacesByRace(1, 20, 1, 100);
    expect(result.totalRunners).toBeGreaterThan(0);
    expect(result.totalRunners).toBe(result.pnlStats.count);
  });

  it("pnlStats.count matches totalRunners exactly even when trainer-form/model/model-beats-SP narrows the runner set", async () => {
    // Regression: reported live via screenshot — with "Model beats SP"
    // checked, a split card's P&L% didn't match the same split's own P&L
    // convergence graph (e.g. card said -13.2%, graph said -19.0%).
    // pnlStats.count came out roughly double totalRunners (2992 vs 1589),
    // because pnlStats' fast-path condition only ever checked the isp
    // range — with model-beats-SP active but the isp range left wide open,
    // it silently took the fast path anyway, whose precomputed
    // raceStaked/raceReturns fields don't know about model-beats-SP at all
    // and summed every isp-in-range runner instead of just the qualifying
    // ones. Both the fast-path condition and the $unwind fallback's runner
    // selection now also account for trainer-form/model/model-beats-SP, so
    // pnlStats always reconciles with totalRunners regardless of which
    // filters are active.
    const result = await dao.getAllRacesByRace(
      1, 20, 1, 20, [], 1, 501, "asc", 1, 30, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 0, true
    );
    expect(result.totalRunners).toBeGreaterThan(0);
    expect(result.pnlStats.count).toBe(result.totalRunners);
  });

  it("qualifyingRunnersCount-based totalRunners strictly narrows (or matches) as trainer-form/model filters stack, when seeded", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasModelData = sample[0]?.runners.some(
      r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null
    );
    if (!hasModelData) return;

    const none = await dao.getAllRacesByRace(1, 20, 1, 100);
    const modelOnly = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 30
    );
    const modelAndBeatsSp = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 30, true
    );
    // Layering on more joint conditions can only keep or shrink the
    // qualifying-runner total, never grow it.
    expect(modelOnly.totalRunners).toBeLessThanOrEqual(none.totalRunners);
    expect(modelAndBeatsSp.totalRunners).toBeLessThanOrEqual(modelOnly.totalRunners);
  });

  it("getRaceConvergenceSeries covers exactly [fromRow, toRow], in raceTime order, with no filters active", async () => {
    const grand = await dao.getAllRacesByRace(1, 1, 1, 100);
    if (grand.total < 10) return;
    const fromRow = 3;
    const toRow = Math.min(10, grand.total);
    const points = await dao.getRaceConvergenceSeries(
      1, 100, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, fromRow, toRow
    );
    expect(points.length).toBe(toRow - fromRow + 1);
    expect(points.map(p => p.raceRowNumber)).toEqual(
      Array.from({ length: toRow - fromRow + 1 }, (_, i) => fromRow + i)
    );
  });

  it("getRaceConvergenceSeries' cumulative sums are monotonically non-decreasing and its last point matches getAllRacesByRace's own pnlStats for the same range", async () => {
    const grand = await dao.getAllRacesByRace(1, 1, 1, 100);
    if (grand.total < 10) return;
    const fromRow = 1;
    const toRow = Math.min(10, grand.total);
    const points = await dao.getRaceConvergenceSeries(
      1, 100, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, fromRow, toRow
    );
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeStaked).toBeGreaterThanOrEqual(points[i - 1].cumulativeStaked);
      expect(points[i].cumulativeReturns).toBeGreaterThanOrEqual(points[i - 1].cumulativeReturns);
    }

    const rangeStats = await dao.getAllRacesByRace(1, 1, 1, 100, [], 1, 1000, "asc", 1, 10000, fromRow, toRow);
    const last = points[points.length - 1];
    expect(last.cumulativeStaked).toBeCloseTo(rangeStats.pnlStats.staked, 5);
    expect(last.cumulativeReturns).toBeCloseTo(rangeStats.pnlStats.returns, 5);
  });

  it("getRaceConvergenceSeries' slow path (a model filter active) still reconciles with getAllRacesByRace's own pnlStats for the same range, when seeded", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const hasModelData = sample[0]?.runners.some(
      r => (r as unknown as { modelWinProbability?: number | null }).modelWinProbability != null
    );
    if (!hasModelData) return;

    const grand = await dao.getAllRacesByRace(
      1, 1, 1, 100, [], 1, 100000, "asc", 1, 10000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 30
    );
    if (grand.total < 5) return;
    const fromRow = 1;
    const toRow = Math.min(5, grand.total);
    const points = await dao.getRaceConvergenceSeries(
      1, 100, [], 1, 100000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 30, false, fromRow, toRow
    );
    expect(points.length).toBe(toRow - fromRow + 1);

    const rangeStats = await dao.getAllRacesByRace(
      1, 1, 1, 100, [], 1, 100000, "asc", 1, 10000, fromRow, toRow, null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 30
    );
    const last = points[points.length - 1];
    expect(last.cumulativeStaked).toBeCloseTo(rangeStats.pnlStats.staked, 5);
    expect(last.cumulativeReturns).toBeCloseTo(rangeStats.pnlStats.returns, 5);
  });

  it("getRaceConvergenceSeries returns an empty array when toRow < fromRow", async () => {
    const points = await dao.getRaceConvergenceSeries(
      1, 100, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 10, 5
    );
    expect(points).toEqual([]);
  });

  it("filters by exact runner (horse) name, case-insensitive", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const runnerName = sample[0]?.runners[0]?.name;
    if (!runnerName) return; // no data seeded in this environment
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, runnerName.toUpperCase()
    );
    expect(data.length).toBeGreaterThan(0);
    for (const race of data) {
      expect(race.runners.some(r => r.name.toLowerCase() === runnerName.toLowerCase())).toBe(true);
    }
  });

  it("runner name matching is anchored both ends, not a prefix match (unlike trainer/jockey search)", async () => {
    const { data: sample } = await dao.getAllRacesByRace(1, 1, 1, 100);
    const runnerName = sample[0]?.runners[0]?.name;
    if (!runnerName || runnerName.length < 2) return;
    // A strict prefix of a real horse's name should match nothing — the
    // full name must match exactly, unlike trainerSearch/jockeySearch.
    const prefix = runnerName.slice(0, runnerName.length - 1);
    const { data } = await dao.getAllRacesByRace(
      1, 20, 1, 100, [], 1, 1000, "asc", 1, 1000, 1, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, prefix
    );
    for (const race of data) {
      expect(race.runners.some(r => r.name.toLowerCase() === prefix.toLowerCase())).toBe(true);
    }
  });
});
