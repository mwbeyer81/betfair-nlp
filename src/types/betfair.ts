// Betfair API data types based on the historical data structure

export interface BetfairMessage {
  op: string; // Operation type (e.g., "mcm" for market change message)
  clk: string; // Change ID
  pt: number; // Publish time
  mc: MarketChange[]; // Market changes
}

export interface MarketChange {
  id: string; // Market ID
  marketDefinition?: MarketDefinition;
  rc?: RunnerChange[]; // Runner changes (price updates)
}

export interface MarketDefinition {
  bspMarket: boolean;
  turnInPlayEnabled: boolean;
  persistenceEnabled: boolean;
  marketBaseRate: number;
  eventId: string;
  eventTypeId: string;
  numberOfWinners: number;
  bettingType: string;
  marketType: string;
  marketTime: string;
  suspendTime: string;
  bspReconciled: boolean;
  complete: boolean;
  inPlay: boolean;
  crossMatching: boolean;
  runnersVoidable: boolean;
  numberOfActiveRunners: number;
  betDelay: number;
  status: MarketStatus;
  runners: Runner[];
  regulators: string[];
  countryCode: string;
  discountAllowed: boolean;
  timezone: string;
  openDate: string;
  version: number;
  name: string;
  eventName: string;
  settledTime?: string;
}

export type MarketStatus = "OPEN" | "SUSPENDED" | "CLOSED";

export interface Runner {
  adjustmentFactor: number;
  status: RunnerStatus;
  sortPriority: number;
  id: number;
  name: string;
}

export type RunnerStatus = "ACTIVE" | "HIDDEN" | "WINNER" | "LOSER";

export interface RunnerChange {
  ltp: number; // Last traded price
  id: number; // Runner ID
}

// Document types for MongoDB collections
export interface MarketDefinitionDocument {
  _id?: string;
  bspMarket: boolean;
  turnInPlayEnabled: boolean;
  persistenceEnabled: boolean;
  marketBaseRate: number;
  eventId: string;
  eventTypeId: string;
  numberOfWinners: number;
  bettingType: string;
  marketType: string;
  marketTime: string;
  suspendTime: string;
  bspReconciled: boolean;
  complete: boolean;
  inPlay: boolean;
  crossMatching: boolean;
  runnersVoidable: boolean;
  numberOfActiveRunners: number;
  betDelay: number;
  status: MarketStatus;
  runners: Runner[];
  regulators: string[];
  countryCode: string;
  discountAllowed: boolean;
  timezone: string;
  openDate: string;
  version: number;
  name: string;
  eventName: string;
  settledTime?: string;
  marketId: string;
  timestamp: Date;
  changeId: string;
  publishTime: Date;
}

export interface PriceUpdateDocument {
  _id?: string;
  marketId: string;
  runnerId: number;
  runnerName: string;
  lastTradedPrice: number;
  timestamp: Date;
  changeId: string;
  publishTime: Date;
  eventId: string;
  eventName: string;
}
