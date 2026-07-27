import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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
        dailyRunner(),
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

  await page.route((url) => url.pathname.startsWith("/api/daily-races/race/"), (route) => {
    const raceId = decodeURIComponent(route.request().url().split("/api/daily-races/race/")[1]);
    const race = MOCK_DAILY_RACES.find((r) => r.raceId === raceId);
    if (!race) {
      route.fulfill({ status: 404, json: { success: false, error: "Race not found" } });
      return;
    }
    route.fulfill({ json: { success: true, data: race } });
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
      { id: 12345, name: "Springwell Bay", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 4.5, ispFraction: "7/2", isFavourite: false, trainer: "W P Mullins", modelWinProbability: 12.5 },
      { id: 12346, name: "Gaelic Warrior", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 9.2, ispFraction: "41/5", isFavourite: false, trainer: "G Elliott", trainerFormRuns: 0, modelWinProbability: 8.3 },
      { id: 12347, name: "Fact To File", num: 3, draw: null, status: "WINNER", sortPriority: 3, isp: 2.1, ispFraction: "11/10", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43, modelWinProbability: 39.2 },
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
      { id: 99001, name: "Teston (FR)", num: 1, draw: 2, status: "PLACED", sortPriority: 1, isp: 11, ispFraction: "10/1", isFavourite: false, trainer: "Ivan Furtado", trainerFormRuns: 0, modelWinProbability: 100 },
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
      { id: 55501, name: "Value Bet Horse With A Longer Name", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 10, ispFraction: "9/1", isFavourite: false, trainer: "Henry Daly", trainerFormRuns: 13, trainerFormWins: 4, trainerFormWinRate: 30.77, modelWinProbability: 25 },
      // isp 1.5 -> implied 66.7%, model 20% -> doesn't beat SP.
      { id: 55502, name: "Market Favourite", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 1.5, ispFraction: "1/2", isFavourite: true, modelWinProbability: 20 },
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
    // if at least 1 runner has modelWinProbability >= minModelWinProbability.
    if (minModelWinProbability > 0) {
      raceData = raceData.filter((race) =>
        race.runners.some(
          (r) => (r as { modelWinProbability?: number }).modelWinProbability != null &&
            (r as { modelWinProbability: number }).modelWinProbability >= minModelWinProbability
        )
      );
    }
    // Mirrors the real DAO's modelBeatsSpQualifyingCount check — a race
    // qualifies if at least 1 runner's model win% exceeds its own SP-implied
    // win% (100/isp).
    if (onlyModelBeatsSp) {
      raceData = raceData.filter((race) =>
        race.runners.some((r) => {
          const runner = r as { modelWinProbability?: number; isp?: number };
          return runner.modelWinProbability != null && runner.isp != null && runner.isp > 0 &&
            runner.modelWinProbability > 100 / runner.isp;
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
        data: raceData,
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
        splitA: { fromRow: fromRowA, toRow: toRowA, total: totalA, totalRunners: totalA > 0 ? 3 : 0, pnlStats: totalA > 0 ? pnlStats : { staked: 0, returns: 0, pnl: 0, count: 0 } },
        splitB: { fromRow: fromRowB, toRow: toRowB, total: totalB, totalRunners: totalB > 0 ? 3 : 0, pnlStats: totalB > 0 ? pnlStats : { staked: 0, returns: 0, pnl: 0, count: 0 } },
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

