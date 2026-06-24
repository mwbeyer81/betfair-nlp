import cors from "cors";
import helmet from "helmet";
import express from "express";
import jwt from "jsonwebtoken";
import config from "config";

export const corsMiddleware = cors({
  origin: true,
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

export const helmetMiddleware = helmet({
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
});

export const jwtAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (req.method === "OPTIONS") return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = authHeader.slice(7);
  try {
    const secret = config.get<string>("jwt.secret");
    jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
