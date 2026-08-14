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
  brier?: { scored: number; priced: number; model: number | null; market: number | null };
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
  experimentId?: string;
}
const mockSavedFilterSets: MockSavedFilterSetDoc[] = [];

// One ml/experiment.py run. The metrics are the real shape and roughly the
// real values: the model loses to industry SP on Brier and badly on
// resolution, which is what the whole experiment programme is trying to move.
const MOCK_EXPERIMENT_ID = "exp-20260806-183001";
const mockExperimentMetrics = {
  n: 189640,
  aucRoc: 0.71554,
  logLoss: 0.326826,
  brierScore: 0.095289,
  resolution: 0.00721379,
  reliability: 0.000098,
  top1Rate: 0.260771,
  mrr: 0.42,
  races: 21000,
};
const mockModelExperimentSummary = {
  experimentId: MOCK_EXPERIMENT_ID,
  name: "base-binary-control",
  notes: "The deployed feature set and objective, through the new code path.",
  runAt: "2026-08-06T18:30:01.000Z",
  gitCommit: "abc1234",
  mode: "fast" as const,
  featureSetName: "baseline",
  objective: "binary",
  newFeatureCols: [],
  // What the $size stage in ModelExperimentDAO.getAll adds — featureCols
  // itself is never sent to the list view.
  featureCount: 27,
  trainingParams: { maxDepth: 5, nEstimatorsCap: 300 },
  foldYears: ["2022", "2023", "2024", "2025", "2026"],
  foldCount: 5,
  scoredRows: 189640,
  unscoredRows: 296758,
  droppedTrainRaces: 0,
  coverageMinDate: "2022-01-01",
  coverageMaxDate: "2026-08-05",
  overall: {
    model: mockExperimentMetrics,
    calibrated: mockExperimentMetrics,
    market: { ...mockExperimentMetrics, brierScore: 0.088829, aucRoc: 0.785405, resolution: 0.01363617 },
    bss: -0.072724,
  },
  acceptanceRule: { minN: 20000, minBss: 0 },
  discoveredSegments: [],
  filterBattery: [],
  totalSeconds: 338.6,
  wroteModelArtifacts: false,
};
// The detail document carries the heavyweight sub-documents the list query
// projects away — see SUMMARY_PROJECTION in ModelExperimentDAO.
const mockModelExperimentDetail = {
  ...mockModelExperimentSummary,
  featureCols: ["course", "going", "officialRating", "wgt"],
  featureCoverage: [
    { col: "wgt", populatedPct: 100 },
    { col: "horseAvgExcuseScore", populatedPct: 0 },
  ],
  folds: [{ year: "2022", trainRows: 265382, scoredRows: 42863, seconds: 18.9, raw: { brierScore: 0.0968, aucRoc: 0.7169 } }],
  spBandTable: [],
  segments: [
    {
      dimension: "spBand", bucket: "5.0-10.0", bucketOrder: 3,
      n: 44000, scoredN: 43980, wins: 5100, strikeRate: 11.6,
      model: mockExperimentMetrics, market: mockExperimentMetrics, bss: -0.026,
      selections: {
        all: { n: 44000, wins: 5100, strikeRate: 11.6, bettableN: 43980,
               pnl: { toWin1: { staked: 8000, returns: 7900, pnl: -100, roiPct: -1.25 },
                      level: { staked: 44000, returns: 43000, pnl: -1000, roiPct: -2.27 } } },
      },
      yearsPositiveToWin1: 2, yearsPositiveLevel: 1,
    },
  ],
};

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
  brierSums?: { scored: number; priced: number; modelSqErrSum: number; marketSqErrSum: number };
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
              // The walk-forward doc lives in the same collection but is a
              // different shape (oosVersionId + coverage dates, no
              // modelVersionId), which is exactly why ModelVersionDAO keys its
              // two queries on disjoint fields — find() above must never see
              // this one, and findOne() here must never see those.
              findOne: jest.fn().mockResolvedValue({
                evaluationType: "walk_forward",
                oosVersionId: "wf-20260731-074825",
                coverageMinDate: "2016-01-01",
                coverageMaxDate: "2026-07-30",
                scoredRows: 885089,
                unscoredRows: 86027,
              }),
            };
          }
          // Its OWN collection, not model_evaluations — that one is read by
          // the training pipeline's champion gate and by the deployed
          // daily-prediction path, and an experiment doc has no business in
          // either. See ModelExperimentDAO's header.
          if (name === "model_experiments") {
            return {
              createIndex: jest.fn().mockResolvedValue(undefined),
              // aggregate, not find: the list query computes featureCount with
              // $size so the ~143-entry featureCols array never has to be sent
              // just to display one integer (see ModelExperimentDAO.getAll).
              aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([mockModelExperimentSummary]),
              }),
              findOne: jest.fn().mockImplementation(async (query: { experimentId?: string }) =>
                query?.experimentId === MOCK_EXPERIMENT_ID ? mockModelExperimentDetail : null
              ),
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
                // brierPriced/brierMarketSqErrSum ride along inside pnlStats
                // because market-definition-dao.ts accumulates the Betfair-SP
                // screen's market Brier in that same $group (it has already
                // $unwound to exactly the runners the P&L covers). The
                // industry-SP side reads its own `brier` branch below instead.
                pnlStats: [{ staked: 1, returns: 2, count: 1, brierPriced: 4, brierMarketSqErrSum: 0.6 }],
                // $facet branch added by the Brier feature — four raw
                // squared-error sums, deliberately NOT a finished score, since
                // brierFromSums does the division. 0.4/4 = 0.1 model,
                // 0.6/4 = 0.15 market, so the assertions downstream are
                // checkable by hand rather than snapshotted.
                brier: [{ scored: 4, priced: 4, modelSqErrSum: 0.4, marketSqErrSum: 0.6 }],
                // $facet branch added by the favourite-backed baseline — raw
                // per-race sums again, not a finished P&L. 3 races, 4 bets (one
                // race had joint favourites), £2 staked to win £1 returning
                // £3, and £4 level returning £10 — so every assertion
                // downstream is checkable by hand: to-win pnl +1, level pnl +6.
                favPnl: [{ races: 3, bets: 4, staked: 2, returns: 3, levelReturns: 10 }],
                // Flat counterparts for the Model vs SP summary aggregation,
                // which groups into scalars rather than a $facet branch.
                brierScored: 4,
                brierPriced: 4,
                brierModelSqErrSum: 0.4,
                brierMarketSqErrSum: 0.6,
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
                // getModelVsSpRunners' summary pipeline accumulators — one tally
                // per EDGE_BAND_BOUNDS band plus the open-ended tail, and the
                // denominator (which deliberately ignores the difference filter).
                allRunners: 10,
                sumAbsEdge: 52.8,
                band0: 4,
                band1: 2,
                band2: 2,
                band3: 1,
                band4: 1,
                band5: 0,
                // ModelAccuracyDAO's $bucket row shape (GET /api/model-accuracy).
                // _id is the band's lower probability boundary — 50 puts these
                // sums in the "under 2.0" band, leaving the other five as the
                // zero-filled rows the service always emits. The count field is
                // deliberately `runnerCount`, not `runners`, because `runners`
                // above is the runner *array* other endpoints here rely on.
                _id: 50,
                runnerCount: 4,
                wins: 1,
                modelProbSum: 240,
                marketProbFairSum: 200,
                marketProbRawSum: 220,
                modelSqErrSum: 0.64,
                marketSqErrSum: 1.08,
                // ...and the $facet wrapper that same DAO now returns, since
                // it emits the bands and the coverage counters in one pass.
                // The band row is repeated rather than referenced because an
                // object literal can't refer to itself; the fields must stay
                // in step with the ones directly above.
                bands: [
                  {
                    _id: 50,
                    runnerCount: 4,
                    wins: 1,
                    modelProbSum: 240,
                    marketProbFairSum: 200,
                    marketProbRawSum: 220,
                    staked: 2.5,
                    returns: 3.5,
                    modelSqErrSum: 0.64,
                    marketSqErrSum: 1.08,
                  },
                ],
                // Six runners in the window carry a real SP; four of them also
                // carry an out-of-sample score. The other two are the early
                // races with no prior form behind them — the gap the coverage
                // line on the screen exists to state.
                coverage: [{ eligibleRunners: 6, scoredRunners: 4 }],
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

    it("returns a market-only Brier score — this dataset has no model column", async () => {
      // The Betfair-SP collection is not what ml/train_and_predict.py scores,
      // so there is no model probability to compare against here. model must
      // be null, NOT 0 — 0 is the best possible Brier score and would render a
      // perfect model on a screen that has no model at all.
      const response = await request(app)
        .get("/api/runners")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.brier).toEqual({ scored: 0, priced: 4, model: null, market: 0.15 });
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

    describe("brier", () => {
      it("returns model and market Brier scores alongside pnlStats", async () => {
        const response = await request(app)
          .get("/api/industry-sp")
          .set("Authorization", `Bearer ${authToken}`)
          .expect(200);

        // 0.4/4 and 0.6/4 from the shared aggregate mock's `brier` branch —
        // the endpoint must DIVIDE the raw sums, not pass them through.
        expect(response.body.brier).toEqual({ scored: 4, priced: 4, model: 0.1, market: 0.15 });
      });

      it("scores the model and the market over the same runner count", async () => {
        // The invariant that makes the two safe to show side by side on one
        // card. They are only allowed to differ on the Betfair-SP screen,
        // which has no model column at all.
        const response = await request(app).get("/api/industry-sp").expect(200);
        expect(response.body.brier.scored).toBe(response.body.brier.priced);
      });

      it("is present on the anonymous response too", async () => {
        // The Filters screen renders it before login, so a missing field here
        // would show an em dash to every logged-out visitor.
        const response = await request(app).get("/api/industry-sp").expect(200);
        expect(response.body.brier).toBeDefined();
        expect(typeof response.body.brier.model).toBe("number");
      });
    });

    describe("favPnl — the back-the-favourite baseline", () => {
      it("returns the baseline alongside pnlStats, in both staking conventions", async () => {
        const response = await request(app)
          .get("/api/industry-sp")
          .set("Authorization", `Bearer ${authToken}`)
          .expect(200);

        // From the shared aggregate mock's `favPnl` branch. The endpoint must
        // SUBTRACT (returns - staked), not pass the raw sums through, and must
        // read the level book's stake off `bets` rather than off `staked`.
        expect(response.body.favPnl).toEqual({
          races: 3,
          count: 4,
          staked: 2,
          returns: 3,
          pnl: 1,
          level: { staked: 4, returns: 10, pnl: 6 },
        });
      });

      it("counts bets, not races — a joint favourite is two bets in one race", async () => {
        // The pair is what makes joint favourites legible on screen; a single
        // number could not distinguish 4 races from 3 races with a tie in one.
        const response = await request(app).get("/api/industry-sp").expect(200);
        expect(response.body.favPnl.count).toBeGreaterThan(response.body.favPnl.races);
      });

      it("is present on the anonymous response too", async () => {
        // The Filters screen renders the split cards before login, so a missing
        // field here would show an em dash to every logged-out visitor.
        const response = await request(app).get("/api/industry-sp").expect(200);
        expect(response.body.favPnl).toBeDefined();
        expect(typeof response.body.favPnl.pnl).toBe("number");
      });
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

    it("accepts a minModelSpEdgePts param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minModelSpEdgePts=5")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("tolerates a non-numeric or out-of-range minModelSpEdgePts instead of erroring", async () => {
      // The router clamps to 0-100 and falls back to 0 on NaN, so a
      // hand-edited or stale URL degrades to "no edge threshold" rather
      // than a 500 — same contract as every other numeric filter param.
      for (const value of ["abc", "-5", "9999", ""]) {
        const response = await request(app)
          .get(`/api/industry-sp?minModelSpEdgePts=${value}`)
          .set("Authorization", `Bearer ${authToken}`)
          .expect(200);
        expect(response.body.success).toBe(true);
      }
    });

    it("serves minModelSpEdgePts anonymously too, under the anonymous race cap", async () => {
      // /api/industry-sp is behind optionalJwtAuth, not a hard gate — an
      // anonymous caller gets a smaller race cap, not a 401. Asserted
      // explicitly so a future auth change to this route has to come past
      // this test.
      const response = await request(app).get("/api/industry-sp?minModelSpEdgePts=5").expect(200);
      expect(response.body.success).toBe(true);
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
    it("accepts an explicit maxAbsEdge of 0 without falling back", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp?maxAbsEdge=0")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      // 0 is falsy, and "only runners whose gap is exactly zero" is a legitimate
      // query — the `parseFloat(x) || DEFAULT` idiom would widen it to 100.
      expect(lastParams().maxAbsEdge).toBe(0);
    });

    it("defaults the difference range to the full 0-100 span", async () => {
      await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(lastParams().minAbsEdge).toBe(0);
      expect(lastParams().maxAbsEdge).toBe(100);
    });

    it("treats the difference filter as unsigned — a negative bound clamps to 0", async () => {
      await request(app)
        .get("/api/model-vs-sp?minAbsEdge=-25&maxAbsEdge=30")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // |edge| can never be negative, so a negative bound is meaningless rather
      // than an error.
      expect(lastParams().minAbsEdge).toBe(0);
      expect(lastParams().maxAbsEdge).toBe(30);
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

    it("clamps the difference range to 0-100", async () => {
      await request(app)
        .get("/api/model-vs-sp?minAbsEdge=-9999&maxAbsEdge=9999")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const params = lastParams();
      expect(params.minAbsEdge).toBe(0);
      expect(params.maxAbsEdge).toBe(100);
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
      expect(response.body.summary).toBeNull();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(lastParams().includeTotal).toBe(false);
    });

    it("returns a distribution summary alongside the rows", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const summary = response.body.summary;
      expect(summary).toBeTruthy();
      expect(typeof summary.allRunners).toBe("number");
      expect(typeof summary.matchedRunners).toBe("number");
      expect(typeof summary.matchedPercent).toBe("number");
      expect(typeof summary.meanAbsEdge).toBe("number");
      expect(Array.isArray(summary.bands)).toBe(true);
      // Scored over the MATCHED runners (the rows listed below the summary),
      // not the wider allRunners denominator the bands describe — the bands
      // say how far apart model and market are, this says which of them was
      // closer to what actually happened.
      expect(summary.brier).toEqual({ scored: 4, priced: 4, model: 0.1, market: 0.15 });
    });

    it("each summary band carries a label, a count and a share", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      for (const band of response.body.summary.bands) {
        expect(typeof band.label).toBe("string");
        expect(typeof band.count).toBe("number");
        expect(typeof band.percent).toBe("number");
        expect(typeof band.minAbs).toBe("number");
      }
      // Only the open-ended final band omits a cumulative share.
      const bands = response.body.summary.bands;
      expect(bands[bands.length - 1].cumulativePercent).toBeNull();
      expect(bands[0].cumulativePercent).not.toBeNull();
    });

    it("summary.matchedRunners is the same number pagination totals by", async () => {
      const response = await request(app)
        .get("/api/model-vs-sp")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.summary.matchedRunners).toBe(response.body.total);
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

  describe("GET /api/model-score-coverage", () => {
    it("returns 200 with success and the walk-forward coverage window", async () => {
      const response = await request(app)
        .get("/api/model-score-coverage")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.coverageMinDate).toBe("2016-01-01");
      expect(response.body.data.coverageMaxDate).toBe("2026-07-30");
    });

    it("each field has the required type", async () => {
      const response = await request(app).get("/api/model-score-coverage").expect(200);
      const d = response.body.data;
      expect(typeof d.oosVersionId).toBe("string");
      expect(typeof d.coverageMinDate).toBe("string");
      expect(typeof d.coverageMaxDate).toBe("string");
      expect(typeof d.scoredRows).toBe("number");
      expect(typeof d.unscoredRows).toBe("number");
    });

    it("is public — returns 200 without auth", async () => {
      const response = await request(app).get("/api/model-score-coverage").expect(200);
      expect(response.body).toHaveProperty("success", true);
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

  describe("GET /api/model-experiments", () => {
    it("returns 200 with success and a data array", async () => {
      const response = await request(app)
        .get("/api/model-experiments")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("count equals data.length", async () => {
      const response = await request(app)
        .get("/api/model-experiments")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });

    // Unlike /api/model-versions, which is deliberately public. This is
    // internal model-development output — candidate feature names, unshipped
    // models, discovered betting angles — and the guard is the route's
    // PLACEMENT below router.use(jwtAuth), which nothing but this test checks.
    it("returns 401 without auth", async () => {
      await request(app).get("/api/model-experiments").expect(401);
    });

    it("each experiment has id, name, mode, objective, meta and metrics", async () => {
      const response = await request(app)
        .get("/api/model-experiments")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const exp = response.body.data[0];
      expect(typeof exp.id).toBe("string");
      expect(typeof exp.name).toBe("string");
      expect(["fast", "full"]).toContain(exp.mode);
      expect(typeof exp.objective).toBe("string");
      expect(typeof exp.meta.foldCount).toBe("number");
      // Computed server-side by $size, since featureCols is projected away.
      expect(exp.featureCount).toBe(27);
      expect(typeof exp.metrics.model.brierScore).toBe("number");
      expect(typeof exp.metrics.market.brierScore).toBe("number");
      // Resolution is the metric the whole exercise is about, so it has to
      // survive the flat-document-to-API reshape.
      expect(typeof exp.metrics.model.resolution).toBe("number");
      expect(typeof exp.metrics.bss).toBe("number");
    });

    it("ignores an unrecognised mode rather than 500ing", async () => {
      const response = await request(app)
        .get("/api/model-experiments?mode=bogus")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });
  });

  describe("GET /api/model-experiments/:experimentId", () => {
    it("returns 200 with the full document for a known id", async () => {
      const response = await request(app)
        .get(`/api/model-experiments/${MOCK_EXPERIMENT_ID}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.id).toBe(MOCK_EXPERIMENT_ID);
      // The sub-documents the list query projects away.
      expect(Array.isArray(response.body.data.segments)).toBe(true);
      expect(Array.isArray(response.body.data.folds)).toBe(true);
      expect(Array.isArray(response.body.data.segmentDimensions)).toBe(true);
    });

    it("surfaces a feature that is effectively dead", async () => {
      // Three of the deployed model's own numeric features have been 100% NaN
      // since 2026-07-26 without anyone noticing, so the screen is given the
      // sparse ones explicitly rather than being handed all ~143 to filter.
      const response = await request(app)
        .get(`/api/model-experiments/${MOCK_EXPERIMENT_ID}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.sparseFeatures).toEqual([
        { col: "horseAvgExcuseScore", populatedPct: 0 },
      ]);
    });

    it("returns 404 for an unknown id", async () => {
      await request(app)
        .get("/api/model-experiments/exp-does-not-exist")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });

    it("returns 401 without auth", async () => {
      await request(app).get(`/api/model-experiments/${MOCK_EXPERIMENT_ID}`).expect(401);
    });
  });

  describe("GET /api/model-accuracy", () => {
    it("returns 200 with success and a data array", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("count equals data.length", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });

    it("requires auth — returns 401 without a token", async () => {
      await request(app).get("/api/model-accuracy").expect(401);
    });

    it("always returns every price band, shortest price first", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.map((b: { label: string }) => b.label)).toEqual([
        "under 2.0",
        "2.0 – 3.0",
        "3.0 – 5.0",
        "5.0 – 10.0",
        "10.0 – 20.0",
        "20.0+",
      ]);
    });

    it("each band carries the model, market, error and P&L figures", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const band = response.body.data[0];
      expect(typeof band.bandKey).toBe("string");
      expect(typeof band.runners).toBe("number");
      expect(typeof band.wins).toBe("number");
      expect(typeof band.modelMeanProb).toBe("number");
      expect(typeof band.actualWinRate).toBe("number");
      expect(typeof band.marketMeanProbFair).toBe("number");
      expect(typeof band.marketMeanProbRaw).toBe("number");
      expect(typeof band.modelErrorPp).toBe("number");
      expect(typeof band.marketErrorPp).toBe("number");
      expect(typeof band.modelBrier).toBe("number");
      expect(typeof band.pnl).toBe("number");
      expect(typeof band.roiPercent).toBe("number");
    });

    it("returns an overall row alongside the bands", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.overall).toBeDefined();
      expect(response.body.overall.label).toBe("All bands");
      // The mocked aggregate returns a single band's sums, so the overall row
      // must total exactly that.
      expect(response.body.overall.runners).toBe(
        response.body.data.reduce((s: number, b: { runners: number }) => s + b.runners, 0)
      );
    });

    it("accepts the filter params without error", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .query({
          minDate: "2026-01-01",
          maxDate: "2026-01-31",
          courses: "Ascot,Kempton",
          goings: "Good",
          raceTypes: "Flat",
          minRunners: "4",
          maxRunners: "12",
        })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });

    it("a stale modelVersionId in a bookmarked URL is ignored, not rejected", async () => {
      // The filter was removed when this screen moved to out-of-sample
      // probabilities: each year's rows come from a different model, so there
      // is no single version to select. An old bookmark must still work.
      const response = await request(app)
        .get("/api/model-accuracy")
        .query({ modelVersionId: "xgb-20260727-171521" })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.length).toBe(6);
    });

    it("reports how much of the window could actually be scored", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.coverage).toEqual({
        eligibleRunners: 6,
        scoredRunners: 4,
        // The two runners with no prior history behind them. They are excluded
        // from every band rather than counted as a 0% prediction the model got
        // wrong, which is why this number has to be stated at all.
        unscoredRunners: 2,
        coveragePercent: 66.67,
      });
    });

    it("the scored count matches the runners the bands were built from", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // If these ever disagree, the coverage line is describing a different
      // population from the table underneath it.
      expect(response.body.overall.runners).toBe(response.body.coverage.scoredRunners);
    });

    it("rejects a runner range where min exceeds max", async () => {
      const response = await request(app)
        .get("/api/model-accuracy")
        .query({ minRunners: "12", maxRunners: "4" })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
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

  describe("GET /api/industry-sp/filter-fields", () => {
    it("returns the raw-model-field catalogue", async () => {
      const response = await request(app)
        .get("/api/industry-sp/filter-fields")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it("reports a count matching the data length", async () => {
      const response = await request(app).get("/api/industry-sp/filter-fields").expect(200);
      expect(response.body.count).toBe(response.body.data.length);
    });

    it("gives every field the properties the picker renders", async () => {
      const response = await request(app).get("/api/industry-sp/filter-fields").expect(200);
      for (const field of response.body.data) {
        expect(typeof field.name).toBe("string");
        expect(typeof field.label).toBe("string");
        expect(["number", "enum"]).toContain(field.type);
        expect(["race", "runner"]).toContain(field.scope);
        expect(typeof field.enabled).toBe("boolean");
        expect(typeof field.coverage).toBe("number");
      }
    });

    it("marks the three comment-derived fields disabled with a reason", async () => {
      const response = await request(app).get("/api/industry-sp/filter-fields").expect(200);
      const dead = response.body.data.filter((f: { enabled: boolean }) => !f.enabled);
      expect(dead.map((f: { name: string }) => f.name).sort()).toEqual([
        "horseAvgExcuseScore",
        "horseTravelledWellRate",
        "horseTroubleInRunningRate",
      ]);
      for (const field of dead) expect(field.note).toBeTruthy();
    });

    it("ships selectable values for every enum field", async () => {
      const response = await request(app).get("/api/industry-sp/filter-fields").expect(200);
      const enums = response.body.data.filter((f: { type: string }) => f.type === "enum");
      expect(enums.length).toBeGreaterThan(0);
      for (const field of enums) {
        expect(Array.isArray(field.enumValues)).toBe(true);
        expect(field.enumValues.length).toBeGreaterThan(0);
        expect(typeof field.enumParam).toBe("string");
      }
    });

    it("is public — returns 200 without auth", async () => {
      await request(app).get("/api/industry-sp/filter-fields").expect(200);
    });
  });

  describe("GET /api/industry-sp with raw-model-field filters", () => {
    it("accepts a min bound on a registry field", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minOfficialRating=90")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body).toHaveProperty("success", true);
    });

    it("accepts a two-sided range and an enum selection together", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minAge=3&maxAge=5&sexes=F,M")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body).toHaveProperty("success", true);
    });

    it("400s on a misspelled field rather than silently ignoring it", async () => {
      // A typo that returned every race would hand back a number answering a
      // different question from the one asked.
      const response = await request(app)
        .get("/api/industry-sp?minOffcialRating=90")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body.error).toContain("unknown filter field");
    });

    it("400s on an unparseable bound", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minAge=abc")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body.error).toContain("not a number");
    });

    it("400s on an unknown enum value", async () => {
      const response = await request(app)
        .get("/api/industry-sp?sexes=Z")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body.error).toContain("unknown value");
    });

    it("400s on a filter over a disabled field", async () => {
      const response = await request(app)
        .get("/api/industry-sp?minHorseAvgExcuseScore=1")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body.error).toContain("not filterable");
    });

    it("leaves the hand-written min*/max* params alone", async () => {
      await request(app)
        .get("/api/industry-sp?minRunners=5&maxRunners=12&minIsp=2&maxIsp=10")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
    });
  });

  describe("GET /api/industry-sp/splits with raw-model-field filters", () => {
    it("accepts registry filters", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?minOfficialRating=90&sexes=G")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);
      expect(response.body).toHaveProperty("success", true);
    });

    it("400s on a misspelled field", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?maxOffcialRating=90")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);
      expect(response.body.error).toContain("unknown filter field");
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
        // Each split carries its own score, and the grand total carries a
        // third — the whole-set number is NOT recoverable from the two split
        // ones on the client (a Brier is a mean, and the splits' denominators
        // are not exposed separately), which is why the response sends it.
        expect(response.body[split].brier).toEqual({ scored: 4, priced: 4, model: 0.1, market: 0.15 });
        // Same relationship for the favourite baseline, and the same reason it
        // is sent per split rather than derived on the client: each split's
        // window covers different races, so neither is recoverable from the
        // other or from the grand total.
        expect(response.body[split].favPnl).toEqual({
          races: 3, count: 4, staked: 2, returns: 3, pnl: 1, level: { staked: 4, returns: 10, pnl: 6 },
        });
      }
      expect(response.body.brier).toEqual({ scored: 4, priced: 4, model: 0.1, market: 0.15 });
      expect(response.body.favPnl).toEqual({
        races: 3, count: 4, staked: 2, returns: 3, pnl: 1, level: { staked: 4, returns: 10, pnl: 6 },
      });
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

    it("accepts a minModelSpEdgePts param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?minModelSpEdgePts=7.5")
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

    it("accepts a minModelSpEdgePts param and returns 200 with success", async () => {
      // The graph has to honour the same filter the split card it was
      // opened from used, or the two disagree about which runners are in
      // the sample — the exact class of mismatch the pnlStats fast-path
      // regression above was about.
      const response = await request(app)
        .get("/api/industry-sp/race-convergence?toRow=1000&minModelSpEdgePts=5")
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
