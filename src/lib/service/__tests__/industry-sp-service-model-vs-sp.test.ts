import { IndustrySpService } from "../industry-sp-service";
import { IndustrySpDAO, ModelVsSpParams, ModelVsSpRow } from "../../dao/industry-sp-dao";
import type { ModelVsSpSummary } from "../model-vs-sp-summary";

// A fake DAO injected through the constructor's optional param — the same
// approach live-price-service.test.ts uses, and the reason IndustrySpService
// takes an optional DAO at all (so a test never has to reach
// DatabaseConnection).
function fakeDao(overrides: Partial<jest.Mocked<IndustrySpDAO>> = {}): jest.Mocked<IndustrySpDAO> {
  return {
    getModelVsSpRunners: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<IndustrySpDAO>;
}

const PARAMS: ModelVsSpParams = {
  page: 3,
  limit: 25,
  sort: "edge_desc",
  minRaceTime: "2025-01-01",
  maxRaceTime: "2025-12-31T23:59:59.999",
  minModelProb: 10,
  maxModelProb: 90,
  minImpliedProb: 5,
  maxImpliedProb: 80,
  minAbsEdge: 5,
  maxAbsEdge: 40,
  minIsp: 2,
  maxIsp: 20,
  minRunners: 4,
  maxRunners: 16,
  countries: ["GB"],
  includeTotal: true,
};

const ROW: ModelVsSpRow = {
  raceId: 1,
  raceTime: "2025-06-01T14:00:00.000Z",
  raceDate: "2025-06-01",
  meetingId: "m1",
  meetingName: "Ascot",
  course: "Ascot",
  countryCode: "GB",
  raceName: "Test Race",
  raceType: "Flat",
  raceClass: "Class 2",
  going: "Good",
  runnerId: 101,
  runnerName: "Springwell Bay",
  num: 1,
  draw: 3,
  sortPriority: 1,
  status: "WINNER",
  isp: 4.5,
  ispFraction: "7/2",
  isFavourite: false,
  jockey: "P Townend",
  trainer: "W P Mullins",
  modelWinProbability: 30,
  impliedSpProbability: 22.22222222222222,
  edge: 7.777777777777779,
  modelVersionId: "xgb-v1",
};

const SUMMARY: ModelVsSpSummary = {
  allRunners: 100,
  matchedRunners: 40,
  matchedPercent: 40,
  meanAbsEdge: 5.3,
  bands: [
    { minAbs: 0, maxAbs: 2, label: "within ±2 pts", count: 40, percent: 40, cumulativePercent: 40 },
    { minAbs: 2, maxAbs: 5, label: "±2 to ±5 pts", count: 25, percent: 25, cumulativePercent: 65 },
    { minAbs: 5, maxAbs: 10, label: "±5 to ±10 pts", count: 20, percent: 20, cumulativePercent: 85 },
    { minAbs: 10, maxAbs: 20, label: "±10 to ±20 pts", count: 10, percent: 10, cumulativePercent: 95 },
    { minAbs: 20, maxAbs: 50, label: "±20 to ±50 pts", count: 4, percent: 4, cumulativePercent: 99 },
    { minAbs: 50, maxAbs: null, label: "beyond ±50 pts", count: 1, percent: 1, cumulativePercent: null },
  ],
};

describe("IndustrySpService.getModelVsSpRunners", () => {
  it("passes the params object through to the DAO unchanged", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [], total: 0, summary: SUMMARY });
    const service = new IndustrySpService(dao);

    await service.getModelVsSpRunners(PARAMS);

    expect(dao.getModelVsSpRunners).toHaveBeenCalledTimes(1);
    expect(dao.getModelVsSpRunners).toHaveBeenCalledWith(PARAMS);
  });

  it("returns the DAO's rows and total verbatim", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [ROW], total: 1284, summary: SUMMARY });
    const service = new IndustrySpService(dao);

    await expect(service.getModelVsSpRunners(PARAMS)).resolves.toEqual({
      rows: [ROW],
      total: 1284,
      summary: SUMMARY,
    });
  });

  it("passes the distribution summary through untouched", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [ROW], total: 40, summary: SUMMARY });
    const service = new IndustrySpService(dao);

    const result = await service.getModelVsSpRunners(PARAMS);
    // The service must not recompute or reshape any of it — the banding is the
    // DAO's (via buildEdgeSummary), and a second implementation here would be
    // free to drift.
    expect(result.summary).toBe(SUMMARY);
    expect(result.summary!.bands).toHaveLength(6);
    expect(result.summary!.matchedRunners).toBe(40);
  });

  // total: null is a distinct state from 0 — "not counted this request" vs
  // "counted, and there are none". Collapsing them would make the screen show
  // "0 runners" every time the user pages.
  it("propagates a null total rather than coercing it to zero", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [ROW], total: null, summary: null });
    const service = new IndustrySpService(dao);

    const result = await service.getModelVsSpRunners({ ...PARAMS, includeTotal: false });
    expect(result.total).toBeNull();
    // The summary is skipped on the same requests the count is.
    expect(result.summary).toBeNull();
    expect(result.rows).toHaveLength(1);
  });

  it("lets a DAO error propagate so the router can turn it into a 500", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockRejectedValue(new Error("QueryExceededMemoryLimitNoDiskUseAllowed"));
    const service = new IndustrySpService(dao);

    await expect(service.getModelVsSpRunners(PARAMS)).rejects.toThrow("QueryExceededMemoryLimit");
  });
});
