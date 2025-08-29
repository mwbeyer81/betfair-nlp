import {
  BetfairMessage,
  MarketChange,
  MarketDefinition,
  RunnerChange,
  MarketDefinitionDocument,
  PriceUpdateDocument,
  MarketStatus,
} from "../../types/betfair";
import { MarketDefinitionDAO } from "../dao/market-definition-dao";
import { PriceUpdateDAO } from "../dao/price-update-dao";
import { DatabaseConnection } from "../../config/database";

export class BetfairService {
  private marketDefinitionDAO: MarketDefinitionDAO;
  private priceUpdateDAO: PriceUpdateDAO;

  constructor() {
    const db = DatabaseConnection.getInstance().getDb();
    this.marketDefinitionDAO = new MarketDefinitionDAO(db);
    this.priceUpdateDAO = new PriceUpdateDAO(db);
  }

  /**
   * Initialize the service by creating necessary indexes
   */
  public async initialize(): Promise<void> {
    await this.marketDefinitionDAO.createIndexes();
    await this.priceUpdateDAO.createIndexes();
  }

  /**
   * Process a data file containing Betfair messages
   */
  public async processDataFile(filePath: string): Promise<void> {
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");

      let processedCount = 0;
      let errorCount = 0;

      for (const line of lines) {
        try {
          const message: BetfairMessage = JSON.parse(line);
          await this.processBetfairMessage(message);
          processedCount++;
        } catch (error) {
          console.error(`Failed to process line: ${line}`, error);
          errorCount++;
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
    // Insert market definition (contains all status information)
    await this.marketDefinitionDAO.insert(
      marketDef,
      marketId,
      timestamp,
      changeId
    );
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
   * Get runner name from market definition
   */
  private getRunnerName(
    runnerId: number,
    marketInfo: MarketDefinitionDocument | null
  ): string {
    if (!marketInfo?.runners) {
      return `Runner ${runnerId}`;
    }

    const runner = marketInfo.runners.find(r => r.id === runnerId);
    return runner?.name || `Runner ${runnerId}`;
  }

  /**
   * Get market definitions for a specific market
   */
  public async getMarketDefinitions(
    marketId: string
  ): Promise<MarketDefinitionDocument[]> {
    return await this.marketDefinitionDAO.getByMarketId(marketId);
  }

  /**
   * Get market definitions by event ID
   */
  public async getMarketDefinitionsByEvent(
    eventId: string
  ): Promise<MarketDefinitionDocument[]> {
    return await this.marketDefinitionDAO.getByEventId(eventId);
  }

  /**
   * Get market definitions by status
   */
  public async getMarketDefinitionsByStatus(
    status: MarketStatus
  ): Promise<MarketDefinitionDocument[]> {
    return await this.marketDefinitionDAO.getByStatus(status);
  }

  /**
   * Get latest market definition for a market
   */
  public async getLatestMarketDefinition(
    marketId: string
  ): Promise<MarketDefinitionDocument | null> {
    return await this.marketDefinitionDAO.getLatestByMarketId(marketId);
  }

  /**
   * Get price updates for a specific market
   */
  public async getPriceUpdates(
    marketId: string
  ): Promise<PriceUpdateDocument[]> {
    return await this.priceUpdateDAO.getByMarketId(marketId);
  }

  /**
   * Get price updates for a specific runner
   */
  public async getPriceUpdatesByRunner(
    marketId: string,
    runnerId: number
  ): Promise<PriceUpdateDocument[]> {
    // Note: This method only filters by runnerId, not marketId
    return await this.priceUpdateDAO.getByRunnerId(runnerId);
  }

  /**
   * Get latest price update for a runner
   */
  public async getLatestPriceUpdate(
    marketId: string,
    runnerId: number
  ): Promise<PriceUpdateDocument | null> {
    return await this.priceUpdateDAO.getLatestPriceByRunnerId(runnerId);
  }
}
