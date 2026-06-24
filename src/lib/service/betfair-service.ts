import {
  BetfairMessage,
  MarketChange,
  MarketDefinition,
  RunnerChange,
  MarketDefinitionDocument,
  PriceUpdateDocument,
  MarketStatus,
  MarketAnalysis,
  EventSummary,
} from "../../types/betfair";
import { MarketDefinitionDAO, EventGroup, RaceWithRunners, RaceWithEvent, SummaryStats, RunnerFilterBounds } from "../dao/market-definition-dao";
import { PriceUpdateDAO } from "../dao/price-update-dao";
import { DatabaseConnection } from "../../config/database";

export class BetfairService {
  private marketDefinitionDAO: MarketDefinitionDAO;
  private priceUpdateDAO: PriceUpdateDAO;
  private bspOnly: boolean;
  private countryFilter: string[];
  private marketTypeFilter: string[];

  constructor(
    marketDefinitionDAO?: MarketDefinitionDAO,
    priceUpdateDAO?: PriceUpdateDAO,
    bspOnly = true
  ) {
    this.bspOnly = bspOnly;
    this.countryFilter = process.env.COUNTRY_FILTER
      ? process.env.COUNTRY_FILTER.split(',').map(s => s.trim().toUpperCase())
      : [];
    this.marketTypeFilter = process.env.MARKET_TYPE_FILTER
      ? process.env.MARKET_TYPE_FILTER.split(',').map(s => s.trim().toUpperCase())
      : [];
    if (marketDefinitionDAO && priceUpdateDAO) {
      this.marketDefinitionDAO = marketDefinitionDAO;
      this.priceUpdateDAO = priceUpdateDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.marketDefinitionDAO = new MarketDefinitionDAO(db);
      this.priceUpdateDAO = new PriceUpdateDAO(db);
    }
  }

  /**
   * Initialize the service by creating necessary indexes
   */
  public async initialize(): Promise<void> {
    await this.marketDefinitionDAO.createIndexes();
    await this.priceUpdateDAO.createIndexes();
  }

  /**
   * Create database indexes (alias for initialize for backward compatibility)
   */
  public async createIndexes(): Promise<void> {
    await this.initialize();
  }

  public async getEventGroups(
    page: number = 1,
    limit: number = 20,
    sort: "asc" | "desc" = "asc"
  ): Promise<{ data: EventGroup[]; total: number }> {
    return this.marketDefinitionDAO.groupByEventId(page, limit, sort);
  }

  public async getEventDefinitions(
    eventId: string,
    limit: number = 200
  ): Promise<MarketDefinitionDocument[]> {
    return this.marketDefinitionDAO.getLatestPerMarketByEventId(eventId, limit);
  }

  public async getRunnersByRace(eventId: string): Promise<RaceWithRunners[]> {
    return this.marketDefinitionDAO.getRunnersByRaceForEvent(eventId);
  }

  public async getAllRunnersByRace(
    page = 1,
    limit = 20,
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minBsp = 1,
    maxBsp = 1000,
    sortOrder: "asc" | "desc" = "asc",
    minInSp = 1,
    maxInSp = 1000,
    fromRow = 1,
    toRow: number | null = null
  ): Promise<{ data: RaceWithEvent[]; total: number; totalRunners: number; pnlStats: { staked: number; returns: number; pnl: number; count: number } }> {
    return this.marketDefinitionDAO.getAllRunnersByRace(page, limit, minRunners, maxRunners, countries, minBsp, maxBsp, sortOrder, minInSp, maxInSp, fromRow, toRow);
  }

