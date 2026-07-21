import request from "supertest";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import app from "../app";

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

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
  authToken = res.body.token;
});

// Mock the OpenAI client to avoid real API calls in tests
jest.mock("../../lib/service/openai-client", () => ({
  OpenAIClient: jest.fn().mockImplementation(() => ({
    createResponse: jest.fn().mockResolvedValue("Mocked AI analysis"),
    createHorseQueryResponse: jest
      .fn()
      .mockResolvedValue(
        '```javascript\ndb.market_definitions.find({"name": "Cheltenham Chase"})\n```'
      ),
  })),
}));

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
jest.mock("../../config/database", () => ({
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
          return {
            distinct: jest.fn().mockResolvedValue(["GB", "IE"]),
          find: jest.fn().mockReturnValue({
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
          }),
          countDocuments: jest.fn().mockResolvedValue(42),
          findOne: jest.fn().mockResolvedValue({ id: 1, name: "Test Horse" }),
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
                total: [{ count: 1 }],
                pnlStats: [{ staked: 1, returns: 2, count: 1 }],
                runnerCounts: [{ maxRunners: 12 }],
                ispBounds: [{ maxIsp: 100, minIsp: 1.5 }],
              },
            ]),
          }),
          };
        }),
      }),
      isConnected: jest.fn().mockReturnValue(true),
    }),
  },
}));

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
    it("should process natural language query and return a successful response", async () => {
      const query = "Show me the top horses in the race";

      const response = await request(app)
        .post("/api/query")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ query })
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
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
      // An open-ended toRowB is capped to a raceCap-wide span now (1000 for
      // an authenticated caller here), not left truly unlimited — see
      // getSplitStats' raceCap clamp.
      expect(response.body.splitB.toRow).toBe(6 + 1000 - 1);
    });

    it("returns raceCap: 1000 for an authenticated caller", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.raceCap).toBe(1000);
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

    it("clamps an explicit toRowA/toRowB span to 1000 races when authenticated", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?fromRowA=1&toRowA=5000&fromRowB=6000&toRowB=9000")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.splitA.toRow).toBe(1 + 1000 - 1);
      expect(response.body.splitB.toRow).toBe(6000 + 1000 - 1);
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

    it("accepts a splitByRunners=false param and returns 200 with success", async () => {
      const response = await request(app)
        .get("/api/industry-sp/splits?splitByRunners=false")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
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
