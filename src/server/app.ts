import express from "express";
import morgan from "morgan";
import path from "path";
import { router, initializeServices } from "./router";
import { corsMiddleware, helmetMiddleware } from "./middleware";

const app = express();

app.use(corsMiddleware);
app.use(helmetMiddleware);
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve the built Expo web client (public — no auth needed for static assets)
const clientDist = path.join(process.cwd(), "client", "dist");
app.use(express.static(clientDist));

// SPA fallback for client-side routes
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/") || req.path === "/health" || req.path === "/hello-world") return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => { if (err) next(); });
});

app.use(router);

initializeServices();

export default app;