  public async getRunnersPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    return this.marketDefinitionDAO.getRunnersPnlStats();
  }

  public async getSummaryStats(): Promise<SummaryStats> {
    return this.marketDefinitionDAO.getSummaryStats();
  }

  public async getDistinctCountryCodes(): Promise<string[]> {
    return this.marketDefinitionDAO.getDistinctCountryCodes();
  }

  public async getRunnerFilterBounds(): Promise<RunnerFilterBounds> {
    return this.marketDefinitionDAO.getRunnerFilterBounds();
  }

  public async getPriceUpdatesByEvent(
    eventId: string,
    limit: number = 100
  ): Promise<PriceUpdateDocument[]> {
    return this.priceUpdateDAO.getByEventId(eventId, limit);
  }

  public async getPriceUpdatesByEventAndRunner(
    eventId: string,
    runnerId: number,
    limit: number = 100,
    sort: "asc" | "desc" = "desc"
  ): Promise<PriceUpdateDocument[]> {
    return this.priceUpdateDAO.getByEventIdAndRunnerId(eventId, runnerId, limit, sort);
  }

  /**
   * Process a data file containing Betfair messages
   * Only processes uncompressed market files (files with dots in the filename, excluding .bz2)
   */
  public async processDataFile(filePath: string): Promise<void> {
    try {
      // Check if this is a market file (contains a dot in the filename)
      const fileName = filePath.split("/").pop() || "";
      if (!fileName.includes(".") || fileName.endsWith(".bz2")) {
        return;
      }

      const fs = await import("fs/promises");
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        try {
          const message: BetfairMessage = JSON.parse(line);
          await this.processBetfairMessage(message);
        } catch {
          // malformed line — skip
        }
      }
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

    // Process price updates (skipped in bspOnly mode — BSP is extracted from marketDefinition instead)
    if (!this.bspOnly && marketChange.rc && marketChange.rc.length > 0) {
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
    if (this.countryFilter.length > 0 && !this.countryFilter.includes(marketDef.countryCode ?? '')) {
      return;
    }
    if (this.marketTypeFilter.length > 0 && !this.marketTypeFilter.includes(marketDef.marketType ?? '')) {
      return;
    }

    if (this.bspOnly) {
      if (marketDef.bspReconciled) {
        // Replace so only the final settled snapshot is kept per market (one doc per marketId)
        await this.marketDefinitionDAO.upsertByMarketId(marketDef, marketId, timestamp, changeId);
        await this.processBspPriceUpdates(marketDef, marketId, timestamp);
      }
    } else {
      await this.marketDefinitionDAO.insert(marketDef, marketId, timestamp, changeId);
    }
  }

  private async processBspPriceUpdates(
    marketDef: MarketDefinition,
    marketId: string,
    timestamp: Date
  ): Promise<void> {
    const docs = this.createBspPriceUpdateDocuments(marketDef, marketId, timestamp);
    if (docs.length > 0) {
      await this.priceUpdateDAO.insertMany(docs);
    }
  }

  private createBspPriceUpdateDocuments(
    marketDef: MarketDefinition,
    marketId: string,
    timestamp: Date
  ): PriceUpdateDocument[] {
    const changeId = `bsp_${marketId}`;
    return marketDef.runners
      .filter(r => r.bsp !== undefined && r.bsp > 1)
      .map(r => ({
        marketId,
        runnerId: r.id,
        runnerName: r.name,
        lastTradedPrice: r.bsp!,
        timestamp,
        changeId,
        publishTime: timestamp,
        eventId: marketDef.eventId,
        eventName: marketDef.eventName,
      }));
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
      ...(rc.tv !== undefined && { tradedVolume: rc.tv }),
      ...(rc.batb?.[0] && { bestBackPrice: rc.batb[0][1], bestBackSize: rc.batb[0][2] }),
      ...(rc.batl?.[0] && { bestLayPrice: rc.batl[0][1], bestLaySize: rc.batl[0][2] }),
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

  /**
   * Get comprehensive market analysis
   */
  public async getMarketAnalysis(marketId: string): Promise<MarketAnalysis> {
    const marketDefinition =
      await this.marketDefinitionDAO.getLatestByMarketId(marketId);
    const priceHistory = await this.priceUpdateDAO.getByMarketId(marketId);

    if (!marketDefinition) {
      throw new Error(`Market definition not found for market ID: ${marketId}`);
    }

    // Calculate price range
    const prices = priceHistory.map(p => p.lastTradedPrice);
    const priceRange = {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0,
    };

    // Get status transitions from market definitions
    const allMarketDefinitions =
      await this.marketDefinitionDAO.getByMarketId(marketId);
    const statusTransitions = allMarketDefinitions
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(md => md.status);

    return {
      marketDefinition,
      priceHistory,
      summary: {
        totalPriceUpdates: priceHistory.length,
        priceRange,
        statusTransitions,
      },
    };
  }

  /**
   * Get event summary across all markets
   */
  public async getEventSummary(eventId: string): Promise<EventSummary> {
    const marketDefinitions =
      await this.marketDefinitionDAO.getByEventId(eventId);

    if (marketDefinitions.length === 0) {
      throw new Error(`No markets found for event ID: ${eventId}`);
    }

    // Get unique markets and their latest status
    const marketMap = new Map<string, MarketDefinitionDocument>();
    marketDefinitions.forEach(md => {
      const existing = marketMap.get(md.marketId);
      if (!existing || md.timestamp > existing.timestamp) {
        marketMap.set(md.marketId, md);
      }
    });

    const markets = Array.from(marketMap.keys());
    const latestMarketDefinitions = Array.from(marketMap.values());

    // Count markets by status
    const activeMarkets = latestMarketDefinitions.filter(
      md => md.status === "OPEN"
    ).length;
    const suspendedMarkets = latestMarketDefinitions.filter(
      md => md.status === "SUSPENDED"
    ).length;
    const closedMarkets = latestMarketDefinitions.filter(
      md => md.status === "CLOSED"
    ).length;

    // Calculate total runners across all markets
    const totalRunners = latestMarketDefinitions.reduce(
      (sum, md) => sum + (md.runners?.length || 0),
      0
    );

    // Get event name from first market definition
    const eventName = latestMarketDefinitions[0]?.eventName || "Unknown Event";

    return {
      eventId,
      eventName,
      markets,
      totalRunners,
      activeMarkets,
      suspendedMarkets,
      closedMarkets,
    };
  }
}
