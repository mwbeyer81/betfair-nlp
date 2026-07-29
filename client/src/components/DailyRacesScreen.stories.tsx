import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DailyRacesScreen } from "./DailyRacesScreen";
import { formatDailyRacesDateLabel, shiftDateString, todayUtcDateString } from "../utils/dailyRaceFormat";

const BASE = "http://localhost:3000";

function runner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runnerId: "hrs_1", horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
    region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
    damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
    owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
    officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
    ...overrides,
  };
}

const MOCK_RACES = [
  {
    raceId: "rac_1", eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
    offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
    distanceF: "16.0", region: "GB", raceClass: "Class 4", type: "Hurdle", ageBand: "4yo+",
    prize: "£3,769", fieldSize: "1", going: "Good", surface: "Turf",
    // modelWinProbability 25 -> breakeven decimal odds 100/25 = 4.00 (3/1) —
    // qualifies for both the model-win% and trainer-form filters below.
    runners: [runner({ modelWinProbability: 25, trainerFormRuns: 5, trainerFormWinRate: 40 })],
  },
  {
    raceId: "rac_2", eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
    offTime: "2:25", offDt: "2026-06-03T14:25:00+01:00", raceName: "Handicap Chase",
    distanceF: "24.0", region: "GB", raceClass: "Class 3", type: "Chase", ageBand: "5yo+",
    prize: "£5,912", fieldSize: "1", going: "Good", surface: "Turf",
    // Same trainer as rac_1 ("A Trainer", the runner() default) but a low
    // model win probability — excluded once a model-win% threshold is applied.
    runners: [runner({ runnerId: "hrs_2", horse: "Chase Fixture", modelWinProbability: 5 })],
  },
  {
    raceId: "rac_3", eventId: "ascot-2026-06-03", course: "Ascot", date: "2026-06-03",
    offTime: "3:05", offDt: "2026-06-03T15:05:00+01:00", raceName: "Maiden Stakes",
    distanceF: "8.0", region: "GB", raceClass: "Class 2", type: "Flat", ageBand: "3yo",
    prize: "£9,400", fieldSize: "1", going: "Good to Firm", surface: "Turf",
    // Different trainer/course from the other two — used to test trainer
    // search and course-chip narrowing.
    runners: [runner({ runnerId: "hrs_3", horse: "Ascot Fixture", trainer: "Z Trainer", modelWinProbability: 30 })],
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/daily-races`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACES, count: MOCK_RACES.length })
  ),
];

const meta: Meta<typeof DailyRacesScreen> = {
  title: "Components/DailyRacesScreen",
  component: DailyRacesScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onNavigateToEvent: fn(),
    onNavigateToRace: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-races-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("daily-races-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-event-newton-abbot-2026-06-03")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-event-ascot-2026-06-03")).toBeInTheDocument();
  },
};

export const NavigationTriggered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-event-ascot-2026-06-03"));
    await expect(args.onNavigateToEvent).toHaveBeenCalledWith("ascot-2026-06-03");
  },
};

export const GroupModeDefaultsToMeeting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-event-newton-abbot-2026-06-03")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-time-row-rac_1")).not.toBeInTheDocument();
  },
};

export const GroupModeSwitchesToTime: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-group-by-time"));

    // Flat, individual race rows across both meetings, no meeting grouping.
    await expect(canvas.getByTestId("daily-races-time-row-rac_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-time-row-rac_2")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-time-row-rac_3")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-event-newton-abbot-2026-06-03")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-event-ascot-2026-06-03")).not.toBeInTheDocument();

    // Chronological order (1:50, 2:25, 3:05), independent of course.
    const rows = canvas.getAllByText(/^\d:\d\d$/);
    await expect(rows.map(el => el.textContent)).toEqual(["1:50", "2:25", "3:05"]);
  },
};

export const TimeRowNavigatesToRace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-group-by-time"));
    await userEvent.click(canvas.getByTestId("daily-races-time-row-rac_3"));
    await expect(args.onNavigateToRace).toHaveBeenCalledWith("rac_3");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, async () => {
          await new Promise((r) => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-races-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("daily-races-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("daily-races-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: [], count: 0 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("daily-races-empty")).resolves.toBeInTheDocument();
  },
};

export const FilterBarVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-min-model-win-probability")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-filter-apply")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-filter-reset")).toBeInTheDocument();
    // No Apply pressed yet — Today's Picks hasn't appeared.
    await expect(canvas.queryByTestId("daily-races-picks-list")).not.toBeInTheDocument();
  },
};

export const ApplyModelFilterShowsPicks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await expect(canvas.getByTestId("daily-races-picks-list")).toBeInTheDocument();
    // Fixture Star (25%) and Ascot Fixture (30%) qualify; Chase Fixture (5%) doesn't.
    await expect(canvas.getByTestId("daily-races-pick-hrs_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-pick-hrs_3")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-hrs_2")).not.toBeInTheDocument();
    // 25 -> breakeven decimal odds 100/25 = 4.00, nearest simple fraction 3/1.
    await expect(canvas.getByTestId("daily-races-pick-fair-odds-hrs_1")).toHaveTextContent("Fair 3/1 (4.00)");
  },
};

export const TrainerSearchNarrowsPicks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    // A clean baseline — this test-runner can carry filter state over from a
    // previously-run story in the same suite, same gotcha documented for
    // IndustrySpScreen's own filter stories.
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const trainerInput = canvas.getByTestId("daily-races-trainer-search");
    await userEvent.type(trainerInput, "A Trainer");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    // Fixture Star + Chase Fixture are both trained by "A Trainer" (the
    // runner() default); Ascot Fixture is trained by "Z Trainer".
    await expect(canvas.getByTestId("daily-races-pick-hrs_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-pick-hrs_2")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-hrs_3")).not.toBeInTheDocument();
  },
};

export const CourseChipFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    // A clean baseline — see the reset-first note in TrainerSearchNarrowsPicks above.
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const chip = canvas.getByTestId("daily-races-course-Newton Abbot");
    await userEvent.click(chip);
    // Selected in the draft but not yet applied — pending visual.
    await expect(chip).toHaveTextContent("Newton Abbot •");

    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));
    await expect(chip).toHaveTextContent("Newton Abbot");
    await expect(chip).not.toHaveTextContent("•");

    await expect(canvas.getByTestId("daily-races-pick-hrs_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-pick-hrs_2")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-hrs_3")).not.toBeInTheDocument();
  },
};

export const ResetFiltersClearsPicks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));
    await expect(canvas.getByTestId("daily-races-picks-list")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));
    await expect(canvas.queryByTestId("daily-races-picks-list")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-min-model-win-probability")).toHaveValue("0");
  },
};

export const PickNavigatesToRace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await userEvent.click(canvas.getByTestId("daily-races-pick-hrs_1"));
    await expect(args.onNavigateToRace).toHaveBeenCalledWith("rac_1");
  },
};

// Captures the real POST /api/bet-orders body so the assertions below can
// check exactly what DailyRacesScreen sent, without needing a prop the
// screen no longer has (see chatApi.createBetOrder — the screen calls the
// real API directly now, not an onPlaceBet callback).
let lastCreateBetOrderBody: Record<string, unknown> | null = null;

export const BetBadgeOpensDialog: Story = {
  parameters: {
    msw: {
      handlers: [
        ...defaultHandlers,
        http.post(`${BASE}/api/bet-orders`, async ({ request }) => {
          lastCreateBetOrderBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { success: true, data: { id: "bet_new_1", ...lastCreateBetOrderBody, minQualifyingPrice: 3, status: "pending", createdAt: "2026-06-03T00:00:00.000Z" } },
            { status: 201 }
          );
        }),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    lastCreateBetOrderBody = null;
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    // args.onNavigateToRace is one shared mock instance across every story
    // in this file (Storybook doesn't reset it between stories), so earlier
    // stories' own navigations already sit in its call history — compare
    // the count before/after this click rather than asserting "never
    // called", which would be a false failure once any prior story navigates.
    const navigateCallsBefore = (args.onNavigateToRace as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await userEvent.click(canvas.getByTestId("daily-races-pick-bet-hrs_1"));
    // Proves the badge's own stopPropagation worked — clicking it must not
    // also trigger the row's navigate-to-race handler.
    await expect((args.onNavigateToRace as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      navigateCallsBefore
    );
    await expect(canvas.getByTestId("place-bet-dialog")).toBeInTheDocument();
    await expect(canvas.getByTestId("place-bet-dialog")).toHaveTextContent("Fixture Star");

    await userEvent.type(canvas.getByTestId("place-bet-dialog-target-profit-input"), "20");
    await userEvent.type(canvas.getByTestId("place-bet-dialog-max-stake-input"), "10");
    await userEvent.click(canvas.getByTestId("place-bet-dialog-confirm"));

    await waitFor(() => expect(canvas.queryByTestId("place-bet-dialog")).not.toBeInTheDocument());
    await expect(lastCreateBetOrderBody).toMatchObject({
      runnerId: "hrs_1",
      horse: "Fixture Star",
      course: "Newton Abbot",
      raceId: "rac_1",
      eventId: "newton-abbot-2026-06-03",
      targetProfit: 20,
      maxStake: 10,
    });
  },
};

export const BetBadgeShowsErrorOnFailedCreate: Story = {
  parameters: {
    msw: {
      handlers: [
        ...defaultHandlers,
        http.post(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: false, error: "targetProfit must be a positive number" }, { status: 400 })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await userEvent.click(canvas.getByTestId("daily-races-pick-bet-hrs_1"));
    await userEvent.type(canvas.getByTestId("place-bet-dialog-target-profit-input"), "20");
    await userEvent.type(canvas.getByTestId("place-bet-dialog-max-stake-input"), "10");
    await userEvent.click(canvas.getByTestId("place-bet-dialog-confirm"));

    await waitFor(() =>
      expect(canvas.getByTestId("place-bet-dialog-error")).toHaveTextContent("targetProfit must be a positive number")
    );
    // The dialog stays open on failure — the user's typed values aren't lost.
    await expect(canvas.getByTestId("place-bet-dialog")).toBeInTheDocument();
  },
};

export const DateNavShowsCurrentDate: Story = {
  // No `date` prop passed — the component falls back to "today" (UTC).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-current-date")).toHaveTextContent(
      formatDailyRacesDateLabel(todayUtcDateString())
    );
  },
};

export const PrevDayButtonNavigatesToPreviousDate: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-prev-day"));

    const expectedDate = shiftDateString(todayUtcDateString(), -1);
    await expect(args.navigate).toHaveBeenCalledWith("/daily-races", expect.stringContaining(`date=${expectedDate}`));
  },
};

export const NextDayButtonNavigatesToNextDate: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-next-day"));

    const expectedDate = shiftDateString(todayUtcDateString(), 1);
    await expect(args.navigate).toHaveBeenCalledWith("/daily-races", expect.stringContaining(`date=${expectedDate}`));
  },
};

export const DayNavigationPreservesAppliedFilters: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await userEvent.click(canvas.getByTestId("daily-races-next-day"));

    const expectedDate = shiftDateString(todayUtcDateString(), 1);
    const [, query] = (args.navigate as unknown as { mock: { calls: [string, string][] } }).mock.calls.slice(-1)[0];
    const params = new URLSearchParams(query);
    await expect(params.get("date")).toBe(expectedDate);
    await expect(params.get("minModelWinProbability")).toBe("20");
  },
};

// MOCK_RACES carries no `result` on any runner at all — used below as the
// "no results captured yet" fixture, paired with a fixed past `date` arg
// (2026-06-03, always behind any real test-run date) to trigger the
// missing-results prompt's date-in-the-past condition.
export const MissingResultsPromptShowsForPastDayWithNoResults: Story = {
  args: { date: "2026-06-03" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-missing-results-prompt")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-reseed-confirm")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-reseed-dismiss")).toBeInTheDocument();
  },
};

export const MissingResultsPromptHiddenWhenSomeResultsExist: Story = {
  args: { date: "2026-06-03" },
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.queryByTestId("daily-races-missing-results-prompt")).not.toBeInTheDocument();
  },
};

export const MissingResultsPromptHiddenForToday: Story = {
  // No `date` arg -> defaults to real "today", not a past day, even though
  // MOCK_RACES has zero results — the prompt must never fire for a day
  // that's still in progress.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.queryByTestId("daily-races-missing-results-prompt")).not.toBeInTheDocument();
  },
};

export const DismissHidesMissingResultsPrompt: Story = {
  args: { date: "2026-06-03" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-missing-results-prompt")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("daily-races-reseed-dismiss"));
    await expect(canvas.queryByTestId("daily-races-missing-results-prompt")).not.toBeInTheDocument();
  },
};

export const ReseedConfirmShowsSuccessMessage: Story = {
  args: { date: "2026-06-03" },
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES, count: MOCK_RACES.length })
        ),
        http.post(`${BASE}/api/daily-races/reseed-results`, () =>
          HttpResponse.json({ success: true, data: { racesUpserted: 3, runnersUpserted: 21, nonGbSkipped: 1 } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-reseed-confirm"));
    await expect(canvas.findByTestId("daily-races-reseed-success")).resolves.toHaveTextContent("Found 3 races");
  },
};

export const ReseedConfirmShowsPlanRequiredMessage: Story = {
  args: { date: "2026-06-03" },
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES, count: MOCK_RACES.length })
        ),
        http.post(`${BASE}/api/daily-races/reseed-results`, () =>
          HttpResponse.json({
            success: false,
            error: "plan_required",
            message: "Our racing data provider only lets us fetch today's results on our current plan.",
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-reseed-confirm"));
    await expect(canvas.findByTestId("daily-races-reseed-error")).resolves.toHaveTextContent("today's results");
  },
};

// Same three races as MOCK_RACES, each now carrying a real captured
// result: rac_1/hrs_1 (Fixture Star, modelWinProbability 25) WINNER at isp
// 5 (implied 100/5=20%) -> beats its own SP (25% > 20%) AND £1-to-win stake
// 1/(5-1)=£0.25, PnL exactly +£1.00 (a win always nets +£1 regardless of
// isp under this staking convention — only the loss side's stake size
// scales with isp); rac_2/hrs_2 (Chase Fixture, modelWinProbability 5)
// LOSER at isp 3 (implied 33.3%) -> does NOT beat SP (5% < 33.3%) and
// loses its 1/(3-1)=£0.50 stake; rac_3/hrs_3 (Ascot Fixture) NON_FINISHER
// with no valid isp -> no PnL and no beats-SP verdict at all (unknown, not
// "no"), same "excluded, not treated as false/zero" convention as
// ispFormat.ts's computeRangePnl.
const MOCK_RACES_WITH_RESULTS = MOCK_RACES.map(race => {
  const resultByRaceId: Record<string, { status: "WINNER" | "LOSER" | "NON_FINISHER"; pos: string; isp: number | null; ispFraction: string | null }> = {
    rac_1: { status: "WINNER", pos: "1", isp: 5, ispFraction: "4/1" },
    rac_2: { status: "LOSER", pos: "4", isp: 3, ispFraction: "2/1" },
    rac_3: { status: "NON_FINISHER", pos: "PU", isp: null, ispFraction: null },
  };
  return { ...race, runners: race.runners.map(r => ({ ...r, result: resultByRaceId[race.raceId] })) };
});

export const WonPickShowsResultAndPnl: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await expect(canvas.getByTestId("daily-races-pick-result-hrs_1")).toHaveTextContent("Won");
    await expect(canvas.getByTestId("daily-races-pick-pnl-hrs_1")).toHaveTextContent("+£1.00");
  },
};

export const LostPickShowsResultAndPnl: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const trainerInput = canvas.getByTestId("daily-races-trainer-search");
    await userEvent.type(trainerInput, "A Trainer");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await expect(canvas.getByTestId("daily-races-pick-result-hrs_2")).toHaveTextContent("Lost");
    await expect(canvas.getByTestId("daily-races-pick-pnl-hrs_2")).toHaveTextContent("-£0.50");
  },
};

export const BeatsSpBadgeShowsOnValuePick: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    // hrs_1: modelWinProbability 25% > isp-5 implied 20% -> beats its SP.
    await expect(canvas.getByTestId("daily-races-pick-beats-sp-hrs_1")).toHaveTextContent("Beat SP");
  },
};

export const BelowSpBadgeShowsOnNonValuePick: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const trainerInput = canvas.getByTestId("daily-races-trainer-search");
    await userEvent.type(trainerInput, "A Trainer");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    // hrs_2: modelWinProbability 5% < isp-3 implied 33.3% -> below SP.
    await expect(canvas.getByTestId("daily-races-pick-beats-sp-hrs_2")).toHaveTextContent("Below SP");
    // hrs_3 (non-finisher, no isp) is a separate race/trainer — not
    // reachable by this search, so no beats-SP verdict is asserted here.
  },
};

export const OnlyModelBeatsSpFilterNarrowsToValueBetsOnly: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    await userEvent.click(canvas.getByTestId("daily-races-only-model-beats-sp"));
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    // Only hrs_1 (beats its SP) qualifies — hrs_2 (below SP) and hrs_3
    // (no result yet, so unverifiable) are both excluded, not shown as
    // exceptions.
    await expect(canvas.getByTestId("daily-races-pick-hrs_1")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-hrs_2")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-hrs_3")).not.toBeInTheDocument();
  },
};

export const NonFinisherPickShowsResultWithNoPnl: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const trainerInput = canvas.getByTestId("daily-races-trainer-search");
    await userEvent.type(trainerInput, "Z Trainer");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await expect(canvas.getByTestId("daily-races-pick-result-hrs_3")).toHaveTextContent("Non-finisher");
    await expect(canvas.queryByTestId("daily-races-pick-pnl-hrs_3")).not.toBeInTheDocument();
  },
};

export const DayPnlSummaryTotalsResultedPicks: Story = {
  // rac_1/hrs_1 WINNER (isp 4, PnL +£1.00) and rac_2/hrs_2 LOSER (isp 3,
  // PnL -£0.50) both qualify (modelWinProbability 25/5, min 0 default) once
  // trainer-searched to "A Trainer" — total should be +£1.00 - £0.50 =
  // +£0.50, "2 resulted" (rac_3/hrs_3 is a Non-finisher with no valid isp,
  // excluded from the total, and isn't matched by this trainer search
  // anyway).
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: MOCK_RACES_WITH_RESULTS, count: MOCK_RACES_WITH_RESULTS.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const trainerInput = canvas.getByTestId("daily-races-trainer-search");
    await userEvent.type(trainerInput, "A Trainer");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await expect(canvas.getByTestId("daily-races-picks-day-pnl")).toHaveTextContent("Day P&L: +£0.50");
    await expect(canvas.getByTestId("daily-races-picks-day-pnl")).toHaveTextContent("2 resulted");
  },
};

export const PendingPickShowsNoResultBadge: Story = {
  // Default handlers (MOCK_RACES) — no runner carries a result yet, same as
  // a race that hasn't been captured by the results job at all.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    // A clean baseline — this test-runner can carry filter state over from a
    // previously-run story in the same suite, same gotcha documented above.
    await userEvent.click(canvas.getByTestId("daily-races-filter-reset"));

    const minModelInput = canvas.getByTestId("daily-races-min-model-win-probability");
    await userEvent.clear(minModelInput);
    await userEvent.type(minModelInput, "20");
    await userEvent.click(canvas.getByTestId("daily-races-filter-apply"));

    await expect(canvas.getByTestId("daily-races-pick-hrs_1")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-result-hrs_1")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-pick-pnl-hrs_1")).not.toBeInTheDocument();
  },
};
