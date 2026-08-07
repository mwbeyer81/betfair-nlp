import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Brier scores the mocked endpoints return. 0.0871 model vs 0.0902 market —
// the model ahead by 0.0031, the order of magnitude a real edge has on this
// data, and far enough from a round number that a hardcoded fallback in the
// app would stand out in a failure. `scored === priced` mirrors the real
// industry-SP endpoints, where both scores always cover the same runners.
const MOCK_BRIER = { scored: 1240, priced: 1240, model: 0.0871, market: 0.0902 };
// What the backend returns when the filters match nothing: null, never 0 — 0
// is the BEST possible Brier score, so a zero here would render a flawless
// forecast on a screen showing no horses.
const EMPTY_MOCK_BRIER = { scored: 0, priced: 0, model: null, market: null };
// The favourite-backed baseline the mocked endpoints return. 800 races, 820
// bets (20 of them joint favourites), losing 12.5% to-win and 4.9% level — the
// two conventions deliberately disagreeing, since a screen reading the wrong
// one is exactly the failure this baseline is most exposed to. 800 races clears
// the small-sample threshold, so the "N races" pill stays off unless a test
// asks for it.
const MOCK_FAV = { races: 800, count: 820, staked: 400, returns: 350, pnl: -50, level: { staked: 820, returns: 780, pnl: -40 } };
// What the backend returns when the filters match nothing. Zeros throughout,
// but `count: 0` is what the UI reads as "no answer" — a £0.00 baseline would
// render as one that broke even, which backing favourites never does.
const EMPTY_MOCK_FAV = { races: 0, count: 0, staked: 0, returns: 0, pnl: 0, level: { staked: 0, returns: 0, pnl: 0 } };

