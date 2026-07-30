import express from "express";
import jwt from "jsonwebtoken";
import config from "config";
import { CodebaseSearchService, ChatHistoryTurn } from "../lib/service/codebase-search-service";
import { BetfairService } from "../lib/service/betfair-service";
import { IndustrySpService } from "../lib/service/industry-sp-service";
import { DailyRaceService } from "../lib/service/daily-race-service";
import { IndustrySpResultsCaptureService } from "../lib/service/industry-sp-results-capture-service";
import { RacingApiClient } from "../lib/service/racing-api-client";
import { TrainerFormService } from "../lib/service/trainer-form-service";
import { ModelVersionService } from "../lib/service/model-version-service";
import { SavedFilterSetService, computeSnapshotParamsFromFilters } from "../lib/service/saved-filter-set-service";
import { LiveFilterResultService } from "../lib/service/live-filter-result-service";
import { BetOrderService } from "../lib/service/bet-order-service";
import { BetOrderType } from "../lib/dao/bet-order-dao";
import { LivePriceService } from "../lib/service/live-price-service";
import type { PickToResolve } from "../lib/service/betfair-market-resolver";
import {
  parseDateRangeParams,
  parseCsvListParam,
  parseFloatParam,
  clampPct,
  clampModelVsSpDateWindow,
} from "../lib/service/filter-params-util";
import type { ModelVsSpSort } from "../lib/dao/industry-sp-dao";
import { AuthService, AuthError } from "../lib/service/auth-service";
import { DatabaseConnection } from "../config/database";
import { jwtAuth, optionalJwtAuth } from "./middleware";

export { jwtAuth };

const router = express.Router();

let dbConnection: DatabaseConnection | null = null;
let codebaseSearchService: CodebaseSearchService | null = null;
let betfairService: BetfairService | null = null;
let industrySpService: IndustrySpService | null = null;
let dailyRaceService: DailyRaceService | null = null;
let industrySpResultsCaptureService: IndustrySpResultsCaptureService | null = null;
let trainerFormService: TrainerFormService | null = null;
let modelVersionService: ModelVersionService | null = null;
let savedFilterSetService: SavedFilterSetService | null = null;
let liveFilterResultService: LiveFilterResultService | null = null;
let authService: AuthService | null = null;
let betOrderService: BetOrderService | null = null;
// REAL BUG FOUND AND FIXED 2026-07-29 (see AGENTS.md's bets-tab-load-fix
// entry): initializeServices() below used to swallow any error from the
// DB-connect/service-construction block in a bare `catch { console.error
// (...) }` with no rethrow — a single TRANSIENT failure (e.g. a Mongo
// connection blip on cold start) left every service above permanently
// `null` for that Lambda execution environment's entire remaining
// lifetime, since apps/lambda/src/handler.ts only ever called this once
// at module load and cached the (silently-"succeeded") promise. Every
// subsequent request on that same warm container then got a real
// `{success:false, error:"Service not initialized"}` 503 from every
// route's own defensive null-check, until AWS eventually recycled the
// container — unpredictable, and affecting the whole app, not one route.
// This flag lets a caller detect that failure and retry initialization
// on the next request instead of being stuck forever; see
// apps/lambda/src/handler.ts's ensureServicesReady().
let servicesReady = false;

export function areServicesReady(): boolean {
  return servicesReady;
}

