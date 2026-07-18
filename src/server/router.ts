import express from "express";
import { NaturalLanguageService } from "../lib/service/natural-language-service";
import { BetfairService } from "../lib/service/betfair-service";
import { IndustrySpService } from "../lib/service/industry-sp-service";
import { AuthService, AuthError } from "../lib/service/auth-service";
import { DatabaseConnection } from "../config/database";
import { jwtAuth } from "./middleware";

export { jwtAuth };

const router = express.Router();

let dbConnection: DatabaseConnection | null = null;
let naturalLanguageService: NaturalLanguageService | null = null;
let betfairService: BetfairService | null = null;
let industrySpService: IndustrySpService | null = null;
let authService: AuthService | null = null;

export const initializeServices = async () => {
  try {
    dbConnection = DatabaseConnection.getInstance();
    await dbConnection.connect();
    // Initialize betfairService first so API routes work even if NLS fails
    betfairService = new BetfairService(undefined, undefined);
    // Ensure indexes exist — required for the hint in getAllRunnersByRace;
    // without this the compound index may be absent on a fresh Atlas cluster.
    try {
      await betfairService.createIndexes();
    } catch (indexError) {
      console.warn("createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    industrySpService = new IndustrySpService();
    try {
      await industrySpService.createIndexes();
    } catch (indexError) {
      console.warn("industry-sp createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    authService = new AuthService(dbConnection.getDb());
    try {
      await authService.createIndexes();
    } catch (indexError) {
      console.warn("auth createIndexes failed (non-fatal, unique email check may hit the DB):", indexError);
    }
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

router.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const token = await authService!.signup(email, password);
    return res.status(201).json({ token });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Signup failed:", error);
    return res.status(500).json({ error: "Signup failed" });
  }
});

// The Lambda API backing this router is shared with the still-deployed
// `main`/backbet.co.uk frontend bundle, whose login form is hardcoded to
// POST {username: "matthew", password: "beyer"} rather than {email, password}.
// Alias that legacy shape onto the seeded test account's real email so that
// old bundle keeps working without a redeploy of its own.
const LEGACY_TEST_USERNAME = "matthew";
const LEGACY_TEST_EMAIL = "matthew@backbet.co.uk";

router.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  let { email } = req.body || {};
  if (!email && username === LEGACY_TEST_USERNAME) {
    email = LEGACY_TEST_EMAIL;
  }
  try {
    const token = await authService!.login(email, password);
    return res.status(200).json({ token });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

// All routes below require auth
router.use(jwtAuth);

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
    // This dataset only changes on a manual reseed, and the bounds are
    // identical for every caller — safe to let the browser skip the round
    // trip entirely on repeat page loads within the hour rather than
    // recomputing (and re-contending Atlas M0's limited concurrent
    // capacity with whatever else the page fetches at the same time).
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: bounds });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch filter bounds" });
  }
});

router.get("/api/runners/countries", async (_req, res) => {
  try {
    if (!betfairService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const countries = await betfairService.getDistinctCountryCodes();
    res.set("Cache-Control", "public, max-age=3600");
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
    const minInSp = Math.max(1, parseInt(req.query.minInSp as string) || 1);
    const maxInSp = Math.min(10000, Math.max(1, parseInt(req.query.maxInSp as string) || 10000));
    const fromRow = Math.max(1, parseInt(req.query.fromRow as string) || 1);
    const toRowRaw = parseInt(req.query.toRow as string);
    const toRow: number | null = isNaN(toRowRaw) ? null : Math.max(fromRow, toRowRaw);
    const { data, total, totalRunners, pnlStats } = await betfairService.getAllRunnersByRace(page, limit, minRunners, maxRunners, countries, minBsp, maxBsp, sortOrder, minInSp, maxInSp, fromRow, toRow);
    res.status(200).json({ success: true, data, count: data.length, total, page, limit, totalPages: Math.ceil(total / limit), totalRunners, pnlStats });
  } catch (error) {
    console.error("getAllRunnersByRace error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch all runners" });
  }
});

// minDate/maxDate arrive as plain "YYYY-MM-DD" strings; raceTime is a
// full ISO datetime string ("2024-03-05T14:01:00"). Lexicographic
// comparison means a bare date already behaves as an inclusive
// start-of-day lower bound ("2024-03-05" sorts before any same-day
// datetime), but the same trick makes it an *exclusive* upper bound (any
// same-day datetime sorts after the bare date) — so maxDate needs an
// end-of-day time appended to actually include that whole day.
function parseDateRangeParams(
  minDateRaw: unknown,
  maxDateRaw: unknown
): { minRaceTime: string | null; maxRaceTime: string | null } {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const minDate = typeof minDateRaw === "string" && DATE_RE.test(minDateRaw) ? minDateRaw : null;
  const maxDate = typeof maxDateRaw === "string" && DATE_RE.test(maxDateRaw) ? maxDateRaw : null;
  return {
    minRaceTime: minDate,
    maxRaceTime: maxDate ? `${maxDate}T23:59:59.999` : null,
  };
}

router.get("/api/industry-sp/pnl-stats", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const pnlStats = await industrySpService.getPnlStats();
    res.status(200).json({ success: true, data: pnlStats });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch P&L stats" });
  }
});

router.get("/api/industry-sp/filter-bounds", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const bounds = await industrySpService.getFilterBounds();
    // Same reasoning as /api/runners/filter-bounds above: this is one of
    // the slowest requests on the /isp home page (smoke-tested live at
    // ~1.5-4.5s even after removing the $unwind that used to make it much
    // worse) and its result is identical for every caller until the next
    // reseed — cache it so repeat page loads skip the round trip.
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: bounds });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch filter bounds" });
  }
});

