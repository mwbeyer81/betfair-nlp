import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";
import { parseDynamicFilters } from "../../filters/dynamic-filter-params";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = `betfair_nlp_test_dynamic_filters_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Seed worked by hand so every expectation below is checkable rather than
// snapshotted. Shapes chosen to exercise the things that actually go wrong:
// null-valued fields, enum combinations, a zero ROI denominator, and filters
// that must be satisfied by ONE runner rather than by the field collectively.
//
// RACE 1 — Flat, 8f, 3 runners. Everything populated.
//   A  OR 95  age 4  sex G  hg "b"   staked 10 returns 25  (ROI 2.5)
//   B  OR 80  age 3  sex F  hg "tb"  staked 10 returns  5  (ROI 0.5)
//   C  OR 70  age 5  sex M  hg null  staked  0 returns  0  (ROI undefined)
//
// RACE 2 — jumps, 16f, 3 runners. NO official rating and NO draw on any of
//   them, which is the real production shape: OR is 16.3% populated in
//   maidens/novices and `draw` is 0.0% over jumps.
//   D  OR null  age 6  sex G  hg null   staked 10 returns 12  (ROI 1.2)
//   E  OR null  age 7  sex G  hg "p"    staked 10 returns  0  (ROI 0.0)
//   F  OR null  age 8  sex R  hg "v"    staked  0 returns 50  (ROI undefined)
//
// RACE 3 — Flat, 5f, 2 runners. The cross-runner trap: G clears the rating
//   bound, H clears the age bound, and NEITHER clears both. A filter set
//   evaluated per-filter-across-the-field would wrongly keep this race.
//   G  OR 99  age 9  sex C  hg null   staked 10 returns 10  (ROI 1.0)
//   H  OR 60  age 3  sex C  hg null   staked 10 returns 10  (ROI 1.0)

function runner(
  id: number,
  name: string,
  isp: number,
  fields: {
    officialRating?: number | null;
    age: number;
    sex: string;
    hg?: string | null;
    trainerFormStaked: number;
    trainerFormReturns: number;
  }
) {
  return {
    id,
    name,
    num: id,
    isp,
    status: "LOSER" as const,
    modelWinProbabilityOos: 20,
    modelWinProbability: 20,
    ...fields,
  };
}

const RACES = [
  {
    _id: 1, raceId: 1, raceDate: "2024-01-01", raceTime: "2024-01-01T13:00:00",
    course: "Ascot", countryCode: "GB", raceType: "Flat", ran: 3, runnersWithIspCount: 3,
    distanceFurlongs: 8,
    runners: [
      runner(11, "A", 2.0, { officialRating: 95, age: 4, sex: "G", hg: "b", trainerFormStaked: 10, trainerFormReturns: 25 }),
      runner(12, "B", 6.0, { officialRating: 80, age: 3, sex: "F", hg: "tb", trainerFormStaked: 10, trainerFormReturns: 5 }),
      runner(13, "C", 11.0, { officialRating: 70, age: 5, sex: "M", hg: null, trainerFormStaked: 0, trainerFormReturns: 0 }),
    ],
  },
  {
    _id: 2, raceId: 2, raceDate: "2024-01-02", raceTime: "2024-01-02T13:00:00",
    course: "Ascot", countryCode: "GB", raceType: "Chase", ran: 3, runnersWithIspCount: 3,
    distanceFurlongs: 16,
    runners: [
      runner(21, "D", 3.0, { officialRating: null, age: 6, sex: "G", hg: null, trainerFormStaked: 10, trainerFormReturns: 12 }),
      runner(22, "E", 4.0, { officialRating: null, age: 7, sex: "G", hg: "p", trainerFormStaked: 10, trainerFormReturns: 0 }),
      runner(23, "F", 9.0, { officialRating: null, age: 8, sex: "R", hg: "v", trainerFormStaked: 0, trainerFormReturns: 50 }),
    ],
  },
  {
    _id: 3, raceId: 3, raceDate: "2024-01-03", raceTime: "2024-01-03T13:00:00",
    course: "Ascot", countryCode: "GB", raceType: "Flat", ran: 2, runnersWithIspCount: 2,
    distanceFurlongs: 5,
    runners: [
      runner(31, "G", 4.0, { officialRating: 99, age: 9, sex: "C", hg: null, trainerFormStaked: 10, trainerFormReturns: 10 }),
      runner(32, "H", 6.0, { officialRating: 60, age: 3, sex: "C", hg: null, trainerFormStaked: 10, trainerFormReturns: 10 }),
    ],
  },
];

describe("IndustrySpDAO — raw-model-field filters (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    await db.collection("industry_starting_prices").insertMany(RACES as never);
    dao = new IndustrySpDAO(db);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  // Filters are supplied as the raw query object a route would receive, so the
  // parser is exercised on the way in rather than bypassed by hand-built
  // objects — the shape a real request takes.
  const query = (params: Record<string, string> = {}) => {
    const { filters, errors } = parseDynamicFilters(params);
    expect(errors).toEqual([]);
    return dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null,
      null, null,
      [], [], [], [], null, null, 0, 0, 100, null, 0, false, null, null, null, 0,
      false, false, filters
    );
  };

  it("returns every race when no registry filter is set", async () => {
    const r = await query();
    expect(r.total).toBe(3);
    expect(r.totalRunners).toBe(8);
  });

  it("narrows to the runners clearing a numeric bound", async () => {
    // OR >= 80: A (95), B (80), G (99). Race 2 has none and drops out.
    const r = await query({ minOfficialRating: "80" });
    expect(r.total).toBe(2);
    expect(r.totalRunners).toBe(3);
  });

  it("excludes null-valued runners from a bound rather than treating null as small", async () => {
    // BSON sorts null below every number, so an unguarded `{$lte: [null, 90]}`
    // is TRUE — race 2's three unrated runners would all match. The $isNumber
    // guard in filter-conditions.ts is what makes this 3 and not 6.
    const r = await query({ maxOfficialRating: "90" });
    expect(r.total).toBe(2);
    expect(r.totalRunners).toBe(3); // B (80), C (70), H (60)
  });

  it("applies a two-sided range", async () => {
    // age 4-6: A (4), C (5), D (6).
    const r = await query({ minAge: "4", maxAge: "6" });
    expect(r.totalRunners).toBe(3);
  });

  it("requires ONE runner to satisfy every active filter, not the field collectively", async () => {
    // Race 3 is the trap: G clears OR>=90, H clears age<=5, neither clears
    // both. Per-filter counts evaluated independently would keep this race.
    const r = await query({ minOfficialRating: "90", maxAge: "5" });
    // Only A (OR 95, age 4) qualifies anywhere.
    expect(r.total).toBe(1);
    expect(r.totalRunners).toBe(1);
  });

  it("filters a race-scoped field on the race document", async () => {
    const long = await query({ minDistanceFurlongs: "16" });
    expect(long.total).toBe(1);
    expect(long.totalRunners).toBe(3); // whole field of race 2 qualifies

    const sprint = await query({ maxDistanceFurlongs: "6" });
    expect(sprint.total).toBe(1);
    expect(sprint.totalRunners).toBe(2);
  });

  it("combines a race-scoped and a runner-scoped filter", async () => {
    // Distance 7-8f isolates race 1 (race 3 is 5f, race 2 is 16f), then
    // age >= 5 leaves C alone.
    const r = await query({ minDistanceFurlongs: "7", maxDistanceFurlongs: "8", minAge: "5" });
    expect(r.total).toBe(1);
    expect(r.totalRunners).toBe(1);

    // Widening the distance bound to include race 3 picks up G as well, which
    // is what proves the race bound was doing the narrowing above.
    const wider = await query({ maxDistanceFurlongs: "8", minAge: "5" });
    expect(wider.total).toBe(2);
    expect(wider.totalRunners).toBe(2);
  });

  it("matches an enum by equality", async () => {
    // sex G: A, D, E.
    const r = await query({ sexes: "G" });
    expect(r.totalRunners).toBe(3);
    expect(r.total).toBe(2);
  });

  it("accepts several enum values as an OR", async () => {
    // sex F or M: B, C — both in race 1.
    const r = await query({ sexes: "F,M" });
    expect(r.total).toBe(1);
    expect(r.totalRunners).toBe(2);
  });

  it("matches headgear as a SET, so a combination counts", async () => {
    // "Blinkers" must find A ("b") AND B ("tb"). Equality would find only A —
    // the reason hg uses matchMode "contains".
    const r = await query({ headgear: "b" });
    expect(r.total).toBe(1);
    expect(r.totalRunners).toBe(2);
  });

  it("does not match a null headgear when a headgear is selected", async () => {
    // null means NO headgear, so it must never satisfy "wearing a visor".
    const r = await query({ headgear: "v" });
    expect(r.total).toBe(1);
    expect(r.totalRunners).toBe(1); // F only
  });

  it("computes ROI from the stored accumulators", async () => {
    // ROI >= 1.2: A (2.5) and D (1.2). B is 0.5, E is 0.0, G/H are exactly 1.0.
    const r = await query({ minTrainerFormROI: "1.2" });
    expect(r.total).toBe(2);
    expect(r.totalRunners).toBe(2);
  });

  it("treats an undefined ROI as unmatched rather than as zero or infinity", async () => {
    // C and F both staked 0. F even has returns of 50, which an unguarded
    // $divide would make infinite and an `|| 0` fallback would make zero —
    // both of which would wrongly answer "did this trainer profit?".
    const all = await query({ minTrainerFormROI: "0" });
    // Everything with a defined ROI: A, B, D, E, G, H — 6 of the 8 runners.
    expect(all.totalRunners).toBe(6);
  });

  it("returns nothing, without erroring, when a filter matches no runner", async () => {
    const r = await query({ minOfficialRating: "200" });
    expect(r.total).toBe(0);
    expect(r.totalRunners).toBe(0);
    expect(r.data).toEqual([]);
  });

  it("leaves the P&L describing the qualifying runners only", async () => {
    // The fast path reads precomputed per-race sums that know nothing about
    // these filters; a registry runner filter has to force the $unwind path or
    // the P&L would cover runners the filter just excluded.
    const all = await query();
    const filtered = await query({ minOfficialRating: "90" });
    expect(all.pnlStats.count).toBe(8);
    expect(filtered.pnlStats.count).toBe(2); // A and G
  });
});
