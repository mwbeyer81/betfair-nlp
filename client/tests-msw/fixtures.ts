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

  await page.route((url) => url.pathname === "/api/industry-sp/filter-bounds", (route) =>
    route.fulfill({ json: { success: true, data: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 } } })
  );

  await page.route((url) => url.pathname === "/api/industry-sp/countries", (route) =>
    route.fulfill({ json: { success: true, data: ["GB", "IE"] } })
  );

  await page.route((url) => url.pathname === "/api/industry-sp/pnl-stats", (route) =>
    route.fulfill({ json: { success: true, data: { staked: 1.6, returns: 2.6, pnl: 1.0 } } })
  );

  const MOCK_MEETING_RACES = [
    {
      raceId: 914592,
      meetingId: "Cheltenham|2025-01-01",
      meetingName: "Cheltenham — 1 January 2025",
      course: "Cheltenham",
      countryCode: "GB",
      raceTime: "2025-01-01T14:01:00",
      raceName: "Cheltenham Chase",
      raceType: "Chase",
      ran: 3,
      runners: [
        { id: 12345, name: "Springwell Bay", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 4.5, ispFraction: "7/2", isFavourite: false },
        { id: 12346, name: "Gaelic Warrior", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 9.2, ispFraction: "41/5", isFavourite: false },
        { id: 12347, name: "Fact To File", num: 3, draw: null, status: "WINNER", sortPriority: 3, isp: 2.1, ispFraction: "11/10", isFavourite: true },
      ],
    },
    {
      raceId: 914593,
      meetingId: "Cheltenham|2025-01-01",
      meetingName: "Cheltenham — 1 January 2025",
      course: "Cheltenham",
      countryCode: "GB",
      raceTime: "2025-01-01T14:35:00",
      raceName: "Cheltenham Hurdle",
      raceType: "Hurdle",
      ran: 2,
      runners: [
        { id: 22345, name: "Constitution Hill", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.5, ispFraction: "1/2", isFavourite: true },
        { id: 22346, name: "State Man", num: 2, draw: null, status: "PLACED", sortPriority: 2, isp: 3.2, ispFraction: "11/5", isFavourite: false },
      ],
    },
  ];

  await page.route((url) => url.pathname.startsWith("/api/industry-sp/meeting/"), (route) => {
    const meetingId = decodeURIComponent(route.request().url().split("/api/industry-sp/meeting/")[1]);
    const data = meetingId === "Cheltenham|2025-01-01" ? MOCK_MEETING_RACES : [];
    route.fulfill({ json: { success: true, data, count: data.length } });
  });

  await page.route((url) => url.pathname.startsWith("/api/industry-sp/race/"), (route) => {
    const raceId = parseInt(route.request().url().split("/api/industry-sp/race/")[1], 10);
    const race = MOCK_MEETING_RACES.find((r) => r.raceId === raceId);
    if (!race) {
      route.fulfill({ status: 404, json: { success: false, error: "Race not found" } });
      return;
    }
    route.fulfill({ json: { success: true, data: race } });
  });

  await page.route((url) => url.pathname === "/api/industry-sp", (route) => {
    // The mocked race has 3 runners in ISP range. Return empty data when maxInIspRange < 3.
    const reqUrl = new URL(route.request().url());
    const maxInIspRange = parseInt(reqUrl.searchParams.get("maxInIspRange") ?? "30");
    const raceData = maxInIspRange >= 3 ? [
      {
        raceId: 914592,
        meetingId: "Cheltenham|2025-01-01",
        meetingName: "Cheltenham — 1 January 2025",
        course: "Cheltenham",
        countryCode: "GB",
        raceTime: "2025-01-01T14:01:00",
        raceName: "Cheltenham Chase",
        raceType: "Chase",
        ran: 3,
        runners: [
          { id: 12345, name: "Springwell Bay", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 4.5, ispFraction: "7/2", isFavourite: false },
          { id: 12346, name: "Gaelic Warrior", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 9.2, ispFraction: "41/5", isFavourite: false },
          { id: 12347, name: "Fact To File", num: 3, draw: null, status: "WINNER", sortPriority: 3, isp: 2.1, ispFraction: "11/10", isFavourite: true },
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

  await page.route((url) => url.pathname === "/api/industry-sp/splits", (route) => {
    // Mirrors the /api/industry-sp handler above: the mocked dataset has 1
    // race with 3 runners in ISP range, so maxInIspRange < 3 zeroes it out.
    const reqUrl = new URL(route.request().url());
    const maxInIspRange = parseInt(reqUrl.searchParams.get("maxInIspRange") ?? "30");
    const matches = maxInIspRange >= 3;
    const totalRaces = matches ? 1 : 0;
    const pnlStats = matches ? { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 } : { staked: 0, returns: 0, pnl: 0, count: 0 };

    const fromRowARaw = reqUrl.searchParams.get("fromRowA");
    const toRowARaw = reqUrl.searchParams.get("toRowA");
    const fromRowBRaw = reqUrl.searchParams.get("fromRowB");
    const toRowBRaw = reqUrl.searchParams.get("toRowB");
    let fromRowA: number, toRowA: number | null, fromRowB: number, toRowB: number | null;
    if (fromRowARaw == null && toRowARaw == null && fromRowBRaw == null && toRowBRaw == null) {
      const half = Math.floor(totalRaces / 2);
      fromRowA = 1;
      toRowA = half;
      fromRowB = half + 1;
      toRowB = null;
    } else {
      fromRowA = fromRowARaw != null ? parseInt(fromRowARaw, 10) : 1;
      toRowA = toRowARaw != null ? parseInt(toRowARaw, 10) : null;
      fromRowB = fromRowBRaw != null ? parseInt(fromRowBRaw, 10) : 1;
      toRowB = toRowBRaw != null ? parseInt(toRowBRaw, 10) : null;
    }
    // A row range only means something relative to an actually-matching
    // dataset — if the filters zero it out, both splits must be 0
    // regardless of which explicit fromRow/toRow values are requested.
    const totalA = totalRaces === 0 ? 0 : Math.max(0, (toRowA ?? totalRaces) - fromRowA + 1);
    const totalB = totalRaces === 0 ? 0 : Math.max(0, (toRowB ?? totalRaces) - fromRowB + 1);

    route.fulfill({
      json: {
        success: true,
        totalRaces,
        totalRunners: matches ? 3 : 0,
        // filterBounds/countries ride along on this response now (see
        // getSplitStats on the backend) — mirrors the standalone
        // /filter-bounds and /countries mocks above so IndustrySpScreen's
        // filter panel still populates without those separate requests.
        filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
        countries: ["GB", "IE"],
        splitA: { fromRow: fromRowA, toRow: toRowA, total: totalA, totalRunners: totalA > 0 ? 3 : 0, pnlStats: totalA > 0 ? pnlStats : { staked: 0, returns: 0, pnl: 0, count: 0 } },
        splitB: { fromRow: fromRowB, toRow: toRowB, total: totalB, totalRunners: totalB > 0 ? 3 : 0, pnlStats: totalB > 0 ? pnlStats : { staked: 0, returns: 0, pnl: 0, count: 0 } },
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

