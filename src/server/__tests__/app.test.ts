import request from "supertest";
import app from "../app";

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
              },
            ]),
          }),
          findOne: jest.fn().mockResolvedValue({ id: 1, name: "Test Horse" }),
          aggregate: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
              {
                eventId: "33858191",
                eventName: "Cheltenham 1st Jan",
                marketIds: ["1.237066150"],
                count: 25,
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
      const response = await request(app).get("/health").auth("matthew", "beyer").expect(200);

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
        .auth("matthew", "beyer")
        .send({ query })
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
    });

    it("should return 400 when query is missing", async () => {
      const response = await request(app)
        .post("/api/query")
        .auth("matthew", "beyer")
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Query is required");
    });

    it("should return 400 when query is not a string", async () => {
      const response = await request(app)
        .post("/api/query")
        .auth("matthew", "beyer")
        .send({ query: 123 })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a string");
    });

    it("should return 400 when query is empty string", async () => {
      const response = await request(app)
        .post("/api/query")
        .auth("matthew", "beyer")
        .send({ query: "" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Query is required");
    });
  });

  describe.skip("GET /api/horses/top (not yet implemented)", () => {
    it("should return top horses with default limit", async () => {
      const response = await request(app).get("/api/horses/top").auth("matthew", "beyer").expect(200);

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
        .auth("matthew", "beyer")
        .expect(200);

      expect(response.body.data).toHaveProperty("limit", limit);
      expect(response.body.data.horses.length).toBeLessThanOrEqual(limit);
    });

    it("should handle invalid limit parameter", async () => {
      const response = await request(app)
        .get("/api/horses/top?limit=invalid")
        .auth("matthew", "beyer")
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
        .auth("matthew", "beyer")
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
      const response = await request(app).get("/api/horses/odds").auth("matthew", "beyer").expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("maxOdds is required");
    });

    it("should return 400 when maxOdds is not a number", async () => {
      const response = await request(app)
        .get("/api/horses/odds?maxOdds=invalid")
        .auth("matthew", "beyer")
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a positive number");
    });

    it("should return 400 when maxOdds is negative", async () => {
      const response = await request(app)
        .get("/api/horses/odds?maxOdds=-1")
        .auth("matthew", "beyer")
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a positive number");
    });
  });

  describe("GET /api/events/:eventId/definitions", () => {
    it("should return documents for a known eventId", async () => {
      const response = await request(app)
        .get("/api/events/33858191/definitions")
        .auth("matthew", "beyer")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.count).toBe("number");
    });

    it("each document has required fields", async () => {
      const response = await request(app)
        .get("/api/events/33858191/definitions")
        .auth("matthew", "beyer")
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
        .auth("matthew", "beyer")
        .expect(200);

      expect(response.body.count).toBe(response.body.data.length);
    });
  });

  describe("GET /api/events/grouped", () => {
    it("should return grouped events with correct shape", async () => {
      const response = await request(app)
        .get("/api/events/grouped")
        .auth("matthew", "beyer")
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
        .auth("matthew", "beyer")
        .expect(200);

      const cheltenham = response.body.data.find(
        (g: any) => g.eventId === "33858191"
      );
      expect(cheltenham).toBeDefined();
      expect(cheltenham.eventName).toBe("Cheltenham 1st Jan");
      expect(cheltenham.marketIds).toContain("1.237066150");
      expect(cheltenham.count).toBe(25);
    });
  });

  describe("404 Handler", () => {
    it("should return 404 for non-existent routes", async () => {
      const response = await request(app)
        .get("/non-existent-route")
        .auth("matthew", "beyer")
        .expect(404);

      expect(response.body).toHaveProperty("error", "Not found");
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("CORS", () => {
    it("should allow CORS requests", async () => {
      const response = await request(app)
        .get("/health")
        .auth("matthew", "beyer")
        .set("Origin", "http://localhost:3000")
        .expect(200);

      expect(response.headers).toHaveProperty("access-control-allow-origin");
    });
  });

  describe("Security Headers", () => {
    it("should include security headers", async () => {
      const response = await request(app).get("/health").auth("matthew", "beyer").expect(200);

      // Check for helmet security headers
      expect(response.headers).toHaveProperty("x-content-type-options");
      expect(response.headers).toHaveProperty("x-frame-options");
      expect(response.headers).toHaveProperty("x-xss-protection");
    });
  });
});
