import config from "config";
import { BetfairApiClient } from "../betfair-api-client";

// Real bug this file exists to catch: the `config` npm package does NOT
// auto-cast env-var-sourced values (via custom-environment-variables.json)
// to match the type already at that path in default.json — a
// custom-environment-variables.json substitution always produces a raw
// string. `readConfigBoolean` in betfair-api-client.ts must handle both a
// real boolean (a literal JSON value, no substitution involved) and the
// "true"/"false" strings a substituted env var always produces. See
// AGENTS.md's config-boolean-fix entry for how this was actually found —
// BETFAIR_DRY_RUN=false silently had no effect in production because of
// exactly this gap.
jest.mock("config");
const mockGet = config.get as jest.Mock;

describe("BetfairApiClient — config boolean coercion", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation(() => {
      throw new Error("not configured");
    });
  });

  it("treats a real boolean false (a literal default.json value, no env override) as false", () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? false : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(false);
  });

  it('treats the STRING "false" (what an env-var override actually produces) as false, not as truthy/fallback', () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? "false" : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(false);
  });

  it('treats the STRING "true" as true', () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? "true" : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(true);
  });

  it("falls back to true (the safe default) when the key is missing entirely", () => {
    mockGet.mockImplementation(() => {
      throw new Error("key not found");
    });
    expect(new BetfairApiClient().isDryRun()).toBe(true);
  });

  it("falls back to true (the safe default) for an unrecognized value shape, never silently going live", () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? 0 : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(true);
  });

  it("getLiveBettingAllowedEmail lowercases whatever string config returns, and defaults to empty (nobody allowed) when unset", () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.liveBettingAllowedEmail" ? "MatthewBeyer@Hotmail.com" : ""));
    expect(new BetfairApiClient().getLiveBettingAllowedEmail()).toBe("matthewbeyer@hotmail.com");

    mockGet.mockImplementation(() => {
      throw new Error("not configured");
    });
    expect(new BetfairApiClient().getLiveBettingAllowedEmail()).toBe("");
  });
});
