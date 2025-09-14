import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { NaturalLanguageService } from "../lib/service/natural-language-service";
import { DatabaseConnection } from "../config/database";
import config from "config";

// Create Express app
const app = express();

// Basic Auth Middleware
const basicAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
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
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Apply basic auth to all routes
app.use(basicAuth);

// Initialize database connection
let dbConnection: DatabaseConnection | null = null;
let naturalLanguageService: NaturalLanguageService | null = null;

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
    const { query } = req.body;

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
