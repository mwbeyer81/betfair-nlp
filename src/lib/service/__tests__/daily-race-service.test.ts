import { DailyRaceService } from "../daily-race-service";
import { DailyRaceDAO, DailyRaceDoc } from "../../dao/daily-race-dao";
import { IndustrySpDAO } from "../../dao/industry-sp-dao";
import { RaceDoc, synthNumericId } from "../../dao/industry-sp-row-mapping";
import { RacingApiClient } from "../racing-api-client";

function fakeClient(overrides: Partial<RacingApiClient> = {}): RacingApiClient {
  return {
    hasCredentials: jest.fn().mockReturnValue(true),
    get: jest.fn(),
    ...overrides,
  } as unknown as RacingApiClient;
}

// Not exercised by ingestFromRacingApi itself, but the constructor always
// needs an IndustrySpDAO now (see the getDailyRaces* describe block below)
// — without a mock, the "real" branch would try DatabaseConnection.getInstance(),
// which isn't mocked in this file and isn't connected to a real Mongo here.
function fakeIndustrySpDAO(): jest.Mocked<IndustrySpDAO> {
  return { getResultsForRaceIds: jest.fn().mockResolvedValue(new Map()) } as any;
}

describe("DailyRaceService.ingestFromRacingApi", () => {
  let mockDAO: jest.Mocked<DailyRaceDAO>;
  let service: DailyRaceService;

  beforeEach(() => {
    mockDAO = { bulkUpsertRaces: jest.fn() } as any;
    service = new DailyRaceService(mockDAO, fakeIndustrySpDAO());
  });

  it("throws when the client has no credentials configured", async () => {
    const client = fakeClient({ hasCredentials: jest.fn().mockReturnValue(false) });
    await expect(service.ingestFromRacingApi(client)).rejects.toThrow("credentials not configured");
    expect(mockDAO.bulkUpsertRaces).not.toHaveBeenCalled();
  });

  it("throws when RacingAPI returns a non-ok response", async () => {
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 401, ok: false, body: { detail: "Plan required" } }),
    });
    await expect(service.ingestFromRacingApi(client)).rejects.toThrow("RacingAPI returned 401");
    expect(mockDAO.bulkUpsertRaces).not.toHaveBeenCalled();
  });

  it("maps and upserts racecards on success, returning the count", async () => {
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        body: {
          racecards: [
            { race_id: "rac_1", course: "Newton Abbot", date: "2026-06-03", runners: [{ horse_id: "hrs_1", horse: "Fixture Star" }] },
            { race_id: "rac_2", course: "Ascot", date: "2026-06-03", runners: [] },
          ],
        },
      }),
    });

    const count = await service.ingestFromRacingApi(client);

    expect(count).toBe(2);
    expect(mockDAO.bulkUpsertRaces).toHaveBeenCalledTimes(1);
    const docs = mockDAO.bulkUpsertRaces.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ _id: "rac_1", course: "Newton Abbot", eventId: "newton-abbot-2026-06-03" });
  });

  it("treats a missing/empty racecards array as zero results, not an error", async () => {
    const client = fakeClient({ get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: {} }) });
    const count = await service.ingestFromRacingApi(client);
    expect(count).toBe(0);
    expect(mockDAO.bulkUpsertRaces).toHaveBeenCalledWith([]);
  });
});

function fakeDailyRace(overrides: Partial<DailyRaceDoc> = {}): DailyRaceDoc {
  return {
    _id: "rac_1",
    raceId: "rac_1",
    eventId: "newton-abbot-2026-06-03",
    course: "Newton Abbot",
    date: "2026-06-03",
    offTime: "1:50",
    offDt: "2026-06-03T13:50:00+01:00",
    raceName: "Novices' Hurdle",
    distanceF: null,
    region: "GB",
    raceClass: null,
    type: null,
    ageBand: null,
    prize: null,
    fieldSize: null,
    going: null,
    surface: null,
    ingestedAt: "2026-06-03T00:00:00.000Z",
    runners: [
      {
        runnerId: "hrs_1", horse: "Fixture Star", age: null, sex: null, sexCode: null, colour: null,
        region: null, dam: null, damId: null, sire: null, sireId: null, damsire: null, damsireId: null,
        trainer: null, trainerId: null, owner: null, ownerId: null, number: null, draw: null, headgear: null,
        lbs: null, officialRating: null, jockey: null, jockeyId: null, lastRun: null, form: null,
        rpr: null, ts: null, spotlight: null, comment: null, trainer14Days: null, trainerRtf: null,
        trainerFormRuns: null, trainerFormWins: null, trainerFormWinRate: null, trainerFormStaked: null,
        trainerFormReturns: null, jockeyFormRuns: null, jockeyFormWins: null, jockeyFormWinRate: null,
        jockeyFormStaked: null, jockeyFormReturns: null, daysSinceLastRun: null, horseCareerRuns: null,
        horseCareerWinRate: null, horseAvgRPR: null, horseAvgTS: null, horseAvgBeatenDistance: null,
        horseAvgExcuseScore: null, horseTroubleInRunningRate: null, horseTravelledWellRate: null,
        featuresComputedAt: null, modelWinProbability: null, modelVersionId: null, modelTopFactors: null,
      },
    ],
    ...overrides,
  };
}

