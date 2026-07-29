import config from "config";

// Thin wrapper over Betfair's Exchange API-NG. Wire format confirmed live
// (2026-07-29, see AGENTS.md's "primary checkout, directly on develop,
// docs-only" dated entry — a different agent's session, pure connectivity
// exploration, no feature code written there) — NOT the JSON-RPC-style
// interface this file originally guessed at, but individual REST-style
// operation endpoints: `POST {exchangeHost}/betting/rest/v1.0/<operation>/`
// with the params object as the raw JSON body, plain JSON result back (no
// jsonrpc envelope). Errors come back as HTTP 400 with a SOAP-fault-shaped
// body (`{faultcode, faultstring, detail: {APINGException: {errorCode}}}`),
// not a network-level failure — see readApingErrorCode below.
//
// Safety: this client is not the safety boundary by itself — placeOrders()
// below refuses to make a real network call whenever dryRun is on,
// regardless of what any caller does. That gate lives here, inside the
// client, rather than only in the calling service, so there is no code path
// that can reach Betfair's real order-placement endpoint while dryRun=true.

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function readConfigBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = config.get<boolean>(key);
    return typeof value === "boolean" ? value : fallback;
  } catch {
    return fallback;
  }
}

export interface BetfairEventType {
  eventType: { id: string; name: string };
  marketCount: number;
}

export interface BetfairRunnerCatalog {
  selectionId: number;
  runnerName: string;
}

export interface BetfairMarketCatalogueEntry {
  marketId: string;
  marketName: string;
  marketStartTime: string;
  event: { id: string; name: string; venue?: string };
  runners: BetfairRunnerCatalog[];
}

export interface BetfairMarketCatalogueFilter {
  eventTypeIds: string[];
  marketCountries: string[];
  marketStartTime: { from: string; to: string };
  textQuery?: string;
}

export interface BetfairRunnerBook {
  selectionId: number;
  status: string;
  ex?: { availableToBack?: { price: number; size: number }[] };
}

export interface BetfairMarketBook {
  marketId: string;
  status: string;
  inplay: boolean;
  runners: BetfairRunnerBook[];
}

export type BetfairPlaceOrderResult =
  | { outcome: "DRY_RUN"; simulatedPrice: number; simulatedSize: number }
  | { outcome: "SUCCESS"; betId: string; matchedPrice: number }
  | { outcome: "FAILURE"; error: string };

// Best-effort extraction across the couple of shapes Betfair's API-NG
// errors are documented/observed to take — defensive rather than a single
// assumed path, since the exact nesting wasn't independently re-verified
// this session (only that "it's a JSON APINGException body" was confirmed
// live, not the precise field path).
function readApingErrorCode(body: unknown): string | null {
  const b = body as Record<string, unknown> | null;
  if (!b) return null;
  const detail = b.detail as Record<string, unknown> | undefined;
  const aping = detail?.APINGException as Record<string, unknown> | undefined;
  if (typeof aping?.errorCode === "string") return aping.errorCode;
  if (typeof b.errorCode === "string") return b.errorCode as string;
  if (typeof b.faultstring === "string") return b.faultstring as string;
  return null;
}

export class BetfairApiClient {
  private identityHost: string;
  private exchangeHost: string;
  private appKey: string;
  private username: string;
  private password: string;
  private dryRun: boolean;
  // A session token obtained outside this process (e.g. copied from
  // Betfair's own API-NG visualiser) — when present, used as-is and never
  // refreshed automatically, since there's no username/password on file to
  // re-login with. See the AGENTS.md entry referenced above: the current
  // real-world setup is exactly this (a manually-obtained SSOID), not
  // server-driven login, so this takes priority over username/password.
  private fixedSessionId: string;
  private sessionToken: string | null = null;

  constructor() {
    this.identityHost = readConfigString("betfair.identityHost") || "https://identitysso.betfair.com";
    this.exchangeHost = readConfigString("betfair.exchangeHost") || "https://api.betfair.com/exchange";
    // delayAppKey is the field name already sitting in config/local.json
    // from the connectivity exploration referenced above (a free "Delay"
    // app key, ~1min delayed market data — the account's only application)
    // — accepted as a fallback so this reads real, already-configured
    // local credentials without requiring them to be renamed/duplicated.
    this.appKey = readConfigString("betfair.appKey") || readConfigString("betfair.delayAppKey");
    this.username = readConfigString("betfair.username");
    this.password = readConfigString("betfair.password");
    this.fixedSessionId = readConfigString("betfair.sessionId");
    // Defaults to true (the safe state) whenever the config value is
    // missing/malformed — a misconfigured deploy must fail safe into
    // "never actually bets", not the other way around.
    this.dryRun = readConfigBoolean("betfair.dryRun", true);
  }

