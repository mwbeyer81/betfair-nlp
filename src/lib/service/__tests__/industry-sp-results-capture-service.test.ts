import { IndustrySpResultsCaptureService } from "../industry-sp-results-capture-service";
import { RacingApiClient } from "../racing-api-client";
import { synthRaceId } from "../../dao/industry-sp-row-mapping";

function fakeClient(overrides: Partial<RacingApiClient> = {}): RacingApiClient {
  return {
    hasCredentials: jest.fn().mockReturnValue(true),
    get: jest.fn(),
    ...overrides,
  } as unknown as RacingApiClient;
}

function fakeCollection() {
  // findOne backs DailyRaceDAO.getRaceById, called once per race to look up
  // a pre-race prediction to join in — defaults to null ("no matching
  // daily_racecards doc"), same as every real race with no prior ingest,
  // so existing assertions here (none of which cover modelWinProbability)
  // stay valid unless a test explicitly overrides it.
  return { bulkWrite: jest.fn().mockResolvedValue({}), findOne: jest.fn().mockResolvedValue(null) };
}

function fakeDb(collection: ReturnType<typeof fakeCollection>) {
  return { collection: jest.fn().mockReturnValue(collection) } as any;
}

// A single well-formed GB race matching the real, live-verified
// /results/today shape (field names confirmed against a real response
// during this feature's planning session).
const GB_RACE = {
  race_id: "rac_1",
  date: "2026-07-27",
  region: "GB",
  course: "Ripon",
  off: "8:40",
  race_name: "Sky Sports Racing Sky 415 Handicap Stakes",
  type: "Flat",
  class: "Class 6",
  going: "Good To Firm",
  dist: "5f",
  runners: [
    {
      horse_id: "hrs_1",
      horse: "Zuffolo (IRE)",
      sp: "7/2",
      number: "2",
      position: "1",
      draw: "6",
      ovr_btn: "0",
      age: "6",
      sex: "G",
      weight_lbs: "130",
      headgear: "b",
      or: "54",
      rpr: "",
      tsr: "72",
      comment: "",
      jockey: "Rhys Elliott",
      trainer: "Michael Dods",
    },
    {
      horse_id: "hrs_2",
      horse: "Doralee (GB)",
      sp: "15/2",
      number: "5",
      position: "2",
      draw: "1",
      ovr_btn: "0.2",
      age: "5",
      sex: "M",
      weight_lbs: "128",
      headgear: "",
      or: "47",
      rpr: "",
      tsr: "",
      comment: "",
      jockey: "Rowan Scott",
      trainer: "David & Nicola Barron",
    },
  ],
};

const FR_RACE = {
  race_id: "rac_2",
  date: "2026-07-27",
  region: "FR",
  course: "Clairefontaine",
  off: "3:03",
  race_name: "Prix De L'oudon",
  type: "Hurdle",
  class: "",
  going: "VERY SOFT",
  dist: "2m1f",
  runners: [],
};

