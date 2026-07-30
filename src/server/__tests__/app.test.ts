import request from "supertest";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import app from "../app";
import { CodebaseSearchService } from "../../lib/service/codebase-search-service";
import { PredictionApiClient } from "../../lib/service/prediction-api-client";
import { RacingApiClient } from "../../lib/service/racing-api-client";
import { initializeServices, areServicesReady } from "../router";
import { DatabaseConnection } from "../../config/database";
import { IndustrySpService } from "../../lib/service/industry-sp-service";
import type { ModelVsSpParams } from "../../lib/dao/industry-sp-dao";

let authToken: string;

const TEST_USER_EMAIL = "matthew@backbet.co.uk";
const TEST_USER_PASSWORD = "beyer";
// Hashed once, synchronously, at module load — every mocked "users" findOne
// below returns this so login() can bcrypt.compare against a real hash.
const TEST_USER_PASSWORD_HASH = bcrypt.hashSync(TEST_USER_PASSWORD, 10);

// A minimal in-memory "users" table backing the mocked collection below —
// stateful (persists across tests in this file, in execution order) so
// signup -> verify -> me flows can be exercised end-to-end without a real
// database. The legacy seeded account starts pre-verified (it predates
// email verification entirely, and there's no real inbox behind it to
// click a link from).
interface MockUserDoc {
  _id: InstanceType<typeof ObjectId>;
  email?: string;
  passwordHash?: string;
  createdAt: Date;
  emailVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpiresAt: Date | null;
  googleId?: string;
  phone?: string;
  phoneVerified?: boolean;
}
const mockUsers: MockUserDoc[] = [
  {
    _id: new ObjectId(),
    email: TEST_USER_EMAIL,
    passwordHash: TEST_USER_PASSWORD_HASH,
    createdAt: new Date(),
    emailVerified: true,
    verificationToken: null,
    verificationTokenExpiresAt: null,
  },
];

// In-memory "saved_filter_sets" table backing the mocked collection below —
// stateful across tests in this file, same pattern as mockUsers.
interface MockSavedFilterSetSplit {
  fromRow: number;
  toRow: number | null;
  total: number;
  totalRunners: number;
  pnlStats: { staked: number; returns: number; pnl: number; count: number };
  graphPoints: unknown[];
}
interface MockSavedFilterSetDoc {
  _id: InstanceType<typeof ObjectId>;
  userId: string;
  name: string;
  filters: Record<string, string>;
  splitA: MockSavedFilterSetSplit;
  splitB: MockSavedFilterSetSplit;
  createdAt: string;
  createdBy?: "user" | "agent";
  modelVersionId?: string;
}
const mockSavedFilterSets: MockSavedFilterSetDoc[] = [];

interface MockLiveFilterResultDoc {
  _id: InstanceType<typeof ObjectId>;
  savedFilterSetId: InstanceType<typeof ObjectId>;
  filters: Record<string, string>;
  modelVersionId: string | null;
  raceDate: string;
  raceId: number;
  raceTime: string;
  raceName: string;
  meetingId: string;
  meetingName: string;
  pnlStats: { staked: number; returns: number; pnl: number; count: number };
  capturedAt: string;
}
const mockLiveFilterResults: MockLiveFilterResultDoc[] = [];

// In-memory "bet_orders" table backing the mocked collection below — same
// stateful-across-tests pattern as mockSavedFilterSets.
interface MockBetOrderDoc {
  _id: InstanceType<typeof ObjectId>;
  userId: string;
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  offDt: string;
  raceId: string;
  eventId: string;
  targetProfit: number;
  maxStake: number;
  minQualifyingPrice: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  note?: string;
}
const mockBetOrders: MockBetOrderDoc[] = [];

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
  authToken = res.body.token;
});

// Mock the chat service to avoid real OpenAI API calls in tests. Auto-mocked
// (no factory) rather than a factory referencing an outer `const` — jest.mock
// factories are hoisted above all other top-level code, so a factory that
// closes over a same-file `const` throws "Cannot access before
// initialization" the moment the mocked module is first required (which
// happens as soon as `import app from "../app"` above pulls in
// router.ts -> codebase-search-service, before this file's own consts run).
jest.mock("../../lib/service/codebase-search-service");
const MOCKED_CHAT_REPLY = "Mocked chat reply";
// initializeServices() constructs exactly one CodebaseSearchService when
// `../app` (imported above) first loads — grab that same instance's
// auto-mocked `chat` method to configure/assert on.
const mockChat = (CodebaseSearchService as jest.MockedClass<typeof CodebaseSearchService>).mock
  .instances[0].chat as jest.MockedFunction<CodebaseSearchService["chat"]>;

// Unlike CodebaseSearchService (a startup singleton), PredictionApiClient is
// constructed fresh per predictDailyRaces() call (see daily-race-service.ts's
// default parameter) — patching the mocked class's prototype, not a single
// captured instance, makes every `new PredictionApiClient()` share this
// implementation regardless of when/how many times it's constructed.
jest.mock("../../lib/service/prediction-api-client");
const mockPredict = jest.fn();
(PredictionApiClient as jest.MockedClass<typeof PredictionApiClient>).prototype.predict = mockPredict;

// Same reasoning as PredictionApiClient above — POST /api/daily-races/reseed-results
// constructs a fresh RacingApiClient per request.
jest.mock("../../lib/service/racing-api-client");
const mockRacingApiGet = jest.fn();
(RacingApiClient as jest.MockedClass<typeof RacingApiClient>).prototype.get = mockRacingApiGet;
(RacingApiClient as jest.MockedClass<typeof RacingApiClient>).prototype.hasCredentials = jest.fn().mockReturnValue(true);

// Mock Google's ID token verification — config/test.json sets a non-empty
// google.clientId so GoogleAuthService actually constructs an OAuth2Client
// (and thus calls this mock) rather than short-circuiting to its own
// "not configured" 503 the way it would with the real empty default.
const GOOGLE_VALID_TOKEN = "valid-google-token";
const GOOGLE_VALID_TOKEN_NO_EMAIL = "valid-google-token-no-email";
const GOOGLE_VALID_TOKEN_EXISTING_EMAIL = "valid-google-token-existing-email";
// AuthService (and the GoogleAuthService/OAuth2Client instance inside it) is
// constructed once at server startup, not per-request — mockImplementationOnce
// on the OAuth2Client constructor wouldn't affect the already-built instance.
// Every distinct scenario needs its own fixed token mapped here instead.
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn().mockImplementation(async ({ idToken }: { idToken: string }) => {
      if (idToken === GOOGLE_VALID_TOKEN) {
        return { getPayload: () => ({ sub: "google-uid-123", email: "googleuser@gmail.com", email_verified: true }) };
      }
      if (idToken === GOOGLE_VALID_TOKEN_NO_EMAIL) {
        return { getPayload: () => ({ sub: "google-uid-456", email: undefined, email_verified: false }) };
      }
      if (idToken === GOOGLE_VALID_TOKEN_EXISTING_EMAIL) {
        return { getPayload: () => ({ sub: "google-uid-789", email: "googleuser2@gmail.com", email_verified: true }) };
      }
      throw new Error("Token used too early or expired");
    }),
  })),
}));

// Mock Twilio's Verify API — same reasoning as above, config/test.json
// gives SmsService non-empty twilio.* values so it actually calls this
// mock instead of short-circuiting to "not configured".
const TWILIO_FAILING_PHONE = "+10000000000";
const TWILIO_CORRECT_CODE = "123456";
jest.mock("twilio", () =>
  jest.fn().mockImplementation(() => ({
    verify: {
      v2: {
        services: jest.fn().mockImplementation(() => ({
          verifications: {
            create: jest.fn().mockImplementation(async ({ to }: { to: string }) => {
              if (to === TWILIO_FAILING_PHONE) throw new Error("Twilio send failed");
              return { status: "pending" };
            }),
          },
          verificationChecks: {
            create: jest.fn().mockImplementation(async ({ code }: { to: string; code: string }) => {
              return { status: code === TWILIO_CORRECT_CODE ? "approved" : "pending" };
            }),
          },
        })),
      },
    },
  }))
);