router.get("/api/industry-sp/countries", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const countries = await industrySpService.getDistinctCountryCodes();
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: countries });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch countries" });
  }
});

router.get("/api/industry-sp/splits", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const minRunners = Math.max(1, parseInt(req.query.minRunners as string) || 1);
    const maxRunners = Math.min(100, Math.max(1, parseInt(req.query.maxRunners as string) || 30));
    const countries = req.query.countries ? (req.query.countries as string).split(",").map(c => c.trim()).filter(Boolean) : [];
    const minIsp = Math.max(1, parseFloat(req.query.minIsp as string) || 1);
    const maxIsp = Math.min(100000, parseFloat(req.query.maxIsp as string) || 1000);
    const minInIspRange = Math.max(1, parseInt(req.query.minInIspRange as string) || 1);
    const maxInIspRange = Math.min(10000, Math.max(1, parseInt(req.query.maxInIspRange as string) || 10000));

    // Omitting fromRowA/toRowA/fromRowB/toRowB entirely (not just leaving
    // them at "1"/unset) is what tells the service to compute the default
    // 50/50 split itself — see getSplitStats.
    // Clamped to >= 1 here (matching /api/industry-sp's fromRow handling)
    // as the first line of defense against a stale/hand-edited URL; the
    // DAO also clamps independently since it's the shared source of truth
    // for both this endpoint and /api/industry-sp — see getAllRacesByRace.
    const fromRowARaw = parseInt(req.query.fromRowA as string);
    const toRowARaw = parseInt(req.query.toRowA as string);
    const fromRowBRaw = parseInt(req.query.fromRowB as string);
    const toRowBRaw = parseInt(req.query.toRowB as string);
    const fromRowA = isNaN(fromRowARaw) ? null : Math.max(1, fromRowARaw);
    const toRowA = isNaN(toRowARaw) ? null : Math.max(1, toRowARaw);
    const fromRowB = isNaN(fromRowBRaw) ? null : Math.max(1, fromRowBRaw);
    const toRowB = isNaN(toRowBRaw) ? null : Math.max(1, toRowBRaw);
    const { minRaceTime, maxRaceTime } = parseDateRangeParams(req.query.minDate, req.query.maxDate);

    const result = await industrySpService.getSplitStats(
      minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange, fromRowA, toRowA, fromRowB, toRowB,
      minRaceTime, maxRaceTime
    );
    // Smoke-tested live: combined into one request and warm (no cold
    // start), this consistently takes ~2-2.5s — that's genuine Atlas M0
    // query latency for the underlying aggregations, not something
    // combining requests or indexing can shave further without a cluster
    // tier change. The dataset only changes on a manual reseed, so a short
    // cache still meaningfully helps the common case (reloading /isp, or
    // returning to the default view after tweaking filters back) without
    // risking real staleness. Shorter than filter-bounds/countries' 1hr
    // cache since split PnL figures feel more like "live" numbers to a
    // user than a static bound — 60s is enough to smooth out a browsing
    // session's repeat loads of the same filter combination.
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("getSplitStats error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch split stats" });
  }
});

router.get("/api/industry-sp", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 20));
    const minRunners = Math.max(1, parseInt(req.query.minRunners as string) || 1);
    const maxRunners = Math.min(100, Math.max(1, parseInt(req.query.maxRunners as string) || 30));
    const countries = req.query.countries ? (req.query.countries as string).split(",").map(c => c.trim()).filter(Boolean) : [];
    const minIsp = Math.max(1, parseFloat(req.query.minIsp as string) || 1);
    const maxIsp = Math.min(100000, parseFloat(req.query.maxIsp as string) || 1000);
    const sortOrder = req.query.sort === "desc" ? "desc" : "asc";
    const minInIspRange = Math.max(1, parseInt(req.query.minInIspRange as string) || 1);
    const maxInIspRange = Math.min(10000, Math.max(1, parseInt(req.query.maxInIspRange as string) || 10000));
    const fromRow = Math.max(1, parseInt(req.query.fromRow as string) || 1);
    const toRowRaw = parseInt(req.query.toRow as string);
    const toRow: number | null = isNaN(toRowRaw) ? null : Math.max(fromRow, toRowRaw);
    const { minRaceTime, maxRaceTime } = parseDateRangeParams(req.query.minDate, req.query.maxDate);
    const { data, total, totalRunners, pnlStats } = await industrySpService.getAllRacesByRace(page, limit, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minInIspRange, maxInIspRange, fromRow, toRow, minRaceTime, maxRaceTime);
    res.status(200).json({ success: true, data, count: data.length, total, page, limit, totalPages: Math.ceil(total / limit), totalRunners, pnlStats });
  } catch (error) {
    console.error("getAllRacesByRace error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch industry SP" });
  }
});

router.get("/api/industry-sp/meeting/:meetingId", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const data = await industrySpService.getRacesByMeetingId(req.params.meetingId);
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("getRacesByMeetingId error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch meeting" });
  }
});

router.get("/api/industry-sp/race/:raceId", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const raceId = parseInt(req.params.raceId, 10);
    if (isNaN(raceId)) return res.status(400).json({ success: false, error: "Invalid raceId" });
    const race = await industrySpService.getRaceById(raceId);
    if (!race) return res.status(404).json({ success: false, error: "Race not found" });
    res.status(200).json({ success: true, data: race });
  } catch (error) {
    console.error("getRaceById error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch race" });
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