describe("IndustrySpResultsCaptureService.captureTodayResults", () => {
  it("throws when the client has no credentials configured", async () => {
    const collection = fakeCollection();
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({ hasCredentials: jest.fn().mockReturnValue(false) });

    await expect(service.captureTodayResults(client)).rejects.toThrow("credentials not configured");
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it("throws when RacingAPI returns a non-ok response", async () => {
    const collection = fakeCollection();
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 401, ok: false, body: { detail: "Basic Plan required" } }),
    });

    await expect(service.captureTodayResults(client)).rejects.toThrow("RacingAPI returned 401");
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it("treats a missing/empty results array as zero races, not an error", async () => {
    const collection = fakeCollection();
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({ get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: {} }) });

    const result = await service.captureTodayResults(client);

    expect(result).toEqual({ racesUpserted: 0, runnersUpserted: 0, nonGbSkipped: 0 });
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it("filters out non-GB races via the region field", async () => {
    const collection = fakeCollection();
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: { results: [GB_RACE, FR_RACE] } }),
    });

    const result = await service.captureTodayResults(client);

    expect(result.racesUpserted).toBe(1);
    expect(result.nonGbSkipped).toBe(1);
    const ops = collection.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].replaceOne.replacement.course).toBe("Ripon");
  });

  it("maps runner fields correctly, including tsr->ts and weight_lbs->wgt", async () => {
    const collection = fakeCollection();
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: { results: [GB_RACE] } }),
    });

    await service.captureTodayResults(client);

    const doc = collection.bulkWrite.mock.calls[0][0][0].replaceOne.replacement;
    expect(doc._id).toBe(synthRaceId("rac_1"));
    expect(doc.raceId).toBe(synthRaceId("rac_1"));
    expect(doc.countryCode).toBe("GB");
    expect(doc.raceDate).toBe("2026-07-27");
    expect(doc.raceTime).toBe("2026-07-27T08:40:00");
    expect(doc.ran).toBe(2);

    const [winner, second] = doc.runners;
    expect(winner.name).toBe("Zuffolo (IRE)");
    expect(winner.status).toBe("WINNER");
    expect(winner.trainer).toBe("Michael Dods");
    expect(winner.jockey).toBe("Rhys Elliott");
    expect(winner.wgt).toBe(130);
    expect(winner.ts).toBe(72);
    expect(winner.rpr).toBeNull();
    expect(winner.isp).toBeCloseTo(4.5);
    expect(winner.ispFraction).toBe("7/2");

    expect(second.status).toBe("PLACED");
    expect(second.ts).toBeNull();
    expect(second.beatenDistance).toBeCloseTo(0.2);
  });

  it("attaches modelWinProbability/modelVersionId from a matching daily_racecards prediction", async () => {
    const collection = fakeCollection();
    (collection.findOne as jest.Mock).mockResolvedValue({
      _id: "rac_1",
      raceId: "rac_1",
      runners: [
        { runnerId: "hrs_1", modelWinProbability: 62.5, modelVersionId: "xgb-live-1" },
        { runnerId: "hrs_2", modelWinProbability: 37.5, modelVersionId: "xgb-live-1" },
      ],
    });
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: { results: [GB_RACE] } }),
    });

    await service.captureTodayResults(client);

    const [winner, second] = collection.bulkWrite.mock.calls[0][0][0].replaceOne.replacement.runners;
    expect(winner.modelWinProbability).toBe(62.5);
    expect(winner.modelVersionId).toBe("xgb-live-1");
    expect(second.modelWinProbability).toBe(37.5);
    expect(second.modelVersionId).toBe("xgb-live-1");
  });

  it("leaves modelWinProbability/modelVersionId null when no matching daily_racecards doc exists", async () => {
    const collection = fakeCollection(); // findOne defaults to null
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: { results: [GB_RACE] } }),
    });

    await service.captureTodayResults(client);

    const [winner] = collection.bulkWrite.mock.calls[0][0][0].replaceOne.replacement.runners;
    expect(winner.modelWinProbability).toBeNull();
    expect(winner.modelVersionId).toBeNull();
  });

  it("is idempotent — upserts by a deterministic _id derived from the RacingAPI race id", async () => {
    const collection = fakeCollection();
    const service = new IndustrySpResultsCaptureService(fakeDb(collection));
    const client = fakeClient({
      get: jest.fn().mockResolvedValue({ status: 200, ok: true, body: { results: [GB_RACE] } }),
    });

    await service.captureTodayResults(client);
    await service.captureTodayResults(client);

    const firstOps = collection.bulkWrite.mock.calls[0][0];
    const secondOps = collection.bulkWrite.mock.calls[1][0];
    expect(firstOps[0].replaceOne.filter).toEqual(secondOps[0].replaceOne.filter);
    expect(firstOps[0].replaceOne.filter).toEqual({ _id: synthRaceId("rac_1") });
  });
});
