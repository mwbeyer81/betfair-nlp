import express from "express";
import jwt from "jsonwebtoken";
import config from "config";
import { CodebaseSearchService, ChatHistoryTurn } from "../lib/service/codebase-search-service";
import { BetfairService } from "../lib/service/betfair-service";
import { IndustrySpService } from "../lib/service/industry-sp-service";
import { TrainerFormService } from "../lib/service/trainer-form-service";
import { ModelVersionService } from "../lib/service/model-version-service";
import { AuthService, AuthError } from "../lib/service/auth-service";
import { DatabaseConnection } from "../config/database";
import { jwtAuth, optionalJwtAuth } from "./middleware";

export { jwtAuth };

const router = express.Router();

let dbConnection: DatabaseConnection | null = null;
let codebaseSearchService: CodebaseSearchService | null = null;
let betfairService: BetfairService | null = null;
let industrySpService: IndustrySpService | null = null;
let trainerFormService: TrainerFormService | null = null;
let modelVersionService: ModelVersionService | null = null;
let authService: AuthService | null = null;

export const initializeServices = async () => {
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
    trainerFormService = new TrainerFormService();
    try {
      await trainerFormService.createIndexes();
    } catch (indexError) {
      console.warn("trainer-form createIndexes failed (non-fatal, queries may be slower):", indexError);
    }
    modelVersionService = new ModelVersionService();
    authService = new AuthService(dbConnection.getDb());
    try {
      await authService.createIndexes();
    } catch (indexError) {
      console.warn("auth createIndexes failed (non-fatal, unique email check may hit the DB):", indexError);
    }
    console.log("Services initialized successfully");
  } catch (error) {
    console.error("Failed to initialize services:", error);
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

// Same comma-joined-list convention already used for `countries`.
function parseCsvListParam(raw: unknown): string[] {
  return typeof raw === "string"
    ? raw.split(",").map(v => v.trim()).filter(Boolean)
    : [];
}

// Anonymous callers get a 100-race window on /api/industry-sp*, a
// logged-in caller gets 1000 (see getSplitStats for the Split A/Split B
// version of this same cap) — enforced here too since this is the plain
// list endpoint "View Races" and the meeting/race drill-down flow hit
// directly, with its own fromRow/toRow independent of /splits. An
// open-ended toRow (null, "through the end") is treated as "exactly the
// cap", not "unlimited", so the cap can't be bypassed by simply omitting
// toRow.
function clampRowSpan(fromRow: number, toRow: number | null, isAuth: boolean): number {
  const cap = isAuth ? 1000 : 100;
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
    // decides the Split A/Split B race cap: 100 anonymous, 1000 logged in.
    const isAuth = res.locals.isAuthenticated === true;
    const raceCap = isAuth ? 1000 : 100;

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
    const raceCap = isAuth ? 1000 : 100;
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
    const { data, total, totalRunners, pnlStats } = await industrySpService.getAllRacesByRace(page, limit, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minInIspRange, maxInIspRange, fromRow, toRow, minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, runnerName, minModelWinProbability, onlyModelBeatsSp, modelVersionId);
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