export const initializeServices = async () => {
  servicesReady = false;
  // Independent of the DB connection below — the chat feature no longer
  // touches MongoDB at all, so it's constructed unconditionally and can
  // still work even if the database itself is unavailable.
  try {
    codebaseSearchService = new CodebaseSearchService();
  } catch (searchError) {
    console.error("CodebaseSearchService init failed (chat will be unavailable):", searchError);
  }

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
    dailyRaceService = new DailyRaceService();
    try {
      await dailyRaceService.createIndexes();
    } catch (indexError) {
      console.warn("daily-race createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    industrySpResultsCaptureService = new IndustrySpResultsCaptureService();
    trainerFormService = new TrainerFormService();
    try {
      await trainerFormService.createIndexes();
    } catch (indexError) {
      console.warn("trainer-form createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    modelVersionService = new ModelVersionService();
    savedFilterSetService = new SavedFilterSetService();
    liveFilterResultService = new LiveFilterResultService();
    try {
      await liveFilterResultService.createIndexes();
    } catch (indexError) {
      console.warn("live-filter-result createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    authService = new AuthService(dbConnection.getDb());
    try {
      await authService.createIndexes();
    } catch (indexError) {
      console.warn("auth createIndexes failed (non-fatal, unique email check may hit the DB):", indexError);
    }
    betOrderService = new BetOrderService();
    try {
      await betOrderService.createIndexes();
    } catch (indexError) {
      console.warn("bet-order createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    console.log("Services initialized successfully");
    servicesReady = true;
  } catch (error) {
    console.error("Failed to initialize services:", error);
    // Rethrown (unlike the old behavior) so the caller — the Lambda
    // handler's ensureServicesReady() — can detect the failure and retry
    // on the next request, rather than silently caching a "succeeded"
    // promise around a container that's actually unusable.
    throw error;
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
    const { token, emailVerified } = await authService!.signup(email, password);
    return res.status(201).json({ token, emailVerified });
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
    const { token, emailVerified } = await authService!.login(email, password);
    return res.status(200).json({ token, emailVerified });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

// Public — reached by clicking the link in the verification email, not
// necessarily from a logged-in session. Returns a small static HTML page
// (same pattern as /hello-world above) rather than redirecting into the
// SPA, since there's nothing for the app itself to do with this request.
router.get("/api/auth/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const renderPage = (title: string, message: string) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — BackBet</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0f4f8; flex-direction: column; gap: 1rem; text-align: center; padding: 0 1.5rem; }
    h1 { font-size: 2rem; color: #0B3D2E; margin: 0; }
    p { color: #4a5568; margin: 0; }
    a { color: #2F6B4F; font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
  <p><a href="${APP_URL}">Return to BackBet</a></p>
</body>
</html>`);
  };
  try {
    const { email } = await authService!.verifyEmail(token);
    res.status(200);
    return renderPage("Email verified", `${email} is now verified — you can close this tab and return to BackBet.`);
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.status);
      return renderPage("Verification failed", error.message);
    }
    console.error("Email verification failed:", error);
    res.status(500);
    return renderPage("Verification failed", "Something went wrong — please try again.");
  }
});

router.post("/api/auth/google", async (req, res) => {
  const { idToken } = req.body || {};
  try {
    const { token, emailVerified } = await authService!.signInWithGoogle(idToken);
    return res.status(200).json({ token, emailVerified });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Google sign-in failed:", error);
    return res.status(500).json({ error: "Google sign-in failed" });
  }
});

router.post("/api/auth/sms/send", async (req, res) => {
  const { phone } = req.body || {};
  try {
    await authService!.sendSmsCode(phone);
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Sending SMS code failed:", error);
    return res.status(500).json({ error: "Failed to send verification code" });
  }
});

router.post("/api/auth/sms/verify", async (req, res) => {
  const { phone, code } = req.body || {};
  try {
    const { token, emailVerified } = await authService!.verifySmsCode(phone, code);
    return res.status(200).json({ token, emailVerified });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("SMS verification failed:", error);
    return res.status(500).json({ error: "SMS verification failed" });
  }
});

// /api/industry-sp* is public — it's the app's anonymous-accessible home
// page. optionalJwtAuth never blocks; it just records whether the caller
// is authenticated (res.locals.isAuthenticated) so the route handlers
// below can pick a 100-race (anon) vs 1000-race (authenticated) cap on
// the Split A/Split B windows. Every other route stays behind the hard
// `router.use(jwtAuth)` gate further down, unchanged.
router.use("/api/industry-sp", optionalJwtAuth);

// Anonymous callers get a 100-race window on /api/industry-sp*, a
// logged-in caller gets 10000 (see getSplitStats for the Split A/Split B
// version of this same cap) — enforced here too since this is the plain
// list endpoint "View Races" and the meeting/race drill-down flow hit
// directly, with its own fromRow/toRow independent of /splits. An
// open-ended toRow (null, "through the end") is treated as "exactly the
// cap", not "unlimited", so the cap can't be bypassed by simply omitting
// toRow.
function clampRowSpan(fromRow: number, toRow: number | null, isAuth: boolean): number {
  const cap = isAuth ? 10000 : 100;
  const maxTo = fromRow + cap - 1;
  return toRow == null ? maxTo : Math.min(toRow, maxTo);
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

router.get("/api/industry-sp/courses", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const courses = await industrySpService.getDistinctCourses();
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: courses });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch courses" });
  }
});

router.get("/api/industry-sp/goings", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const goings = await industrySpService.getDistinctGoings();
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: goings });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch goings" });
  }
});

router.get("/api/industry-sp/race-classes", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const raceClasses = await industrySpService.getDistinctRaceClasses();
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: raceClasses });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch race classes" });
  }
});

router.get("/api/industry-sp/race-types", async (_req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const raceTypes = await industrySpService.getDistinctRaceTypes();
    res.set("Cache-Control", "public, max-age=3600");
    res.status(200).json({ success: true, data: raceTypes });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch race types" });
  }
});

router.get("/api/model-versions", async (_req, res) => {
  try {
    if (!modelVersionService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const data = await modelVersionService.getAllModelVersions();
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("getAllModelVersions error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch model versions" });
  }
});

// Service-to-service auth for the ML training pipeline (ml/train_and_predict.py)
// — a fixed shared secret, not a user JWT, since the caller is an unattended
// script with no logged-in user. Requires the configured secret to be
// non-empty so an unset TRAINING_PIPELINE_API_KEY (config/default.json ships
// "") always rejects rather than accidentally matching an empty header.
function isValidAgentApiKey(req: express.Request): boolean {
  const key = req.headers["x-training-pipeline-api-key"];
  const expected = config.get<string>("trainingPipeline.agentApiKey");
  return typeof key === "string" && expected.length > 0 && key === expected;
}

// Lives up here with the other pre-jwtAuth public routes (rather than beside
// its 4 sibling /api/saved-filter-sets routes below router.use(jwtAuth)),
// because it must skip JWT auth entirely — computeSnapshotParamsFromFilters
// is a hoisted function declaration further down this file, safe to call
// from here. One doc per curated filter-battery entry, reusing the exact
// same aggregation path (via SavedFilterSetService.saveAgentResult) that
// the live Filters screen's own Save button uses.
router.post("/api/saved-filter-sets/agent", async (req, res) => {
  if (!isValidAgentApiKey(req)) return res.status(401).json({ success: false, error: "Invalid or missing API key" });
  try {
    if (!savedFilterSetService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const filters = req.body?.filters && typeof req.body.filters === "object" ? (req.body.filters as Record<string, string>) : null;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const modelVersionId = typeof req.body?.modelVersionId === "string" ? req.body.modelVersionId.trim() : "";
    if (!filters) return res.status(400).json({ success: false, error: "filters is required" });
    if (!name) return res.status(400).json({ success: false, error: "name is required" });
    if (!modelVersionId) return res.status(400).json({ success: false, error: "modelVersionId is required" });
    const computeParams = computeSnapshotParamsFromFilters(filters);
    const data = await savedFilterSetService.saveAgentResult(name, filters, computeParams, modelVersionId);
    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("saveAgentFilterSet error:", error);
    res.status(500).json({ success: false, error: "Failed to save agent result" });
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
    const courses = parseCsvListParam(req.query.courses);
    const goings = parseCsvListParam(req.query.goings);
    const raceClasses = parseCsvListParam(req.query.raceClasses);
    const raceTypes = parseCsvListParam(req.query.raceTypes);
    const trainerSearch = typeof req.query.trainer === "string" && req.query.trainer.trim() ? req.query.trainer.trim() : null;
    const jockeySearch = typeof req.query.jockey === "string" && req.query.jockey.trim() ? req.query.jockey.trim() : null;
    const trainerFormMinWinRate = Math.min(100, Math.max(0, parseFloat(req.query.trainerFormMinWinRate as string) || 0));
    const minTrainerFormRunners = Math.max(0, parseInt(req.query.minTrainerFormRunners as string) || 0);
    const maxTrainerFormRunners = Math.min(100, Math.max(0, parseInt(req.query.maxTrainerFormRunners as string) || 100));
    const minModelWinProbability = Math.min(100, Math.max(0, parseFloat(req.query.minModelWinProbability as string) || 0));
    const onlyModelBeatsSp = req.query.onlyModelBeatsSp === "true";

    // Set by optionalJwtAuth (registered on /api/industry-sp above) —
    // decides the Split A/Split B race cap: 100 anonymous, 10000 logged in.
    const isAuth = res.locals.isAuthenticated === true;
    const raceCap = isAuth ? 10000 : 100;

    const result = await industrySpService.getSplitStats(
      minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange, fromRowA, toRowA, fromRowB, toRowB,
      minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
      trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, minModelWinProbability, onlyModelBeatsSp,
      raceCap
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

router.get("/api/industry-sp/race-convergence", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const minRunners = Math.max(1, parseInt(req.query.minRunners as string) || 1);
    const maxRunners = Math.min(100, Math.max(1, parseInt(req.query.maxRunners as string) || 30));
    const countries = req.query.countries ? (req.query.countries as string).split(",").map(c => c.trim()).filter(Boolean) : [];
    const minIsp = Math.max(1, parseFloat(req.query.minIsp as string) || 1);
    const maxIsp = Math.min(100000, parseFloat(req.query.maxIsp as string) || 1000);
    const minInIspRange = Math.max(1, parseInt(req.query.minInIspRange as string) || 1);
    const maxInIspRange = Math.min(10000, Math.max(1, parseInt(req.query.maxInIspRange as string) || 10000));
    const { minRaceTime, maxRaceTime } = parseDateRangeParams(req.query.minDate, req.query.maxDate);
    const courses = parseCsvListParam(req.query.courses);
    const goings = parseCsvListParam(req.query.goings);
    const raceClasses = parseCsvListParam(req.query.raceClasses);
    const raceTypes = parseCsvListParam(req.query.raceTypes);
    const trainerSearch = typeof req.query.trainer === "string" && req.query.trainer.trim() ? req.query.trainer.trim() : null;
    const jockeySearch = typeof req.query.jockey === "string" && req.query.jockey.trim() ? req.query.jockey.trim() : null;
    const trainerFormMinWinRate = Math.min(100, Math.max(0, parseFloat(req.query.trainerFormMinWinRate as string) || 0));
    const minTrainerFormRunners = Math.max(0, parseInt(req.query.minTrainerFormRunners as string) || 0);
    const maxTrainerFormRunners = Math.min(100, Math.max(0, parseInt(req.query.maxTrainerFormRunners as string) || 100));
    const minModelWinProbability = Math.min(100, Math.max(0, parseFloat(req.query.minModelWinProbability as string) || 0));
    const onlyModelBeatsSp = req.query.onlyModelBeatsSp === "true";

    const toRowRaw = parseInt(req.query.toRow as string);
    if (isNaN(toRowRaw) || toRowRaw < 1) {
      return res.status(400).json({ success: false, error: "toRow is required and must be a positive integer" });
    }
    // Defaults to 1 (the dataset's true start) when omitted — a caller
    // asking for the graph without a fromRow gets the same behavior as
    // before fromRow existed. Split A's own Graph button always sends 1
    // explicitly; Split B's sends its own first race's row number, so its
    // convergence line restarts fresh there instead of continuing Split
    // A's already-settled running total.
    const fromRowRaw = parseInt(req.query.fromRow as string);
    const fromRow = isNaN(fromRowRaw) || fromRowRaw < 1 ? 1 : fromRowRaw;
    if (fromRow > toRowRaw) {
      return res.status(400).json({ success: false, error: "fromRow must not exceed toRow" });
    }

    // Set by optionalJwtAuth (registered on /api/industry-sp above) — same
    // race cap the split cards themselves use, so the graph never scans
    // further than a split could anyway.
    const isAuth = res.locals.isAuthenticated === true;
    const raceCap = isAuth ? 10000 : 100;
    const toRow = Math.min(toRowRaw, fromRow + raceCap - 1);

    const data = await industrySpService.getRaceConvergenceSeries(
      minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
      minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
      trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, minModelWinProbability, onlyModelBeatsSp,
      fromRow, toRow
    );
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("getRaceConvergenceSeries error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch race convergence series" });
  }
});

router.get("/api/industry-sp", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    // getAllRacesByRace's $facet packs the "data" page, "total",
    // "totalRunners", and "pnlStats" branches into a single BSON document —
    // that's a MongoDB $facet property, not something an index or
    // allowDiskUse changes — so the whole result must fit under Mongo's
    // 16MB single-document limit regardless of collection size. Confirmed
    // live against production data: a single request's "data" page of
    // ~2560 full races (with their runners arrays reattached) produced a
    // ~20.5MB result and failed with `BSONObjectTooLarge`; 2400 succeeded.
    // Clamped well under that measured threshold (with real-world margin
    // for races with larger-than-average runners arrays) rather than at
    // the previous 10000, which could trip this on nothing more than an
    // innocent "load everything at once" request.
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit as string) || 20));
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
    const toRowRequested: number | null = isNaN(toRowRaw) ? null : Math.max(fromRow, toRowRaw);
    // Set by optionalJwtAuth (registered on /api/industry-sp above).
    const isAuth = res.locals.isAuthenticated === true;
    const toRow: number | null = clampRowSpan(fromRow, toRowRequested, isAuth);
    const { minRaceTime, maxRaceTime } = parseDateRangeParams(req.query.minDate, req.query.maxDate);
    const courses = parseCsvListParam(req.query.courses);
    const goings = parseCsvListParam(req.query.goings);
    const raceClasses = parseCsvListParam(req.query.raceClasses);
    const raceTypes = parseCsvListParam(req.query.raceTypes);
    const trainerSearch = typeof req.query.trainer === "string" && req.query.trainer.trim() ? req.query.trainer.trim() : null;
    const jockeySearch = typeof req.query.jockey === "string" && req.query.jockey.trim() ? req.query.jockey.trim() : null;
    const trainerFormMinWinRate = Math.min(100, Math.max(0, parseFloat(req.query.trainerFormMinWinRate as string) || 0));
    const minTrainerFormRunners = Math.max(0, parseInt(req.query.minTrainerFormRunners as string) || 0);
    const maxTrainerFormRunners = Math.min(100, Math.max(0, parseInt(req.query.maxTrainerFormRunners as string) || 100));
    const runnerName = typeof req.query.runnerName === "string" && req.query.runnerName.trim() ? req.query.runnerName.trim() : null;
    const minModelWinProbability = Math.min(100, Math.max(0, parseFloat(req.query.minModelWinProbability as string) || 0));
    const onlyModelBeatsSp = req.query.onlyModelBeatsSp === "true";
    const modelVersionId = typeof req.query.modelVersionId === "string" && req.query.modelVersionId.trim() ? req.query.modelVersionId.trim() : null;
    // Restricts an already-row-ranged window to a calendar sub-range —
    // see the DAO's own comment on subMinRaceTime/subMaxRaceTime. Distinct
    // from minDate/maxDate above: those participate in defining the row
    // range itself, these narrow *within* it without changing what "row
    // N" means. Used by IspRacesScreen's per-year loading (tap a
    // collapsed year -> a normal small paginated request scoped to that
    // year, instead of walking the whole row range forward to reach it).
    const { minRaceTime: subMinRaceTime, maxRaceTime: subMaxRaceTime } = parseDateRangeParams(req.query.subMinDate, req.query.subMaxDate);
    const { data, total, totalRunners, pnlStats } = await industrySpService.getAllRacesByRace(page, limit, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minInIspRange, maxInIspRange, fromRow, toRow, minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, runnerName, minModelWinProbability, onlyModelBeatsSp, modelVersionId, subMinRaceTime, subMaxRaceTime);
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

router.get("/api/trainer-form", async (req, res) => {
  try {
    if (!trainerFormService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const trainer = typeof req.query.trainer === "string" ? req.query.trainer.trim() : "";
    const formCategory = req.query.formCategory === "Flat" || req.query.formCategory === "Jumps" ? req.query.formCategory : null;
    if (!trainer || !formCategory) {
      return res.status(400).json({ success: false, error: "trainer and formCategory (Flat|Jumps) are required" });
    }
    const data = await trainerFormService.getTrainerForm(trainer, formCategory);
    if (!data) return res.status(404).json({ success: false, error: "Trainer form not found" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getTrainerForm error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch trainer form" });
  }
});

// All routes below require auth
router.use(jwtAuth);

// jwtAuth (above) already verified the Bearer token exists and is valid —
// this just re-decodes it to read the `sub` claim (the user's id) back
// out. Keyed by id rather than email — a phone-only or some Google
// accounts have no email at all, so email can't be the universal
// identity claim anymore. Not attached to `req` by jwtAuth itself (that
// middleware only gates), so each route that needs the caller's identity
// decodes independently rather than everything depending on a shared
// req.user convention.
function userIdFromAuthHeader(req: express.Request): string | null {
  try {
    const token = (req.headers.authorization || "").slice(7);
    const secret = config.get<string>("jwt.secret");
    const payload = jwt.verify(token, secret) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

router.get("/api/auth/me", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ error: "Invalid or expired token" });
  try {
    const me = await authService!.getMe(userId);
    if (!me) return res.status(404).json({ error: "Account not found" });
    return res.status(200).json({ success: true, ...me });
  } catch (error) {
    console.error("getMe failed:", error);
    return res.status(500).json({ error: "Failed to fetch account" });
  }
});

router.post("/api/auth/resend-verification", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ error: "Invalid or expired token" });
  try {
    const result = await authService!.resendVerification(userId);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("resendVerification failed:", error);
    return res.status(500).json({ error: "Failed to resend verification email" });
  }
});

// Runner-level (not race-level) rows comparing the model's own win probability
// against the probability each runner's industry SP implies (100/isp), plus the
// signed percentage-point gap between them — the Model vs SP screen.
//
// Login-gated, and the placement is what enforces that, not the path: every
// handler registered ABOVE `router.use(jwtAuth)` under the /api/industry-sp
// prefix inherits optionalJwtAuth instead (that prefix is the app's anonymous
// home page). Registering this next to its natural /api/industry-sp siblings
// would have silently shipped an anonymous endpoint, so it lives below the gate
// AND outside that prefix, so the two signals agree. The 401 test in
// src/server/__tests__/app.test.ts is the actual guard.
router.get("/api/model-vs-sp", async (req, res) => {
  try {
    if (!industrySpService) return res.status(503).json({ success: false, error: "Service not initialized" });

    const page = Math.min(100000, Math.max(1, parseInt(req.query.page as string) || 1));
    // No $facet in this query (see getModelVsSpRunners), so the 16MB
    // single-BSON-doc ceiling that forces /api/industry-sp's limit down to 2000
    // doesn't apply here. This cap is about per-request M0 cost and payload
    // size instead, at roughly 300 bytes per row.
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

    const sortRaw = req.query.sort;
    const sort: ModelVsSpSort =
      sortRaw === "date_asc" || sortRaw === "edge_desc" || sortRaw === "edge_asc" ? sortRaw : "date_desc";

    // Always bounded, and the span clamped to keep a cold load near a second —
    // the edge sort has no index able to serve it and its cost scales linearly
    // with the window (measured: ~106ms for a month, ~1.1s for a year, ~11.5s for
    // the whole collection; see MODEL_VS_SP_MAX_SPAN_DAYS). Clamping rather than
    // 400ing an over-wide range matches the convention everywhere else in this
    // file; the trade-off is that a shared URL with a hand-edited 5-year range
    // quietly shows one year rather than telling the user why.
    const { minRaceTime, maxRaceTime, minDate, maxDate } = clampModelVsSpDateWindow(
      req.query.minDate,
      req.query.maxDate
    );

    // parseFloatParam, not the `parseFloat(x) || DEFAULT` idiom used elsewhere in
    // this file: 0 is falsy, and 0 is exactly the boundary that makes these
    // filters useful ("only runners the model rates above the market" is
    // minEdge=0, "only below" is maxEdge=0). The `||` form would silently widen
    // both back to the ±100 default and match everything.
    const minModelProb = clampPct(parseFloatParam(req.query.minModelProb, 0));
    const maxModelProb = clampPct(parseFloatParam(req.query.maxModelProb, 100));
    const minImpliedProb = clampPct(parseFloatParam(req.query.minImpliedProb, 0));
    const maxImpliedProb = clampPct(parseFloatParam(req.query.maxImpliedProb, 100));
    // The difference filter is unsigned: it asks how FAR apart the model and the
    // market are, not which way round. |edge| can't exceed 100 (both sides are
    // percentages), so the range is 0-100 rather than ±100.
    const minAbsEdge = clampPct(parseFloatParam(req.query.minAbsEdge, 0));
    const maxAbsEdge = clampPct(parseFloatParam(req.query.maxAbsEdge, 100));

    const minIsp = Math.max(1, parseFloatParam(req.query.minIsp, 1));
    const maxIsp = Math.min(100000, parseFloatParam(req.query.maxIsp, 1000));
    const minRunners = Math.max(1, parseInt(req.query.minRunners as string) || 1);
    const maxRunners = Math.min(100, Math.max(1, parseInt(req.query.maxRunners as string) || 30));
    const countries = parseCsvListParam(req.query.countries);

    // A pure page step already knows the total AND the summary from the request
    // that loaded page 1, so it opts out of both — halving this endpoint's cost
    // per Next/Prev on a tier where concurrency, not per-query time, is the
    // ceiling.
    const includeTotal = req.query.includeTotal !== "false";

    const { rows, total, summary } = await industrySpService.getModelVsSpRunners({
      page,
      limit,
      sort,
      minRaceTime,
      maxRaceTime,
      minModelProb,
      maxModelProb,
      minImpliedProb,
      maxImpliedProb,
      minAbsEdge,
      maxAbsEdge,
      minIsp,
      maxIsp,
      minRunners,
      maxRunners,
      countries,
      includeTotal,
    });

    res.status(200).json({
      success: true,
      data: rows,
      count: rows.length,
      total,
      page,
      limit,
      // null (not 0) when the count was skipped — the client keeps showing the
      // total it already had rather than flashing "0 runners" on every page step.
      totalPages: total != null ? Math.ceil(total / limit) : null,
      sort,
      // Echoed back so the client can tell when its requested window was clamped
      // (or defaulted) and reflect the window actually queried.
      minDate,
      maxDate,
      // How the model's accuracy is distributed across every runner matching the
      // other filters — the denominator deliberately ignores the difference
      // range, so narrowing that filter doesn't move its own baseline. null
      // alongside total when the count was skipped.
      summary,
    });
  } catch (error) {
    console.error("getModelVsSpRunners error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch model vs SP" });
  }
});

// Daily Races (RacingAPI-backed) — login-gated, unlike the public
// /api/industry-sp/* family, since this is a new user-facing view rather
// than the historical/public ISP data.
router.get("/api/daily-races", async (req, res) => {
  try {
    if (!dailyRaceService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const date = typeof req.query.date === "string" && req.query.date.trim() ? req.query.date.trim() : new Date().toISOString().slice(0, 10);
    const data = await dailyRaceService.getDailyRaces(date);
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("getDailyRaces error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch daily races" });
  }
});

router.get("/api/daily-races/event/:eventId", async (req, res) => {
  try {
    if (!dailyRaceService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const data = await dailyRaceService.getDailyRacesByEvent(req.params.eventId);
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("getDailyRacesByEvent error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch event" });
  }
});

router.get("/api/daily-races/race/:raceId", async (req, res) => {
  try {
    if (!dailyRaceService) return res.status(503).json({ success: false, error: "Service not initialized" });
    // raceId is a RacingAPI string (e.g. "rac_123") — no parseInt, unlike
    // industry-sp's numeric raceId.
    const race = await dailyRaceService.getDailyRaceById(req.params.raceId);
    if (!race) return res.status(404).json({ success: false, error: "Race not found" });
    res.status(200).json({ success: true, data: race });
  } catch (error) {
    console.error("getDailyRaceById error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch race" });
  }
});

// On-demand alternative to running ml/predict_daily_races.py by hand —
// scores a date's already-ingested, already-feature-computed races via the
// internal ml-prediction-api Lambda (apps/ml-api, see prediction-api-client.ts).
// v1 is manually/API-triggered only, not wired into the scheduled
// EventBridge ingest in apps/lambda/src/handler.ts.
router.post("/api/daily-races/predict", async (req, res) => {
  try {
    if (!dailyRaceService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : new Date().toISOString().slice(0, 10);
    const result = await dailyRaceService.predictDailyRaces(date);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("predictDailyRaces error:", error);
    res.status(500).json({ success: false, error: "Failed to predict daily races" });
  }
});

// User-triggered "try to fetch results now" for a given date's Today's
// Picks (see DailyRacesScreen.tsx's missing-results prompt) — a manual
// on-demand alternative to waiting for the 10-minute results-capture cron.
// RacingAPI's Basic plan only ever exposes ONE results endpoint,
// "/results/today" — confirmed live (not inferred) that even the literal
// current date as a path segment (e.g. "/results/2026-07-28") still 401s
// "Standard Plan required", so a genuinely past date can never succeed
// here; only calling the literal "/results/today" path while today is
// still the date being viewed can ever return real data. That plan-tier
// failure is expected/routine, not a server error — reported back as
// success:false with a plain-language message, not a 500.
router.post("/api/daily-races/reseed-results", async (req, res) => {
  try {
    if (!industrySpResultsCaptureService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const today = new Date().toISOString().slice(0, 10);
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : today;
    const path = date === today ? undefined : `/results/${date}`;
    const result = await industrySpResultsCaptureService.captureTodayResults(new RacingApiClient(), path);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Standard Plan required")) {
      return res.status(200).json({
        success: false,
        error: "plan_required",
        message:
          "Our racing data provider only lets us fetch today's results on our current plan — results for past days can't be pulled in after the fact. This isn't a bug, it's a limit of the data subscription.",
      });
    }
    console.error("reseedResults error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch results" });
  }
});

// Saved filter-set "Results" — the first user-owned MongoDB resource in
// this codebase, so all 4 routes live here (after router.use(jwtAuth)
// above), not alongside the public /api/model-versions route. filters is
// the raw ISP_FILTER_PARAM_NAMES string map from the client (see
// client/src/utils/ispUrlParams.ts) — parsed via computeSnapshotParamsFromFilters
// (saved-filter-set-service.ts) into ComputeSnapshotParams using the exact
// same helpers/clamping /api/industry-sp/splits uses, so the snapshot's
// PnL/graph is computed identically to what the Filters screen itself would
// have shown. Also reused by LiveFilterResultService for the live,
// day-by-day counterpart to this snapshot.

router.post("/api/saved-filter-sets", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!savedFilterSetService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const filters = req.body?.filters && typeof req.body.filters === "object" ? (req.body.filters as Record<string, string>) : null;
    if (!filters) return res.status(400).json({ success: false, error: "filters is required" });
    const computeParams = computeSnapshotParamsFromFilters(filters);
    const data = await savedFilterSetService.saveResult(userId, req.body?.name, filters, computeParams);
    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("saveFilterSet error:", error);
    res.status(500).json({ success: false, error: "Failed to save result" });
  }
});

router.get("/api/saved-filter-sets", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!savedFilterSetService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const data = await savedFilterSetService.listForUser(userId);
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("listSavedFilterSets error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch saved results" });
  }
});

router.get("/api/saved-filter-sets/:id", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!savedFilterSetService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const data = await savedFilterSetService.getForUser(req.params.id, userId);
    if (!data) return res.status(404).json({ success: false, error: "Not found" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getSavedFilterSet error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch saved result" });
  }
});

router.get("/api/saved-filter-sets/:id/live-performance", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!savedFilterSetService || !liveFilterResultService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    // Same ownership rule as GET /api/saved-filter-sets/:id (owner, or any
    // logged-in user for an agent-generated result) — 404 rather than 403
    // for the same reason deleteForUser above doesn't distinguish "doesn't
    // exist" from "belongs to someone else".
    const filterSet = await savedFilterSetService.getForUser(req.params.id, userId);
    if (!filterSet) return res.status(404).json({ success: false, error: "Not found" });
    const data = await liveFilterResultService.listForFilterSet(req.params.id);
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("getLiveFilterPerformance error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch live performance" });
  }
});

router.delete("/api/saved-filter-sets/:id", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!savedFilterSetService) return res.status(503).json({ success: false, error: "Service not initialized" });
    // 404 whether the doc doesn't exist or belongs to another user —
    // deleteForUser's filter is {_id, userId} together, so it can't tell
    // (and shouldn't leak) the difference.
    const deleted = await savedFilterSetService.deleteForUser(req.params.id, userId);
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("deleteSavedFilterSet error:", error);
    res.status(500).json({ success: false, error: "Failed to delete saved result" });
  }
});

// Betfair bet orders — mirrors /api/saved-filter-sets' shape as the second
// user-owned MongoDB resource in this codebase (see bet-order-dao.ts).
// Two orderTypes share this one endpoint (see bet-order-service.ts):
// "scheduled" (default) only ever schedules a watch — BetOrderService's own
// evaluatePendingOrders (run on a schedule, see apps/lambda/src/handler.ts)
// is what later calls Betfair's real placeOrders for it. "instant" calls
// placeOrders synchronously, right here in this request. Either way,
// placeOrders itself only reaches Betfair's real endpoint while config
// betfair.dryRun=false (default true, see betfair-api-client.ts) AND the
// requester's own email matches BetfairApiClient.getLiveBettingAllowedEmail()
// — the email is looked up server-side via authService.getMe(userId) below,
// never trusted from the request body, since it's the sole input to that
// per-request identity gate (bet-order-service.ts's `liveBettingAllowed`).
router.post("/api/bet-orders", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!betOrderService || !authService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const body = req.body ?? {};
    const requiredStrings = ["runnerId", "horse", "course", "offTime", "offDt", "raceId", "eventId"];
    for (const field of requiredStrings) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        return res.status(400).json({ success: false, error: `${field} is required` });
      }
    }
    const targetProfit = Number(body.targetProfit);
    const maxStake = Number(body.maxStake);
    // Old cached client bundles won't send orderType at all — default to
    // "scheduled" so they keep today's behavior unchanged.
    const orderType: BetOrderType = body.orderType === "instant" ? "instant" : "scheduled";
    // Absent/anything-but-literal-true -> false, same fail-safe direction
    // as every other boolean this route parses.
    const sandbox = body.sandbox === true;
    const me = await authService.getMe(userId);
    const data = await betOrderService.createForUser(
      userId,
      {
        runnerId: body.runnerId,
        horse: body.horse,
        course: body.course,
        offTime: body.offTime,
        offDt: body.offDt,
        raceId: body.raceId,
        eventId: body.eventId,
        targetProfit,
        maxStake,
        orderType,
        sandbox,
      },
      me?.email ?? null
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create bet order";
    // targetProfit/maxStake validation errors, including the maxStake
    // safety cap, are the caller's mistake (bad input), not a server fault.
    if (message.includes("must be a positive number") || message.includes("cannot exceed")) {
      return res.status(400).json({ success: false, error: message });
    }
    // An instant bet that couldn't be safely placed (ambiguous market
    // match, or the current price doesn't meet the user's target) — the
    // caller's request was well-formed, there's just nothing to place.
    if (message.startsWith("INSTANT_BET_REJECTED: ")) {
      return res.status(400).json({ success: false, error: message.replace("INSTANT_BET_REJECTED: ", "") });
    }
    // A placeOrders attempt completed but the result couldn't be saved —
    // genuinely different from "nothing happened", so it gets its own
    // specific message rather than the generic one below (see
    // bet-order-service.ts's logPossiblePhantomRealBet).
    if (message.startsWith("INSTANT_BET_PERSISTENCE_FAILED: ")) {
      console.error("createBetOrder persistence failure:", error);
      return res.status(500).json({ success: false, error: message.replace("INSTANT_BET_PERSISTENCE_FAILED: ", "") });
    }
    console.error("createBetOrder error:", error);
    res.status(500).json({ success: false, error: "Failed to create bet order" });
  }
});

router.get("/api/bet-orders", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!betOrderService) return res.status(503).json({ success: false, error: "Service not initialized" });
    const data = await betOrderService.listForUser(userId);
    res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error("listBetOrders error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch bet orders" });
  }
});

router.delete("/api/bet-orders/:id", async (req, res) => {
  const userId = userIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ success: false, error: "Invalid or expired token" });
  try {
    if (!betOrderService) return res.status(503).json({ success: false, error: "Service not initialized" });
    // 404 whether the doc doesn't exist, belongs to another user, or is no
    // longer cancellable (already triggered/expired) — cancelForUser's
    // filter can't distinguish these, same reasoning as
    // DELETE /api/saved-filter-sets/:id above.
    const cancelled = await betOrderService.cancelForUser(req.params.id, userId);
    if (!cancelled) return res.status(404).json({ success: false, error: "Not found or no longer cancellable" });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("cancelBetOrder error:", error);
    res.status(500).json({ success: false, error: "Failed to cancel bet order" });
  }
});

// Live Betfair prices for whatever picks the caller is currently showing —
// the client sends exactly the runners on screen (same reasoning as POST
// /api/bet-orders taking the full race/runner context directly) rather
// than this route recomputing "today's qualifying picks" itself, which
// would duplicate DailyRacesScreen.tsx's own filter logic as a second
// source of truth. Read-only: never calls placeOrders, no persistence.
// Degrades to {price: null, note: "..."} per pick (never a 500) whenever
// Betfair credentials aren't configured or a market can't be confidently
// identified — see live-price-service.ts.
router.post("/api/daily-races/live-prices", async (req, res) => {
  try {
    const body = req.body ?? {};
    const rawPicks = Array.isArray(body.picks) ? body.picks : [];
    const picks: PickToResolve[] = [];
    for (const p of rawPicks) {
      if (
        typeof p?.runnerId === "string" &&
        typeof p?.horse === "string" &&
        typeof p?.course === "string" &&
        typeof p?.offDt === "string"
      ) {
        picks.push({ runnerId: p.runnerId, horse: p.horse, course: p.course, offDt: p.offDt });
      }
    }
    const data = await new LivePriceService().getLivePricesForPicks(picks);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getLivePrices error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch live prices" });
  }
});

router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Betfair NLP API",
    database: dbConnection?.isConnected() ? "connected" : "disconnected",
  });
});

// Server-side cap on conversation history, independent of whatever the
// client already trims to — never trust the client's own cap alone.
const MAX_HISTORY_TURNS = 20;

function isValidHistory(value: unknown): value is ChatHistoryTurn[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    turn =>
      turn &&
      typeof turn === "object" &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.text === "string"
  );
}

router.post("/api/query", async (req, res) => {
  try {
    const { query, history } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required and must be a string", example: { query: "What does this app do?" } });
    }
    if (history !== undefined && !isValidHistory(history)) {
      return res.status(400).json({ error: "history must be an array of { role: \"user\"|\"assistant\", text: string }" });
    }
    if (!codebaseSearchService) {
      return res.status(500).json({ error: "Service not initialized", message: "Chat service is not available" });
    }
    const cappedHistory: ChatHistoryTurn[] = (history ?? []).slice(-MAX_HISTORY_TURNS);
    const reply = await codebaseSearchService.chat(query, cappedHistory);
    res.status(200).json({ success: true, reply });
  } catch (error) {
    console.error("Error processing chat query:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ success: false, error: errorMessage, message: "Failed to process chat query" });
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


// 404 and error handlers
router.use((req, res) => {
  res.status(404).json({ error: "Not found", message: `Route ${req.originalUrl} not found` });
});

router.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error", message: "An unexpected error occurred" });
});

export { router };
