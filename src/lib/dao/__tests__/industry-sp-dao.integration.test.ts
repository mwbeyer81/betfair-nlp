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
});
