import express from "express";
import { NaturalLanguageService } from "../lib/service/natural-language-service";
import { BetfairService } from "../lib/service/betfair-service";
import { DatabaseConnection } from "../config/database";

const router = express.Router();

let dbConnection: DatabaseConnection | null = null;
let naturalLanguageService: NaturalLanguageService | null = null;
let betfairService: BetfairService | null = null;

export const basicAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (req.method === "OPTIONS") return next();
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Authentication Required"');
    return res.status(401).json({ error: "Authentication required" });
  }
  const auth = Buffer.from(authHeader.split(" ")[1], "base64").toString();
  const [username, password] = auth.split(":");
  if (username === "matthew" && password === "beyer") {
    next();
  } else {
    res.setHeader("WWW-Authenticate", 'Basic realm="Authentication Required"');
    return res.status(401).json({ error: "Invalid credentials" });
  }
};

export const initializeServices = async () => {
  try {
    dbConnection = DatabaseConnection.getInstance();
    await dbConnection.connect();
    // Initialize betfairService first so API routes work even if NLS fails
    betfairService = new BetfairService(undefined, undefined);
    try {
      naturalLanguageService = new NaturalLanguageService(null as any, dbConnection.getDb());
    } catch (nlsError) {
      console.error("NaturalLanguageService init failed (continuing without it):", nlsError);
      naturalLanguageService = new NaturalLanguageService();
    }
    console.log("Services initialized successfully");
  } catch (error) {
    console.error("Failed to initialize services:", error);
    naturalLanguageService = new NaturalLanguageService();
  }
};

// Public routes (before auth)
router.get("/", (_req, res) => res.redirect("/hello-world"));

const APP_URL = "https://app.backbet.co.uk";

router.get("/hello-world", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hello World — Betfair NLP API</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0f4f8; flex-direction: column; gap: 1rem; }
    h1 { font-size: 3rem; color: #2d3748; margin: 0; }
    p { color: #4a5568; margin: 0; }
    a { color: #3182ce; font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Hello, World!</h1>
  <p>This is the Betfair NLP API server.</p>
  <p>Looking for the app? <a href="${APP_URL}">Open the Betfair NLP app</a></p>
</body>
</html>`);
});

// All routes below require auth
router.use(basicAuth);

router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Betfair NLP API",
    database: dbConnection?.isConnected() ? "connected" : "disconnected",
  });
});

router.post("/api/query", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required and must be a string", example: { query: "Show me the top horses in the race" } });
    }
    if (!naturalLanguageService) {
      return res.status(500).json({ error: "Service not initialized", message: "Natural language service is not available" });
    }
    const result = await naturalLanguageService.processQuery(query);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error processing query:", error);
    let statusCode = 500;
    let errorMessage = "Internal server error";
    if (error instanceof Error) {
      if (error.message.includes("Database connection not available")) { statusCode = 503; errorMessage = "Database service is currently unavailable"; }
      else if (error.message.includes("No results found")) { statusCode = 404; errorMessage = error.message; }
      else if (error.message.includes("Could not extract MongoDB query")) { statusCode = 422; errorMessage = "Could not generate a valid database query from your request"; }
      else if (error.message.includes("Failed to get AI analysis")) { statusCode = 503; errorMessage = "AI service is currently unavailable"; }
      else { errorMessage = error.message; }
    }
    res.status(statusCode).json({ success: false, error: errorMessage, message: "Failed to process natural language query" });
  }
});

router.get("/api/events/grouped", async (req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sort = req.query.sort === "desc" ? "desc" : "asc";
    const { data, total } = await betfairService.getEventGroups(page, limit, sort);
    res.status(200).json({ success: true, data, count: data.length, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch event groups" });
  }
});

router.get("/api/events/:eventId/definitions", async (req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
    const docs = await betfairService.getEventDefinitions(req.params.eventId, limit);
    res.status(200).json({ success: true, data: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch event definitions" });
  }
});

router.get("/api/events/:eventId/runners", async (req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const races = await betfairService.getRunnersByRace(req.params.eventId);
    res.status(200).json({ success: true, data: races, count: races.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch runners" });
  }
});

router.get("/api/events/:eventId/runners/:runnerId/price-updates", async (req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const runnerIdNum = parseInt(req.params.runnerId, 10);
    if (isNaN(runnerIdNum)) return res.status(400).json({ success: false, error: "runnerId must be a number" });
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const sort = String(req.query.sort ?? "desc") === "asc" ? "asc" : "desc";
    const docs = await betfairService.getPriceUpdatesByEventAndRunner(req.params.eventId, runnerIdNum, limit, sort);
    res.status(200).json({ success: true, data: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch runner price updates" });
  }
});

router.get("/api/events/:eventId/price-updates", async (req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const docs = await betfairService.getPriceUpdatesByEvent(req.params.eventId, limit);
    res.status(200).json({ success: true, data: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch price updates" });
  }
});

router.get("/api/stats", async (_req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const stats = await betfairService.getSummaryStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch stats" });
  }
});

router.get("/api/runners/pnl-stats", async (_req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const pnlStats = await betfairService.getRunnersPnlStats();
    res.status(200).json({ success: true, data: pnlStats });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch P&L stats" });
  }
});

router.get("/api/runners/filter-bounds", async (_req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const bounds = await betfairService.getRunnerFilterBounds();
    res.status(200).json({ success: true, data: bounds });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch filter bounds" });
  }
});

router.get("/api/runners/countries", async (_req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const countries = await betfairService.getDistinctCountryCodes();
    res.status(200).json({ success: true, data: countries });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch countries" });
  }
});

router.get("/api/runners", async (req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 20));
    const minRunners = Math.max(1, parseInt(req.query.minRunners as string) || 1);
    const maxRunners = Math.min(100, Math.max(1, parseInt(req.query.maxRunners as string) || 30));
    const countries = req.query.countries ? (req.query.countries as string).split(",").map(c => c.trim()).filter(Boolean) : [];
    const minBsp = Math.max(1, parseFloat(req.query.minBsp as string) || 1);
    const maxBsp = Math.min(100000, parseFloat(req.query.maxBsp as string) || 1000);
    const sortOrder = req.query.sort === "desc" ? "desc" : "asc";
    const { data, total, totalRunners, pnlStats } = await betfairService.getAllRunnersByRace(page, limit, minRunners, maxRunners, countries, minBsp, maxBsp, sortOrder);
    res.status(200).json({ success: true, data, count: data.length, total, page, limit, totalPages: Math.ceil(total / limit), totalRunners, pnlStats });
  } catch (error) {
    console.error("getAllRunnersByRace error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch all runners" });
  }
});

// 404 and error handlers
router.use((req, res) => {
  res.status(404).json({ error: "Not found", message: `Route ${req.originalUrl} not found` });
});

router.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error", message: "An unexpected error occurred" });
});

export { router };
