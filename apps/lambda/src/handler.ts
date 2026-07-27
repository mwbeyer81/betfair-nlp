import serverlessExpress from "@vendia/serverless-express";
import express from "express";
import rateLimit from "express-rate-limit";
import { router, initializeServices } from "../../../src/server/router";
import { corsMiddleware, helmetMiddleware } from "../../../src/server/middleware";
import { DailyRaceService } from "../../../src/lib/service/daily-race-service";
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
// API Gateway HTTP API v2 events never have. Used to route the daily-races
// cron (see .claude/commands/daily-races-cron.md) through this same
// function without touching the Express/API Gateway path at all.
interface ScheduledEvent {
  source: string;
}

function isScheduledEvent(event: unknown): event is ScheduledEvent {
  return typeof event === "object" && event !== null && (event as { source?: unknown }).source === "aws.events";
}

export const handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent, context: Context) => {
  await initPromise;
  if (isScheduledEvent(event)) {
    try {
      const count = await new DailyRaceService().ingestFromRacingApi();
      console.log(`Scheduled daily-races ingest: upserted ${count} races.`);
      return { statusCode: 200 };
    } catch (error) {
      console.error("Scheduled daily-races ingest failed:", error);
      throw error;
    }
  }
  return proxy(event as APIGatewayProxyEventV2, context);
};
