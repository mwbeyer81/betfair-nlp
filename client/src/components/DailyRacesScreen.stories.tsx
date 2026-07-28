import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DailyRacesScreen } from "./DailyRacesScreen";

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

// Same three races as MOCK_RACES, each now carrying a real captured
// result: rac_1/hrs_1 (Fixture Star) WINNER at isp 4 -> £1-to-win stake
// 1/(4-1)=£0.333, so PnL is exactly +£1.00; rac_2/hrs_2 (Chase Fixture)
// LOSER at isp 3 -> loses its 1/(3-1)=£0.50 stake; rac_3/hrs_3 (Ascot
// Fixture) NON_FINISHER with no valid isp -> no PnL at all, same
// "excluded from PnL" convention as ispFormat.ts's computeRangePnl.
const MOCK_RACES_WITH_RESULTS = MOCK_RACES.map(race => {
  const resultByRaceId: Record<string, { status: "WINNER" | "LOSER" | "NON_FINISHER"; pos: string; isp: number | null; ispFraction: string | null }> = {
    rac_1: { status: "WINNER", pos: "1", isp: 4, ispFraction: "3/1" },
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
