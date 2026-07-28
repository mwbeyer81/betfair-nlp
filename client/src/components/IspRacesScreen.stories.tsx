import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { IspRacesScreen } from "./IspRacesScreen";

const BASE = "http://localhost:3000";

const MOCK_RACES: Array<{
  raceId: number;
  meetingId: string;
  meetingName: string;
  course: string;
  countryCode: string;
  raceTime: string;
  raceName: string;
  raceType: string;
  ran: number;
  runners: Array<{
    id: number; name: string; num: number | null; draw: number | null; status: string; sortPriority: number;
    isp: number; ispFraction: string; isFavourite: boolean;
    trainer?: string; trainerFormRuns?: number; trainerFormWins?: number; trainerFormWinRate?: number | null;
    modelWinProbability?: number | null;
  }>;
}> = [
  {
    raceId: 914592,
    meetingId: "Leopardstown|2026-02-01",
    meetingName: "Leopardstown — 1 February 2026",
    course: "Leopardstown",
    countryCode: "IE",
    raceTime: "2026-02-01T13:15:00",
    raceName: "Leopardstown 13:15",
    raceType: "Chase",
    ran: 2,
    runners: [
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43 },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false, trainer: "Emmet Mullins" },
    ],
  },
  {
    raceId: 914593,
    meetingId: "Leopardstown|2026-02-01",
    meetingName: "Leopardstown — 1 February 2026",
    course: "Leopardstown",
    countryCode: "IE",
    raceTime: "2026-02-01T13:50:00",
    raceName: "Leopardstown 13:50",
    raceType: "Hurdle",
    ran: 2,
    runners: [
      { id: 22001, name: "State Man", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.4, ispFraction: "2/5", isFavourite: true },
      { id: 22002, name: "Brighterdaysahead", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 6.0, ispFraction: "5/1", isFavourite: false },
    ],
  },
];

const TOTAL_RUNNERS_IN_DB = MOCK_RACES.reduce((s, r) => s + r.runners.length, 0); // 4

// A race with a third runner that fails the "model beats SP" filter — used
// to prove the race-level P&L badge reflects only the runners actually
// shown, not every runner in the underlying race.
const FILTERED_RACE_MOCK = [
  {
    raceId: 954500,
    meetingId: "Wetherby|2026-03-01",
    meetingName: "Wetherby — 1 March 2026",
    course: "Wetherby",
    countryCode: "GB",
    raceTime: "2026-03-01T13:30:00",
    raceName: "Wetherby 13:30",
    raceType: "Chase",
    ran: 3,
    runners: [
      { id: 31001, name: "Red Stripes", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbability: 26 },
      { id: 31002, name: "Aqlette", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 17, ispFraction: "16/1", isFavourite: false, modelWinProbability: 21 },
      // No modelWinProbability → modelBeatsSp is false, so this runner is
      // filtered out of the list — but its -£1.00 loser stake used to still
      // get folded into the race's P&L total.
      { id: 31003, name: "Filtered Favourite", num: 3, draw: null, status: "LOSER", sortPriority: 3, isp: 2, ispFraction: "1/1", isFavourite: true },
    ],
  },
];

