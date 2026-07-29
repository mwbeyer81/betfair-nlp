import config from "config";

// Thin wrapper over Betfair's Exchange API-NG (the stable, long-documented
// JSON-RPC interface — https://developer.betfair.com). Written from a
// confident recollection of that interface's shape (identity login,
// SportsAPING/v1.0 JSON-RPC methods), NOT verified against a live account
// this session (no credentials exist yet — see AGENTS.md's
// daily-races-bet-button entry). Confirm current field/enum names against
// Betfair's own Developer Program docs before ever setting
// betfair.dryRun=false against a real account.
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

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string; data?: unknown };
}

// Betfair session tokens are interactive-login tokens that stay valid for
// hours, not seconds — cached in memory per client instance rather than
// re-logging in on every call, with re-login only on an explicit session
// error from a real API call (no fixed TTL guess baked in).
export class BetfairApiClient {
  private identityHost: string;
  private exchangeHost: string;
  private appKey: string;
  private username: string;
  private password: string;
  private dryRun: boolean;
  private sessionToken: string | null = null;

  constructor() {
    this.identityHost = readConfigString("betfair.identityHost") || "https://identitysso.betfair.com";
    this.exchangeHost = readConfigString("betfair.exchangeHost") || "https://api.betfair.com/exchange";
    this.appKey = readConfigString("betfair.appKey");
    this.username = readConfigString("betfair.username");
    this.password = readConfigString("betfair.password");
    // Defaults to true (the safe state) whenever the config value is
    // missing/malformed — a misconfigured deploy must fail safe into
    // "never actually bets", not the other way around.
    this.dryRun = readConfigBoolean("betfair.dryRun", true);
  }

  public hasCredentials(): boolean {
    return Boolean(this.appKey && this.username && this.password);
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
    if (this.sessionToken) return this.sessionToken;
    return this.login();
  }

  // Betfair's Sports AP-ING is a JSON-RPC 2.0 interface — one endpoint,
  // method name in the body (e.g. "SportsAPING/v1.0/listMarketCatalogue").
  private async jsonRpc<T>(method: string, params: unknown, retryOnSessionError = true): Promise<T> {
    const token = await this.ensureSession();
    const response = await fetch(`${this.exchangeHost}/betting/json-rpc/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Application": this.appKey,
        "X-Authentication": token,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const body = (await response.json().catch(() => ({}))) as JsonRpcResponse<T>;
    if (body.error) {
      const message = body.error.message ?? JSON.stringify(body.error.data ?? body.error);
      // INVALID_SESSION_INFORMATION (or a plain 401) means the cached
      // token expired/was revoked — log in exactly once more before
      // giving up, so a stale session doesn't fail every call until the
      // process restarts.
      if (retryOnSessionError && message.includes("INVALID_SESSION_INFORMATION")) {
        this.sessionToken = null;
        return this.jsonRpc<T>(method, params, false);
      }
      throw new Error(`Betfair API error (${method}): ${message}`);
    }
    return body.result as T;
  }

  public async listMarketCatalogue(filter: BetfairMarketCatalogueFilter): Promise<BetfairMarketCatalogueEntry[]> {
    return this.jsonRpc<BetfairMarketCatalogueEntry[]>("SportsAPING/v1.0/listMarketCatalogue", {
      filter,
      marketProjection: ["EVENT", "MARKET_START_TIME", "RUNNER_DESCRIPTION"],
      sort: "FIRST_TO_START",
      maxResults: "50",
    });
  }

  public async listMarketBook(marketIds: string[]): Promise<BetfairMarketBook[]> {
    return this.jsonRpc<BetfairMarketBook[]>("SportsAPING/v1.0/listMarketBook", {
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
      const result = await this.jsonRpc<{
        status: string;
        instructionReports?: { status: string; betId?: string; averagePriceMatched?: number; errorCode?: string }[];
      }>("SportsAPING/v1.0/placeOrders", {
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
