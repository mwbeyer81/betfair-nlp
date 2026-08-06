import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
// Standalone file + uniquely-named throwaway database, same reasoning as
// industry-sp-dao-model-version-filter.integration.test.ts — avoids adding a
// new describe block to the shared, already-contested
// industry-sp-dao.integration.test.ts file (see AGENTS.md).
const DB_NAME = `betfair_nlp_test_isp_live_meeting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

describe("IndustrySpDAO.getQualifyingRacesForDate (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  const baseParams = {
    countries: [] as string[],
    minRunners: 1,
    maxRunners: 30,
    minIsp: 1,
    maxIsp: 1000,
    minInIspRange: 1,
    maxInIspRange: 10000,
    courses: [] as string[],
    goings: [] as string[],
    raceClasses: [] as string[],
    raceTypes: [] as string[],
    trainerSearch: null as string | null,
    jockeySearch: null as string | null,
    trainerFormMinWinRate: 0,
    minTrainerFormRunners: 0,
    maxTrainerFormRunners: 100,
    minModelWinProbability: 0,
    onlyModelBeatsSp: false,
  };

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
    await dao.createIndexes();

    // Three races on the target date (2026-07-27) — two at the SAME meeting
    // (Ascot) to prove per-race rows stay distinct rather than merging like
    // the old meeting-level aggregation used to — plus one at a different
    // meeting (Newmarket), plus a fourth race on a different date at one of
    // the same meetings — the date scoping must exclude that entirely, not
    // just fail to group it. Runner A (isp 2, WINNER, modelWinProbabilityOos
    // 60) beats SP (60% > 100/2=50%); Runner B (isp 4, LOSER,
    // modelWinProbabilityOos 20) does not (20% < 100/4=25%).
    await db.collection("industry_starting_prices").insertMany([
      {
        _id: 1,
        raceId: 1,
        meetingId: "Ascot|2026-07-27",
        meetingName: "Ascot — 27 July 2026",
        course: "Ascot",
        countryCode: "GB",
        raceDate: "2026-07-27",
        raceTime: "2026-07-27T14:00:00",
        raceName: "Test Race 1",
        raceType: "Flat",
        raceClass: "Class 1",
        going: "Good",
        ran: 2,
        runnersWithIspCount: 2,
        runners: [
          { id: 101, name: "Runner A", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, modelWinProbabilityOos: 60, modelVersionId: "xgb-live-1" },
          { id: 102, name: "Runner B", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 4, ispFraction: "3/1", isFavourite: false, modelWinProbabilityOos: 20, modelVersionId: "xgb-live-1" },
        ],
      },
      {
        _id: 2,
        raceId: 2,
        meetingId: "Ascot|2026-07-27",
        meetingName: "Ascot — 27 July 2026",
        course: "Ascot",
        countryCode: "GB",
        raceDate: "2026-07-27",
        raceTime: "2026-07-27T14:30:00",
        raceName: "Test Race 2 (same meeting as race 1)",
        raceType: "Flat",
        raceClass: "Class 1",
        going: "Good",
        ran: 1,
        runnersWithIspCount: 1,
        runners: [
          { id: 111, name: "Runner F", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 3, ispFraction: "2/1", isFavourite: true, modelWinProbabilityOos: 80, modelVersionId: "xgb-live-1" },
        ],
      },
      {
        _id: 3,
        raceId: 3,
        meetingId: "Newmarket|2026-07-27",
        meetingName: "Newmarket — 27 July 2026",
        course: "Newmarket",
        countryCode: "GB",
        raceDate: "2026-07-27",
        raceTime: "2026-07-27T15:30:00",
        raceName: "Test Race 3",
        raceType: "Flat",
        raceClass: "Class 1",
        going: "Good",
        ran: 2,
        runnersWithIspCount: 2,
        runners: [
          { id: 201, name: "Runner C", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 3, ispFraction: "2/1", isFavourite: true, modelWinProbabilityOos: 50, modelVersionId: "xgb-live-1" },
          { id: 202, name: "Runner D", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbabilityOos: 10, modelVersionId: "xgb-live-1" },
        ],
      },
      {
        _id: 4,
        raceId: 4,
        meetingId: "Ascot|2026-07-28",
        meetingName: "Ascot — 28 July 2026",
        course: "Ascot",
        countryCode: "GB",
        raceDate: "2026-07-28",
        raceTime: "2026-07-28T14:00:00",
        raceName: "Test Race 4 (different date)",
        raceType: "Flat",
        raceClass: "Class 1",
        going: "Good",
        ran: 2,
        runnersWithIspCount: 2,
        runners: [
          { id: 301, name: "Runner E", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, modelWinProbabilityOos: 90, modelVersionId: "xgb-live-1" },
        ],
      },
    ] as any[]);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("with no filters, returns one row per qualifying race (not merged by meeting)", async () => {
    const results = await dao.getQualifyingRacesForDate({ raceDate: "2026-07-27", ...baseParams });
    expect(results).toHaveLength(3);

    const ascotRaces = results.filter(r => r.meetingId === "Ascot|2026-07-27");
    expect(ascotRaces).toHaveLength(2);
    const race1 = ascotRaces.find(r => r.raceId === 1);
    expect(race1).toBeDefined();
    expect(race1!.meetingName).toBe("Ascot — 27 July 2026");
    expect(race1!.raceName).toBe("Test Race 1");
    expect(race1!.raceTime).toBe("2026-07-27T14:00:00");
    expect(race1!.raceDate).toBe("2026-07-27");
    // staked = 1/(2-1) + 1/(4-1) = 1 + 0.333... ; returns = winner only: 1+1=2
    expect(race1!.pnlStats.count).toBe(2);
    expect(race1!.pnlStats.staked).toBeCloseTo(1 + 1 / 3, 5);
    expect(race1!.pnlStats.returns).toBeCloseTo(2, 5);

    const race2 = ascotRaces.find(r => r.raceId === 2);
    expect(race2).toBeDefined();
    expect(race2!.raceName).toBe("Test Race 2 (same meeting as race 1)");
    expect(race2!.pnlStats.count).toBe(1);
    expect(race2!.pnlStats.staked).toBeCloseTo(0.5, 5);
    expect(race2!.pnlStats.returns).toBeCloseTo(1.5, 5);

    const newmarketRace = results.find(r => r.meetingId === "Newmarket|2026-07-27");
    expect(newmarketRace).toBeDefined();
    expect(newmarketRace!.pnlStats.count).toBe(2);
  });

  it("excludes races on a different date entirely", async () => {
    const results = await dao.getQualifyingRacesForDate({ raceDate: "2026-07-27", ...baseParams });
    expect(results.some(r => r.meetingId === "Ascot|2026-07-28")).toBe(false);
  });

  it("onlyModelBeatsSp narrows each race to only its beats-SP runner", async () => {
    const results = await dao.getQualifyingRacesForDate({
      raceDate: "2026-07-27",
      ...baseParams,
      onlyModelBeatsSp: true,
    });

    const race1 = results.find(r => r.raceId === 1);
    expect(race1).toBeDefined();
    // Only Runner A (60% > 50%) qualifies — Runner B (20% < 25%) does not.
    expect(race1!.pnlStats.count).toBe(1);
    expect(race1!.pnlStats.staked).toBeCloseTo(1, 5);
    expect(race1!.pnlStats.returns).toBeCloseTo(2, 5);

    const newmarketRace = results.find(r => r.meetingId === "Newmarket|2026-07-27");
    // Runner C: 50% vs 100/3=33.3% -> qualifies. Runner D: 10% vs 20% -> no.
    expect(newmarketRace!.pnlStats.count).toBe(1);
  });

  it("minModelWinProbability excludes a race entirely when nothing qualifies", async () => {
    const results = await dao.getQualifyingRacesForDate({
      raceDate: "2026-07-27",
      ...baseParams,
      minModelWinProbability: 55,
    });
    // Only Runner A (60%, race 1) and Runner F (80%, race 2) clear 55% —
    // Newmarket's best is 50%, so that race produces no qualifying runners
    // at all and should be absent, not a zero-stats row (mirrors
    // getAllRacesByRace's "absence means no match").
    expect(results).toHaveLength(2);
    expect(results.some(r => r.meetingId === "Newmarket|2026-07-27")).toBe(false);
    const race1 = results.find(r => r.raceId === 1);
    expect(race1!.pnlStats.count).toBe(1);
  });

  it("returns an empty array for a date with no races at all", async () => {
    const results = await dao.getQualifyingRacesForDate({ raceDate: "2099-01-01", ...baseParams });
    expect(results).toEqual([]);
  });
});
