import request from "supertest";
import app from "../app";

// Mock the OpenAI client to avoid real API calls in tests
jest.mock("../../lib/service/openai-client", () => ({
  OpenAIClient: jest.fn().mockImplementation(() => ({
    createResponse: jest.fn().mockResolvedValue("Mocked AI analysis"),
    createHorseQueryResponse: jest
      .fn()
      .mockResolvedValue("Mocked horse racing analysis"),
  })),
}));

describe("API Endpoints", () => {
  describe("GET /health", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/health").expect(200);

      expect(response.body).toHaveProperty("status", "OK");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("service", "Betfair NLP API");
    });
  });

  describe("POST /api/query", () => {
    it("should process natural language query and return horses with AI analysis", async () => {
      const query = "Show me the top horses in the race";

      const response = await request(app)
        .post("/api/query")
        .send({ query })
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("horses");
      expect(response.body.data).toHaveProperty("query", query);
      expect(response.body.data).toHaveProperty("timestamp");
      expect(response.body.data).toHaveProperty("confidence");
      expect(response.body.data).toHaveProperty("aiAnalysis");

      // Check horses structure
      expect(Array.isArray(response.body.data.horses)).toBe(true);
      expect(response.body.data.horses.length).toBeGreaterThan(0);

      const horse = response.body.data.horses[0];
      expect(horse).toHaveProperty("id");
      expect(horse).toHaveProperty("name");
      expect(horse).toHaveProperty("odds");
      expect(horse).toHaveProperty("position");
      expect(horse).toHaveProperty("jockey");
      expect(horse).toHaveProperty("trainer");
      expect(horse).toHaveProperty("weight");
      expect(horse).toHaveProperty("age");
      expect(horse).toHaveProperty("form");
    });

    it("should return 400 when query is missing", async () => {
      const response = await request(app)
        .post("/api/query")
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Query is required");
    });

    it("should return 400 when query is not a string", async () => {
      const response = await request(app)
        .post("/api/query")
        .send({ query: 123 })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a string");
    });

    it("should return 400 when query is empty string", async () => {
      const response = await request(app)
        .post("/api/query")
        .send({ query: "" })
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Query is required");
    });
  });

  describe("GET /api/horses/top", () => {
    it("should return top horses with default limit", async () => {
      const response = await request(app).get("/api/horses/top").expect(200);

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
        .expect(200);

      expect(response.body.data).toHaveProperty("limit", limit);
      expect(response.body.data.horses.length).toBeLessThanOrEqual(limit);
    });

    it("should handle invalid limit parameter", async () => {
      const response = await request(app)
        .get("/api/horses/top?limit=invalid")
        .expect(200);

      // Should default to 5 when invalid limit is provided
      expect(response.body.data).toHaveProperty("limit", 5);
    });
  });

  describe("GET /api/horses/odds", () => {
    it("should return horses with odds under specified value", async () => {
      const maxOdds = 5.0;
      const response = await request(app)
        .get(`/api/horses/odds?maxOdds=${maxOdds}`)
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
      const response = await request(app).get("/api/horses/odds").expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("maxOdds is required");
    });

    it("should return 400 when maxOdds is not a number", async () => {
      const response = await request(app)
        .get("/api/horses/odds?maxOdds=invalid")
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a positive number");
    });

    it("should return 400 when maxOdds is negative", async () => {
      const response = await request(app)
        .get("/api/horses/odds?maxOdds=-1")
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("must be a positive number");
    });
  });

  describe("404 Handler", () => {
    it("should return 404 for non-existent routes", async () => {
      const response = await request(app)
        .get("/non-existent-route")
        .expect(404);

      expect(response.body).toHaveProperty("error", "Not found");
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("CORS", () => {
    it("should allow CORS requests", async () => {
      const response = await request(app)
        .get("/health")
        .set("Origin", "http://localhost:3000")
        .expect(200);

      expect(response.headers).toHaveProperty("access-control-allow-origin");
    });
  });

  describe("Security Headers", () => {
    it("should include security headers", async () => {
      const response = await request(app).get("/health").expect(200);

      // Check for helmet security headers
      expect(response.headers).toHaveProperty("x-content-type-options");
      expect(response.headers).toHaveProperty("x-frame-options");
      expect(response.headers).toHaveProperty("x-xss-protection");
    });
  });
});
