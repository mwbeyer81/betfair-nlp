import serverlessExpress from "@vendia/serverless-express";
import express from "express";
import rateLimit from "express-rate-limit";
import { router, initializeServices } from "../../../src/server/router";
import { corsMiddleware, helmetMiddleware } from "../../../src/server/middleware";
import { DailyRaceService } from "../../../src/lib/service/daily-race-service";
import { IndustrySpResultsCaptureService } from "../../../src/lib/service/industry-sp-results-capture-service";
import { LiveFilterResultService } from "../../../src/lib/service/live-filter-result-service";
import { computeDailyRaceFeatures } from "../../../src/lib/service/daily-race-feature-service";
import { DatabaseConnection } from "../../../src/config/database";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// API-only Express app — no static file serving, no SPA fallback
const app = express();

// API Gateway forwards real client IP in X-Forwarded-For
app.set("trust proxy", 1);

app.use(corsMiddleware);
app.use(helmetMiddleware);
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
// the same promise so they block until MongoDB is connected.
const initPromise = initializeServices();

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
  await initPromise;
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
            `${liveResult.rowsUpserted} meeting rows upserted.`
        );
      } catch (error) {
        console.error("Scheduled live filter-result capture failed (results capture already succeeded):", error);
      }

      return { statusCode: 200 };
    }
    const dailyRaceService = new DailyRaceService();
    let count: number;
    try {
      count = await dailyRaceService.ingestFromRacingApi();
      console.log(`Scheduled daily-races ingest: upserted ${count} races.`);
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