// Spans two years, two months within 2015, and two meetings on the same
// day — exercises every level of the year/month/day/meeting collapsible
// hierarchy with hand-computed P&L at each level (see the group-pnl-rollup
// stories below for the arithmetic).
const HIERARCHY_MOCK_RACES = [
  {
    raceId: 700001,
    meetingId: "Musselburgh|2015-01-01",
    meetingName: "Musselburgh — 1 January 2015",
    course: "Musselburgh",
    countryCode: "GB",
    raceTime: "2015-01-01T13:00:00",
    raceName: "Musselburgh 13:00",
    raceType: "Hurdle",
    ran: 1,
    runners: [
      { id: 70101, name: "January Winner", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false },
    ],
  },
  {
    raceId: 700002,
    meetingId: "Ascot|2015-01-01",
    meetingName: "Ascot — 1 January 2015",
    course: "Ascot",
    countryCode: "GB",
    raceTime: "2015-01-01T14:00:00",
    raceName: "Ascot 14:00",
    raceType: "Hurdle",
    ran: 1,
    runners: [
      { id: 70201, name: "January Loser", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false },
    ],
  },
  {
    raceId: 700003,
    meetingId: "Musselburgh|2015-02-15",
    meetingName: "Musselburgh — 15 February 2015",
    course: "Musselburgh",
    countryCode: "GB",
    raceTime: "2015-02-15T13:00:00",
    raceName: "Musselburgh 13:00",
    raceType: "Chase",
    ran: 1,
    runners: [
      { id: 70301, name: "February Loser", num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 3, ispFraction: "2/1", isFavourite: false },
    ],
  },
  {
    raceId: 700004,
    meetingId: "Ascot|2016-01-01",
    meetingName: "Ascot — 1 January 2016",
    course: "Ascot",
    countryCode: "GB",
    raceTime: "2016-01-01T13:00:00",
    raceName: "Ascot 13:00",
    raceType: "Flat",
    ran: 1,
    runners: [
      { id: 70401, name: "Next Year Winner", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 3, ispFraction: "2/1", isFavourite: false },
    ],
  },
];

const withQueryParams = (search: string) => {
  const Decorator = (Story: React.ComponentType) => {
    window.history.pushState({}, "", `${window.location.pathname}?${search}`);
    return <Story />;
  };
  return Decorator;
};

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp`, () =>
    HttpResponse.json({
      success: true,
      data: MOCK_RACES,
      count: MOCK_RACES.length,
      total: MOCK_RACES.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      totalRunners: TOTAL_RUNNERS_IN_DB,
      pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
    })
  ),
];

const meta: Meta<typeof IspRacesScreen> = {
  title: "Components/IspRacesScreen",
  component: IspRacesScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onBack: fn(),
    onNavigateToMeeting: fn(),
    onNavigateToRace: fn(),
    onNavigateToRunner: fn(),
    onNavigateToTrainer: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-sp-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-list")).not.toBeInTheDocument();
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/industry-sp`, () => HttpResponse.error())] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("industry-sp-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-list")).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: [],
            count: 0,
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 1,
            totalRunners: 0,
            pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("No races found.")).resolves.toBeInTheDocument();
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("industry-sp-races-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-list")).resolves.toBeInTheDocument();
    // "Races" (plus counts) is now folded into the AppHeader subtitle
    // rather than being its own Appbar title.
    await expect(canvas.findByText(/Races/)).resolves.toBeInTheDocument();
  },
};

export const BackButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-races-back-button");
    await expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const MeetingSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Meeting header shows just the course now — the date lives on the day
    // header above it in the year/month/day/meeting hierarchy.
    const meeting = await canvas.findByTestId("industry-sp-meeting-Leopardstown|2026-02-01");
    await expect(within(meeting).getByText("Leopardstown")).toBeInTheDocument();
    const day = await canvas.findByTestId("industry-sp-day-2026-02-01");
    await expect(within(day).getByText("1 Feb 2026")).toBeInTheDocument();
  },
};

export const RaceAndRunnerRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("industry-sp-race-914592")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
  },
};

export const MeetingHeaderNavigatesToMeeting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const link = canvas.getByTestId(`industry-sp-meeting-link-${MOCK_RACES[0].meetingId}`);
    await userEvent.click(link);
    await expect(args.onNavigateToMeeting).toHaveBeenCalledWith(MOCK_RACES[0].meetingId);
  },
};

export const RaceRowNavigatesToRace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const raceRow = canvas.getByTestId(`industry-sp-race-${MOCK_RACES[0].raceId}`);
    await userEvent.click(raceRow);
    await expect(args.onNavigateToRace).toHaveBeenCalledWith(MOCK_RACES[0].raceId);
  },
};

export const OddsModeDefaultsToFraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-odds-mode-toggle")).toHaveTextContent("Odds: Fraction");
    await expect(canvas.getByTestId(`industry-sp-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 19/20");
  },
};

export const OddsModeToggleSwitchesToDecimal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await userEvent.click(canvas.getByTestId("industry-sp-odds-mode-toggle"));
    await expect(canvas.getByTestId("industry-sp-odds-mode-toggle")).toHaveTextContent("Odds: Decimal");
    // 19/20 + 1 = 1.95 — a clean 2dp value, never a raw float artifact.
    await expect(canvas.getByTestId(`industry-sp-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 1.95");
  },
};

export const IspDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const runners = MOCK_RACES.flatMap(r => r.runners);
    for (const runner of runners) {
      const ispEl = await canvas.findByTestId(`industry-sp-isp-${runner.id}`);
      await expect(ispEl).toBeInTheDocument();
      await expect(ispEl).toHaveTextContent(`ISP ${runner.ispFraction}`);
    }
  },
};

export const PerRunnerPnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Galopin Des Champs: WINNER at ISP 1.95, stake £1.05 → +£1.00
    await expect(await canvas.findByTestId("industry-sp-pnl-item-21001")).toHaveTextContent("+£1.00");
    await expect(canvas.getByTestId("industry-sp-stake-21001")).toHaveTextContent("Bet £1.05");
    // Meetingofthewaters: LOSER at ISP 5.5, stake £0.22 → -£0.22
    await expect(canvas.getByTestId("industry-sp-pnl-item-21002")).toHaveTextContent("-£0.22");
    await expect(canvas.getByTestId("industry-sp-stake-21002")).toHaveTextContent("Bet £0.22");
  },
};

export const MeetingPnlDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Leopardstown's two races combined: Galopin (+£1.00, stake £1.05),
    // Meetingofthewaters (-£0.22), State Man (+£1.00, stake £2.50),
    // Brighterdaysahead (-£0.20) — £3.97 staked, £1.58 net.
    await expect(
      canvas.getByTestId(`industry-sp-meeting-pnl-${MOCK_RACES[0].meetingId}`)
    ).toHaveTextContent("+£1.58");
  },
};

export const MeetingPnlRespondsToFilters: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: FILTERED_RACE_MOCK,
            count: 1,
            total: 1,
            page: 1,
            limit: 20,
            totalPages: 1,
            totalRunners: 3,
            pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
          })
        ),
      ],
    },
  },
  decorators: [withQueryParams("onlyModelBeatsSp=true")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");

      // Only Red Stripes + Aqlette pass the filter — the meeting-level
      // total must count just those two (+£1.00 winner, -£0.06 loser =
      // +£0.94), not the whole field including the filtered-out third runner.
      await expect(
        canvas.getByTestId(`industry-sp-meeting-pnl-${FILTERED_RACE_MOCK[0].meetingId}`)
      ).toHaveTextContent("+£0.94");
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const RacePnlMatchesVisibleRunnersWhenFiltered: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: FILTERED_RACE_MOCK,
            count: 1,
            total: 1,
            page: 1,
            limit: 20,
            totalPages: 1,
            totalRunners: 3,
            pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
          })
        ),
      ],
    },
  },
  decorators: [withQueryParams("onlyModelBeatsSp=true")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");

      // Only the two runners where the model beats SP are shown...
      await expect(canvas.getByTestId("industry-sp-item-name-31001")).toBeInTheDocument();
      await expect(canvas.getByTestId("industry-sp-item-name-31002")).toBeInTheDocument();
      await expect(canvas.queryByTestId("industry-sp-item-name-31003")).not.toBeInTheDocument();

      // ...and the race-level P&L badge must equal the sum of exactly those
      // two runners' P&L (+£1.00 winner, -£0.06 loser = +£0.94), not the
      // whole field including the filtered-out third runner's -£1.00 loser.
      const raceRow = canvas.getByTestId("industry-sp-race-954500");
      await expect(within(raceRow).getByText(/^\+£0\.94/)).toBeInTheDocument();
    } finally {
      // The test runner reuses one browser page across stories in this
      // file — clear the query param this story pushed so it doesn't leak
      // into whichever story runs next, even if an assertion above throws.
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const TrainerFormBadgeDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Galopin Des Champs has a 14-day form sample — badge shows win/run/rate.
    await expect(canvas.getByTestId("industry-sp-item-trainer-21001")).toHaveTextContent("W P Mullins");
    await expect(canvas.getByTestId("industry-sp-item-trainer-form-21001")).toHaveTextContent("3/14");
    await expect(canvas.getByTestId("industry-sp-item-trainer-form-21001")).toHaveTextContent("21%");

    // Meetingofthewaters has a trainer but no form sample — name shows, no badge.
    await expect(canvas.getByTestId("industry-sp-item-trainer-21002")).toHaveTextContent("Emmet Mullins");
    await expect(canvas.queryByTestId("industry-sp-item-trainer-form-21002")).not.toBeInTheDocument();
  },
};

