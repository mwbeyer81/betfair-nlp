import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setupApiMocks(page: Page) {
  await page.route("**/api/stats", (route) =>
    route.fulfill({ json: { success: true, data: { totalRaces: 8, totalRunners: 109 } } })
  );

  await page.route((url) => url.pathname === "/api/events/grouped", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          { eventId: "33858191", eventName: "Cheltenham 1st Jan", marketIds: ["1.237066150"], count: 1 },
          { eventId: "33988522", eventName: "Leopardstown 1st Feb", marketIds: ["1.238923739", "1.238923745"], count: 2 },
        ],
        total: 2,
        totalPages: 1,
      },
    })
  );

  await page.route("**/api/events/*/runners", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            marketId: "1.237066150",
            marketTime: "2025-01-01T14:01:00.000Z",
            marketType: "ANTEPOST_WIN",
            marketName: "Cheltenham Chase",
            runners: [
              { id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1, bsp: 4.5 },
              { id: 12346, name: "Gaelic Warrior", status: "ACTIVE", sortPriority: 2, bsp: 9.2 },
              { id: 12347, name: "Fact To File", status: "WINNER", sortPriority: 3, bsp: 2.1 },
            ],
          },
        ],
        count: 1,
      },
    })
  );

  await page.route("**/api/events/*/definitions", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            marketId: "1.237066150",
            marketType: "ANTEPOST_WIN",
            marketTime: "2025-01-01T14:01:00.000Z",
            status: "CLOSED",
            eventId: "33858191",
            eventName: "Cheltenham 1st Jan",
            runners: [],
          },
        ],
        count: 1,
      },
    })
  );

  await page.route((url) => url.pathname === "/api/runners/filter-bounds", (route) =>
    route.fulfill({ json: { success: true, data: { maxRunnersPerRace: 29, maxBsp: 1000, minBsp: 1.1 } } })
  );

  await page.route((url) => url.pathname === "/api/runners/countries", (route) =>
    route.fulfill({ json: { success: true, data: ["GB", "IE"] } })
  );

  await page.route((url) => url.pathname === "/api/runners/pnl-stats", (route) =>
    route.fulfill({ json: { success: true, data: { staked: 1.6, returns: 2.6, pnl: 1.0 } } })
  );

  await page.route((url) => url.pathname === "/api/runners", (route) => {
    // The mocked race has 3 runners in SP range. Return empty data when maxInSp < 3.
    const reqUrl = new URL(route.request().url());
    const maxInSp = parseInt(reqUrl.searchParams.get("maxInSp") ?? "30");
    const raceData = maxInSp >= 3 ? [
      {
        marketId: "1.237066150",
        marketTime: "2025-01-01T14:01:00.000Z",
        marketType: "ANTEPOST_WIN",
        marketName: "Cheltenham Chase",
        eventId: "33858191",
        eventName: "Cheltenham 1st Jan",
        runners: [
          { id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1, bsp: 4.5 },
          { id: 12346, name: "Gaelic Warrior", status: "ACTIVE", sortPriority: 2, bsp: 9.2 },
          { id: 12347, name: "Fact To File", status: "WINNER", sortPriority: 3, bsp: 2.1 },
        ],
      },
    ] : [];
    route.fulfill({
      json: {
        success: true,
        count: raceData.length,
        total: raceData.length,
        totalPages: 1,
        totalRunners: raceData.length > 0 ? 3 : 0,
        pnlStats: { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 },
        data: raceData,
      },
    });
  });

  await page.route("**/health", (route) =>
    route.fulfill({ json: { status: "OK", service: "Betfair NLP API", database: "connected" } })
  );
}

// Fake JWT with exp=9999999999 (year 2286) — satisfies isTokenExpired() check in App.tsx
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJtYXR0aGV3IiwiZXhwIjo5OTk5OTk5OTk5fQ==" +
  ".fakesignature";

export const test = base.extend({
  page: async ({ page }, use) => {
    // Inject auth token before React mounts so the app skips the login screen
    await page.addInitScript((token) => {
      localStorage.setItem("auth_token", token);
    }, FAKE_JWT);
    await setupApiMocks(page);
    await use(page);
  },
});

export { expect };

