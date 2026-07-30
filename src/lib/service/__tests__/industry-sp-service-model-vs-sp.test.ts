import { IndustrySpService } from "../industry-sp-service";
import { IndustrySpDAO, ModelVsSpParams, ModelVsSpRow } from "../../dao/industry-sp-dao";

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
  minEdge: 0,
  maxEdge: 40,
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

describe("IndustrySpService.getModelVsSpRunners", () => {
  it("passes the params object through to the DAO unchanged", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [], total: 0 });
    const service = new IndustrySpService(dao);

    await service.getModelVsSpRunners(PARAMS);

    expect(dao.getModelVsSpRunners).toHaveBeenCalledTimes(1);
    expect(dao.getModelVsSpRunners).toHaveBeenCalledWith(PARAMS);
  });

  it("returns the DAO's rows and total verbatim", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [ROW], total: 1284 });
    const service = new IndustrySpService(dao);

    await expect(service.getModelVsSpRunners(PARAMS)).resolves.toEqual({ rows: [ROW], total: 1284 });
  });

  // total: null is a distinct state from 0 — "not counted this request" vs
  // "counted, and there are none". Collapsing them would make the screen show
  // "0 runners" every time the user pages.
  it("propagates a null total rather than coercing it to zero", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockResolvedValue({ rows: [ROW], total: null });
    const service = new IndustrySpService(dao);

    const result = await service.getModelVsSpRunners({ ...PARAMS, includeTotal: false });
    expect(result.total).toBeNull();
    expect(result.rows).toHaveLength(1);
  });

  it("lets a DAO error propagate so the router can turn it into a 500", async () => {
    const dao = fakeDao();
    dao.getModelVsSpRunners.mockRejectedValue(new Error("QueryExceededMemoryLimitNoDiskUseAllowed"));
    const service = new IndustrySpService(dao);

    await expect(service.getModelVsSpRunners(PARAMS)).rejects.toThrow("QueryExceededMemoryLimit");
  });
});