export const SortToggleVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-sort-toggle");
    await expect(btn).toBeInTheDocument();
    await expect(btn).toHaveTextContent("First → Last");
  },
};

export const SortToggleSwitchesToDesc: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-sort-toggle");
    await expect(btn).toHaveTextContent("First → Last");
    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("Last → First");

    // Clicking the toggle writes ?sort=desc to the real browser URL (see
    // ispUrlParams.updateUrlParams) — the test runner reuses one page
    // across stories in this file, so clear it or it leaks into whichever
    // story runs next (that story's sortOrder would then init to "desc").
    window.history.pushState({}, "", window.location.pathname);
  },
};

export const LoadMoreVisibleWhenMorePagesExist: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: MOCK_RACES,
            count: MOCK_RACES.length,
            total: 50,
            page: 1,
            limit: 20,
            totalPages: 3,
            totalRunners: TOTAL_RUNNERS_IN_DB,
            pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-load-more")).toHaveTextContent("Load more (48 remaining)");
  },
};

const hierarchyHandlers = [
  http.get(`${BASE}/api/industry-sp`, () =>
    HttpResponse.json({
      success: true,
      data: HIERARCHY_MOCK_RACES,
      count: HIERARCHY_MOCK_RACES.length,
      total: HIERARCHY_MOCK_RACES.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      totalRunners: HIERARCHY_MOCK_RACES.reduce((s, r) => s + r.runners.length, 0),
      pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
    })
  ),
];

export const HierarchyLevelsVisible: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await expect(canvas.getByTestId("industry-sp-year-2015")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-year-2016")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-month-2015-01")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-month-2015-02")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-day-2015-01-01")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-day-2015-02-15")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-meeting-Musselburgh|2015-01-01")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-meeting-Ascot|2015-01-01")).toBeInTheDocument();
    await expect(canvas.getByText("January 2015")).toBeInTheDocument();
  },
};

