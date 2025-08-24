import {
  MarketDefinition,
  RunnerChange,
  BetfairMessage,
  MarketDefinitionDocument,
  PriceUpdateDocument,
  MarketStatusDocument,
} from "../../../types/betfair";

export class TestUtils {
  /**
   * Create a mock market definition with optional overrides
   */
  static createMockMarketDefinition(
    overrides: Partial<MarketDefinition> = {}
  ): MarketDefinition {
    return {
      bspMarket: false,
      turnInPlayEnabled: false,
      persistenceEnabled: false,
      marketBaseRate: 5.0,
      eventId: "33858191",
      eventTypeId: "7",
      numberOfWinners: 1,
      bettingType: "ODDS",
      marketType: "ANTEPOST_WIN",
      marketTime: "2025-01-01T14:01:00.000Z",
      suspendTime: "2024-12-26T08:00:00.000Z",
      bspReconciled: false,
      complete: false,
      inPlay: false,
      crossMatching: false,
      runnersVoidable: false,
      numberOfActiveRunners: 26,
      betDelay: 0,
      status: "OPEN",
      runners: [],
      regulators: ["MR_INT"],
      countryCode: "GB",
      discountAllowed: true,
      timezone: "Europe/London",
      openDate: "2025-01-01T14:01:00.000Z",
      version: 6326141802,
      name: "Test Market",
      eventName: "Test Event",
      ...overrides,
    };
  }

  /**
   * Create a mock runner change with optional overrides
   */
  static createMockRunnerChange(
    overrides: Partial<RunnerChange> = {}
  ): RunnerChange {
    return {
      ltp: 21.0,
      id: 26600965,
      ...overrides,
    };
  }

  /**
   * Create a mock Betfair message with optional overrides
   */
  static createMockBetfairMessage(
    overrides: Partial<BetfairMessage> = {}
  ): BetfairMessage {
    return {
      op: "mcm",
      clk: "123",
      pt: 1733842450728,
      mc: [],
      ...overrides,
    };
  }

  /**
   * Create a mock market definition document with optional overrides
   */
  static createMockMarketDefinitionDocument(
    overrides: Partial<MarketDefinitionDocument> = {}
  ): MarketDefinitionDocument {
    const baseMarketDef = this.createMockMarketDefinition();
    return {
      ...baseMarketDef,
      _id: "test-id",
      marketId: "1.237066150",
      timestamp: new Date(),
      changeId: "123",
      publishTime: new Date(),
      ...overrides,
    };
  }

  /**
   * Create a mock price update document with optional overrides
   */
  static createMockPriceUpdateDocument(
    overrides: Partial<PriceUpdateDocument> = {}
  ): PriceUpdateDocument {
    return {
      _id: "test-id",
      marketId: "1.237066150",
      runnerId: 26600965,
      runnerName: "Test Runner",
      lastTradedPrice: 21.0,
      timestamp: new Date(),
      changeId: "123",
      publishTime: new Date(),
      eventId: "33858191",
      eventName: "Test Event",
      ...overrides,
    };
  }

  /**
   * Create a mock market status document with optional overrides
   */
  static createMockMarketStatusDocument(
    overrides: Partial<MarketStatusDocument> = {}
  ): MarketStatusDocument {
    return {
      _id: "test-id",
      marketId: "1.237066150",
      status: "OPEN",
      timestamp: new Date(),
      changeId: "123",
      publishTime: new Date(),
      eventId: "33858191",
      eventName: "Test Event",
      numberOfActiveRunners: 26,
      ...overrides,
    };
  }

  /**
   * Create a mock market change with optional overrides
   */
  static createMockMarketChange(overrides: any = {}) {
    return {
      id: "1.237066150",
      marketDefinition: undefined,
      rc: undefined,
      ...overrides,
    };
  }

  /**
   * Create a mock runner with optional overrides
   */
  static createMockRunner(overrides: any = {}) {
    return {
      adjustmentFactor: 0.0,
      status: "ACTIVE",
      sortPriority: 1,
      id: 26600965,
      name: "Test Runner",
      ...overrides,
    };
  }
}
