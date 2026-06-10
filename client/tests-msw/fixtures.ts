import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setupApiMocks(page: Page) {
  await page.route("**/api/stats", (route) =>
    route.fulfill({ json: { success: true, data: { totalRaces: 8, totalRunners: 109 } } })
  );

  await page.route("**/api/events/grouped", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          { eventId: "33858191", eventName: "Cheltenham 1st Jan", marketIds: ["1.237066150"], count: 1 },
          { eventId: "33988522", eventName: "Leopardstown 1st Feb", marketIds: ["1.238923739", "1.238923745"], count: 2 },
        ],
      },
    })
  );

  await page.route("**/api/events/*/runners/*/price-updates", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            _id: "pu1",
            marketId: "1.237066150",
            runnerId: 12345,
            runnerName: "Springwell Bay",
            lastTradedPrice: 4.5,
            timestamp: "2025-01-01T14:10:00.000Z",
            changeId: "abc1",
            eventId: "33858191",
            eventName: "Cheltenham 1st Jan",
          },
        ],
        count: 1,
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

  await page.route("**/api/events/*/price-updates", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            _id: "pu1",
            marketId: "1.237066150",
            runnerId: 12345,
            runnerName: "Springwell Bay",
            lastTradedPrice: 4.5,
            timestamp: "2025-01-01T14:10:00.000Z",
            changeId: "abc1",
            eventId: "33858191",
            eventName: "Cheltenham 1st Jan",
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

  await page.route((url) => url.pathname === "/api/runners", (route) =>
    route.fulfill({
      json: {
        success: true,
        count: 1,
        total: 1,
        totalPages: 1,
        totalRunners: 3,
        pnlStats: { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 },
        data: [
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
        ],
      },
    })
  );

  await page.route("**/health", (route) =>
    route.fulfill({ json: { status: "OK", service: "Betfair NLP API", database: "connected" } })
  );
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await setupApiMocks(page);
    await use(page);
  },
});

export { expect };