export const GroupPnlRollupsMatchChildRaces: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Meeting level: one race each. Each testID targets the group's own
    // P&L text directly (not a free-text search of the whole subtree) —
    // a single-race meeting's total is numerically identical to that
    // race's own P&L badge, so a loose text match would find both.
    // Musselburgh (Jan 1) — WINNER at 4/1, stake £0.25 → +£1.00 (+400.0%)
    await expect(canvas.getByTestId("industry-sp-meeting-pnl-Musselburgh|2015-01-01"))
      .toHaveTextContent("+£1.00 (+400.0%)");
    // Ascot (Jan 1) — LOSER at 4/1, stake £0.25 → -£0.25 (-100.0%)
    await expect(canvas.getByTestId("industry-sp-meeting-pnl-Ascot|2015-01-01"))
      .toHaveTextContent("-£0.25 (-100.0%)");

    // Day level: both Jan 1 meetings combined → +£1.00 - £0.25 = +£0.75 (+150.0%)
    await expect(canvas.getByTestId("industry-sp-day-pnl-2015-01-01")).toHaveTextContent("+£0.75 (+150.0%)");

    // Month level: January 2015 (same as the single day in it) vs February
    // 2015 (one LOSER at 2/1, stake £0.50 → -£0.50, -100.0%).
    await expect(canvas.getByTestId("industry-sp-month-pnl-2015-01")).toHaveTextContent("+£0.75 (+150.0%)");
    await expect(canvas.getByTestId("industry-sp-month-pnl-2015-02")).toHaveTextContent("-£0.50 (-100.0%)");

    // Year level: 2015 = Jan (staked £0.50, returns £1.25) + Feb (staked
    // £0.50, returns £0) → staked £1.00, returns £1.25, net +£0.25
    // (+25.0%). 2016 = single WINNER at 2/1, stake £0.50 → +£1.00 (+200.0%).
    await expect(canvas.getByTestId("industry-sp-year-pnl-2015")).toHaveTextContent("+£0.25 (+25.0%)");
    await expect(canvas.getByTestId("industry-sp-year-pnl-2016")).toHaveTextContent("+£1.00 (+200.0%)");
  },
};

export const YearToggleCollapsesDescendants: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2015"));

    await expect(canvas.queryByTestId("industry-sp-month-2015-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-day-2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-meeting-Musselburgh|2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700001")).not.toBeInTheDocument();
    // The year header itself stays, just its chevron flips.
    await expect(canvas.getByTestId("industry-sp-year-2015")).toBeInTheDocument();
    // A sibling year is unaffected.
    await expect(canvas.getByTestId("industry-sp-year-2016")).toBeInTheDocument();
  },
};

export const MonthToggleCollapsesDescendants: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2015-01"));

    await expect(canvas.queryByTestId("industry-sp-day-2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700001")).not.toBeInTheDocument();
    // A sibling month (Feb 2015) is unaffected.
    await expect(canvas.getByTestId("industry-sp-day-2015-02-15")).toBeInTheDocument();
  },
};

export const DayToggleCollapsesDescendants: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await userEvent.click(canvas.getByTestId("industry-sp-day-toggle-2015-01-01"));

    await expect(canvas.queryByTestId("industry-sp-meeting-Musselburgh|2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-meeting-Ascot|2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700001")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700002")).not.toBeInTheDocument();
  },
};

export const MeetingToggleCollapsesRacesButLinkStillNavigates: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await userEvent.click(canvas.getByTestId("industry-sp-meeting-toggle-Musselburgh|2015-01-01"));
    await expect(canvas.queryByTestId("industry-sp-race-700001")).not.toBeInTheDocument();
    // Meeting header (course name + P&L) stays visible, collapsed or not.
    await expect(canvas.getByTestId("industry-sp-meeting-Musselburgh|2015-01-01")).toBeInTheDocument();

    // The course-name link is a separate control from the collapse chevron
    // — clicking it still navigates rather than just toggling.
    await userEvent.click(canvas.getByTestId("industry-sp-meeting-link-Musselburgh|2015-01-01"));
    await expect(args.onNavigateToMeeting).toHaveBeenCalledWith("Musselburgh|2015-01-01");
  },
};

export const CollapseAllTogglesEverything: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-collapse-all-toggle");
    await expect(btn).toHaveTextContent("Collapse All");

    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("Expand All");
    // Nothing below year level survives a full collapse.
    await expect(canvas.queryByTestId("industry-sp-month-2015-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700004")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-year-2015")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-year-2016")).toBeInTheDocument();

    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("Collapse All");
    await expect(canvas.getByTestId("industry-sp-month-2015-01")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-race-700004")).toBeInTheDocument();
  },
};

export const RendersAtIphone12: Story = {
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-races-screen")).toBeInTheDocument();
  },
};

export const RendersAtLaptop: Story = {
  parameters: { viewport: { defaultViewport: "laptop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-races-screen")).toBeInTheDocument();
  },
};
