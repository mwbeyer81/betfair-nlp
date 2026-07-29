import serverlessExpress from "@vendia/serverless-express";
import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { router, initializeServices, areServicesReady } from "../../../src/server/router";
import { corsMiddleware, helmetMiddleware } from "../../../src/server/middleware";
import { DailyRaceService } from "../../../src/lib/service/daily-race-service";
import { IndustrySpResultsCaptureService } from "../../../src/lib/service/industry-sp-results-capture-service";
import { LiveFilterResultService } from "../../../src/lib/service/live-filter-result-service";
import { computeDailyRaceFeatures } from "../../../src/lib/service/daily-race-feature-service";
import { BetOrderService } from "../../../src/lib/service/bet-order-service";
import { DatabaseConnection } from "../../../src/config/database";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// API-only Express app — no static file serving, no SPA fallback
const app = express();

// API Gateway forwards real client IP in X-Forwarded-For
app.set("trust proxy", 1);

app.use(corsMiddleware);
app.use(helmetMiddleware);
// gzips JSON responses before @vendia/serverless-express base64-encodes the
// body for API Gateway — HTTP APIs (v2) don't auto-compress Lambda proxy
// responses the way REST APIs (v1) can, so without this the backend was
// sending large industry-sp payloads fully uncompressed (confirmed live: a
// 640-race page came back as ~5MB with no Content-Encoding header at all,
// despite the client sending Accept-Encoding: gzip) — see the
// isp-response-compression entry in AGENTS.md.
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(router);

const proxy = serverlessExpress({ app });

// Start initialization immediately on cold start; subsequent requests await
// the same promise so they block until MongoDB is connected. Caught here
// (not left to reject the module-level binding) so a transient cold-start
// failure doesn't need special handling at the call site below — see
// ensureServicesReady, which is what actually decides whether to retry.
let initPromise: Promise<void> = initializeServices().catch(error => {
  console.error("Initial service initialization failed — will retry on the next request:", error);
});

// REAL BUG FOUND AND FIXED 2026-07-29 (see AGENTS.md's bets-tab-load-fix
// entry, and router.ts's servicesReady flag): a transient failure during
// initializeServices() (e.g. a Mongo connection blip) used to leave every
// service in router.ts permanently null for this execution environment's
// entire remaining lifetime, since initPromise was only ever assigned
// once, at module load — awaiting an already-settled promise doesn't
// retry the work it represents. Every request routed to that same warm
// container then got a real 503 "Service not initialized" from every
// route's own defensive check, until AWS eventually recycled the
// container (unpredictable, could be minutes or hours). Now: if services
// aren't ready after awaiting the current attempt, kick off a fresh
// initializeServices() call for THIS request rather than trusting a
// stale, already-failed attempt forever.
async function ensureServicesReady(): Promise<void> {
  await initPromise;
  if (!areServicesReady()) {
    console.warn("Services not ready after initialization — retrying for this request.");
    initPromise = initializeServices().catch(error => {
      console.error("Retried service initialization also failed:", error);
    });
    await initPromise;
  }
}

// EventBridge Scheduled Rule events carry `source: "aws.events"` — a shape
// API Gateway HTTP API v2 events never have. Used to route both the
// daily-races racecards cron (see .claude/commands/daily-races-cron.md) and
// the industry-sp results-capture cron (see
// .claude/commands/industry-sp-results-cron.md) through this same function
// without touching the Express/API Gateway path at all. `action` picks
// which one: the original daily-races rule's input has no `action` field at
// all, so it keeps hitting the default (racecards) branch unchanged —
// `action: "capture-results"` is purely additive.
interface ScheduledEvent {
  source: string;
  action?: string;
}

function isScheduledEvent(event: unknown): event is ScheduledEvent {
  return typeof event === "object" && event !== null && (event as { source?: unknown }).source === "aws.events";
}