async function setupApiMocks(page: Page) {
  await page.route("**/api/stats", (route) =>
    route.fulfill({ json: { success: true, data: { totalRaces: 8, totalRunners: 109 } } })
  );

  // IndustrySpScreen fetches this whenever it sees an authenticated session
  // (see its emailVerified effect) — verified by default so every existing
  // authenticated test keeps seeing "no verify-email banner" like before
  // that banner existed. Tests specifically covering the banner override
  // this route themselves.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { success: true, email: "matthew@backbet.co.uk", emailVerified: true } })
  );
  // IndustrySpScreen fetches this once on mount to explain why a model-filtered
  // date range outside the walk-forward window comes back empty. The dates are
  // the real production ones, so a test picking a range before 2016 or after
  // 2026-07-30 exercises the same edges a user hits.
  await page.route("**/api/model-score-coverage", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          oosVersionId: "wf-msw",
          coverageMinDate: "2016-01-01",
          coverageMaxDate: "2026-07-30",
          scoredRows: 885089,
          unscoredRows: 86027,
        },
      },
    })
  );

  await page.route("**/api/auth/resend-verification", (route) =>
    route.fulfill({ json: { success: true, alreadyVerified: false } })
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
        brier: MOCK_BRIER,
        favPnl: raceData.length > 0 ? MOCK_FAV : EMPTY_MOCK_FAV,
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

  await page.route((url) => url.pathname === "/api/industry-sp/courses", (route) =>
    route.fulfill({ json: { success: true, data: ["Cheltenham", "Ascot"] } })
  );

  await page.route((url) => url.pathname === "/api/industry-sp/goings", (route) =>
    route.fulfill({ json: { success: true, data: ["Good", "Soft"] } })
  );

  await page.route((url) => url.pathname === "/api/industry-sp/race-classes", (route) =>
    route.fulfill({ json: { success: true, data: ["Class 1", "Class 2"] } })
  );

  await page.route((url) => url.pathname === "/api/industry-sp/race-types", (route) =>
    route.fulfill({ json: { success: true, data: ["Chase", "Hurdle"] } })
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
        { id: 12345, name: "Springwell Bay", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 4.5, ispFraction: "7/2", isFavourite: false, trainer: "W P Mullins" },
        { id: 12346, name: "Gaelic Warrior", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 9.2, ispFraction: "41/5", isFavourite: false, trainer: "G Elliott", trainerFormRuns: 0 },
        { id: 12347, name: "Fact To File", num: 3, draw: null, status: "WINNER", sortPriority: 3, isp: 2.1, ispFraction: "11/10", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43 },
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

  function dailyRunner(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      runnerId: "hrs_1", horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
      region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
      damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
      owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
      officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
      ...overrides,
    };
  }

  const MOCK_DAILY_RACES = [
    {
      raceId: "rac_test_0001", eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
      offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
      distanceF: "16.0", region: "GB", raceClass: "Class 4", type: "Hurdle", ageBand: "4yo+",
      prize: "£3,769", fieldSize: "2", going: "Good", surface: "Turf",
      runners: [
        // modelWinProbability 25 -> breakeven decimal odds 100/25 = 4.00 (3/1).
        // Also carries modelTopFactors so the tooltip's "why this %" list has
        // something to render — hrs_2 below is deliberately left free of any
        // model fields, since it must NOT qualify for the Today's Picks
        // filter test further down.
        dailyRunner({
          modelWinProbability: 25,
          modelVersionId: "xgb-test-version",
          modelTopFactors: [
            { label: "Strong recent form", direction: "positive" },
            { label: "In-form trainer", direction: "positive" },
            { label: "Lower official rating", direction: "negative" },
          ],
          // A real captured result — this race has already finished. isp 5
          // (implied prob 100/5=20%) -> £1-to-win stake 1/(5-1)=£0.25, so a
          // WINNER's PnL is exactly +£1.00 regardless of isp (see
          // ispFormat.ts's stakeToWin1/runnerPnl convention) — and since its
          // own modelWinProbability (25%) beats that 20% implied price, this
          // pick also "beats SP" (dailyRacePickBeatsSp).
          result: { status: "WINNER", pos: "1", isp: 5, ispFraction: "4/1" },
        }),
        dailyRunner({ runnerId: "hrs_2", horse: "Second Fixture", trainer: "C Trainer", jockey: "D Jockey", number: "2" }),
      ],
    },
    {
      raceId: "rac_test_0002", eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
      offTime: "2:25", offDt: "2026-06-03T14:25:00+01:00", raceName: "Handicap Chase",
      distanceF: "24.0", region: "GB", raceClass: "Class 3", type: "Chase", ageBand: "5yo+",
      prize: "£5,912", fieldSize: "1", going: "Good", surface: "Turf",
      runners: [dailyRunner({ runnerId: "hrs_3", horse: "Chase Fixture", number: "1" })],
    },
    {
      raceId: "rac_test_0003", eventId: "ascot-2026-06-03", course: "Ascot", date: "2026-06-03",
      offTime: "3:05", offDt: "2026-06-03T15:05:00+01:00", raceName: "Maiden Stakes",
      distanceF: "8.0", region: "GB", raceClass: "Class 2", type: "Flat", ageBand: "3yo",
      prize: "£9,400", fieldSize: "1", going: "Good to Firm", surface: "Turf",
      runners: [dailyRunner({ runnerId: "hrs_4", horse: "Ascot Fixture", number: "1" })],
    },
  ];

  await page.route((url) => url.pathname === "/api/daily-races", (route) => {
    route.fulfill({ json: { success: true, data: MOCK_DAILY_RACES, count: MOCK_DAILY_RACES.length } });
  });

  await page.route((url) => url.pathname.startsWith("/api/daily-races/event/"), (route) => {
    const eventId = decodeURIComponent(route.request().url().split("/api/daily-races/event/")[1]);
    const data = MOCK_DAILY_RACES.filter((r) => r.eventId === eventId);
    route.fulfill({ json: { success: true, data, count: data.length } });
  });

  // Conditional "Bet" orders — stateful per-test in-memory list, same
  // per-call-freshness as every other mutable fixture in this function
  // (setupApiMocks runs once per test via the test/anonTest fixtures
  // below). Creating an order never touches Betfair at all in the real
  // backend (only the scheduled evaluator does) — so this mock never
  // needs to simulate any Betfair-side behavior, only bet_orders CRUD.
  let mockBetOrderIdCounter = 1;
  const mockBetOrders: Record<string, unknown>[] = [];

  await page.route((url) => url.pathname === "/api/bet-orders", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const targetProfit = Number(body.targetProfit);
      const maxStake = Number(body.maxStake);
      if (!(targetProfit > 0) || !(maxStake > 0)) {
        route.fulfill({ status: 400, json: { success: false, error: "targetProfit must be a positive number" } });
        return;
      }
      const order = {
        id: `bet_${mockBetOrderIdCounter++}`,
        runnerId: body.runnerId,
        horse: body.horse,
        course: body.course,
        offTime: body.offTime,
        raceId: body.raceId,
        eventId: body.eventId,
        targetProfit,
        maxStake,
        minQualifyingPrice: 1 + targetProfit / maxStake,
        status: "pending",
        createdAt: "2026-07-29T08:00:00.000Z",
      };
      mockBetOrders.push(order);
      route.fulfill({ status: 201, json: { success: true, data: order } });
      return;
    }
    route.fulfill({ json: { success: true, data: mockBetOrders, count: mockBetOrders.length } });
  });

  await page.route((url) => url.pathname.startsWith("/api/bet-orders/"), (route) => {
    const id = decodeURIComponent(route.request().url().split("/api/bet-orders/")[1]);
    const order = mockBetOrders.find((o) => o.id === id);
    if (!order || (order.status !== "pending" && order.status !== "unmatched")) {
      route.fulfill({ status: 404, json: { success: false, error: "Not found or no longer cancellable" } });
      return;
    }
    order.status = "cancelled";
    route.fulfill({ json: { success: true } });
  });

  await page.route((url) => url.pathname.startsWith("/api/daily-races/race/"), (route) => {
    const raceId = decodeURIComponent(route.request().url().split("/api/daily-races/race/")[1]);
    const race = MOCK_DAILY_RACES.find((r) => r.raceId === raceId);
    if (!race) {
      route.fulfill({ status: 404, json: { success: false, error: "Race not found" } });
      return;
    }
    route.fulfill({ json: { success: true, data: race } });
  });

  // hrs_1 has a real live price; every other runner reports "not
  // configured" (a real, expected state — see live-price-service.ts) so
  // existing tests that don't specifically cover this feature see
  // consistent, harmless output rather than an unmocked network request.
  await page.route((url) => url.pathname === "/api/daily-races/live-prices", async (route) => {
    const body = route.request().postDataJSON() as { picks: { runnerId: string }[] };
    const data: Record<string, { price: number | null; note?: string }> = {};
    for (const pick of body.picks) {
      data[pick.runnerId] =
        pick.runnerId === "hrs_1" ? { price: 4.0 } : { price: null, note: "Live prices aren't configured yet." };
    }
    route.fulfill({ json: { success: true, data } });
  });

  const MOCK_INDUSTRY_SP_RACE = {
    raceId: 914592,
    meetingId: "Cheltenham|2025-01-01",
    meetingName: "Cheltenham — 1 January 2025",
    course: "Cheltenham",
    countryCode: "GB",
    raceTime: "2025-01-01T14:01:00",
    raceName: "Cheltenham Chase",
    raceType: "Chase",
    raceClass: "Class 1",
    going: "Good",
    ran: 3,
    runners: [
      { id: 12345, name: "Springwell Bay", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 4.5, ispFraction: "7/2", isFavourite: false, trainer: "W P Mullins", modelWinProbabilityOos: 12.5 },
      { id: 12346, name: "Gaelic Warrior", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 9.2, ispFraction: "41/5", isFavourite: false, trainer: "G Elliott", trainerFormRuns: 0, modelWinProbabilityOos: 8.3 },
      { id: 12347, name: "Fact To File", num: 3, draw: null, status: "WINNER", sortPriority: 3, isp: 2.1, ispFraction: "11/10", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43, modelWinProbabilityOos: 39.2 },
    ],
  };

  // A second race where every runner has zero trainer-form sample — the
  // same shape as the real cold-start-window bug (a race whose runners'
  // trainers have no runs in the trailing 14 days as of that race). Used to
  // prove the "Has trainer form" filter actually excludes a race like this
  // from the individual races list, not just the Split aggregate totals.
  const MOCK_NO_FORM_RACE = {
    raceId: 773337,
    meetingId: "Southwell|2021-01-01",
    meetingName: "Southwell — 1 January 2021",
    course: "Southwell",
    countryCode: "GB",
    raceTime: "2021-01-01T01:15:00",
    raceName: "Bombardier Handicap",
    raceType: "Flat",
    raceClass: "Class 1",
    going: "Good",
    ran: 1,
    runners: [
      { id: 99001, name: "Teston (FR)", num: 1, draw: 2, status: "PLACED", sortPriority: 1, isp: 11, ispFraction: "10/1", isFavourite: false, trainer: "Ivan Furtado", trainerFormRuns: 0, modelWinProbabilityOos: 100 },
    ],
  };

  // A third race with two runners: one whose model win probability beats
  // its own SP-implied probability (a "value" bet) and one that doesn't —
  // within the same race, so onlyModelBeatsSp's runner-level hiding can be
  // proven without touching MOCK_INDUSTRY_SP_RACE's existing fixture values
  // (which other tests already assert exact badge percentages against).
  const MOCK_VALUE_MIXED_RACE = {
    raceId: 556677,
    meetingId: "Kempton|2022-06-01",
    meetingName: "Kempton — 1 June 2022",
    course: "Kempton",
    countryCode: "GB",
    raceTime: "2022-06-01T15:30:00",
    raceName: "Kempton Handicap",
    raceType: "Flat",
    raceClass: "Class 2",
    going: "Soft",
    ran: 2,
    runners: [
      // isp 10 -> implied 10%, model 25% -> beats SP (value). Also carries
      // every other optional badge (trainer, trainer-form, ISP/stake/PnL) at
      // once — the real-world worst case reported live where a runner with
      // ISP + Bet + PnL + trainer/form + Model + Value + status badges all
      // present squeezed the runner name down to an illegible sliver.
      { id: 55501, name: "Value Bet Horse With A Longer Name", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 10, ispFraction: "9/1", isFavourite: false, trainer: "Henry Daly", trainerFormRuns: 13, trainerFormWins: 4, trainerFormWinRate: 30.77, modelWinProbabilityOos: 25 },
      // isp 1.5 -> implied 66.7%, model 20% -> doesn't beat SP.
      { id: 55502, name: "Market Favourite", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 1.5, ispFraction: "1/2", isFavourite: true, modelWinProbabilityOos: 20 },
    ],
  };

  await page.route((url) => url.pathname === "/api/industry-sp", (route) => {
    // The mocked race has 3 runners in ISP range. Return empty data when maxInIspRange < 3.
    const reqUrl = new URL(route.request().url());
    const maxInIspRange = parseInt(reqUrl.searchParams.get("maxInIspRange") ?? "30");
    const runnerName = reqUrl.searchParams.get("runnerName");
    const minTrainerFormRunners = parseInt(reqUrl.searchParams.get("minTrainerFormRunners") ?? "0");
    const trainerFormMinWinRate = parseFloat(reqUrl.searchParams.get("trainerFormMinWinRate") ?? "0");
    const minModelWinProbability = parseFloat(reqUrl.searchParams.get("minModelWinProbability") ?? "0");
    const onlyModelBeatsSp = reqUrl.searchParams.get("onlyModelBeatsSp") === "true";
    let raceData = maxInIspRange >= 3 ? [MOCK_INDUSTRY_SP_RACE, MOCK_NO_FORM_RACE, MOCK_VALUE_MIXED_RACE] : [];
    // Runner History screen scopes every request to one horse's exact name
    // (case-insensitive) — mirrors the real backend's anchored-both-ends match.
    if (runnerName) {
      raceData = raceData.filter((race) =>
        race.runners.some((r) => r.name.toLowerCase() === runnerName.toLowerCase())
      );
    }
    // Mirrors the real DAO: a race qualifies if at least minTrainerFormRunners
    // of its runners have a non-null trainerFormWinRate >= trainerFormMinWinRate.
    if (minTrainerFormRunners > 0) {
      raceData = raceData.filter((race) => {
        const qualifying = race.runners.filter(
          (r) => (r as { trainerFormWinRate?: number }).trainerFormWinRate != null &&
            (r as { trainerFormWinRate: number }).trainerFormWinRate >= trainerFormMinWinRate
        );
        return qualifying.length >= minTrainerFormRunners;
      });
    }
    // Mirrors the real DAO's modelQualifyingCount check — a race qualifies
    // if at least 1 runner has modelWinProbabilityOos >= minModelWinProbability.
    if (minModelWinProbability > 0) {
      raceData = raceData.filter((race) =>
        race.runners.some(
          (r) => (r as { modelWinProbabilityOos?: number }).modelWinProbabilityOos != null &&
            (r as { modelWinProbabilityOos: number }).modelWinProbabilityOos >= minModelWinProbability
        )
      );
    }
    // Mirrors the real DAO's modelBeatsSpQualifyingCount check — a race
    // qualifies if at least 1 runner's model win% exceeds its own SP-implied
    // win% (100/isp).
    if (onlyModelBeatsSp) {
      raceData = raceData.filter((race) =>
        race.runners.some((r) => {
          const runner = r as { modelWinProbabilityOos?: number; isp?: number };
          return runner.modelWinProbabilityOos != null && runner.isp != null && runner.isp > 0 &&
            runner.modelWinProbabilityOos > 100 / runner.isp;
        })
      );
    }
    route.fulfill({
      json: {
        success: true,
        count: raceData.length,
        total: raceData.length,
        totalPages: 1,
        totalRunners: raceData.length > 0 ? 3 : 0,
        pnlStats: { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 },
        brier: MOCK_BRIER,
        favPnl: raceData.length > 0 ? MOCK_FAV : EMPTY_MOCK_FAV,
        data: raceData,
      },
    });
  });

  // Two extra runners in a second 2025 race, existing only for the Model vs SP
  // screen: the three race fixtures above are each a single moment in time, so
  // without a second date inside the same calendar year there is nothing for a
  // date sort to order (and that endpoint caps any window at 366 days).
  //   June Value Runner isp 5  -> SP 20.0% | model 45 -> edge +25.0
  //   June Outsider     isp 20 -> SP  5.0% | model  1 -> edge  -4.0
  const MODEL_VS_SP_JUNE_RACE = {
    raceId: 667788,
    meetingId: "Newbury|2025-06-15",
    meetingName: "Newbury — 15 June 2025",
    course: "Newbury",
    countryCode: "GB",
    raceTime: "2025-06-15T13:45:00",
    raceName: "Newbury Stakes",
    raceType: "Flat",
    raceClass: "Class 4",
    going: "Firm",
    ran: 2,
    runners: [
      { id: 66601, name: "June Value Runner", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false, trainer: "A Balding", modelWinProbabilityOos: 45 },
      { id: 66602, name: "June Outsider", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 20, ispFraction: "19/1", isFavourite: false, trainer: "A Balding", modelWinProbabilityOos: 1 },
    ],
  };

  // Model vs SP: runner-level rows, flattened from the SAME three race fixtures
  // above so the model/SP/edge numbers this screen asserts reconcile with the
  // ones /isp/races' own specs already assert against those runners. Every edge
  // below is therefore derived, not invented:
  //
  //   Springwell Bay   isp 4.5 -> SP 22.2% | model 12.5 -> edge  -9.7
  //   Gaelic Warrior   isp 9.2 -> SP 10.9% | model  8.3 -> edge  -2.6
  //   Fact To File     isp 2.1 -> SP 47.6% | model 39.2 -> edge  -8.4
  //   Teston (FR)      isp 11  -> SP  9.1% | model  100 -> edge +90.9
  //   Value Bet Horse  isp 10  -> SP 10.0% | model   25 -> edge +15.0
  //   Market Favourite isp 1.5 -> SP 66.7% | model   20 -> edge -46.7
  const MODEL_VS_SP_ROWS = [
    MOCK_INDUSTRY_SP_RACE,
    MOCK_NO_FORM_RACE,
    MOCK_VALUE_MIXED_RACE,
    MODEL_VS_SP_JUNE_RACE,
  ].flatMap((race) =>
    race.runners.map((r) => {
      const runner = r as {
        id: number; name: string; num: number | null; draw: number | null;
        status: string; sortPriority: number; isp: number; ispFraction: string;
        isFavourite: boolean; trainer?: string; modelWinProbabilityOos: number;
      };
      const implied = 100 / runner.isp;
      return {
        raceId: race.raceId,
        raceTime: race.raceTime,
        raceDate: race.raceTime.slice(0, 10),
        meetingId: race.meetingId,
        meetingName: race.meetingName,
        course: race.course,
        countryCode: race.countryCode,
        raceName: race.raceName,
        raceType: race.raceType,
        raceClass: race.raceClass,
        going: race.going,
        runnerId: runner.id,
        runnerName: runner.name,
        num: runner.num,
        draw: runner.draw,
        sortPriority: runner.sortPriority,
        status: runner.status,
        isp: runner.isp,
        ispFraction: runner.ispFraction,
        isFavourite: runner.isFavourite,
        jockey: null,
        trainer: runner.trainer ?? null,
        modelWinProbability: runner.modelWinProbabilityOos,
        impliedSpProbability: implied,
        edge: runner.modelWinProbabilityOos - implied,
        modelVersionId: "xgb-msw",
      };
    })
  );

  // A predicate matcher on the exact pathname, not a glob: "**/api/model*"
  // would also swallow /api/model-versions, which has its own handler.
  await page.route((url) => url.pathname === "/api/model-vs-sp", (route) => {
    const reqUrl = new URL(route.request().url());
    const page_ = Math.max(1, parseInt(reqUrl.searchParams.get("page") ?? "1", 10));
    const limit = Math.max(1, parseInt(reqUrl.searchParams.get("limit") ?? "50", 10));
    const sort = reqUrl.searchParams.get("sort") ?? "date_desc";
    const includeTotal = reqUrl.searchParams.get("includeTotal") !== "false";
    const rawMinDate = reqUrl.searchParams.get("minDate") ?? "2024-01-01";
    const rawMaxDate = reqUrl.searchParams.get("maxDate") ?? "2024-01-31";
    // The real endpoint ALWAYS clamps the window to 366 days and echoes back what
    // it actually queried (its gap sort is a blocking in-memory sort with no
    // index to fall back on). Mirrored here, or these tests would pass against a
    // wider window than production would ever serve.
    const minDate = rawMinDate;
    const capped = new Date(`${minDate}T00:00:00Z`);
    capped.setUTCDate(capped.getUTCDate() + 366);
    const maxAllowed = capped.toISOString().slice(0, 10);
    const maxDate = rawMaxDate > maxAllowed ? maxAllowed : rawMaxDate;
    // Unsigned, like the real endpoint: the filter asks how FAR apart the model
    // and the market are, not which way round.
    const minAbsEdge = parseFloat(reqUrl.searchParams.get("minAbsEdge") ?? "0");
    const maxAbsEdge = parseFloat(reqUrl.searchParams.get("maxAbsEdge") ?? "100");
    const minModelProb = parseFloat(reqUrl.searchParams.get("minModelProb") ?? "0");
    const maxModelProb = parseFloat(reqUrl.searchParams.get("maxModelProb") ?? "100");

    // The summary's denominator deliberately ignores the difference filter, so
    // narrowing that filter doesn't move its own baseline.
    const beforeEdgeFilter = MODEL_VS_SP_ROWS.filter(
      (r) =>
        r.raceDate >= minDate &&
        r.raceDate <= maxDate &&
        r.modelWinProbability >= minModelProb &&
        r.modelWinProbability <= maxModelProb
    );

    let rows = beforeEdgeFilter.filter(
      (r) => Math.abs(r.edge) >= minAbsEdge && Math.abs(r.edge) <= maxAbsEdge
    );

    rows = [...rows].sort((a, b) => {
      if (sort === "edge_desc") return b.edge - a.edge;
      if (sort === "edge_asc") return a.edge - b.edge;
      if (sort === "date_asc") return a.raceTime.localeCompare(b.raceTime);
      return b.raceTime.localeCompare(a.raceTime);
    });

    const total = rows.length;
    const data = rows.slice((page_ - 1) * limit, page_ * limit);

    // Mirrors buildEdgeSummary in src/lib/service/model-vs-sp-summary.ts —
    // EDGE_BAND_BOUNDS [2, 5, 10, 20, 50] plus an open-ended tail.
    const bounds = [2, 5, 10, 20, 50];
    const absEdges = beforeEdgeFilter.map((r) => Math.abs(r.edge));
    const all = absEdges.length;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const pct = (n: number) => (all > 0 ? round1((n / all) * 100) : 0);
    let running = 0;
    const bands = [...bounds, null].map((upper, i) => {
      const lower = i === 0 ? 0 : bounds[i - 1];
      const count = absEdges.filter((e) => (upper == null ? e >= lower : e >= lower && e < upper)).length;
      running += count;
      return {
        minAbs: lower,
        maxAbs: upper,
        label: upper == null ? `beyond ±${lower} pts` : lower === 0 ? `within ±${upper} pts` : `±${lower} to ±${upper} pts`,
        count,
        percent: pct(count),
        cumulativePercent: upper == null ? null : pct(running),
      };
    });

    route.fulfill({
      json: {
        success: true,
        data,
        count: data.length,
        total: includeTotal ? total : null,
        page: page_,
        limit,
        totalPages: includeTotal ? Math.ceil(total / limit) : null,
        sort,
        minDate,
        maxDate,
        summary: includeTotal
          ? {
              allRunners: all,
              matchedRunners: total,
              matchedPercent: pct(total),
              meanAbsEdge: all > 0 ? round1(absEdges.reduce((a, b) => a + b, 0) / all) : 0,
              bands,
              // Scored over the MATCHED runners, not `all` — the summary's
              // bands and its Brier deliberately have different denominators
              // (see the `brier` comment on ModelVsSpSummary).
              brier: total > 0 ? MOCK_BRIER : EMPTY_MOCK_BRIER,
            }
          : null,
      },
    });
  });

  const MOCK_TRAINER_FORM = {
    trainer: "W P Mullins",
    formCategory: "Flat",
    runs: [
      { raceId: 914591, runnerId: 11111, horseName: "Galopin Des Champs", raceDate: "2025-01-01", course: "Ascot", status: "WINNER", pos: "1", isp: 2.5 },
      { raceId: 914592, runnerId: 12347, horseName: "Fact To File", raceDate: "2025-01-08", course: "Cheltenham", status: "WINNER", pos: "1", isp: 2.1 },
      { raceId: 914594, runnerId: 33333, horseName: "State Man", raceDate: "2025-01-15", course: "Newbury", status: "LOSER", pos: "4", isp: 5.0 },
    ],
    totalRuns: 3,
    totalWins: 2,
    lastUpdated: "2025-01-16T00:00:00.000Z",
  };

  await page.route((url) => url.pathname === "/api/trainer-form", (route) => {
    const reqUrl = new URL(route.request().url());
    const trainer = reqUrl.searchParams.get("trainer");
    if (trainer === "W P Mullins") {
      route.fulfill({ json: { success: true, data: MOCK_TRAINER_FORM } });
    } else {
      route.fulfill({ status: 404, json: { success: false, error: "Trainer form not found" } });
    }
  });

  await page.route((url) => url.pathname === "/api/industry-sp/splits", (route) => {
    // Mirrors the /api/industry-sp handler above: the mocked dataset has 1
    // race with 3 runners in ISP range, so maxInIspRange < 3 zeroes it out.
    const reqUrl = new URL(route.request().url());
    const maxInIspRange = parseInt(reqUrl.searchParams.get("maxInIspRange") ?? "30");
    const matches = maxInIspRange >= 3;
    const totalRaces = matches ? 1 : 0;
    const pnlStats = matches ? { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 } : { staked: 0, returns: 0, pnl: 0, count: 0 };
    const brier = matches ? MOCK_BRIER : EMPTY_MOCK_BRIER;
    const favPnl = matches ? MOCK_FAV : EMPTY_MOCK_FAV;

    const fromRowARaw = reqUrl.searchParams.get("fromRowA");
    const toRowARaw = reqUrl.searchParams.get("toRowA");
    const fromRowBRaw = reqUrl.searchParams.get("fromRowB");
    const toRowBRaw = reqUrl.searchParams.get("toRowB");
    let fromRowA: number, toRowA: number | null, fromRowB: number, toRowB: number | null;
    if (fromRowARaw == null && toRowARaw == null && fromRowBRaw == null && toRowBRaw == null) {
      // Mirrors the real backend's even half/half default (see
      // getSplitStats) rather than a fixed 1000/1000-race window.
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
        // 1000 — this fixture always mocks an authenticated session (see
        // FAKE_JWT below), matching the real backend's authenticated cap.
        raceCap: 1000,
        // filterBounds/countries ride along on this response now (see
        // getSplitStats on the backend) — mirrors the standalone
        // /filter-bounds and /countries mocks above so IndustrySpScreen's
        // filter panel still populates without those separate requests.
        filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
        countries: ["GB", "IE"],
        courses: ["Cheltenham", "Ascot"],
        goings: ["Good", "Soft"],
        raceClasses: ["Class 1", "Class 2"],
        raceTypes: ["Chase", "Hurdle"],
        brier,
        favPnl,
        splitA: { fromRow: fromRowA, toRow: toRowA, total: totalA, totalRunners: totalA > 0 ? 3 : 0, pnlStats: totalA > 0 ? pnlStats : { staked: 0, returns: 0, pnl: 0, count: 0 }, brier: totalA > 0 ? MOCK_BRIER : EMPTY_MOCK_BRIER, favPnl: totalA > 0 ? MOCK_FAV : EMPTY_MOCK_FAV },
        splitB: { fromRow: fromRowB, toRow: toRowB, total: totalB, totalRunners: totalB > 0 ? 3 : 0, pnlStats: totalB > 0 ? pnlStats : { staked: 0, returns: 0, pnl: 0, count: 0 }, brier: totalB > 0 ? MOCK_BRIER : EMPTY_MOCK_BRIER, favPnl: totalB > 0 ? MOCK_FAV : EMPTY_MOCK_FAV },
      },
    });
  });

  await page.route((url) => url.pathname === "/api/industry-sp/race-convergence", (route) => {
    const reqUrl = new URL(route.request().url());
    const toRow = Math.max(1, parseInt(reqUrl.searchParams.get("toRow") ?? "1", 10));
    // Defaults to 1 — Split A's own Graph button always sends fromRow=1
    // explicitly; Split B's sends its own first race's row number, so its
    // line restarts fresh instead of continuing Split A's already-settled
    // total (mirrors the real backend — see getRaceConvergenceSeries).
    const fromRow = Math.max(1, parseInt(reqUrl.searchParams.get("fromRow") ?? "1", 10));
    // Synthetic but plausible: volatile for the first few races of
    // whichever range was requested, settling toward a stable ~-10% ROI —
    // mirrors the real convergence shape (verified live against production
    // data) without needing real bet outcomes in the mock. The win pattern
    // is keyed off the TRUE global row number (not a re-based local index),
    // same as the real backend, so a Split B call starting mid-sequence
    // isn't artificially "luckier" or "unluckier" than the equivalent
    // slice of Split A's own sequence would have been.
    let cumulativeStaked = 0;
    let cumulativeReturns = 0;
    const data = [];
    for (let raceRowNumber = fromRow; raceRowNumber <= toRow; raceRowNumber++) {
      const stake = 1;
      cumulativeStaked += stake;
      const isWinner = raceRowNumber % 3 === 0;
      if (isWinner) cumulativeReturns += stake * 1.8;
      const cumulativePnl = cumulativeReturns - cumulativeStaked;
      data.push({
        raceRowNumber,
        cumulativeStaked,
        cumulativeReturns,
        cumulativePnl,
        roiPercent: cumulativeStaked > 0 ? (cumulativePnl / cumulativeStaked) * 100 : 0,
      });
    }
    route.fulfill({ json: { success: true, data, count: data.length } });
  });

  await page.route("**/health", (route) =>
    route.fulfill({ json: { status: "OK", service: "Betfair NLP API", database: "connected" } })
  );

  // Stateful in-memory fixture, scoped to this call (fresh per test via the
  // test/anonTest fixtures below) — mirrors real create/list/get/delete
  // semantics closely enough to test the full UI loop against a static
  // build, without a real backend.
  interface MockSavedSplit {
    fromRow: number;
    toRow: number | null;
    total: number;
    totalRunners: number;
    pnlStats: { staked: number; returns: number; pnl: number; count: number };
    graphPoints: { raceRowNumber: number; cumulativeStaked: number; cumulativeReturns: number; cumulativePnl: number; roiPercent: number }[];
    brier?: { scored: number; priced: number; model: number | null; market: number | null };
    // Optional for the same reason brier is above — mock-result-2 deliberately
    // has neither, standing in for the real production documents saved before
    // these fields existed and never migrated.
    favPnl?: { races: number; count: number; staked: number; returns: number; pnl: number; level: { staked: number; returns: number; pnl: number } };
  }
  const mockSavedResults: {
    id: string;
    name: string;
    filters: Record<string, string>;
    splitA: MockSavedSplit;
    splitB: MockSavedSplit;
    createdAt: string;
  }[] = [
    {
      id: "mock-result-1",
      name: "Ascot favourites",
      filters: { courses: "Ascot", minDate: "2026-01-01", maxDate: "2026-01-01" },
      splitA: {
        fromRow: 1,
        toRow: 2,
        total: 2,
        totalRunners: 6,
        pnlStats: { staked: 10, returns: 11, pnl: 1, count: 2 },
        // Split A: model ahead of the market. Split B (below) has it behind,
        // so the two cards on the detail screen render opposite verdicts from
        // one fixture — the case a single shared number could never cover.
        brier: { scored: 6, priced: 6, model: 0.08, market: 0.09 },
        // Baseline -25.0% against this split's own +10.0% — the filter beating
        // it by 35 points.
        favPnl: { races: 2, count: 2, staked: 8, returns: 6, pnl: -2, level: { staked: 2, returns: 1.5, pnl: -0.5 } },
        graphPoints: [
          { raceRowNumber: 1, cumulativeStaked: 5, cumulativeReturns: 6, cumulativePnl: 1, roiPercent: 20 },
          { raceRowNumber: 2, cumulativeStaked: 10, cumulativeReturns: 11, cumulativePnl: 1, roiPercent: 10 },
        ],
      },
      splitB: {
        fromRow: 3,
        toRow: 4,
        total: 2,
        totalRunners: 6,
        pnlStats: { staked: 10, returns: 6, pnl: -4, count: 2 },
        brier: { scored: 6, priced: 6, model: 0.11, market: 0.09 },
        // The other way round: baseline +50.0% against this split's -40.0%, so
        // one saved result renders both verdicts. 3 bets over 2 races also
        // exercises the joint-favourite case end to end.
        favPnl: { races: 2, count: 3, staked: 6, returns: 9, pnl: 3, level: { staked: 3, returns: 7, pnl: 4 } },
        graphPoints: [
          { raceRowNumber: 3, cumulativeStaked: 5, cumulativeReturns: 5, cumulativePnl: 0, roiPercent: 0 },
          { raceRowNumber: 4, cumulativeStaked: 10, cumulativeReturns: 6, cumulativePnl: -4, roiPercent: -40 },
        ],
      },
      createdAt: "2026-01-15T09:00:00.000Z",
    },
    {
      id: "mock-result-2",
      name: "Nottingham class 1",
      filters: { courses: "Nottingham", raceClasses: "Class 1" },
      splitA: {
        fromRow: 1,
        toRow: 1,
        total: 1,
        totalRunners: 3,
        pnlStats: { staked: 5, returns: 9, pnl: 4, count: 1 },
        graphPoints: [{ raceRowNumber: 1, cumulativeStaked: 5, cumulativeReturns: 9, cumulativePnl: 4, roiPercent: 80 }],
      },
      splitB: {
        fromRow: 2,
        toRow: 2,
        total: 1,
        totalRunners: 3,
        pnlStats: { staked: 5, returns: 9, pnl: 4, count: 1 },
        graphPoints: [{ raceRowNumber: 2, cumulativeStaked: 5, cumulativeReturns: 9, cumulativePnl: 4, roiPercent: 80 }],
      },
      createdAt: "2026-01-20T09:00:00.000Z",
    },
  ];

  await page.route((url) => url.pathname === "/api/saved-filter-sets", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name?: string; filters: Record<string, string> };
      const created = {
        id: `mock-result-${mockSavedResults.length + 1}`,
        name: body.name?.trim() || `Auto name · ${Object.values(body.filters)[0] ?? "All races"}`,
        filters: body.filters,
        splitA: mockSavedResults[0].splitA,
        splitB: mockSavedResults[0].splitB,
        createdAt: new Date().toISOString(),
      };
      mockSavedResults.unshift(created);
      route.fulfill({ status: 201, json: { success: true, data: created } });
      return;
    }
    route.fulfill({ json: { success: true, data: mockSavedResults, count: mockSavedResults.length } });
  });

  await page.route((url) => url.pathname.startsWith("/api/saved-filter-sets/"), (route) => {
    const id = route.request().url().split("/api/saved-filter-sets/")[1];
    const index = mockSavedResults.findIndex(r => r.id === id);
    if (route.request().method() === "DELETE") {
      if (index === -1) {
        route.fulfill({ status: 404, json: { success: false, error: "Not found" } });
        return;
      }
      mockSavedResults.splice(index, 1);
      route.fulfill({ json: { success: true } });
      return;
    }
    if (index === -1) {
      route.fulfill({ status: 404, json: { success: false, error: "Not found" } });
      return;
    }
    route.fulfill({ json: { success: true, data: mockSavedResults[index] } });
  });

  // Model Accuracy screen. Deliberately shaped like a real result: well
  // calibrated in the middle, over-rating long shots, so the error columns
  // genuinely differ row to row rather than all reading zero.
  await page.route((url) => url.pathname === "/api/model-accuracy", (route) => {
    const bands = [
      { bandKey: "50.0000", label: "under 2.0", minPrice: null, maxPrice: 2, runners: 412, wins: 241, modelMeanProb: 61.2, actualWinRate: 58.5, marketMeanProbFair: 60.1, marketMeanProbRaw: 64.8, staked: 402.1, returns: 393.9, pnl: -8.2, roiPercent: -2.04, modelErrorPp: 2.7, marketErrorPp: 1.6, modelBrier: 0.221, marketBrier: 0.216 },
      { bandKey: "33.3333", label: "2.0 – 3.0", minPrice: 2, maxPrice: 3, runners: 780, wins: 295, modelMeanProb: 39.1, actualWinRate: 37.8, marketMeanProbFair: 38.4, marketMeanProbRaw: 42.6, staked: 690.4, returns: 694.5, pnl: 4.1, roiPercent: 0.59, modelErrorPp: 1.3, marketErrorPp: 0.6, modelBrier: 0.201, marketBrier: 0.198 },
      { bandKey: "20.0000", label: "3.0 – 5.0", minPrice: 3, maxPrice: 5, runners: 1340, wins: 253, modelMeanProb: 25, actualWinRate: 18.9, marketMeanProbFair: 22.1, marketMeanProbRaw: 25.4, staked: 512.3, returns: 451, pnl: -61.3, roiPercent: -11.96, modelErrorPp: 6.1, marketErrorPp: 3.2, modelBrier: 0.176, marketBrier: 0.161 },
      { bandKey: "10.0000", label: "5.0 – 10.0", minPrice: 5, maxPrice: 10, runners: 2100, wins: 290, modelMeanProb: 14.2, actualWinRate: 13.8, marketMeanProbFair: 13.5, marketMeanProbRaw: 15.8, staked: 402.9, returns: 425.6, pnl: 22.7, roiPercent: 5.63, modelErrorPp: 0.4, marketErrorPp: -0.3, modelBrier: 0.118, marketBrier: 0.119 },
      { bandKey: "5.0000", label: "10.0 – 20.0", minPrice: 10, maxPrice: 20, runners: 2650, wins: 135, modelMeanProb: 6.8, actualWinRate: 5.1, marketMeanProbFair: 5.9, marketMeanProbRaw: 7.1, staked: 220.5, returns: 180.4, pnl: -40.1, roiPercent: -18.19, modelErrorPp: 1.7, marketErrorPp: 0.8, modelBrier: 0.049, marketBrier: 0.047 },
      { bandKey: "0.0000", label: "20.0+", minPrice: 20, maxPrice: null, runners: 3900, wins: 66, modelMeanProb: 2.9, actualWinRate: 1.7, marketMeanProbFair: 2.2, marketMeanProbRaw: 2.9, staked: 180, returns: 85, pnl: -95, roiPercent: -52.78, modelErrorPp: 1.2, marketErrorPp: 0.5, modelBrier: 0.017, marketBrier: 0.016 },
    ];
    const overall = { bandKey: "overall", label: "All bands", minPrice: null, maxPrice: null, runners: 11182, wins: 1280, modelMeanProb: 11.4, actualWinRate: 11.4, marketMeanProbFair: 11, marketMeanProbRaw: 12.9, staked: 2408.2, returns: 2230.4, pnl: -177.8, roiPercent: -7.38, modelErrorPp: 0, marketErrorPp: -0.4, modelBrier: 0.0921, marketBrier: 0.0904 };
    // 11,182 of 12,000 eligible runners could be scored out-of-sample; the
    // remaining 818 are the earliest races, with no prior form behind them.
    const coverage = {
      eligibleRunners: 12000,
      scoredRunners: 11182,
      unscoredRunners: 818,
      coveragePercent: 93.18,
    };
    route.fulfill({ json: { success: true, data: bands, count: bands.length, overall, coverage } });
  });

  await page.route((url) => url.pathname === "/api/model-versions", (route) =>
    route.fulfill({ json: { success: true, data: [], count: 0 } })
  );

  // Model Experiments screen. Two runs: the control (the deployed feature set
  // and objective) and a candidate that improves on it. The numbers are close
  // to the real measured ones, so the screen is exercised against the finding
  // it actually has to communicate — the model losing to industry SP on Brier
  // and, much more heavily, on resolution.
  await page.route((url) => url.pathname === "/api/model-experiments", (route) => {
    const metrics = (brier: number, auc: number, resolution: number, top1: number) => ({
      n: 189640, aucRoc: auc, logLoss: 0.3268, brierScore: brier,
      resolution, reliability: 0.000098, top1Rate: top1, mrr: 0.42, races: 21000,
    });
    const meta = {
      gitCommit: "abc1234", foldYears: ["2022", "2023", "2024", "2025", "2026"], foldCount: 5,
      scoredRows: 189640, unscoredRows: 296758, droppedTrainRaces: 0,
      coverageMinDate: "2022-01-01", coverageMaxDate: "2026-08-05",
      totalSeconds: 338.6, trainingParams: { maxDepth: 5 },
    };
    const market = metrics(0.088829, 0.785405, 0.01363617, 0.348483);
    const data = [
      {
        id: "exp-20260806-190210", name: "rel-softmax",
        notes: "Within-race relative features plus conditional-logit training.",
        runAt: "2026-08-06T19:02:10.000Z", mode: "fast", featureSetName: "all",
        objective: "softmax_race", featureCount: 143, newFeatureCount: 116, meta,
        metrics: {
          model: metrics(0.093104, 0.7364, 0.0091, 0.2881),
          calibrated: metrics(0.093088, 0.7363, 0.00909, 0.288),
          market, bss: -0.048,
          // Brier DOWN is an improvement, AUC UP is an improvement — the
          // screen colours them in opposite directions.
          deltaVsBaseline: { brierScore: -0.002185, aucRoc: 0.02086, logLoss: -0.0071, resolution: 0.0018862, top1Rate: 0.027329 },
        },
        baselineExperimentId: "exp-20260806-183001", discoveredCount: 1,
      },
      {
        id: "exp-20260806-183001", name: "base-binary-control",
        notes: "The deployed feature set and objective, through the new code path.",
        runAt: "2026-08-06T18:30:01.000Z", mode: "fast", featureSetName: "baseline",
        objective: "binary", featureCount: 27, newFeatureCount: 0, meta,
        metrics: {
          model: metrics(0.095289, 0.71554, 0.00721379, 0.260771),
          calibrated: metrics(0.095243, 0.715342, 0.0072, 0.260589),
          market, bss: -0.072724, deltaVsBaseline: null,
        },
        baselineExperimentId: null, discoveredCount: 0,
      },
    ];
    route.fulfill({ json: { success: true, data, count: data.length } });
  });

  await page.route((url) => url.pathname.startsWith("/api/model-experiments/"), (route) => {
    const metrics = (brier: number, auc: number, resolution: number, top1: number) => ({
      n: 189640, aucRoc: auc, logLoss: 0.3268, brierScore: brier,
      resolution, reliability: 0.000098, top1Rate: top1, mrr: 0.42, races: 21000,
    });
    const segment = (dimension: string, bucket: string, bucketOrder: number, bss: number, roiLevel: number, roiToWin: number) => ({
      dimension, bucket, bucketOrder, n: 44000, scoredN: 43980, wins: 5100, strikeRate: 11.6,
      model: metrics(0.0931, 0.736, 0.0091, 0.288), market: metrics(0.0888, 0.785, 0.0136, 0.348),
      bss,
      selections: {
        all: {
          n: 44000, wins: 5100, strikeRate: 11.6, bettableN: 43980,
          pnl: {
            toWin1: { staked: 8000, returns: 8000, pnl: 0, roiPct: roiToWin },
            level: { staked: 44000, returns: 44000, pnl: 0, roiPct: roiLevel },
          },
        },
      },
      yearsPositiveToWin1: 9, yearsPositiveLevel: 9,
    });
    route.fulfill({
      json: {
        success: true,
        data: {
          id: "exp-20260806-190210", name: "rel-softmax", notes: "Within-race relative features.",
          runAt: "2026-08-06T19:02:10.000Z", mode: "fast", featureSetName: "all",
          objective: "softmax_race", featureCount: 143, newFeatureCount: 116,
          meta: {
            gitCommit: "abc1234", foldYears: ["2022", "2023"], foldCount: 2, scoredRows: 189640,
            unscoredRows: 296758, droppedTrainRaces: 3, coverageMinDate: "2022-01-01",
            coverageMaxDate: "2026-08-05", totalSeconds: 402.1, trainingParams: { maxDepth: 5 },
          },
          metrics: {
            model: metrics(0.093104, 0.7364, 0.0091, 0.2881),
            calibrated: metrics(0.093088, 0.7363, 0.00909, 0.288),
            market: metrics(0.088829, 0.785405, 0.01363617, 0.348483),
            bss: -0.048,
            deltaVsBaseline: { brierScore: -0.002185, aucRoc: 0.02086, logLoss: -0.0071, resolution: 0.0018862, top1Rate: 0.027329 },
          },
          baselineExperimentId: "exp-20260806-183001", discoveredCount: 2,
          featureCols: ["course", "officialRatingRank"], newFeatureCols: ["officialRatingRank"],
          sparseFeatures: [],
          folds: [
            { year: "2022", trainRows: 265382, scoredRows: 42863, seconds: 18.9, raw: { brierScore: 0.0968, aucRoc: 0.7169 } },
            { year: "2023", trainRows: 304972, scoredRows: 42643, seconds: 18.5, raw: { brierScore: 0.0944, aucRoc: 0.7134 } },
          ],
          spBandTable: [],
          segments: [
            segment("raceType", "Chase", 0, -0.02, -9.4, -8.1),
            segment("raceType", "Flat", 1, -0.06, -12.2, -11.1),
            segment("spBand", "under 2.0", 0, -0.31, -4.1, -3.2),
            segment("spBand", "5.0-10.0", 3, 0.004, 1.2, 0.9),
          ],
          segmentDimensions: ["raceType", "spBand"],
          acceptanceRule: { minN: 20000, minBss: 0, requirePositiveUnderBothStakings: true, minYearsPositiveFraction: 8 / 11, minYearsPositive: 4, foldYearsScored: 5 },
          discoveredSegments: [
            { dimension: "spBand", bucket: "5.0-10.0", selection: "all", n: 44000, bss: 0.004, strikeRate: 11.6, roiToWin1: 0.9, roiLevel: 1.2, yearsPositiveToWin1: 9, ispFilterable: true, filters: { minIsp: "5.0", maxIsp: "10.0" } },
            // Real slice, but the Filters screen has no param for it.
            { dimension: "isHandicap", bucket: "handicap", selection: "all", n: 130000, bss: 0.002, strikeRate: 11.1, roiToWin1: 0.4, roiLevel: 0.6, yearsPositiveToWin1: 8, ispFilterable: false, filters: null },
          ],
          filterBattery: [],
        },
      },
    });
  });
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

// /isp is public now — this variant deliberately does NOT inject a token,
// for tests covering the anonymous experience (cap banner, Sign Up/Log In
// buttons, Events/Chat/Runners staying behind the login wall).
export const anonTest = base.extend({
  page: async ({ page }, use) => {
    await setupApiMocks(page);
    await use(page);
  },
});

export { expect };

