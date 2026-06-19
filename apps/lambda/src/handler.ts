import serverlessExpress from "@vendia/serverless-express";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { router, initializeServices } from "../../../src/server/router";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// API-only Express app — no static file serving, no SPA fallback
const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(router);

const proxy = serverlessExpress({ app });

// Start initialization immediately on cold start; subsequent requests await
// the same promise so they block until MongoDB is connected.
const initPromise = initializeServices();

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  await initPromise;
  return proxy(event, context);
};