export const handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent, context: Context) => {
  await ensureServicesReady();
  if (isScheduledEvent(event)) {
    if (event.action === "capture-results") {
      try {
        const result = await new IndustrySpResultsCaptureService().captureTodayResults();
        console.log(
          `Scheduled industry-sp results capture: upserted ${result.racesUpserted} races ` +
            `(${result.runnersUpserted} runners), skipped ${result.nonGbSkipped} non-GB races.`
        );
      } catch (error) {
        console.error("Scheduled industry-sp results capture failed:", error);
        throw error;
      }

      // Chained onto the same invocation (no separate EventBridge rule) —
      // turns the results just captured above into a live, day-by-day P&L
      // rollup per saved filter set. Logged, not thrown, on failure: the
      // results capture above already succeeded and its upsert is real/
      // committed — letting this downstream step fail the whole invocation
      // would make EventBridge retry and redundantly re-capture results
      // that already landed correctly (same reasoning as the daily-races
      // branch's own feature-compute/predict chaining below).
      try {
        const today = new Date().toISOString().slice(0, 10);
        const liveResult = await new LiveFilterResultService().captureLiveResultsForDate(today);
        console.log(
          `Scheduled live filter-result capture: ${liveResult.filterSetsProcessed} filter sets processed, ` +
            `${liveResult.rowsUpserted} race rows upserted.`
        );
      } catch (error) {
        console.error("Scheduled live filter-result capture failed (results capture already succeeded):", error);
      }

      return { statusCode: 200 };
    }
    // Conditional Betfair bet orders — see bet-order-service.ts and
    // .claude/commands/bet-orders-cron.md. NOT yet wired to a real
    // EventBridge rule (see that doc's setup script, written but not run) —
    // this branch only fires if/when that rule is actually created.
    // BetfairApiClient.placeOrders defaults to dryRun=true regardless, so
    // even a live-firing rule can't place a real bet until that's
    // deliberately flipped off in config once real credentials are in.
    if (event.action === "evaluate-bet-orders") {
      try {
        const summary = await new BetOrderService().evaluatePendingOrders();
        console.log(
          `Scheduled bet-order evaluation: ${summary.evaluated} evaluated, ${summary.resolved} newly ` +
            `market-resolved, ${summary.triggered} triggered, ${summary.unmatched} unmatched, ` +
            `${summary.expired} expired, ${summary.errors} errors.`
        );
      } catch (error) {
        console.error("Scheduled bet-order evaluation failed:", error);
        throw error;
      }
      return { statusCode: 200 };
    }
    const dailyRaceService = new DailyRaceService();
    try {
      const ingestResult = await dailyRaceService.ingestFromRacingApi();
      console.log(
        `Scheduled daily-races ingest: upserted ${ingestResult.racesUpserted} races, ` +
          `skipped ${ingestResult.nonGbSkipped} non-GB races.`
      );
    } catch (error) {
      console.error("Scheduled daily-races ingest failed:", error);
      throw error;
    }

    // Feature-compute + predict are chained onto the same scheduled
    // invocation (no separate EventBridge rule) so today's races always
    // carry model probabilities without a manual re-run — see AGENTS.md's
    // dated entry for why this was previously deferred (no Python compute
    // target existed in this Lambda's runtime) and how apps/ml-api
    // resolved that. Failures here are logged, not thrown: ingest above
    // already succeeded and its upsert is real/committed — letting a
    // downstream failure throw would make EventBridge treat the whole
    // invocation as failed and retry it, redundantly re-ingesting racecards
    // that already landed correctly.
    const today = new Date().toISOString().slice(0, 10);
    try {
      const db = DatabaseConnection.getInstance().getDb();
      const featureResult = await computeDailyRaceFeatures(db, today);
      console.log(
        `Scheduled daily-race features: ${featureResult.racesUpdated} races, ` +
          `${featureResult.runnersUpdated} runners (${featureResult.horsesMatched}/${featureResult.horsesTotal} horses matched prior history).`
      );
      const predictResult = await dailyRaceService.predictDailyRaces(today);
      console.log(
        `Scheduled daily-race predictions: ${predictResult.racesUpdated} races, ` +
          `${predictResult.runnersUpdated} runners, ${predictResult.errors.length} errors.`
      );
      if (predictResult.errors.length > 0) {
        console.error("Scheduled daily-race prediction errors:", JSON.stringify(predictResult.errors));
      }
    } catch (error) {
      console.error("Scheduled daily-race feature-compute/predict failed (ingest already succeeded):", error);
    }
    return { statusCode: 200 };
  }
  return proxy(event as APIGatewayProxyEventV2, context);
};