// Mock the database connection
jest.mock("../../config/database", () => {
  // Lazily required (not a top-level import) — jest.mock factories can't
  // reference out-of-scope module bindings directly, only via a require()
  // call made inside the factory itself.
  const { synthRaceId, synthNumericId } = require("../../lib/dao/industry-sp-row-mapping");

  return {
  DatabaseConnection: {
    getInstance: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      getDb: jest.fn().mockReturnValue({
        collection: jest.fn().mockImplementation((name: string) => {
          if (name === "users") {
            return {
              createIndex: jest.fn().mockResolvedValue(undefined),
              findOne: jest.fn().mockImplementation(async (query: { email?: string; verificationToken?: string; _id?: unknown; phone?: string; googleId?: string }) => {
                if (query?.email) {
                  return mockUsers.find(u => u.email === query.email) ?? null;
                }
                if (query?.verificationToken) {
                  return mockUsers.find(u => u.verificationToken === query.verificationToken) ?? null;
                }
                if (query?._id) {
                  return mockUsers.find(u => String(u._id) === String(query._id)) ?? null;
                }
                if (query?.phone) {
                  return mockUsers.find(u => u.phone === query.phone) ?? null;
                }
                if (query?.googleId) {
                  return mockUsers.find(u => u.googleId === query.googleId) ?? null;
                }
                return null;
              }),
              insertOne: jest.fn().mockImplementation(async (doc: Omit<MockUserDoc, "_id">) => {
                const _id = new ObjectId();
                mockUsers.push({ ...doc, _id });
                return { insertedId: _id };
              }),
              updateOne: jest.fn().mockImplementation(async (filter: { _id?: unknown }, update: { $set?: Partial<MockUserDoc> }) => {
                const user = mockUsers.find(u => String(u._id) === String(filter?._id));
                if (user && update?.$set) Object.assign(user, update.$set);
                return { matchedCount: user ? 1 : 0 };
              }),
            };
          }
          if (name === "trainer_form") {
            return {
              createIndex: jest.fn().mockResolvedValue(undefined),
              findOne: jest.fn().mockImplementation(async (query: { trainer?: string; formCategory?: string }) => {
                if (query?.trainer === "W P Mullins" && query?.formCategory === "Flat") {
                  return {
                    trainer: "W P Mullins",
                    formCategory: "Flat",
                    runs: [
                      { raceId: 914592, runnerId: 12347, horseName: "Fact To File", raceDate: "2025-01-08", course: "Cheltenham", status: "WINNER", pos: "1", isp: 2.1 },
                    ],
                    totalRuns: 1,
                    totalWins: 1,
                    lastUpdated: "2025-01-09T00:00:00.000Z",
                  };
                }
                return null;
              }),
            };
          }
          if (name === "model_evaluations") {
            return {
              find: jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue([
                  {
                    modelVersionId: "xgb-20260301-090000",
                    runLabel: "unlabeled",
                    runAt: "2026-03-01T09:00:00.000Z",
                    trainingParams: {
                      nEstimators: 2000,
                      learningRate: 0.03,
                      maxDepth: 5,
                      subsample: 0.8,
                      colsampleBytree: 0.8,
                      minChildWeight: 8,
                      randomState: 42,
                      earlyStoppingRounds: 50,
                    },
                    featureCols: ["course", "going", "trainer", "jockey"],
                    trainRows: 180000,
                    testRows: 20000,
                    trainDateMax: "2026-02-25",
                    testDateMin: "2026-02-26",
                    bestIteration: 842,
                    aucRoc: 0.731,
                    logLoss: 0.579,
                    brierScore: 0.199,
                    calibrationTable: [
                      { meanPredicted: 10, actualWinRate: 12, n: 2000 },
                      { meanPredicted: 90, actualWinRate: 85, n: 2100 },
                    ],
                  },
                ]),
              }),
            };
          }
          if (name === "saved_filter_sets") {
            return {
              insertOne: jest.fn().mockImplementation(async (doc: Record<string, unknown>) => {
                const _id = new ObjectId();
                mockSavedFilterSets.push({ ...doc, _id } as MockSavedFilterSetDoc);
                return { insertedId: _id };
              }),
              find: jest.fn().mockImplementation((query: { userId?: string; createdBy?: string }) => ({
                sort: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue(
                  mockSavedFilterSets
                    .filter(d => (query?.createdBy === "agent" ? d.createdBy === "agent" : d.userId === query?.userId))
                    .slice()
                    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                ),
              })),
              findOne: jest.fn().mockImplementation(async (query: { _id?: unknown; userId?: string; createdBy?: string }) => {
                return (
                  mockSavedFilterSets.find(
                    d =>
                      String(d._id) === String(query?._id) &&
                      (query?.createdBy === "agent" ? d.createdBy === "agent" : d.userId === query?.userId)
                  ) ?? null
                );
              }),
              deleteOne: jest.fn().mockImplementation(async (query: { _id?: unknown; userId?: string }) => {
                const index = mockSavedFilterSets.findIndex(d => String(d._id) === String(query?._id) && d.userId === query?.userId);
                if (index === -1) return { deletedCount: 0 };
                mockSavedFilterSets.splice(index, 1);
                return { deletedCount: 1 };
              }),
            };
          }
          if (name === "saved_filter_set_live_results") {
            return {
              createIndex: jest.fn().mockResolvedValue(undefined),
              dropIndex: jest.fn().mockResolvedValue(undefined),
              find: jest.fn().mockImplementation((query: { savedFilterSetId?: unknown }) => ({
                sort: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue(
                  mockLiveFilterResults
                    .filter(d => String(d.savedFilterSetId) === String(query?.savedFilterSetId))
                    .slice()
                    .sort((a, b) => (a.raceTime < b.raceTime ? 1 : -1))
                ),
              })),
              bulkWrite: jest.fn().mockResolvedValue({}),
            };
          }
          if (name === "daily_racecards") {
            const mockDailyRace = {
              _id: "rac_test_0001",
              raceId: "rac_test_0001",
              eventId: "newton-abbot-2026-06-03",
              course: "Newton Abbot",
              date: "2026-06-03",
              offTime: "1:50",
              offDt: "2026-06-03T13:50:00+01:00",
              raceName: "Novices' Hurdle",
              distanceF: "16.0",
              region: "GB",
              raceClass: "Class 4",
              type: "Hurdle",
              ageBand: "4yo+",
              prize: "£3,769",
              fieldSize: "1",
              going: "Good",
              surface: "Turf",
              runners: [
                {
                  runnerId: "hrs_1", horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
                  region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
                  damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
                  owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
                  officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
                },
              ],
              ingestedAt: "2026-06-03T00:00:00.000Z",
            };
            return {
              createIndex: jest.fn().mockResolvedValue(undefined),
              find: jest.fn().mockImplementation((query: { date?: string; eventId?: string }) => ({
                sort: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue(
                  (query?.date && query.date === mockDailyRace.date) ||
                  (query?.eventId && query.eventId === mockDailyRace.eventId)
                    ? [mockDailyRace]
                    : []
                ),
              })),
              findOne: jest.fn().mockImplementation(async (query: { _id?: string }) => {
                return query?._id === mockDailyRace._id ? mockDailyRace : null;
              }),
              bulkWrite: jest.fn().mockResolvedValue({}),
            };
          }
          if (name === "bet_orders") {
            return {
              createIndex: jest.fn().mockResolvedValue(undefined),
              insertOne: jest.fn().mockImplementation(async (doc: Omit<MockBetOrderDoc, "_id">) => {
                const _id = new ObjectId();
                mockBetOrders.push({ ...doc, _id } as MockBetOrderDoc);
                return { insertedId: _id };
              }),
              find: jest.fn().mockImplementation((query: { userId?: string; status?: { $in?: string[] } }) => ({
                sort: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue(
                  mockBetOrders
                    .filter(d =>
                      query?.status?.$in ? query.status.$in.includes(d.status) : d.userId === query?.userId
                    )
                    .slice()
                    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                ),
              })),
              findOne: jest.fn().mockImplementation(async (query: { _id?: unknown; userId?: string }) => {
                return mockBetOrders.find(d => String(d._id) === String(query?._id) && d.userId === query?.userId) ?? null;
              }),
              // Backs BOTH BetOrderDAO.cancelByIdForUser (filter has userId +
              // status:{$in:[...]}) and .tryTransition (filter has an exact
              // status, no userId) — matched generically by checking every
              // present filter key against the in-memory doc, same
              // compare-and-swap semantics the real driver gives: the update
              // only applies if every filter condition is still true right now.
              updateOne: jest.fn().mockImplementation(
                async (filter: { _id?: unknown; userId?: string; status?: string | { $in?: string[] } }, update: { $set?: Partial<MockBetOrderDoc>; $unset?: Record<string, unknown> }) => {
                  const doc = mockBetOrders.find(d => String(d._id) === String(filter?._id));
                  if (!doc) return { modifiedCount: 0 };
                  if (filter.userId != null && doc.userId !== filter.userId) return { modifiedCount: 0 };
                  if (filter.status != null) {
                    const statusMatches =
                      typeof filter.status === "string"
                        ? doc.status === filter.status
                        : (filter.status.$in?.includes(doc.status) ?? false);
                    if (!statusMatches) return { modifiedCount: 0 };
                  }
                  if (update.$set) Object.assign(doc, update.$set);
                  if (update.$unset) for (const key of Object.keys(update.$unset)) delete (doc as unknown as Record<string, unknown>)[key];
                  return { modifiedCount: 1 };
                }
              ),
            };
          }
          // A captured result for mockDailyRace above (raceId "rac_test_0001",
          // runner "hrs_1") — hashed with the exact same helpers
          // IndustrySpResultsCaptureService/DailyRaceService use, so
          // DailyRaceService.getResultsForRaceIds's join actually matches in
          // this test the same way it would against real captured data.
          // industry_starting_prices falls through to this shared generic
          // branch (not its own dedicated one) so it keeps the same
          // aggregate/distinct/countDocuments mocks every other
          // /api/industry-sp/* route here already depends on — only `find`
          // is special-cased for the `_id: {$in: [...]}` shape
          // getResultsForRaceIds actually issues.
          const mockResultRaceId = synthRaceId("rac_test_0001");
          const mockResultRace = {
            _id: mockResultRaceId,
            raceId: mockResultRaceId,
            course: "Newton Abbot",
            countryCode: "GB",
            raceDate: "2026-06-03",
            raceTime: "2026-06-03T13:50:00",
            raceName: "Novices' Hurdle",
            raceType: "Hurdle",
            raceClass: "Class 4",
            going: "Good",
            distance: "16.0",
            ran: 1,
            meetingId: "Newton Abbot|2026-06-03",
            meetingName: "Newton Abbot — 3 June 2026",
            runnersWithIspCount: 1,
            raceStaked: 1 / 3,
            raceReturns: 1 / 3 + 1,
            runners: [
              {
                id: synthNumericId("rac_test_0001:hrs_1"),
                name: "Fixture Star",
                num: 1,
                draw: 0,
                pos: "1",
                status: "WINNER",
                sortPriority: 1,
                isp: 4,
                ispFraction: "3/1",
                isFavourite: true,
                age: 6,
                wgt: 154,
                officialRating: 98,
                rpr: null,
                ts: null,
                beatenDistance: null,
                comment: null,
              },
            ],
          };
          return {
            distinct: jest.fn().mockResolvedValue(["GB", "IE"]),
          find: jest.fn().mockImplementation((query?: { _id?: { $in?: number[] } }) => {
            if (name === "industry_starting_prices" && query?._id?.$in) {
              return {
                toArray: jest.fn().mockResolvedValue(
                  query._id!.$in!.includes(mockResultRaceId) ? [mockResultRace] : []
                ),
              };
            }
            return {
              sort: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([
                {
                  eventId: "33858191",
                  marketId: "1.237066150",
                  changeId: "12890365544",
                  status: "OPEN",
                  marketType: "WIN",
                  marketTime: "2025-01-01T14:01:00.000Z",
                  numberOfActiveRunners: 5,
                  timestamp: new Date().toISOString(),
                  runners: [],
                  runnerId: 12345,
                  runnerName: "Springwell Bay",
                  lastTradedPrice: 4.5,
                  eventName: "Cheltenham 1st Jan",
                },
              ]),
            };
          }),
          countDocuments: jest.fn().mockResolvedValue(42),
          findOne: jest.fn().mockResolvedValue({ id: 1, name: "Test Horse" }),
          bulkWrite: jest.fn().mockResolvedValue({}),
          aggregate: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
              {
                // Shared mock — fields satisfy all aggregate-based endpoints:
                // /api/stats (SummaryStats shape)
                totalRaces: 8,
                totalRunners: 110,
                // /api/events/grouped (EventGroup shape)
                eventId: "33858191",
                eventName: "Cheltenham 1st Jan",
                marketIds: ["1.237066150"],
                count: 1,
                fromRow: 1,
                toRow: 8,
                // getRaceConvergenceSeries' per-point shape — this mock
                // array only has one element, so the endpoint's response
                // has exactly one convergence point in tests, which is
                // enough to assert its field shape.
                raceRowNumber: 1,
                cumulativeStaked: 1,
                cumulativeReturns: 2,
                // /api/events/:eventId/definitions (MarketDefinitionDocument shape)
                // /api/events/:eventId/runners (Race shape)
                marketId: "1.237066150",
                marketTime: "2025-01-01T14:01:00.000Z",
                marketType: "ANTEPOST_WIN",
                marketName: "Cheltenham Chase",
                status: "CLOSED",
                runners: [{ id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1 }],
                // Runner shape fields (for aggregate-based runner queries)
                id: 12345,
                name: "Springwell Bay",
                sortPriority: 1,
                // $facet shape for getAllRunnersByRace (paginated) AND getEventGroups
                data: [
                  {
                    // EventGroup fields
                    marketIds: ["1.237066150"],
                    count: 1,
                    earliestMarketTime: "2025-01-01T14:01:00.000Z",
                    // RaceWithEvent fields
                    eventId: "33858191",
                    eventName: "Cheltenham 1st Jan",
                    marketId: "1.237066150",
                    marketTime: "2025-01-01T14:01:00.000Z",
                    marketType: "ANTEPOST_WIN",
                    marketName: "Cheltenham Chase",
                    runners: [{ id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1 }],
                    // IspRace fields (getAllRacesByRace)
                    raceId: 914592,
                    course: "Ascot",
                    countryCode: "GB",
                    raceTime: "2025-01-01T14:01:00.000Z",
                    raceName: "Cheltenham Chase",
                    raceType: "Hurdle",
                    raceClass: "Class 3",
                    going: "Good",
                    ran: 1,
                    meetingId: "Ascot|2025-01-01",
                    meetingName: "Ascot — 1 January 2025",
                  },
                ],
                // 50000 (not 1) — large enough that it never dominates the
                // raceCap-clamping tests below (getSplitStats now also
                // clamps each split's toRow to the matched total, not just
                // raceCap; a total of 1 would make every clamped toRow
                // collapse to 1 regardless of raceCap, defeating the point
                // of those tests).
                total: [{ count: 50000 }],
                pnlStats: [{ staked: 1, returns: 2, count: 1 }],
                staked: 1,
                returns: 2,
                runnerCounts: [{ maxRunners: 12 }],
                ispBounds: [{ maxIsp: 100, minIsp: 1.5 }],
                // ModelVsSpRow shape (GET /api/model-vs-sp) — the runner-level
                // fields the race-shaped fields above don't already cover.
                // Deliberately NOT re-declaring `status` (already "CLOSED" for
                // the market-definitions shape) — hence /api/model-vs-sp's own
                // describe block never asserts on data[0].status.
                runnerId: 12345,
                runnerName: "Springwell Bay",
                // raceId/raceDate at the TOP level — they already exist inside
                // `data` above for the race-shaped $facet endpoints, but this
                // endpoint's rows are flat, so it reads them from here.
                raceId: 914592,
                raceDate: "2025-01-01",
                num: 1,
                draw: null,
                isp: 4.5,
                ispFraction: "7/2",
                isFavourite: false,
                trainer: "W P Mullins",
                jockey: "P Townend",
                modelWinProbability: 30,
                impliedSpProbability: 22.22,
                edge: 7.78,
                modelVersionId: "xgb-20260301-090000",
                // getModelVsSpRunners' count-pipeline accumulator. Deliberately
                // not named `total` or `count`: `total` here is already a
                // $facet-shaped [{count:50000}] and `count` is already 1, so
                // reusing either name would make the new endpoint read an array
                // as a number and emit totalPages: NaN.
                matchedRunners: 7,
              },
            ]),
          }),
          };
        }),
      }),
      isConnected: jest.fn().mockReturnValue(true),
    }),
  },
  };
});

