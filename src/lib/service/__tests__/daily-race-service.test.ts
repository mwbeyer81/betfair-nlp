import { DailyRaceService } from "../daily-race-service";
import { DailyRaceDAO } from "../../dao/daily-race-dao";
import { RacingApiClient } from "../racing-api-client";

function fakeClient(overrides: Partial<RacingApiClient> = {}): RacingApiClient {
  return {
    hasCredentials: jest.fn().mockReturnValue(true),
    get: jest.fn(),
    ...overrides,
  } as unknown as RacingApiClient;
}

describe("DailyRaceService.ingestFromRacingApi", () => {
  let mockDAO: jest.Mocked<DailyRaceDAO>;
  let service: DailyRaceService;

  beforeEach(() => {
    mockDAO = { bulkUpsertRaces: jest.fn() } as any;
    service = new DailyRaceService(mockDAO);
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
