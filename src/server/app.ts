import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { NaturalLanguageService } from "../lib/service/natural-language-service";
import { BetfairService } from "../lib/service/betfair-service";
import { DatabaseConnection } from "../config/database";

// Create Express app
const app = express();

// Basic Auth Middleware
const basicAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (req.method === "OPTIONS") return next();

  // Get auth header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Authentication Required"');
    return res.status(401).json({ error: "Authentication required" });
  }

  // Parse auth header
  const auth = Buffer.from(authHeader.split(" ")[1], "base64").toString();
  const [username, password] = auth.split(":");

  // Check credentials
  if (username === "matthew" && password === "beyer") {
    next();
  } else {
    res.setHeader("WWW-Authenticate", 'Basic realm="Authentication Required"');
    return res.status(401).json({ error: "Invalid credentials" });
  }
};

// Middleware
app.use(cors({
  origin: true,
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginResourcePolicy: false }));
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Public routes (before auth)
app.get("/hello-world", (req, res) => {
  res.status(200).json({ message: "Hello, World!" });
});

// Apply basic auth to all routes
app.use(basicAuth);

// Initialize database connection
let dbConnection: DatabaseConnection | null = null;
let naturalLanguageService: NaturalLanguageService | null = null;
let betfairService: BetfairService | null = null;

// Initialize services
const initializeServices = async () => {
  try {
    // Initialize database connection
    dbConnection = DatabaseConnection.getInstance();
    await dbConnection.connect();

    // Initialize natural language service with database
    naturalLanguageService = new NaturalLanguageService(
      null as any,
      dbConnection.getDb()
    );

    betfairService = new BetfairService(undefined, undefined);

    console.log("Services initialized successfully");
  } catch (error) {
    console.error("Failed to initialize services:", error);
    // Continue without database connection
    naturalLanguageService = new NaturalLanguageService();
  }
};

// Initialize services on startup
initializeServices();

// Health check endpoint
app.get("/health", (req, res) => {
  console.log("Health check endpoint called");
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Betfair NLP API",
    database: dbConnection?.isConnected() ? "connected" : "disconnected",
  });
});

// Natural language query endpoint
app.post("/api/query", async (req, res) => {
  try {
    const { query } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Query is required and must be a string",
        example: {
          query: "Show me the top horses in the race",
        },
      });
    }

    if (!naturalLanguageService) {
      return res.status(500).json({
        error: "Service not initialized",
        message: "Natural language service is not available",
      });
    }

    const result = await naturalLanguageService.processQuery(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error processing query:", error);

    // Determine appropriate HTTP status code based on error type
    let statusCode = 500;
    let errorMessage = "Internal server error";

    if (error instanceof Error) {
      if (error.message.includes("Database connection not available")) {
        statusCode = 503; // Service Unavailable
        errorMessage = "Database service is currently unavailable";
      } else if (error.message.includes("No results found")) {
        statusCode = 404; // Not Found
        errorMessage = error.message;
      } else if (error.message.includes("Could not extract MongoDB query")) {
        statusCode = 422; // Unprocessable Entity
        errorMessage =
          "Could not generate a valid database query from your request";
      } else if (error.message.includes("Failed to get AI analysis")) {
        statusCode = 503; // Service Unavailable
        errorMessage = "AI service is currently unavailable";
      } else {
        errorMessage = error.message;
      }
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      message: "Failed to process natural language query",
    });
  }
});

// Event definitions endpoint
app.get("/api/events/:eventId/definitions", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const { eventId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
    const docs = await betfairService.getEventDefinitions(eventId, limit);
    res.status(200).json({ success: true, data: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch event definitions" });
  }
});

// Runners by race (grouped by WIN market) endpoint
app.get("/api/events/:eventId/runners", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const { eventId } = req.params;
    const races = await betfairService.getRunnersByRace(eventId);
    res.status(200).json({ success: true, data: races, count: races.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch runners" });
  }
});

// Price updates by event and runner endpoint
app.get("/api/events/:eventId/runners/:runnerId/price-updates", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const { eventId, runnerId } = req.params;
    const runnerIdNum = parseInt(runnerId, 10);
    if (isNaN(runnerIdNum)) {
      return res.status(400).json({ success: false, error: "runnerId must be a number" });
    }
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const sortParam = String(req.query.sort ?? "desc");
    const sort = sortParam === "asc" ? "asc" : "desc";
    const docs = await betfairService.getPriceUpdatesByEventAndRunner(eventId, runnerIdNum, limit, sort);
    res.status(200).json({ success: true, data: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch runner price updates" });
  }
});

// Price updates by event endpoint
app.get("/api/events/:eventId/price-updates", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const { eventId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const docs = await betfairService.getPriceUpdatesByEvent(eventId, limit);
    res.status(200).json({ success: true, data: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch price updates" });
  }
});

// Event groups endpoint
app.get("/api/events/grouped", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sort = req.query.sort === "desc" ? "desc" : "asc";
    const { data, total } = await betfairService.getEventGroups(page, limit, sort);
    const totalPages = Math.ceil(total / limit);
    res.status(200).json({ success: true, data, count: data.length, total, totalPages });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch event groups" });
  }
});

// Summary stats endpoint
app.get("/api/stats", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const stats = await betfairService.getSummaryStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch stats" });
  }
});

// All runners across all events, grouped by WIN race
app.get("/api/runners/pnl-stats", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const pnlStats = await betfairService.getRunnersPnlStats();
    res.status(200).json({ success: true, data: pnlStats });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch P&L stats" });
  }
});

app.get("/api/runners/countries", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const countries = await betfairService.getDistinctCountryCodes();
    res.status(200).json({ success: true, data: countries });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch countries" });
  }
});

app.get("/api/runners", async (req, res) => {
  try {
    if (!betfairService) {
      return res.status(503).json({ success: false, error: "Service not initialized" });
    }
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const minRunners = Math.max(1, parseInt(req.query.minRunners as string) || 1);
    const maxRunners = Math.min(100, Math.max(1, parseInt(req.query.maxRunners as string) || 30));
    const countries = req.query.countries
      ? (req.query.countries as string).split(",").map(c => c.trim()).filter(Boolean)
      : [];
    const { data, total, totalRunners, pnlStats } =
      await betfairService.getAllRunnersByRace(page, limit, minRunners, maxRunners, countries);
    const totalPages = Math.ceil(total / limit);
    res.status(200).json({
      success: true,
      data,
      count: data.length,
      total,
      page,
      limit,
      totalPages,
      totalRunners,
      pnlStats,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch all runners" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.originalUrl} not found`,
  });
});

// Error handler
app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Unhandled error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "An unexpected error occurred",
    });
  }
);

export default app;