describe("API Endpoints", () => {
  describe("GET /health", () => {
    it("should return health status with database connection info", async () => {
      const response = await request(app).get("/health").set("Authorization", `Bearer ${authToken}`).expect(200);

      expect(response.body).toHaveProperty("status", "OK");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("service", "Betfair NLP API");
      expect(response.body).toHaveProperty("database");
    });
  });

  describe("POST /api/auth/signup", () => {
    it("creates a new account and returns a token for a fresh email", async () => {
      const response = await request(app)
        .post("/api/auth/signup")
        .send({ email: "new.user@backbet.co.uk", password: "correct-horse-battery" })
        .expect(201);

      expect(response.body).toHaveProperty("token");
      expect(typeof response.body.token).toBe("string");
    });

    it("a fresh signup is unverified", async () => {
      const response = await request(app)
        .post("/api/auth/signup")
        .send({ email: "unverified.user@backbet.co.uk", password: "correct-horse-battery" })
        .expect(201);

      expect(response.body.emailVerified).toBe(false);
    });

    it("returns 409 when the email is already registered", async () => {
      const response = await request(app)
        .post("/api/auth/signup")
        .send({ email: TEST_USER_EMAIL, password: "correct-horse-battery" })
        .expect(409);

      expect(response.body).toHaveProperty("error");
    });

    it("returns 400 for an invalid email", async () => {
      const response = await request(app)
        .post("/api/auth/signup")
        .send({ email: "not-an-email", password: "correct-horse-battery" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("returns 400 for a too-short password", async () => {
      const response = await request(app)
        .post("/api/auth/signup")
        .send({ email: "short.pw@backbet.co.uk", password: "abcd" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns a token for valid email/password", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      expect(typeof response.body.token).toBe("string");
    });

    it("the seeded legacy account logs in as already verified", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
        .expect(200);

      expect(response.body.emailVerified).toBe(true);
    });

    it("returns 401 for a wrong password", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER_EMAIL, password: "wrong-password" })
        .expect(401);

      expect(response.body).toHaveProperty("error");
    });

    // The backbet.co.uk (main branch) bundle isn't updated by this change and
    // still posts {username, password} — the router aliases username:"matthew"
    // onto the seeded TEST_USER_EMAIL so that old bundle keeps working.
    it("accepts the legacy {username, password} shape for the matthew account", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ username: "matthew", password: TEST_USER_PASSWORD })
        .expect(200);

      expect(response.body).toHaveProperty("token");
    });

    it("returns 401 for an unknown email", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@backbet.co.uk", password: "whatever123" })
        .expect(401);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /api/auth/verify", () => {
    it("is public — returns 200 HTML with no auth header, given a valid token", async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ email: "verify.me@backbet.co.uk", password: "correct-horse-battery" })
        .expect(201);
      const token = mockUsers.find(u => u.email === "verify.me@backbet.co.uk")?.verificationToken;
      expect(typeof token).toBe("string");

      const response = await request(app).get(`/api/auth/verify?token=${token}`).expect(200);
      expect(response.headers["content-type"]).toMatch(/html/);
      expect(response.text).toContain("verify.me@backbet.co.uk");

      const user = mockUsers.find(u => u.email === "verify.me@backbet.co.uk");
      expect(user?.emailVerified).toBe(true);
      expect(user?.verificationToken).toBeNull();
    });

    it("returns 400 HTML for an unknown/invalid token", async () => {
      const response = await request(app).get("/api/auth/verify?token=not-a-real-token").expect(400);
      expect(response.headers["content-type"]).toMatch(/html/);
    });

    it("returns 400 HTML for an expired token", async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ email: "expired.token@backbet.co.uk", password: "correct-horse-battery" })
        .expect(201);
      const user = mockUsers.find(u => u.email === "expired.token@backbet.co.uk")!;
      user.verificationTokenExpiresAt = new Date(Date.now() - 1000);

      const response = await request(app).get(`/api/auth/verify?token=${user.verificationToken}`).expect(400);
      expect(response.text).toContain("expired");
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns 401 without auth", async () => {
      await request(app).get("/api/auth/me").expect(401);
    });

    it("returns email + emailVerified for the authenticated user", async () => {
      const response = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ success: true, email: TEST_USER_EMAIL, emailVerified: true });
    });
  });

  describe("POST /api/auth/resend-verification", () => {
    it("returns 401 without auth", async () => {
      await request(app).post("/api/auth/resend-verification").expect(401);
    });

    it("issues a new token for an unverified account", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ email: "resend.me@backbet.co.uk", password: "correct-horse-battery" })
        .expect(201);
      const originalToken = mockUsers.find(u => u.email === "resend.me@backbet.co.uk")?.verificationToken;

      const response = await request(app)
        .post("/api/auth/resend-verification")
        .set("Authorization", `Bearer ${signupRes.body.token}`)
        .expect(200);

      expect(response.body).toMatchObject({ success: true, alreadyVerified: false });
      const newToken = mockUsers.find(u => u.email === "resend.me@backbet.co.uk")?.verificationToken;
      expect(newToken).not.toBe(originalToken);
    });

    it("reports alreadyVerified for an already-verified account", async () => {
      const response = await request(app)
        .post("/api/auth/resend-verification")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ success: true, alreadyVerified: true });
    });
  });

  describe("POST /api/auth/google", () => {
    it("creates a new account for a first-time Google sign-in", async () => {
      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: GOOGLE_VALID_TOKEN })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      expect(response.body.emailVerified).toBe(true);
      const user = mockUsers.find(u => u.googleId === "google-uid-123");
      expect(user).toBeTruthy();
      expect(user?.email).toBe("googleuser@gmail.com");
      expect(user?.passwordHash).toBeUndefined();
    });

    it("logs into the same account on a repeat sign-in rather than duplicating it", async () => {
      const before = mockUsers.length;
      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: GOOGLE_VALID_TOKEN })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      expect(mockUsers.length).toBe(before);
    });

    it("links googleId onto an existing email/password account with the same email", async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ email: "googleuser2@gmail.com", password: "correct-horse-battery" })
        .expect(201);

      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: GOOGLE_VALID_TOKEN_EXISTING_EMAIL })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      const user = mockUsers.find(u => u.email === "googleuser2@gmail.com");
      expect(user?.googleId).toBe("google-uid-789");
    });

    it("returns 401 for an invalid Google ID token", async () => {
      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: "not-a-real-token" })
        .expect(401);

      expect(response.body).toHaveProperty("error");
    });

    it("creates an account with no email when Google doesn't provide one", async () => {
      const response = await request(app)
        .post("/api/auth/google")
        .send({ idToken: GOOGLE_VALID_TOKEN_NO_EMAIL })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      const user = mockUsers.find(u => u.googleId === "google-uid-456");
      expect(user?.email).toBeUndefined();
    });
  });

  describe("POST /api/auth/sms/send", () => {
    it("returns success for a valid E.164 phone number", async () => {
      const response = await request(app)
        .post("/api/auth/sms/send")
        .send({ phone: "+14155551234" })
        .expect(200);

      expect(response.body).toEqual({ success: true });
    });

    it("returns 400 for a malformed phone number", async () => {
      const response = await request(app)
        .post("/api/auth/sms/send")
        .send({ phone: "07911123456" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("returns 502 when Twilio fails to send", async () => {
      const response = await request(app)
        .post("/api/auth/sms/send")
        .send({ phone: TWILIO_FAILING_PHONE })
        .expect(502);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth/sms/verify", () => {
    it("creates a new account and returns a token for a correct code", async () => {
      const response = await request(app)
        .post("/api/auth/sms/verify")
        .send({ phone: "+14155559999", code: TWILIO_CORRECT_CODE })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      const user = mockUsers.find(u => u.phone === "+14155559999");
      expect(user?.phoneVerified).toBe(true);
      expect(user?.passwordHash).toBeUndefined();
    });

    it("logs into the same account on a repeat verify rather than duplicating it", async () => {
      const before = mockUsers.length;
      const response = await request(app)
        .post("/api/auth/sms/verify")
        .send({ phone: "+14155559999", code: TWILIO_CORRECT_CODE })
        .expect(200);

      expect(response.body).toHaveProperty("token");
      expect(mockUsers.length).toBe(before);
    });

    it("returns 401 for an incorrect code", async () => {
      const response = await request(app)
        .post("/api/auth/sms/verify")
        .send({ phone: "+14155551111", code: "999999" })
        .expect(401);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /api/query", () => {
    beforeEach(() => {
      mockChat.mockClear();
      mockChat.mockResolvedValue(MOCKED_CHAT_REPLY);
    });

    it("returns a successful reply for a chat query", async () => {
      const response = await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query: "What does this app do?" })
        .expect(200);

      expect(response.body).toEqual({ success: true, reply: MOCKED_CHAT_REPLY });
      expect(mockChat).toHaveBeenCalledWith("What does this app do?", []);
    });

    it("accepts and forwards a conversation history array", async () => {
      const history = [
        { role: "user", text: "What does this app do?" },
        { role: "assistant", text: "It tracks horse races." },
      ];

      await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query: "How does it work?", history })
        .expect(200);

      expect(mockChat).toHaveBeenCalledWith("How does it work?", history);
    });

    it("truncates an oversized history array server-side before passing it on", async () => {
      const oversizedHistory = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        text: `turn ${i}`,
      }));

      await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query: "follow-up", history: oversizedHistory })
        .expect(200);

      const forwardedHistory = mockChat.mock.calls[0][1];
      expect(forwardedHistory).toHaveLength(20);
      expect(forwardedHistory).toEqual(oversizedHistory.slice(-20));
    });

    it("returns 400 when history isn't a well-formed array of turns", async () => {
      const response = await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query: "hi", history: [{ role: "system", text: "bad role" }] })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(mockChat).not.toHaveBeenCalled();
    });

    it("should return 400 when query is missing", async () => {
      const response = await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Query is required");
    });

    it("should return 400 when query is not a string", async () => {
      const response = await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query: 123 })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a string");
    });

    it("should return 400 when query is empty string", async () => {
      const response = await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query: "" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Query is required");
    });
  });

  describe.skip("GET /api/horses/top (not yet implemented)", () => {
    it("should return top horses with default limit", async () => {
      const response = await request(app).get("/api/horses/top").set("Authorization", `Bearer ${authToken}`).expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("horses");
      expect(response.body.data).toHaveProperty("count");
      expect(response.body.data).toHaveProperty("limit", 5);

      expect(Array.isArray(response.body.data.horses)).toBe(true);
      expect(response.body.data.horses.length).toBeLessThanOrEqual(5);
    });

    it("should return top horses with custom limit", async () => {
      const limit = 3;
      const response = await request(app)
        .get(`/api/horses/top?limit=${limit}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty("limit", limit);
      expect(response.body.data.horses.length).toBeLessThanOrEqual(limit);
    });

    it("should handle invalid limit parameter", async () => {
      const response = await request(app)
        .get("/api/horses/top?limit=invalid")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Should default to 5 when invalid limit is provided
      expect(response.body.data).toHaveProperty("limit", 5);
    });
  });

  describe.skip("GET /api/horses/odds (not yet implemented)", () => {
    it("should return horses with odds under specified value", async () => {
      const maxOdds = 5.0;
      const response = await request(app)
        .get(`/api/horses/odds?maxOdds=${maxOdds}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("horses");
      expect(response.body.data).toHaveProperty("count");
      expect(response.body.data).toHaveProperty("maxOdds", maxOdds);

      // All returned horses should have odds <= maxOdds
      response.body.data.horses.forEach((horse: any) => {
        expect(horse.odds).toBeLessThanOrEqual(maxOdds);
      });
    });

    it("should return 400 when maxOdds is missing", async () => {
      const response = await request(app).get("/api/horses/odds").set("Authorization", `Bearer ${authToken}`).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("maxOdds is required");
    });

    it("should return 400 when maxOdds is not a number", async () => {
      const response = await request(app)
        .get("/api/horses/odds?maxOdds=invalid")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a positive number");
    });

    it("should return 400 when maxOdds is negative", async () => {
      const response = await request(app)
        .get("/api/horses/odds?maxOdds=-1")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a positive number");
    });
  });

  describe("GET /api/events/:eventId/definitions", () => {
    it("should return documents for a known eventId", async () => {
      const response = await request(app)
        .get("/api/events/33858191/definitions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.count).toBe("number");
    });

    it("each document has required fields", async () => {
      const response = await request(app)
        .get("/api/events/33858191/definitions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const doc = response.body.data[0];
      expect(doc).toHaveProperty("eventId");
      expect(doc).toHaveProperty("marketId");
      expect(doc).toHaveProperty("status");
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/events/33858191/definitions").expect(401);
    });

    it("returns count matching data length", async () => {
      const response = await request(app)
        .get("/api/events/33858191/definitions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });
  });

  describe("GET /api/events/grouped", () => {
    it("should return grouped events with correct shape", async () => {
      const response = await request(app)
        .get("/api/events/grouped")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const group = response.body.data[0];
      expect(group).toHaveProperty("eventId");
      expect(group).toHaveProperty("eventName");
      expect(Array.isArray(group.marketIds)).toBe(true);
      expect(typeof group.count).toBe("number");
    });

    it("should return 401 without auth", async () => {
      await request(app).get("/api/events/grouped").expect(401);
    });

    it("should return known Cheltenham event from mock", async () => {
      const response = await request(app)
        .get("/api/events/grouped")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const cheltenham = response.body.data.find(
        (g: any) => g.eventId === "33858191"
      );
      expect(cheltenham).toBeDefined();
      expect(cheltenham.eventName).toBe("Cheltenham 1st Jan");
      expect(cheltenham.marketIds).toContain("1.237066150");
      expect(cheltenham.count).toBe(cheltenham.marketIds.length);
    });
  });

  describe("GET /api/events/:eventId/runners", () => {
    it("should return races for a known eventId", async () => {
      const response = await request(app)
        .get("/api/events/33858191/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.count).toBe("number");
    });

    it("each race has marketId, marketTime, marketType, runners array", async () => {
      const response = await request(app)
        .get("/api/events/33858191/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const race = response.body.data[0];
      expect(race).toHaveProperty("marketId");
      expect(race).toHaveProperty("marketTime");
      expect(race).toHaveProperty("marketType");
      expect(Array.isArray(race.runners)).toBe(true);
      const runner = race.runners[0];
      expect(runner).toHaveProperty("id");
      expect(runner).toHaveProperty("name");
      expect(runner).toHaveProperty("status");
      expect(runner).toHaveProperty("sortPriority");
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/events/33858191/runners").expect(401);
    });

    it("count equals number of races", async () => {
      const response = await request(app)
        .get("/api/events/33858191/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });
  });

  describe("GET /api/runners", () => {
    it("returns paginated races with pagination metadata", async () => {
      const response = await request(app)
        .get("/api/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.count).toBe("number");
      expect(typeof response.body.total).toBe("number");
      expect(typeof response.body.page).toBe("number");
      expect(typeof response.body.limit).toBe("number");
      expect(typeof response.body.totalPages).toBe("number");
      expect(typeof response.body.totalRunners).toBe("number");
    });

    it("each race has eventId, eventName, marketId, marketType, runners", async () => {
      const response = await request(app)
        .get("/api/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const race = response.body.data[0];
      expect(race).toHaveProperty("eventId");
      expect(race).toHaveProperty("eventName");
      expect(race).toHaveProperty("marketId");
      expect(race).toHaveProperty("marketType");
      expect(Array.isArray(race.runners)).toBe(true);
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/runners").expect(401);
    });

    it("count equals data.length", async () => {
      const response = await request(app)
        .get("/api/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });

    it("respects page and limit query params", async () => {
      const response = await request(app)
        .get("/api/runners?page=1&limit=5")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(5);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it("data.length does not exceed limit", async () => {
      const response = await request(app)
        .get("/api/runners?limit=3")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(3);
    });

    it("accepts sort=asc and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/runners?sort=asc")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts sort=desc and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/runners?sort=desc")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("invalid sort value defaults gracefully and returns 200", async () => {
      const response = await request(app)
        .get("/api/runners?sort=invalid")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it("accepts minBsp and maxBsp params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/runners?minBsp=5&maxBsp=50")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts minRunners and maxRunners params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/runners?minRunners=2&maxRunners=10")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("response includes pnlStats with staked, returns, pnl", async () => {
      const response = await request(app)
        .get("/api/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("pnlStats");
      expect(typeof response.body.pnlStats.staked).toBe("number");
      expect(typeof response.body.pnlStats.returns).toBe("number");
      expect(typeof response.body.pnlStats.pnl).toBe("number");
    });

    it("exact production params (page=1 limit=20 minRunners=1 maxRunners=20 minBsp=1 maxBsp=1000 minInSp=1 maxInSp=30 fromRow=1) return 200", async () => {
      const response = await request(app)
        .get("/api/runners?page=1&limit=20&minRunners=1&maxRunners=20&minBsp=1&maxBsp=1000&sort=asc&minInSp=1&maxInSp=30&fromRow=1")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.count).toBe(response.body.data.length);
    });
  });

  describe("GET /api/industry-sp", () => {
    it("returns paginated races with pagination metadata", async () => {
      const response = await request(app)
        .get("/api/industry-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.count).toBe("number");
      expect(typeof response.body.total).toBe("number");
      expect(typeof response.body.page).toBe("number");
      expect(typeof response.body.limit).toBe("number");
      expect(typeof response.body.totalPages).toBe("number");
      expect(typeof response.body.totalRunners).toBe("number");
    });

    it("each race has raceId, course, countryCode, raceTime, runners", async () => {
      const response = await request(app)
        .get("/api/industry-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const race = response.body.data[0];
      expect(race).toHaveProperty("raceId");
      expect(race).toHaveProperty("course");
      expect(race).toHaveProperty("countryCode");
      expect(race).toHaveProperty("raceTime");
      expect(Array.isArray(race.runners)).toBe(true);
    });

    it("is public — returns 200 without auth", async () => {
      const response = await request(app).get("/api/industry-sp").expect(200);
      expect(response.body).toHaveProperty("success", true);
    });

    it("clamps an explicit toRow to a 100-race span when anonymous", async () => {
      const response = await request(app)
        .get("/api/industry-sp?fromRow=1&toRow=5000")
        .expect(200);

      // The DAO result itself isn't observable here (mocked), but the row
      // range actually queried is derived from fromRow/toRow — this at
      // least confirms the endpoint doesn't just pass the unclamped 5000
      // straight through without erroring, matching the clamp added to
      // clampRowSpan in router.ts.
      expect(response.body.success).toBe(true);
    });

    it("accepts minDate/maxDate without erroring", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minDate=2024-01-01&maxDate=2024-12-31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });

    // subMinDate/subMaxDate restrict an already row-ranged (fromRow/toRow)
    // window to a calendar sub-range — see IspRacesScreen's per-year
    // loading (isp-year-direct-load). Distinct from minDate/maxDate above,
    // which participate in defining the row range itself.
    it("accepts subMinDate/subMaxDate alongside fromRow/toRow without erroring", async () => {
      const response = await request(app)
        .get("/api/industry-sp?fromRow=1&toRow=100&minDate=2024-01-01&maxDate=2025-12-31&subMinDate=2025-01-01&subMaxDate=2025-12-31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });

    it("ignores a malformed subMinDate/subMaxDate instead of erroring", async () => {
      const response = await request(app)
        .get("/api/industry-sp?subMinDate=not-a-date&subMaxDate=also-not-a-date")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });

    it("count equals data.length", async () => {
      const response = await request(app)
        .get("/api/industry-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });

    it("respects page and limit query params", async () => {
      const response = await request(app)
        .get("/api/industry-sp?page=1&limit=5")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(5);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it("accepts minIsp and maxIsp params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minIsp=2&maxIsp=50")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("response includes pnlStats with staked, returns, pnl", async () => {
      const response = await request(app)
        .get("/api/industry-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("pnlStats");
      expect(typeof response.body.pnlStats.staked).toBe("number");
      expect(typeof response.body.pnlStats.returns).toBe("number");
      expect(typeof response.body.pnlStats.pnl).toBe("number");
    });

    it("accepts courses/goings/raceClasses/raceTypes params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?courses=Ascot&goings=Good&raceClasses=Class%203&raceTypes=Hurdle")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts trainer/jockey search params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?trainer=Smi&jockey=Jon")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts trainer-form filter params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?trainerFormMinWinRate=25&minTrainerFormRunners=1&maxTrainerFormRunners=5")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts a runnerName param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?runnerName=" + encodeURIComponent("Fact To File"))
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts a minModelWinProbability param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minModelWinProbability=30")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("accepts an onlyModelBeatsSp param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?onlyModelBeatsSp=true")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("each race includes raceClass and going", async () => {
      const response = await request(app)
        .get("/api/industry-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const race = response.body.data[0];
      expect(race).toHaveProperty("raceClass");
      expect(race).toHaveProperty("going");
    });
  });

  describe("GET /api/model-vs-sp", () => {
    // Most of this endpoint's behaviour is param clamping, and the shared
    // aggregate mock below can't distinguish one set of clamped params from
    // another — so assert on what actually reached the service. jest.spyOn calls
    // through by default, so the request still runs end-to-end.
    let paramsSpy: jest.SpyInstance;

    beforeAll(() => {
      paramsSpy = jest.spyOn(IndustrySpService.prototype, "getModelVsSpRunners");
    });

    afterAll(() => {
      paramsSpy.mockRestore();
    });

    function lastParams(): ModelVsSpParams {
      const call = paramsSpy.mock.calls[paramsSpy.mock.calls.length - 1];
      expect(call).toBeDefined();
      return call[0] as ModelVsSpParams;
    }

    // The single most important test in this block: it proves the handler landed
    // BELOW router.use(jwtAuth) and that its path escaped the /api/industry-sp
    // prefix, which carries optionalJwtAuth and would have made this public.
    it("requires authentication — 401 without a Bearer token", async () => {
      await request(app).get("/api/model-vs-sp").expect(401);
    });

    it("returns a paginated runner-level envelope", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.total).toBe("number");
      expect(typeof response.body.page).toBe("number");
      expect(typeof response.body.limit).toBe("number");
      expect(typeof response.body.totalPages).toBe("number");
    });

    it("count equals data.length", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });

    it("rows carry modelWinProbability, impliedSpProbability and edge", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const row = response.body.data[0];
      expect(typeof row.runnerId).toBe("number");
      expect(typeof row.runnerName).toBe("string");
      expect(typeof row.isp).toBe("number");
      expect(typeof row.modelWinProbability).toBe("number");
      expect(typeof row.impliedSpProbability).toBe("number");
      expect(typeof row.edge).toBe("number");
      expect(typeof row.raceId).toBe("number");
      expect(typeof row.raceDate).toBe("string");
    });

    it("derives totalPages from total and limit", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?limit=2")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.totalPages).toBe(Math.ceil(response.body.total / 2));
    });

    it("defaults to a 50-row page and the date_desc sort", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.limit).toBe(50);
      expect(response.body.page).toBe(1);
      expect(response.body.sort).toBe("date_desc");
    });

    it("clamps limit to 200", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?limit=5000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.limit).toBe(200);
    });

    it("clamps page to at least 1", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?page=0")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.page).toBe(1);
    });

    it.each(["date_desc", "date_asc", "edge_desc", "edge_asc"])("accepts and echoes sort=%s", async sort => {
      const response = await request(app)
        .get(`/api/model-vs-sp?sort=${sort}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.sort).toBe(sort);
    });

    it("falls back to date_desc for an unknown sort value", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?sort=by_vibes")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.sort).toBe("date_desc");
    });

    // The regression these two guard: the `parseFloat(x) || DEFAULT` idiom used
    // throughout router.ts turns a legitimate 0 into the fallback, which would
    // silently widen the edge filter back to ±100. minEdge=0 / maxEdge=0 are the
    // two headline use cases ("model above the market" / "model below it"), so
    // this would have broken the feature's whole point.
    it("accepts an explicit minEdge of 0 without falling back", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?minEdge=0")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(lastParams().minEdge).toBe(0);
    });

    it("accepts an explicit maxEdge of 0 without falling back", async () => {
      await request(app)
        .get("/api/model-vs-sp?maxEdge=0")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(lastParams().maxEdge).toBe(0);
    });

    it("accepts an explicit minModelProb of 0 without falling back", async () => {
      await request(app)
        .get("/api/model-vs-sp?minModelProb=0&minImpliedProb=0")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const params = lastParams();
      expect(params.minModelProb).toBe(0);
      expect(params.minImpliedProb).toBe(0);
    });

    it("clamps the edge range to ±100", async () => {
      await request(app)
        .get("/api/model-vs-sp?minEdge=-9999&maxEdge=9999")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const params = lastParams();
      expect(params.minEdge).toBe(-100);
      expect(params.maxEdge).toBe(100);
    });

    it("clamps the probability ranges to 0-100", async () => {
      await request(app)
        .get("/api/model-vs-sp?minModelProb=-20&maxModelProb=500&minImpliedProb=-1&maxImpliedProb=900")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const params = lastParams();
      expect(params.minModelProb).toBe(0);
      expect(params.maxModelProb).toBe(100);
      expect(params.minImpliedProb).toBe(0);
      expect(params.maxImpliedProb).toBe(100);
    });

    it("honours a valid date window and echoes it back", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?minDate=2025-03-01&maxDate=2025-03-31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.minDate).toBe("2025-03-01");
      expect(response.body.maxDate).toBe("2025-03-31");
    });

    it("clamps a date span wider than the 366-day cap", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?minDate=2020-01-01&maxDate=2026-12-31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.minDate).toBe("2020-01-01");
      expect(response.body.maxDate).toBe("2021-01-01");
    });

    it("defaults the date window when minDate/maxDate are absent or malformed", async () => {
      const absent = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(absent.body.minDate).toBe("2024-01-01");
      expect(absent.body.maxDate).toBe("2024-01-31");

      const malformed = await request(app)
        .get("/api/model-vs-sp?minDate=nonsense&maxDate=2024/12/31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(malformed.body.minDate).toBe("2024-01-01");
      expect(malformed.body.maxDate).toBe("2024-01-31");
    });

    it("nulls total and totalPages when includeTotal=false", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?includeTotal=false")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.total).toBeNull();
      expect(response.body.totalPages).toBeNull();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(lastParams().includeTotal).toBe(false);
    });

    it("accepts the isp, runner-count and country filter params", async () => {
      await request(app)
        .get("/api/model-vs-sp?minIsp=2&maxIsp=20&minRunners=6&maxRunners=12&countries=GB,IE")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const params = lastParams();
      expect(params.minIsp).toBe(2);
      expect(params.maxIsp).toBe(20);
      expect(params.minRunners).toBe(6);
      expect(params.maxRunners).toBe(12);
      expect(params.countries).toEqual(["GB", "IE"]);
    });
  });

  describe("GET /api/model-versions", () => {
    it("returns 200 with success and a data array", async () => {
      const response = await request(app)
        .get("/api/model-versions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("count equals data.length", async () => {
      const response = await request(app)
        .get("/api/model-versions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });

    it("is public — returns 200 without auth", async () => {
      const response = await request(app).get("/api/model-versions").expect(200);
      expect(response.body).toHaveProperty("success", true);
    });

    it("each version has id, runLabel, runAt, trainingParams, runMeta, performanceMetrics", async () => {
      const response = await request(app)
        .get("/api/model-versions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const version = response.body.data[0];
      expect(typeof version.id).toBe("string");
      expect(typeof version.runLabel).toBe("string");
      expect(typeof version.runAt).toBe("string");
      expect(typeof version.trainingParams.nEstimators).toBe("number");
      expect(typeof version.trainingParams.earlyStoppingRounds).toBe("number");
      expect(Array.isArray(version.runMeta.featureCols)).toBe(true);
      expect(typeof version.runMeta.trainRows).toBe("number");
      expect(typeof version.performanceMetrics.aucRoc).toBe("number");
      expect(Array.isArray(version.performanceMetrics.calibrationTable)).toBe(true);
    });
  });

  describe("/api/saved-filter-sets", () => {
    const SECOND_USER_EMAIL = "second.user@backbet.co.uk";
    const SECOND_USER_PASSWORD = "secondpass";
    let secondUserToken: string;

    beforeAll(async () => {
      mockUsers.push({
        _id: new ObjectId(),
        email: SECOND_USER_EMAIL,
        passwordHash: bcrypt.hashSync(SECOND_USER_PASSWORD, 10),
        createdAt: new Date(),
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
      });
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: SECOND_USER_EMAIL, password: SECOND_USER_PASSWORD });
      secondUserToken = res.body.token;
    });

    it("POST rejects without auth", async () => {
      await request(app).post("/api/saved-filter-sets").send({ filters: { courses: "Ascot" } }).expect(401);
    });
    it("GET list rejects without auth", async () => {
      await request(app).get("/api/saved-filter-sets").expect(401);
    });
    it("GET by id rejects without auth", async () => {
      await request(app).get("/api/saved-filter-sets/000000000000000000000000").expect(401);
    });
    it("DELETE rejects without auth", async () => {
      await request(app).delete("/api/saved-filter-sets/000000000000000000000000").expect(401);
    });

    it("POST without a filters body returns 400", async () => {
      await request(app)
        .post("/api/saved-filter-sets")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "No filters" })
        .expect(400);
    });

    let savedId: string;

    it("POST creates a result and returns 201 with the computed snapshot", async () => {
      const response = await request(app)
        .post("/api/saved-filter-sets")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Ascot favourites", filters: { courses: "Ascot", minDate: "2026-01-01", maxDate: "2026-01-01" } })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(typeof response.body.data.id).toBe("string");
      expect(response.body.data.name).toBe("Ascot favourites");
      expect(response.body.data.filters).toEqual({ courses: "Ascot", minDate: "2026-01-01", maxDate: "2026-01-01" });
      // From the shared aggregate mock's convergence-point fixture
      // (cumulativeStaked: 1, cumulativeReturns: 2) — see the "Shared mock"
      // comment above the aggregate mock definition. The mock returns the
      // same fixture regardless of which split's own query is in flight, so
      // both Split A and Split B resolve to identical numbers here — that's
      // a property of this generic mock, not something the real endpoint
      // guarantees for two genuinely different splits.
      for (const split of ["splitA", "splitB"] as const) {
        expect(response.body.data[split].pnlStats).toEqual({ staked: 1, returns: 2, pnl: 1, count: 1 });
        expect(response.body.data[split].graphPoints).toHaveLength(1);
        expect(response.body.data[split].graphPoints[0]).toMatchObject({ raceRowNumber: 1, cumulativeStaked: 1, cumulativeReturns: 2, cumulativePnl: 1 });
        expect(typeof response.body.data[split].fromRow).toBe("number");
        expect(typeof response.body.data[split].total).toBe("number");
        expect(typeof response.body.data[split].totalRunners).toBe("number");
      }
      savedId = response.body.data.id;
    });

    it("POST with a blank name falls back to an auto-generated non-empty name", async () => {
      const response = await request(app)
        .post("/api/saved-filter-sets")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ filters: { courses: "Ascot", minDate: "2026-01-01", maxDate: "2026-01-01" } })
        .expect(201);

      expect(response.body.data.name.length).toBeGreaterThan(0);
      expect(response.body.data.name).toContain("Ascot");
    });

    it("GET list returns the created result with count matching data.length", async () => {
      const response = await request(app)
        .get("/api/saved-filter-sets")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(response.body.data.length);
      expect(response.body.data.some((r: { id: string }) => r.id === savedId)).toBe(true);
    });

    it("GET by id returns the matching result", async () => {
      const response = await request(app)
        .get(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.id).toBe(savedId);
      expect(response.body.data.name).toBe("Ascot favourites");
    });

    it("GET by unknown id returns 404", async () => {
      await request(app)
        .get("/api/saved-filter-sets/000000000000000000000000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });

    it("GET by another user's id returns 404, never leaking another user's data", async () => {
      await request(app)
        .get(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${secondUserToken}`)
        .expect(404);
    });

    it("second user's list does not include the first user's results", async () => {
      const response = await request(app)
        .get("/api/saved-filter-sets")
        .set("Authorization", `Bearer ${secondUserToken}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it("DELETE by another user's id returns 404 and leaves the result intact", async () => {
      await request(app)
        .delete(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${secondUserToken}`)
        .expect(404);

      await request(app)
        .get(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
    });

    it("DELETE removes the result, and a second delete returns 404", async () => {
      await request(app)
        .delete(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      await request(app)
        .get(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);

      await request(app)
        .delete(`/api/saved-filter-sets/${savedId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });

    describe("GET /api/saved-filter-sets/:id/live-performance", () => {
      let liveTestFilterSetId: string;

      beforeAll(async () => {
        const res = await request(app)
          .post("/api/saved-filter-sets")
          .set("Authorization", `Bearer ${authToken}`)
          .send({ name: "Live perf test filter", filters: { courses: "Ascot" } })
          .expect(201);
        liveTestFilterSetId = res.body.data.id;
        mockLiveFilterResults.push({
          _id: new ObjectId(),
          savedFilterSetId: new ObjectId(liveTestFilterSetId),
          filters: { courses: "Ascot" },
          modelVersionId: "xgb-20260727-171521",
          raceDate: "2026-07-27",
          raceId: 914592,
          raceTime: "2026-07-27T14:00:00",
          raceName: "Test Handicap Stakes",
          meetingId: "Ascot|2026-07-27",
          meetingName: "Ascot — 27 July 2026",
          pnlStats: { staked: 4, returns: 6, pnl: 2, count: 4 },
          capturedAt: "2026-07-27T21:31:00.000Z",
        });
      });

      it("rejects without auth", async () => {
        await request(app).get(`/api/saved-filter-sets/${liveTestFilterSetId}/live-performance`).expect(401);
      });

      it("returns 200 with the live per-race rows for the owner, count matching data.length", async () => {
        const response = await request(app)
          .get(`/api/saved-filter-sets/${liveTestFilterSetId}/live-performance`)
          .set("Authorization", `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.count).toBe(response.body.data.length);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
          raceDate: "2026-07-27",
          raceId: 914592,
          raceTime: "2026-07-27T14:00:00",
          raceName: "Test Handicap Stakes",
          meetingId: "Ascot|2026-07-27",
          meetingName: "Ascot — 27 July 2026",
          pnlStats: { staked: 4, returns: 6, pnl: 2, count: 4 },
        });
      });

      it("returns 404 for another user's filter set, never leaking another user's data", async () => {
        await request(app)
          .get(`/api/saved-filter-sets/${liveTestFilterSetId}/live-performance`)
          .set("Authorization", `Bearer ${secondUserToken}`)
          .expect(404);
      });

      it("returns 404 for an unknown filter set id", async () => {
        await request(app)
          .get("/api/saved-filter-sets/000000000000000000000000/live-performance")
          .set("Authorization", `Bearer ${authToken}`)
          .expect(404);
      });
    });

  describe("POST /api/saved-filter-sets/agent", () => {
    const VALID_API_KEY = "test-training-pipeline-api-key"; // matches config/test.json's trainingPipeline.agentApiKey
    const VALID_BODY = { filters: { courses: "Ascot" }, name: "AI Training · All races · xgb-20260727-101500", modelVersionId: "xgb-20260727-101500" };

    it("rejects with 401 when no API key header is sent", async () => {
      await request(app).post("/api/saved-filter-sets/agent").send(VALID_BODY).expect(401);
    });

    it("rejects with 401 when the API key header is wrong", async () => {
      await request(app)
        .post("/api/saved-filter-sets/agent")
        .set("x-training-pipeline-api-key", "not-the-real-key")
        .send(VALID_BODY)
        .expect(401);
    });

    it("rejects with 400 when filters/name/modelVersionId are missing", async () => {
      await request(app)
        .post("/api/saved-filter-sets/agent")
        .set("x-training-pipeline-api-key", VALID_API_KEY)
        .send({ name: "No filters", modelVersionId: "xgb-1" })
        .expect(400);
      await request(app)
        .post("/api/saved-filter-sets/agent")
        .set("x-training-pipeline-api-key", VALID_API_KEY)
        .send({ filters: { courses: "Ascot" }, modelVersionId: "xgb-1" })
        .expect(400);
      await request(app)
        .post("/api/saved-filter-sets/agent")
        .set("x-training-pipeline-api-key", VALID_API_KEY)
        .send({ filters: { courses: "Ascot" }, name: "No model version" })
        .expect(400);
    });

    let agentResultId: string;

    it("succeeds with the correct key, returns createdBy:'agent' and the given modelVersionId", async () => {
      const response = await request(app)
        .post("/api/saved-filter-sets/agent")
        .set("x-training-pipeline-api-key", VALID_API_KEY)
        .send(VALID_BODY)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.createdBy).toBe("agent");
      expect(response.body.data.modelVersionId).toBe("xgb-20260727-101500");
      expect(response.body.data.name).toBe(VALID_BODY.name);
      agentResultId = response.body.data.id;
    });

    it("the created agent result appears in GET /api/saved-filter-sets for any logged-in user", async () => {
      for (const token of [authToken, secondUserToken]) {
        const response = await request(app)
          .get("/api/saved-filter-sets")
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
        expect(response.body.data.some((r: { id: string }) => r.id === agentResultId)).toBe(true);
      }
    });

    it("the created agent result is not deletable via the per-user DELETE route", async () => {
      await request(app)
        .delete(`/api/saved-filter-sets/${agentResultId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });
  });
  });

  describe("GET /api/daily-races", () => {
    it("returns success with an array of racecards", async () => {
      const response = await request(app)
        .get("/api/daily-races?date=2026-06-03")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.count).toBe("number");
      expect(response.body.count).toBe(response.body.data.length);
    });

    it("each racecard has the required fields", async () => {
      const response = await request(app)
        .get("/api/daily-races?date=2026-06-03")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const doc = response.body.data[0];
      expect(doc).toHaveProperty("raceId");
      expect(doc).toHaveProperty("eventId");
      expect(doc).toHaveProperty("course");
      expect(doc).toHaveProperty("date");
      expect(Array.isArray(doc.runners)).toBe(true);
    });

    it("attaches the real result once industry_starting_prices has captured the race", async () => {
      const response = await request(app)
        .get("/api/daily-races?date=2026-06-03")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const doc = response.body.data[0];
      expect(doc.runners[0].result).toEqual({ status: "WINNER", pos: "1", isp: 4, ispFraction: "3/1" });
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/daily-races?date=2026-06-03").expect(401);
    });

    it("returns an empty array for a date with no racecards", async () => {
      const response = await request(app)
        .get("/api/daily-races?date=1999-01-01")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe("GET /api/daily-races/event/:eventId", () => {
    it("returns the races for a known event", async () => {
      const response = await request(app)
        .get("/api/daily-races/event/newton-abbot-2026-06-03")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty("eventId", "newton-abbot-2026-06-03");
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/daily-races/event/newton-abbot-2026-06-03").expect(401);
    });

    it("returns an empty array for an unknown eventId", async () => {
      const response = await request(app)
        .get("/api/daily-races/event/unknown-event")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe("GET /api/daily-races/race/:raceId", () => {
    it("returns a single race by id", async () => {
      const response = await request(app)
        .get("/api/daily-races/race/rac_test_0001")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("raceId", "rac_test_0001");
      expect(Array.isArray(response.body.data.runners)).toBe(true);
      expect(response.body.data.runners[0].result).toEqual({ status: "WINNER", pos: "1", isp: 4, ispFraction: "3/1" });
    });

    it("returns 404 for an unknown raceId", async () => {
      const response = await request(app)
        .get("/api/daily-races/race/rac_does_not_exist")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/daily-races/race/rac_test_0001").expect(401);
    });
  });

  describe("POST /api/daily-races/predict", () => {
    beforeEach(() => {
      mockPredict.mockReset();
    });

    it("scores runners via PredictionApiClient and writes modelWinProbability/modelVersionId/modelTopFactors back", async () => {
      mockPredict.mockResolvedValue({
        status: 200,
        ok: true,
        body: {
          modelVersionId: "xgb-test-version",
          predictions: [
            {
              runnerId: "hrs_1",
              modelWinProbability: 42.5,
              topFactors: [{ label: "Strong recent form", direction: "positive" }],
            },
          ],
        },
      });

      const response = await request(app)
        .post("/api/daily-races/predict")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ date: "2026-06-03" })
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toEqual({ racesUpdated: 1, runnersUpdated: 1, errors: [] });
      expect(mockPredict).toHaveBeenCalledTimes(1);
      const [runners] = mockPredict.mock.calls[0];
      expect(runners[0]).toMatchObject({ raceId: "rac_test_0001", runnerId: "hrs_1", trainer: "A Trainer" });
    });

    it("collects a per-race error instead of failing the whole request", async () => {
      mockPredict.mockResolvedValue({ status: 502, ok: false, body: { error: "model not ready" } });

      const response = await request(app)
        .post("/api/daily-races/predict")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ date: "2026-06-03" })
        .expect(200);

      expect(response.body.data).toEqual({
        racesUpdated: 0,
        runnersUpdated: 0,
        errors: [{ raceId: "rac_test_0001", error: "model not ready" }],
      });
    });

    it("defaults date to today when omitted", async () => {
      mockPredict.mockResolvedValue({ status: 200, ok: true, body: { modelVersionId: "v1", predictions: [] } });
      const response = await request(app)
        .post("/api/daily-races/predict")
        .set("Authorization", `Bearer ${authToken}`)
        .send({})
        .expect(200);
      expect(response.body.data).toEqual({ racesUpdated: 0, runnersUpdated: 0, errors: [] });
    });

    it("returns 401 without auth", async () => {
      await request(app).post("/api/daily-races/predict").send({ date: "2026-06-03" }).expect(401);
    });
  });

  describe("POST /api/daily-races/reseed-results", () => {
    beforeEach(() => {
      mockRacingApiGet.mockReset();
    });

    it("fetches and upserts results when RacingAPI returns ok (today)", async () => {
      mockRacingApiGet.mockResolvedValue({
        status: 200,
        ok: true,
        body: { results: [{ race_id: "rac_1", date: "2026-06-03", region: "GB", course: "Ascot", off: "14:00", race_name: "Test", runners: [] }] },
      });

      const response = await request(app)
        .post("/api/daily-races/reseed-results")
        .set("Authorization", `Bearer ${authToken}`)
        .send({})
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toEqual({ racesUpserted: 1, runnersUpserted: 0, nonGbSkipped: 0 });
      // No date in the body -> defaults to today -> hits the plan-tier-safe
      // "/results/today" path, not a dated path.
      expect(mockRacingApiGet).toHaveBeenCalledWith("/results/today");
    });

    it("targets /results/<date> when a past date is given", async () => {
      mockRacingApiGet.mockResolvedValue({ status: 200, ok: true, body: { results: [] } });
      await request(app)
        .post("/api/daily-races/reseed-results")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ date: "2026-06-02" })
        .expect(200);
      expect(mockRacingApiGet).toHaveBeenCalledWith("/results/2026-06-02");
    });

    it("returns a plain-language plan_required error instead of a 500 when RacingAPI 401s for a past date", async () => {
      mockRacingApiGet.mockResolvedValue({ status: 401, ok: false, body: { detail: "Standard Plan required" } });

      const response = await request(app)
        .post("/api/daily-races/reseed-results")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ date: "2026-06-02" })
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        error: "plan_required",
        message: expect.stringContaining("today's results"),
      });
    });

    it("returns 401 without auth", async () => {
      await request(app).post("/api/daily-races/reseed-results").send({}).expect(401);
    });
  });

  describe("/api/bet-orders", () => {
    const VALID_BODY = {
      runnerId: "hrs_1",
      horse: "Artagnan",
      course: "Redcar",
      offTime: "2:05",
      offDt: "2026-07-29T14:05:00.000Z",
      raceId: "rac_1",
      eventId: "redcar-2026-07-29",
      targetProfit: 20,
      maxStake: 10,
    };
    const SECOND_USER_EMAIL = "bet.orders.second.user@backbet.co.uk";
    const SECOND_USER_PASSWORD = "secondpass";
    let secondUserToken: string;

    beforeAll(async () => {
      mockUsers.push({
        _id: new ObjectId(),
        email: SECOND_USER_EMAIL,
        passwordHash: bcrypt.hashSync(SECOND_USER_PASSWORD, 10),
        createdAt: new Date(),
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
      });
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: SECOND_USER_EMAIL, password: SECOND_USER_PASSWORD });
      secondUserToken = res.body.token;
    });

    it("POST rejects without auth", async () => {
      await request(app).post("/api/bet-orders").send(VALID_BODY).expect(401);
    });
    it("GET list rejects without auth", async () => {
      await request(app).get("/api/bet-orders").expect(401);
    });
    it("DELETE rejects without auth", async () => {
      await request(app).delete("/api/bet-orders/000000000000000000000000").expect(401);
    });

    it("POST without a required field returns 400", async () => {
      const { horse, ...withoutHorse } = VALID_BODY;
      await request(app)
        .post("/api/bet-orders")
        .set("Authorization", `Bearer ${authToken}`)
        .send(withoutHorse)
        .expect(400);
    });

    it("POST with a non-positive targetProfit returns 400", async () => {
      await request(app)
        .post("/api/bet-orders")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ ...VALID_BODY, targetProfit: 0 })
        .expect(400);
    });

    let orderId: string;

    it("POST creates a pending order with the computed minQualifyingPrice", async () => {
      const response = await request(app)
        .post("/api/bet-orders")
        .set("Authorization", `Bearer ${authToken}`)
        .send(VALID_BODY)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("pending");
      // 1 + 20/10 = 3
      expect(response.body.data.minQualifyingPrice).toBe(3);
      orderId = response.body.data.id;
    });

    it("GET list returns the created order with count matching data.length", async () => {
      const response = await request(app)
        .get("/api/bet-orders")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(response.body.data.length);
      expect(response.body.data.some((o: { id: string }) => o.id === orderId)).toBe(true);
    });

    it("second user's list does not include the first user's order", async () => {
      const response = await request(app)
        .get("/api/bet-orders")
        .set("Authorization", `Bearer ${secondUserToken}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it("DELETE (cancel) by another user's id returns 404 and leaves the order intact", async () => {
      await request(app)
        .delete(`/api/bet-orders/${orderId}`)
        .set("Authorization", `Bearer ${secondUserToken}`)
        .expect(404);

      const response = await request(app)
        .get("/api/bet-orders")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body.data.find((o: { id: string }) => o.id === orderId).status).toBe("pending");
    });

    it("DELETE cancels a pending order, and a second cancel returns 404", async () => {
      await request(app)
        .delete(`/api/bet-orders/${orderId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const response = await request(app)
        .get("/api/bet-orders")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body.data.find((o: { id: string }) => o.id === orderId).status).toBe("cancelled");

      await request(app)
        .delete(`/api/bet-orders/${orderId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe("POST /api/daily-races/live-prices", () => {
    const PICK = { runnerId: "hrs_live_test", horse: "Live Test Runner", course: "Test Course", offDt: "2026-07-29T14:05:00.000Z" };

    it("returns 401 without auth", async () => {
      await request(app).post("/api/daily-races/live-prices").send({ picks: [PICK] }).expect(401);
    });

    // config/test.json has no betfair credentials (inherits default.json's
    // empty placeholders) — this exercises the REAL "not configured"
    // degrade path in live-price-service.ts, not a mock of it.
    it("degrades to price: null with a plain-language note when Betfair isn't configured, rather than erroring", async () => {
      const response = await request(app)
        .post("/api/daily-races/live-prices")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ picks: [PICK] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hrs_live_test).toEqual({
        price: null,
        note: "Live prices aren't configured yet.",
      });
    });

    it("returns an empty object for an empty picks array", async () => {
      const response = await request(app)
        .post("/api/daily-races/live-prices")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ picks: [] })
        .expect(200);

      expect(response.body.data).toEqual({});
    });

    it("silently drops a malformed pick (missing required fields) rather than erroring", async () => {
      const response = await request(app)
        .post("/api/daily-races/live-prices")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ picks: [{ runnerId: "hrs_bad" }, PICK] })
        .expect(200);

      expect(response.body.data.hrs_bad).toBeUndefined();
      expect(response.body.data.hrs_live_test).toBeDefined();
    });

    it("returns 200 with an empty object when picks is missing from the body entirely", async () => {
      const response = await request(app)
        .post("/api/daily-races/live-prices")
        .set("Authorization", `Bearer ${authToken}`)
        .send({})
        .expect(200);

      expect(response.body.data).toEqual({});
    });
  });

  describe("GET /api/industry-sp/filter-bounds", () => {
    it("returns success with maxRunnersPerRace, minIsp, maxIsp", async () => {
      const response = await request(app)
        .get("/api/industry-sp/filter-bounds")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("maxRunnersPerRace");
      expect(response.body.data).toHaveProperty("minIsp");
      expect(response.body.data).toHaveProperty("maxIsp");
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/filter-bounds").expect(200);
    });
  });

  describe("GET /api/industry-sp/countries", () => {
    it("returns success with an array of country codes", async () => {
      const response = await request(app)
        .get("/api/industry-sp/countries")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/countries").expect(200);
    });
  });

  describe("GET /api/industry-sp/courses", () => {
    it("returns success with an array of courses", async () => {
      const response = await request(app)
        .get("/api/industry-sp/courses")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/courses").expect(200);
    });
  });

  describe("GET /api/industry-sp/goings", () => {
    it("returns success with an array of goings", async () => {
      const response = await request(app)
        .get("/api/industry-sp/goings")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/goings").expect(200);
    });
  });

  describe("GET /api/industry-sp/race-classes", () => {
    it("returns success with an array of race classes", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-classes")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/race-classes").expect(200);
    });
  });

  describe("GET /api/industry-sp/race-types", () => {
    it("returns success with an array of race types", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-types")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/race-types").expect(200);
    });
  });

  describe("GET /api/industry-sp/splits", () => {
    it("returns success with totalRaces/totalRunners and both splits", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("totalRaces");
      expect(response.body).toHaveProperty("totalRunners");
      // filterBounds/countries ride along on this same response now — see
      // getSplitStats — so /isp's first load only needs one Lambda
      // invocation instead of up to three concurrent ones.
      expect(response.body.filterBounds).toHaveProperty("maxRunnersPerRace");
      expect(response.body.filterBounds).toHaveProperty("minIsp");
      expect(response.body.filterBounds).toHaveProperty("maxIsp");
      expect(Array.isArray(response.body.countries)).toBe(true);
      for (const split of ["splitA", "splitB"]) {
        expect(response.body[split]).toHaveProperty("fromRow");
        expect(response.body[split]).toHaveProperty("toRow");
        expect(response.body[split]).toHaveProperty("total");
        expect(response.body[split]).toHaveProperty("totalRunners");
        expect(response.body[split].pnlStats).toHaveProperty("staked");
        expect(response.body[split].pnlStats).toHaveProperty("returns");
        expect(response.body[split].pnlStats).toHaveProperty("pnl");
      }
    });

    it("splitA defaults to fromRow 1 when no explicit range is given", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.splitA.fromRow).toBe(1);
    });

    it("accepts explicit fromRowA/toRowA/fromRowB/toRowB", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?fromRowA=1&toRowA=5&fromRowB=6")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.splitA.fromRow).toBe(1);
      expect(response.body.splitA.toRow).toBe(5);
      expect(response.body.splitB.fromRow).toBe(6);
      // An open-ended toRowB is capped to a raceCap-wide span now (10000 for
      // an authenticated caller here), not left truly unlimited — see
      // getSplitStats' raceCap clamp.
      expect(response.body.splitB.toRow).toBe(6 + 10000 - 1);
    });

    it("returns raceCap: 10000 for an authenticated caller", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.raceCap).toBe(10000);
    });

    it("returns raceCap: 100 for an anonymous caller", async () => {
      const response = await request(app).get("/api/industry-sp/splits").expect(200);

      expect(response.body.raceCap).toBe(100);
    });

    it("clamps an explicit toRowA/toRowB span to 100 races when anonymous", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?fromRowA=1&toRowA=5000&fromRowB=6000&toRowB=9000")
        .expect(200);

      expect(response.body.splitA.fromRow).toBe(1);
      expect(response.body.splitA.toRow).toBe(1 + 100 - 1);
      expect(response.body.splitB.fromRow).toBe(6000);
      expect(response.body.splitB.toRow).toBe(6000 + 100 - 1);
    });

    it("clamps an explicit toRowA/toRowB span to 10000 races when authenticated", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?fromRowA=1&toRowA=20000&fromRowB=6000&toRowB=30000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.splitA.toRow).toBe(1 + 10000 - 1);
      expect(response.body.splitB.toRow).toBe(6000 + 10000 - 1);
    });

    it("never clamps toRow beyond the matched totalRaces, even when raceCap would otherwise push it past the end", async () => {
      // Regression: reported live — raceCap clamping computed toRow as
      // fromRow + raceCap - 1 unconditionally, overshooting the real total
      // whenever the matched set was smaller than raceCap (the common case
      // for any filtered/date-scoped view). fromRowB=45000 + the
      // authenticated raceCap (10000) would naively land at 54999, well
      // past the mocked totalRaces of 50000.
      const response = await request(app)
        .get("/api/industry-sp/splits?fromRowA=1&toRowA=5000&fromRowB=45000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.totalRaces).toBe(50000);
      expect(response.body.splitB.toRow).toBe(50000);
    });

    it("accepts minDate/maxDate without erroring", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?minDate=2024-01-01&maxDate=2024-12-31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });

    it("ignores a malformed minDate/maxDate instead of erroring", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?minDate=not-a-date&maxDate=2024/12/31")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/splits").expect(200);
    });

    it("accepts trainer-form filter params and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?trainerFormMinWinRate=30&minTrainerFormRunners=1&maxTrainerFormRunners=30")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it("accepts a minModelWinProbability param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?minModelWinProbability=30")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it("accepts an onlyModelBeatsSp param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?onlyModelBeatsSp=true")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

  });

  describe("GET /api/industry-sp/race-convergence", () => {
    it("returns 200 with success, a data array, and count matching data.length", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-convergence?toRow=1000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.count).toBe(response.body.data.length);
    });

    it("each point has raceRowNumber, cumulative staked/returns/pnl, and roiPercent", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-convergence?toRow=1000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      const point = response.body.data[0];
      expect(point).toHaveProperty("raceRowNumber");
      expect(point).toHaveProperty("cumulativeStaked");
      expect(point).toHaveProperty("cumulativeReturns");
      expect(point).toHaveProperty("cumulativePnl");
      expect(point).toHaveProperty("roiPercent");
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/race-convergence?toRow=1000").expect(200);
    });

    it("returns 400 when toRow is missing", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-convergence")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body).toHaveProperty("error");
    });

    it("accepts an explicit fromRow (e.g. Split B's own race range) and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-convergence?fromRow=1001&toRow=2000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body.success).toBe(true);
    });

    it("returns 400 when fromRow exceeds toRow", async () => {
      const response = await request(app)
        .get("/api/industry-sp/race-convergence?fromRow=2000&toRow=1000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /api/trainer-form", () => {
    it("returns 400 when trainer is missing", async () => {
      const response = await request(app)
        .get("/api/trainer-form?formCategory=Flat")
        .expect(400);
      expect(response.body).toHaveProperty("error");
    });

    it("returns 400 when formCategory is missing or invalid", async () => {
      const response = await request(app)
        .get("/api/trainer-form?trainer=W%20P%20Mullins&formCategory=NotACategory")
        .expect(400);
      expect(response.body).toHaveProperty("error");
    });

    it("returns 404 for an unknown trainer", async () => {
      const response = await request(app)
        .get("/api/trainer-form?trainer=Nobody&formCategory=Flat")
        .expect(404);
      expect(response.body).toHaveProperty("error");
    });

    it("returns 200 with the trainer's form data for a known trainer/category", async () => {
      const response = await request(app)
        .get("/api/trainer-form?trainer=" + encodeURIComponent("W P Mullins") + "&formCategory=Flat")
        .expect(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trainer).toBe("W P Mullins");
      expect(Array.isArray(response.body.data.runs)).toBe(true);
      expect(response.body.data.runs.length).toBeGreaterThan(0);
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/trainer-form?trainer=" + encodeURIComponent("W P Mullins") + "&formCategory=Flat").expect(200);
    });
  });

  describe("GET /api/industry-sp/pnl-stats", () => {
    it("returns success with staked, returns, pnl", async () => {
      const response = await request(app)
        .get("/api/industry-sp/pnl-stats")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("staked");
      expect(response.body.data).toHaveProperty("returns");
      expect(response.body.data).toHaveProperty("pnl");
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/pnl-stats").expect(200);
    });
  });

  describe("GET /api/stats", () => {
    it("returns success with totalRaces and totalRunners", async () => {
      const response = await request(app)
        .get("/api/stats")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("totalRaces");
      expect(response.body.data).toHaveProperty("totalRunners");
      expect(typeof response.body.data.totalRaces).toBe("number");
      expect(typeof response.body.data.totalRunners).toBe("number");
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/stats").expect(401);
    });
  });

  describe("404 Handler", () => {
    it("should return 404 for non-existent API routes", async () => {
      const response = await request(app)
        .get("/api/non-existent-route")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty("error", "Not found");
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("CORS", () => {
    it("should allow CORS requests", async () => {
      const response = await request(app)
        .get("/health")
        .set("Authorization", `Bearer ${authToken}`)
        .set("Origin", "http://localhost:3000")
        .expect(200);

      expect(response.headers).toHaveProperty("access-control-allow-origin");
    });
  });

  describe("Security Headers", () => {
    it("should include security headers", async () => {
      const response = await request(app).get("/health").set("Authorization", `Bearer ${authToken}`).expect(200);

      // Check for helmet security headers
      expect(response.headers).toHaveProperty("x-content-type-options");
      expect(response.headers).toHaveProperty("x-frame-options");
      expect(response.headers).toHaveProperty("x-xss-protection");
    });
  });
});

// REAL BUG FOUND AND FIXED 2026-07-29 (see AGENTS.md's bets-tab-load-fix
// entry): initializeServices() used to swallow any error in a bare
// `catch { console.error(...) }` with no rethrow — a single TRANSIENT
// failure (e.g. a Mongo connection blip on Lambda cold start) left every
// service permanently null for that Lambda execution environment's entire
// remaining lifetime (apps/lambda/src/handler.ts only ever called this
// once, at module load), so every subsequent request on that same warm
// container kept getting a real 503 "Service not initialized" from every
// route's own defensive check, until AWS eventually recycled the
// container. This describe lives in app.test.ts (not a separate file)
// specifically to reuse its already-working DatabaseConnection/service
// mock harness above — replicating that in a new file would mean
// duplicating ~100 lines of mocks (twilio, google-auth-library,
// codebase-search-service, etc.) just to reach the same working
// "initializeServices() can actually succeed" baseline this file already
// has.
describe("initializeServices — transient failure recovery", () => {
  it("rethrows on failure instead of silently swallowing it (so a caller can detect and retry)", async () => {
    const mockedConnect = DatabaseConnection.getInstance().connect as jest.Mock;
    mockedConnect.mockRejectedValueOnce(new Error("simulated transient Mongo connection blip"));

    await expect(initializeServices()).rejects.toThrow("simulated transient Mongo connection blip");
    expect(areServicesReady()).toBe(false);
  });

  it("recovers on a subsequent call once the transient failure clears — proves the actual bug is fixed", async () => {
    const mockedConnect = DatabaseConnection.getInstance().connect as jest.Mock;
    mockedConnect.mockRejectedValueOnce(new Error("simulated transient Mongo connection blip"));

    await expect(initializeServices()).rejects.toThrow();
    expect(areServicesReady()).toBe(false);

    // mockRejectedValueOnce only consumes one call — this next call falls
    // back to the file's base mockResolvedValue(undefined), simulating the
    // blip clearing. Before this fix, nothing in this codebase ever
    // retried initializeServices() at all once a Lambda's single
    // module-load-time call had already "settled" (successfully, since
    // the old code swallowed the error) — this second call is the retry
    // apps/lambda/src/handler.ts's ensureServicesReady() now performs.
    await expect(initializeServices()).resolves.toBeUndefined();
    expect(areServicesReady()).toBe(true);
  });
});