function fakeResultDoc(raceId: string, runnerId: string, overrides: Partial<RaceDoc["runners"][number]> = {}): RaceDoc {
  return {
    _id: 0,
    raceId: 0,
    course: "Newton Abbot",
    countryCode: "GB",
    raceDate: "2026-06-03",
    raceTime: "2026-06-03T13:50:00",
    raceName: "Novices' Hurdle",
    raceType: "Hurdle",
    raceClass: null,
    going: null,
    distance: null,
    ran: 1,
    meetingId: "Newton Abbot|2026-06-03",
    meetingName: "Newton Abbot — 3 June 2026",
    runnersWithIspCount: 1,
    raceStaked: 1,
    raceReturns: 2,
    runners: [
      {
        id: synthNumericId(`${raceId}:${runnerId}`),
        name: "Fixture Star",
        num: 1,
        draw: 0,
        pos: "1",
        status: "WINNER",
        sortPriority: 1,
        isp: 3,
        ispFraction: "2/1",
        isFavourite: true,
        age: null,
        wgt: null,
        officialRating: null,
        rpr: null,
        ts: null,
        beatenDistance: null,
        comment: null,
        ...overrides,
      },
    ],
  };
}

describe("DailyRaceService.getDailyRaces (result enrichment)", () => {
  it("attaches the matching runner's result when industry_starting_prices has captured the race", async () => {
    const race = fakeDailyRace();
    const mockDAO = { getRacesByDate: jest.fn().mockResolvedValue([race]) } as any;
    const resultDoc = fakeResultDoc("rac_1", "hrs_1", { status: "WINNER", pos: "1", isp: 3, ispFraction: "2/1" });
    const mockIndustrySpDAO = {
      getResultsForRaceIds: jest.fn().mockResolvedValue(new Map([["rac_1", resultDoc]])),
    } as any;

    const service = new DailyRaceService(mockDAO, mockIndustrySpDAO);
    const [enriched] = await service.getDailyRaces("2026-06-03");

    expect(mockIndustrySpDAO.getResultsForRaceIds).toHaveBeenCalledWith(["rac_1"]);
    expect(enriched.runners[0].result).toEqual({ status: "WINNER", pos: "1", isp: 3, ispFraction: "2/1" });
  });

  it("leaves result null when no result doc matches this race yet", async () => {
    const race = fakeDailyRace();
    const mockDAO = { getRacesByDate: jest.fn().mockResolvedValue([race]) } as any;
    const mockIndustrySpDAO = { getResultsForRaceIds: jest.fn().mockResolvedValue(new Map()) } as any;

    const service = new DailyRaceService(mockDAO, mockIndustrySpDAO);
    const [enriched] = await service.getDailyRaces("2026-06-03");

    expect(enriched.runners[0].result).toBeNull();
  });

  it("leaves result null when the race has a result doc but this runner isn't in it", async () => {
    const race = fakeDailyRace();
    const mockDAO = { getRacesByDate: jest.fn().mockResolvedValue([race]) } as any;
    const resultDoc = fakeResultDoc("rac_1", "hrs_some_other_horse");
    const mockIndustrySpDAO = {
      getResultsForRaceIds: jest.fn().mockResolvedValue(new Map([["rac_1", resultDoc]])),
    } as any;

    const service = new DailyRaceService(mockDAO, mockIndustrySpDAO);
    const [enriched] = await service.getDailyRaces("2026-06-03");

    expect(enriched.runners[0].result).toBeNull();
  });

  it("batches every race's raceId into a single getResultsForRaceIds call", async () => {
    const races = [fakeDailyRace(), fakeDailyRace({ _id: "rac_2", raceId: "rac_2" })];
    const mockDAO = { getRacesByDate: jest.fn().mockResolvedValue(races) } as any;
    const mockIndustrySpDAO = { getResultsForRaceIds: jest.fn().mockResolvedValue(new Map()) } as any;

    const service = new DailyRaceService(mockDAO, mockIndustrySpDAO);
    await service.getDailyRaces("2026-06-03");

    expect(mockIndustrySpDAO.getResultsForRaceIds).toHaveBeenCalledTimes(1);
    expect(mockIndustrySpDAO.getResultsForRaceIds).toHaveBeenCalledWith(["rac_1", "rac_2"]);
  });
});
