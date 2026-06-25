import request from "supertest";
import app from "../app";

let authToken: string;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "matthew", password: "beyer" });
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

// Mock the database connection
jest.mock("../../config/database", () => ({
  DatabaseConnection: {
    getInstance: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      getDb: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
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
                  },
                ],
                total: [{ count: 1 }],
              },
            ]),
          }),
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
