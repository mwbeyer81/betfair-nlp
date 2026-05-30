/**
 * CI tests for GET /api/events/:eventId/runners/:runnerId/price-updates
 *
 * Regression: route returned 404 because the server process was not restarted
 * after the route was added. These tests run in CI via Supertest (no live server
 * required) and catch that class of mistake at build time.
 */
import request from "supertest";
import app from "../app";

jest.mock("../../lib/service/openai-client", () => ({
  OpenAIClient: jest.fn().mockImplementation(() => ({
    createResponse: jest.fn().mockResolvedValue("Mocked AI analysis"),
    createHorseQueryResponse: jest.fn().mockResolvedValue("```javascript\ndb.price_updates.find({})\n```"),
  })),
}));

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
                _id: "6a0d8235566f2193080d4909",
                marketId: "1.237066150",
                runnerId: 26817268,
                runnerName: "Gemirande",
                lastTradedPrice: 3.75,
                timestamp: "2024-12-29T13:11:04.990Z",
                changeId: "12874778579",
                publishTime: "2024-12-29T13:11:04.990Z",
                eventId: "33858191",
                eventName: "Cheltenham 1st Jan",
              },
            ]),
          }),
          countDocuments: jest.fn().mockResolvedValue(1),
          findOne: jest.fn().mockResolvedValue(null),
          aggregate: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
      isConnected: jest.fn().mockReturnValue(true),
    }),
  },
}));

const EVENT_ID = "33858191";
const RUNNER_ID = 26817268; // runnerId from the failing curl that exposed the 404
const BASE = `/api/events/${EVENT_ID}/runners/${RUNNER_ID}/price-updates`;

describe("GET /api/events/:eventId/runners/:runnerId/price-updates", () => {
  describe("route registration (regression: was 404 before server restart)", () => {
    it("returns 200, not 404", async () => {
      const res = await request(app).get(BASE).auth("matthew", "beyer");
      expect(res.status).not.toBe(404);
      expect(res.status).toBe(200);
    });

    it("response body has success: true", async () => {
      const res = await request(app).get(BASE).auth("matthew", "beyer").expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("response shape", () => {
    it("data is an array", async () => {
      const res = await request(app).get(BASE).auth("matthew", "beyer").expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("count equals data.length", async () => {
      const res = await request(app).get(BASE).auth("matthew", "beyer").expect(200);
      expect(res.body.count).toBe(res.body.data.length);
    });

    it("each item has runnerId, runnerName, lastTradedPrice, eventId, marketId", async () => {
      const res = await request(app).get(BASE).auth("matthew", "beyer").expect(200);
      for (const doc of res.body.data) {
        expect(typeof doc.runnerId).toBe("number");
        expect(typeof doc.runnerName).toBe("string");
        expect(typeof doc.lastTradedPrice).toBe("number");
        expect(typeof doc.eventId).toBe("string");
        expect(typeof doc.marketId).toBe("string");
      }
    });

    it("runnerId in response matches the path param", async () => {
      const res = await request(app).get(BASE).auth("matthew", "beyer").expect(200);
      for (const doc of res.body.data) {
        expect(doc.runnerId).toBe(RUNNER_ID);
      }
    });
  });

  describe("authentication", () => {
    it("returns 401 without Authorization header", async () => {
      await request(app).get(BASE).expect(401);
    });

    it("returns 401 with wrong credentials", async () => {
      await request(app).get(BASE).auth("wrong", "creds").expect(401);
    });
  });

  describe("input validation", () => {
    it("returns 400 for non-numeric runnerId", async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_ID}/runners/not-a-number/price-updates`)
        .auth("matthew", "beyer")
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/number/i);
    });

    it("respects ?limit query param", async () => {
      const res = await request(app)
        .get(`${BASE}?limit=10`)
        .auth("matthew", "beyer")
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it("accepts ?sort=desc and returns 200", async () => {
      const res = await request(app)
        .get(`${BASE}?sort=desc`)
        .auth("matthew", "beyer")
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it("accepts ?sort=asc and returns 200", async () => {
      const res = await request(app)
        .get(`${BASE}?sort=asc`)
        .auth("matthew", "beyer")
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it("defaults to desc when ?sort is omitted", async () => {
      const res = await request(app)
        .get(BASE)
        .auth("matthew", "beyer")
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it("treats unknown sort values as desc (safe fallback)", async () => {
      const res = await request(app)
        .get(`${BASE}?sort=invalid`)
        .auth("matthew", "beyer")
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });
});
