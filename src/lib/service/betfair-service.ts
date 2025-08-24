import { readFileSync } from "fs";
import {
  BetfairMessage,
  MarketChange,
  MarketDefinition,
  RunnerChange,
  PriceUpdateDocument,
  MarketDefinitionDocument,
} from "../../types/betfair";
import { MarketDefinitionDAO, MarketStatusDAO, PriceUpdateDAO } from "../dao";

export class BetfairService {
  private marketDefinitionDAO: MarketDefinitionDAO;
  private priceUpdateDAO: PriceUpdateDAO;
  private marketStatusDAO: MarketStatusDAO;

  constructor(
    marketDefinitionDAO: MarketDefinitionDAO,
    priceUpdateDAO: PriceUpdateDAO,
    marketStatusDAO: MarketStatusDAO
  ) {
    this.marketDefinitionDAO = marketDefinitionDAO;
    this.priceUpdateDAO = priceUpdateDAO;
    this.marketStatusDAO = marketStatusDAO;
  }

  /**
   * Process a Betfair data file and insert all messages into MongoDB
   */
  public async processDataFile(filePath: string): Promise<void> {
    try {
      console.log(`Processing file: ${filePath}`);

      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.trim().split("\n");

      let processedCount = 0;
      let errorCount = 0;

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message: BetfairMessage = JSON.parse(line);
            await this.processBetfairMessage(message);
            processedCount++;
          } catch (error) {
            console.error(
              `Failed to process line: ${line.substring(0, 100)}...`,
              error
            );
            errorCount++;
          }
        }
      }

      console.log(
        `File processing complete. Processed: ${processedCount}, Errors: ${errorCount}`
      );
    } catch (error) {
      console.error(`Failed to process file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Process a Betfair message and route data to appropriate DAOs
   */
  public async processBetfairMessage(message: BetfairMessage): Promise<void> {
    const timestamp = new Date(message.pt);
    const changeId = message.clk;

    for (const marketChange of message.mc) {
      await this.processMarketChange(marketChange, timestamp, changeId);
    }
  }

  /**
   * Process individual market changes and apply business logic
   */
  private async processMarketChange(
    marketChange: MarketChange,
    timestamp: Date,
    changeId: string
  ): Promise<void> {
    const marketId = marketChange.id;

    // Process market definition updates
    if (marketChange.marketDefinition) {
      await this.processMarketDefinition(
        marketChange.marketDefinition,
        marketId,
        timestamp,
        changeId
      );
    }

    // Process price updates
    if (marketChange.rc && marketChange.rc.length > 0) {
      await this.processPriceUpdates(
        marketChange.rc,
        marketId,
        timestamp,
        changeId
      );
    }
  }

  /**
   * Process market definition updates
   */
  private async processMarketDefinition(
    marketDef: MarketDefinition,
    marketId: string,
    timestamp: Date,
    changeId: string
  ): Promise<void> {
    // Insert market definition
    await this.marketDefinitionDAO.insert(
      marketDef,
      marketId,
      timestamp,
      changeId
    );

    // Create market status document
    await this.marketStatusDAO.insert(marketDef, marketId, timestamp, changeId);
  }

  /**
   * Process price updates with business logic
   */
  private async processPriceUpdates(
    runnerChanges: RunnerChange[],
    marketId: string,
    timestamp: Date,
    changeId: string
  ): Promise<void> {
    // Get market info for context
    const marketInfo =
      await this.marketDefinitionDAO.getLatestByMarketId(marketId);

    // Apply business logic to create price update documents
    const priceUpdateDocs = this.createPriceUpdateDocuments(
      runnerChanges,
      marketId,
      timestamp,
      changeId,
      marketInfo
    );

    // Insert price updates
    if (priceUpdateDocs.length > 0) {
      await this.priceUpdateDAO.insertMany(priceUpdateDocs);
    }
  }

  /**
   * Create price update documents with business logic
   */
  private createPriceUpdateDocuments(
    runnerChanges: RunnerChange[],
    marketId: string,
    timestamp: Date,
    changeId: string,
    marketInfo: MarketDefinitionDocument | null
  ): PriceUpdateDocument[] {
    return runnerChanges.map(rc => ({
      marketId,
      runnerId: rc.id,
      runnerName: this.getRunnerName(rc.id, marketInfo),
      lastTradedPrice: rc.ltp,
      timestamp,
      changeId,
      publishTime: timestamp,
      eventId: marketInfo?.eventId || "",
      eventName: marketInfo?.eventName || "",
    }));
  }

  /**
   * Get runner name from market info with fallback logic
   */
  private getRunnerName(
    runnerId: number,
    marketInfo: MarketDefinitionDocument | null
  ): string {
    if (!marketInfo?.runners) return `Runner_${runnerId}`;

    const runner = marketInfo.runners.find(r => r.id === runnerId);
    return runner?.name || `Runner_${runnerId}`;
  }

  /**
   * Create all database indexes
   */
  public async createIndexes(): Promise<void> {
    await Promise.all([
      this.marketDefinitionDAO.createIndexes(),
      this.priceUpdateDAO.createIndexes(),
      this.marketStatusDAO.createIndexes(),
    ]);
    console.log("All database indexes created successfully");
  }

  /**
   * Get comprehensive market analysis
   */
  public async getMarketAnalysis(marketId: string): Promise<{
    marketDefinition: MarketDefinitionDocument | null;
    priceHistory: PriceUpdateDocument[];
    statusHistory: any[];
    summary: {
      totalPriceUpdates: number;
      priceRange: { min: number; max: number };
      statusTransitions: string[];
    };
  }> {
    const [marketDefinition, priceHistory, statusHistory] = await Promise.all([
      this.marketDefinitionDAO.getLatestByMarketId(marketId),
      this.priceUpdateDAO.getByMarketId(marketId, 1000),
      this.marketStatusDAO.getByMarketId(marketId, 100),
    ]);

    // Calculate price range
    const prices = priceHistory.map(p => p.lastTradedPrice);
    const priceRange = {
      min: Math.min(...prices),
      max: Math.max(...prices),
    };

    // Get status transitions
    const statusTransitions = statusHistory.map(s => s.status);

    return {
      marketDefinition,
      priceHistory,
      statusHistory,
      summary: {
        totalPriceUpdates: priceHistory.length,
        priceRange,
        statusTransitions,
      },
    };
  }

  /**
   * Get event summary across multiple markets
   */
  public async getEventSummary(eventId: string): Promise<{
    eventId: string;
    eventName: string;
    markets: string[];
    totalRunners: number;
    activeMarkets: number;
    suspendedMarkets: number;
    closedMarkets: number;
  }> {
    const [marketDefinitions, marketStatuses] = await Promise.all([
      this.marketDefinitionDAO.getByEventId(eventId, 1000),
      this.marketStatusDAO.getByEventId(eventId, 1000),
    ]);

    const markets = [...new Set(marketDefinitions.map(m => m.marketId))];
    const latestStatuses = markets
      .map(marketId =>
        marketStatuses.find(
          s =>
            s.marketId === marketId &&
            s.timestamp.getTime() ===
              Math.max(
                ...marketStatuses
                  .filter(s2 => s2.marketId === marketId)
                  .map(s2 => s2.timestamp.getTime())
              )
        )
      )
      .filter(Boolean);

    const statusCounts = latestStatuses.reduce(
      (acc, status) => {
        if (status) {
          acc[status.status] = (acc[status.status] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const totalRunners = marketDefinitions.reduce(
      (sum, m) => sum + (m.runners?.length || 0),
      0
    );

    return {
      eventId,
      eventName: marketDefinitions[0]?.eventName || "",
      markets,
      totalRunners,
      activeMarkets: statusCounts.OPEN || 0,
      suspendedMarkets: statusCounts.SUSPENDED || 0,
      closedMarkets: statusCounts.CLOSED || 0,
    };
  }
}