  // A fixed sessionId is itself enough to make calls (no login needed);
  // otherwise a username+password pair is required for the interactive
  // login flow.
  public hasCredentials(): boolean {
    return Boolean(this.appKey) && Boolean(this.fixedSessionId || (this.username && this.password));
  }

  public isDryRun(): boolean {
    return this.dryRun;
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.identityHost}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "X-Application": this.appKey,
      },
      body: new URLSearchParams({ username: this.username, password: this.password }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as { status?: string; token?: string; error?: string };
    if (body.status !== "SUCCESS" || !body.token) {
      throw new Error(`Betfair login failed: ${body.error ?? body.status ?? "unknown error"}`);
    }
    this.sessionToken = body.token;
    return body.token;
  }

  private async ensureSession(): Promise<string> {
    if (this.fixedSessionId) return this.fixedSessionId;
    if (this.sessionToken) return this.sessionToken;
    return this.login();
  }

  private async restCall<T>(operation: string, params: unknown, retryOnSessionError = true): Promise<T> {
    const token = await this.ensureSession();
    const response = await fetch(`${this.exchangeHost}/betting/rest/v1.0/${operation}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Application": this.appKey,
        "X-Authentication": token,
      },
      body: JSON.stringify(params),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorCode = readApingErrorCode(body) ?? response.statusText ?? "unknown error";
      if (retryOnSessionError && errorCode === "INVALID_SESSION_INFORMATION" && !this.fixedSessionId && this.username && this.password) {
        this.sessionToken = null;
        return this.restCall<T>(operation, params, false);
      }
      throw new Error(`Betfair API error (${operation}): ${errorCode}`);
    }
    return body as T;
  }

  // Read-only, side-effect-free — the confirmed-live connectivity check
  // referenced in this file's header comment (`{"filter":{}}` returns the
  // real sport/market-count list). Safe to call at any time, purely to
  // prove the round trip works.
  public async listEventTypes(): Promise<BetfairEventType[]> {
    return this.restCall<BetfairEventType[]>("listEventTypes", { filter: {} });
  }

  public async listMarketCatalogue(filter: BetfairMarketCatalogueFilter): Promise<BetfairMarketCatalogueEntry[]> {
    return this.restCall<BetfairMarketCatalogueEntry[]>("listMarketCatalogue", {
      filter,
      marketProjection: ["EVENT", "MARKET_START_TIME", "RUNNER_DESCRIPTION"],
      sort: "FIRST_TO_START",
      maxResults: "50",
    });
  }

  public async listMarketBook(marketIds: string[]): Promise<BetfairMarketBook[]> {
    return this.restCall<BetfairMarketBook[]>("listMarketBook", {
      marketIds,
      priceProjection: { priceData: ["EX_BEST_OFFERS"] },
    });
  }

  // The dry-run gate: whenever dryRun is on, this returns a synthetic
  // result WITHOUT ever calling Betfair's real place-order endpoint — no
  // network request, no chance of an accidental live bet. size is the
  // stake in GBP; price is the minimum acceptable back price (a Betfair
  // "LIMIT" back order at this price or better).
  public async placeOrders(marketId: string, selectionId: number, price: number, size: number): Promise<BetfairPlaceOrderResult> {
    if (this.dryRun) {
      return { outcome: "DRY_RUN", simulatedPrice: price, simulatedSize: size };
    }
    try {
      const result = await this.restCall<{
        status: string;
        instructionReports?: { status: string; betId?: string; averagePriceMatched?: number; errorCode?: string }[];
      }>("placeOrders", {
        marketId,
        instructions: [
          {
            selectionId,
            side: "BACK",
            orderType: "LIMIT",
            limitOrder: { size, price, persistenceType: "LAPSE" },
          },
        ],
      });
      const report = result.instructionReports?.[0];
      if (result.status !== "SUCCESS" || !report || report.status !== "SUCCESS" || !report.betId) {
        return { outcome: "FAILURE", error: report?.errorCode ?? result.status ?? "unknown placeOrders failure" };
      }
      return { outcome: "SUCCESS", betId: report.betId, matchedPrice: report.averagePriceMatched ?? price };
    } catch (error) {
      return { outcome: "FAILURE", error: error instanceof Error ? error.message : String(error) };
    }
  }
}
