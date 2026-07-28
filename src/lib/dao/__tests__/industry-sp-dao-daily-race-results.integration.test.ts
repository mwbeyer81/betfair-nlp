import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";
import { synthNumericId, synthRaceId } from "../industry-sp-row-mapping";

const MONGO_URI = "mongodb://localhost:27019";
// Standalone file + uniquely-named throwaway database — avoids adding a new
// describe block to the shared, already-contested industry-sp-dao.integration.test.ts
// file (see AGENTS.md's convention on this, followed identically by
// industry-sp-dao-live-race-results.integration.test.ts).
const DB_NAME = `betfair_nlp_test_isp_daily_race_results_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

describe("IndustrySpDAO.getResultsForRaceIds (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  const RAW_RACE_ID_1 = "rac_test_0001";
  const RAW_RACE_ID_2 = "rac_test_0002";

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
    await dao.createIndexes();

    // Race 1: a real finished race, keyed by synthRaceId(raw race_id) exactly
    // as IndustrySpResultsCaptureService writes it. Runner "hrs_1" has a
    // valid ISP (this is the WINNER whose result should surface); a second
    // runner "hrs_2" deliberately has isp: null (a non-finisher/no-priced
    // runner) — getResultsForRaceIds must still return it (unlike
    // getRaceById, which would silently drop it).
    await db.collection("industry_starting_prices").insertOne({
      _id: synthRaceId(RAW_RACE_ID_1),
      raceId: synthRaceId(RAW_RACE_ID_1),
      course: "Newton Abbot",
      countryCode: "GB",
      raceDate: "2026-06-03",
      raceTime: "2026-06-03T13:50:00",
      raceName: "Novices' Hurdle",
      raceType: "Hurdle",
      raceClass: "Class 4",
      going: "Good",
      distance: "16.0",
      ran: 2,
      meetingId: "Newton Abbot|2026-06-03",
      meetingName: "Newton Abbot — 3 June 2026",
      runnersWithIspCount: 1,
      raceStaked: 0.5,
      raceReturns: 1.5,
      runners: [
        {
          id: synthNumericId(`${RAW_RACE_ID_1}:hrs_1`),
          name: "Fixture Star",
          num: 1,
          draw: 0,
          pos: "1",
          status: "WINNER",
          sortPriority: 1,
          isp: 3,
          ispFraction: "2/1",
          isFavourite: true,
          age: 6,
          wgt: 154,
          officialRating: 98,
          rpr: 120,
          ts: 100,
          beatenDistance: null,
          comment: "Led throughout",
        },
        {
          id: synthNumericId(`${RAW_RACE_ID_1}:hrs_2`),
          name: "Second Fixture",
          num: 2,
          draw: 1,
          pos: "PU",
          status: "NON_FINISHER",
          sortPriority: 2,
          isp: null,
          ispFraction: null,
          isFavourite: false,
          age: 5,
          wgt: 150,
          officialRating: 90,
          rpr: null,
          ts: null,
          beatenDistance: null,
          comment: "Pulled up",
        },
      ],
    } as any);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("returns the race doc keyed by the caller's raw raceId, not the hashed numeric _id", async () => {
    const results = await dao.getResultsForRaceIds([RAW_RACE_ID_1]);
    expect(results.size).toBe(1);
    const doc = results.get(RAW_RACE_ID_1);
    expect(doc).toBeDefined();
    expect(doc!.raceName).toBe("Novices' Hurdle");
    expect(doc!.runners).toHaveLength(2);
  });

  it("includes a runner with no valid ISP (unlike getRaceById's isp>1 filter)", async () => {
    const results = await dao.getResultsForRaceIds([RAW_RACE_ID_1]);
    const doc = results.get(RAW_RACE_ID_1)!;
    const nonFinisher = doc.runners.find(r => r.id === synthNumericId(`${RAW_RACE_ID_1}:hrs_2`));
    expect(nonFinisher).toBeDefined();
    expect(nonFinisher!.status).toBe("NON_FINISHER");
    expect(nonFinisher!.isp).toBeNull();
  });

  it("returns a map with no entry for a raceId that hasn't been captured yet", async () => {
    const results = await dao.getResultsForRaceIds([RAW_RACE_ID_2]);
    expect(results.size).toBe(0);
    expect(results.get(RAW_RACE_ID_2)).toBeUndefined();
  });

  it("batches a mix of matched and unmatched raceIds in one call", async () => {
    const results = await dao.getResultsForRaceIds([RAW_RACE_ID_1, RAW_RACE_ID_2]);
    expect(results.size).toBe(1);
    expect(results.has(RAW_RACE_ID_1)).toBe(true);
    expect(results.has(RAW_RACE_ID_2)).toBe(false);
  });

  it("returns an empty map for an empty input array without querying Mongo", async () => {
    const results = await dao.getResultsForRaceIds([]);
    expect(results.size).toBe(0);
  });
});
