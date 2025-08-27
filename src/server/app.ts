import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { NaturalLanguageService } from "../lib/service/natural-language-service";
import config from "config";

// Create Express app
const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Initialize services (simplified for now)
const naturalLanguageService = new NaturalLanguageService(null as any);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Betfair NLP API",
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

    const result = await naturalLanguageService.processQuery(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error processing query:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to process natural language query",
    });
  }
});

// Get top horses endpoint
app.get("/api/horses/top", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const horses = await naturalLanguageService.getTopHorses(limit);

    res.status(200).json({
      success: true,
      data: {
        horses,
        count: horses.length,
        limit,
      },
    });
  } catch (error) {
    console.error("Error getting top horses:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to get top horses",
    });
  }
});

// Get horses by odds endpoint
app.get("/api/horses/odds", async (req, res) => {
  try {
    const maxOdds = parseFloat(req.query.maxOdds as string);

    if (isNaN(maxOdds) || maxOdds <= 0) {
      return res.status(400).json({
        error: "maxOdds is required and must be a positive number",
        example: {
          maxOdds: 5.0,
        },
      });
    }

    const horses = await naturalLanguageService.getHorsesByOdds(maxOdds);

    res.status(200).json({
      success: true,
      data: {
        horses,
        count: horses.length,
        maxOdds,
      },
    });
  } catch (error) {
    console.error("Error getting horses by odds:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to get horses by odds",
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
