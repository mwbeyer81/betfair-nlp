import config from "config";

const DEFAULT_BASE_URL = "https://api.theracingapi.com/v1";

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export interface RacingApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
}

// Thin wrapper over The Racing API (https://theracingapi.com) — HTTP Basic
// Auth, JSON in/out. Deliberately returns status+body instead of throwing on
// non-2xx: callers (e.g. the live smoke tests) need to distinguish "wrong
// credentials" (401, generic detail) from "endpoint needs a higher plan"
// (401, {"detail": "<Tier> Plan required"}) from a real outage, none of
// which should be swallowed by an exception.
export class RacingApiClient {
  private baseUrl: string;
  private username: string;
  private password: string;

  constructor() {
    this.baseUrl = readConfigString("racingApi.baseUrl") || DEFAULT_BASE_URL;
    this.username = readConfigString("racingApi.username");
    this.password = readConfigString("racingApi.password");
  }

  public hasCredentials(): boolean {
    return Boolean(this.username && this.password);
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64");
  }

  public async get<T = unknown>(path: string, params?: Record<string, string>): Promise<RacingApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    const response = await fetch(url.toString(), {
      headers: { Authorization: this.authHeader() },
    });
    const body = (await response.json().catch(() => ({}))) as T;
    return { status: response.status, ok: response.ok, body };
  }
}
