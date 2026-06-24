import serverlessExpress from "@vendia/serverless-express";
import express from "express";
import rateLimit from "express-rate-limit";
import { router, initializeServices } from "../../../src/server/router";
import { corsMiddleware, helmetMiddleware } from "../../../src/server/middleware";
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

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  await initPromise;
  return proxy(event, context);
};
