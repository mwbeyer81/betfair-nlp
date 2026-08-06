import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
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
    modelWinProbabilityOos?: number | null;
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
      { id: 31001, name: "Red Stripes", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbabilityOos: 26 },
      { id: 31002, name: "Aqlette", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 17, ispFraction: "16/1", isFavourite: false, modelWinProbabilityOos: 21 },
      // No out-of-sample model probability → modelBeatsSp is false, so this runner is
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

// Every group starts collapsed (see IspRacesScreen's `expandedKeys`) and the
// day is the fetch unit (see dayStates/loadDayPage), so reaching a race row
// means opening year -> month -> day -> meeting in turn, waiting for each
// level's own fetch to land before the next level's rows exist to click.
// That's exactly what a user does, and it's what the local-CI Playwright
// suite does too (client/tests-local-ci/isp-races-ui.spec.ts).
//
// Deliberately NOT "just press Expand All": that now cascades a year probe
// into a month probe into a day fetch for every year in range, which with an
// unbounded filter is a large burst of requests and several render passes to
// settle — slow and flaky as a precondition for an assertion about one row.
async function drill(
  canvas: ReturnType<typeof within>,
  { year, month, day, meeting }: { year: string; month: string; day: string; meeting?: string }
) {
  await userEvent.click(await canvas.findByTestId(`industry-sp-year-toggle-${year}`));
  await userEvent.click(await canvas.findByTestId(`industry-sp-month-toggle-${month}`));
  // The day's own row only appears once the month's probe has resolved and
  // told the screen which day its data starts on.
  await waitFor(() => expect(canvas.getByTestId(`industry-sp-day-toggle-${day}`)).toBeInTheDocument(), {
    timeout: 10000,
  });
  await userEvent.click(canvas.getByTestId(`industry-sp-day-toggle-${day}`));
  if (meeting) {
    await waitFor(() => expect(canvas.getByTestId(`industry-sp-meeting-toggle-${meeting}`)).toBeInTheDocument(), {
      timeout: 10000,
    });
    await userEvent.click(canvas.getByTestId(`industry-sp-meeting-toggle-${meeting}`));
  }
}

// The three fixtures' own coordinates, so stories name a fixture rather than
// repeating date arithmetic.
const AT_LEOPARDSTOWN = { year: "2026", month: "2026-02", day: "2026-02-01", meeting: "Leopardstown|2026-02-01" };
const AT_WETHERBY = { year: "2026", month: "2026-03", day: "2026-03-01", meeting: "Wetherby|2026-03-01" };
const AT_MUSSELBURGH = { year: "2015", month: "2015-01", day: "2015-01-01", meeting: "Musselburgh|2015-01-01" };

// Every handler below answers with total/totalRunners/pnlStats computed over
// the races it actually matched — never a hardcoded constant, and never the
// whole dataset's numbers for a narrower window. That is what the real
// pipeline does (subDateMatchStage sits ahead of the $facet), and since the
// isp-races-rollup-mismatch fix it is also what every year/month/day header on
// this screen renders directly, so a mock that lied here would let the screen
// silently go back to counting only the races it had paged in.
type MockRace = { raceTime: string; runners: { isp?: number | null; status: string }[] };

function pnlOver(races: MockRace[]) {
  let staked = 0, returns = 0, count = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner.isp != null && runner.isp > 1) {
        count++;
        const stake = 1 / (runner.isp - 1);
        staked += stake;
        if (runner.status === "WINNER") returns += stake + 1;
      }
    }
  }
  return { staked, returns, pnl: returns - staked, count };
}

// Narrows by the sub-date window the caller asked for, then pages what's left
// — the same order the real aggregation applies them in.
function ispPage<T extends MockRace>(all: T[], request: Request) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const subMinDate = url.searchParams.get("subMinDate");
  const subMaxDate = url.searchParams.get("subMaxDate");
  let matched = all;
  if (subMinDate) matched = matched.filter(r => r.raceTime.slice(0, 10) >= subMinDate);
  if (subMaxDate) matched = matched.filter(r => r.raceTime.slice(0, 10) <= subMaxDate);
  const data = matched.slice((page - 1) * limit, (page - 1) * limit + limit);
  const stats = pnlOver(matched);
  return {
    success: true,
    data,
    count: data.length,
    total: matched.length,
    page,
    limit,
    totalPages: Math.ceil(matched.length / limit),
    totalRunners: stats.count,
    pnlStats: stats,
  };
}

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp`, ({ request }) => HttpResponse.json(ispPage(MOCK_RACES, request))),
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
    // rather than being its own Appbar title. Matched via the subtitle's
    // own "Races · N runners" shape — a bare /Races/ also hits the burger
    // menu's "Daily Races" button and fails as ambiguous.
    await expect(canvas.findByText(/Races · \d+\/\d+ runners/)).resolves.toBeInTheDocument();
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

    await drill(canvas, AT_LEOPARDSTOWN);

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

    await drill(canvas, AT_LEOPARDSTOWN);

    await expect(canvas.findByTestId("industry-sp-race-914592")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
  },
};

export const MeetingHeaderNavigatesToMeeting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_LEOPARDSTOWN);

    const link = canvas.getByTestId(`industry-sp-meeting-link-${MOCK_RACES[0].meetingId}`);
    await userEvent.click(link);
    await expect(args.onNavigateToMeeting).toHaveBeenCalledWith(MOCK_RACES[0].meetingId);
  },
};

export const RaceRowNavigatesToRace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_LEOPARDSTOWN);

    const raceRow = canvas.getByTestId(`industry-sp-race-${MOCK_RACES[0].raceId}`);
    await userEvent.click(raceRow);
    await expect(args.onNavigateToRace).toHaveBeenCalledWith(MOCK_RACES[0].raceId);
  },
};

export const OddsModeDefaultsToFraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_LEOPARDSTOWN);
    await expect(canvas.getByTestId("industry-sp-odds-mode-toggle")).toHaveTextContent("Odds: Fraction");
    await expect(canvas.getByTestId(`industry-sp-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 19/20");
  },
};

export const OddsModeToggleSwitchesToDecimal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_LEOPARDSTOWN);
    await userEvent.click(canvas.getByTestId("industry-sp-odds-mode-toggle"));
    await expect(canvas.getByTestId("industry-sp-odds-mode-toggle")).toHaveTextContent("Odds: Decimal");
    // 19/20 + 1 = 1.95 — a clean 2dp value, never a raw float artifact.
    await expect(canvas.getByTestId(`industry-sp-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 1.95");
  },
};

export const IspDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await drill(canvas, AT_LEOPARDSTOWN);

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

    await drill(canvas, AT_LEOPARDSTOWN);

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

    await drill(canvas, AT_LEOPARDSTOWN);

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
      await drill(canvas, AT_WETHERBY);

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
      await drill(canvas, AT_WETHERBY);

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

    await drill(canvas, AT_LEOPARDSTOWN);

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
    // MOCK_RACES' 2 races are both dated 2026-02-01 — the mount chain lands
    // on 2026 -> February -> the 1st, and this static handler (which ignores
    // query params, always returning the same 2 races / total: 50) reports 48
    // more remaining within that day. "Load more" lives at day level now, so
    // the tree has to be opened down to the day for it to be on screen.
    await drill(canvas, { year: "2026", month: "2026-02", day: "2026-02-01" });
    await waitFor(() => {
      expect(canvas.getByTestId("industry-sp-day-load-more-2026-02-01")).toHaveTextContent("48 remaining");
    }, { timeout: 10000 });
  },
};

const hierarchyHandlers = [
  http.get(`${BASE}/api/industry-sp`, ({ request }) => HttpResponse.json(ispPage(HIERARCHY_MOCK_RACES, request))),
];

export const HierarchyLevelsVisible: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_MUSSELBURGH);

    await expect(canvas.getByTestId("industry-sp-year-2015")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-year-2016")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-month-2015-01")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-month-2015-02")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-day-2015-01-01")).toBeInTheDocument();
    // February's *day* rows only exist once February itself is opened — a
    // closed month renders no days at all now that the day is the fetch unit.
    await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2015-02"));
    await waitFor(() => expect(canvas.getByTestId("industry-sp-day-2015-02-15")).toBeInTheDocument(), { timeout: 10000 });
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

    await drill(canvas, AT_MUSSELBURGH);

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

// The behaviour this screen is specified on: arriving at it never drops the
// user part-way into an already-opened tree, however deep the data that
// loaded goes.
export const EverythingStartsCollapsedOnLoad: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Year headers are the only tappable rows on screen — every level below
    // them starts shut, including the year the mount fetch actually landed
    // in (2015 here, which is where the old behaviour would have opened).
    await expect(canvas.getByTestId("industry-sp-year-2015")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-year-2016")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-month-2015-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-day-2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-meeting-Musselburgh|2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700001")).not.toBeInTheDocument();

    // ...and with nothing expanded, the toggle offers to expand.
    await expect(canvas.getByTestId("industry-sp-collapse-all-toggle")).toHaveTextContent("Expand All");
  },
};

// Collapsed must not mean empty: the mount fetch still runs, so the year
// header carries a real race count and P&L rollup the user can read without
// opening anything.
export const CollapsedYearStillShowsItsCountAndPnl: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // 2015 = Jan (staked £0.50, returns £1.25) + Feb (staked £0.50,
    // returns £0) → +£0.25 (+25.0%) — the same arithmetic as
    // GroupPnlRollupsMatchChildRaces, just read off a shut year.
    await waitFor(() => {
      expect(canvas.getByTestId("industry-sp-year-pnl-2015")).toHaveTextContent("+£0.25 (+25.0%)");
    }, { timeout: 5000 });
    await expect(canvas.getByTestId("industry-sp-year-count-2015")).toHaveTextContent("3 races");

    // Still shut while showing those numbers.
    await expect(canvas.queryByTestId("industry-sp-month-2015-01")).not.toBeInTheDocument();
  },
};

export const YearToggleCollapsesDescendants: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_MUSSELBURGH);

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

    await drill(canvas, AT_MUSSELBURGH);

    await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2015-01"));

    await expect(canvas.queryByTestId("industry-sp-day-2015-01-01")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-race-700001")).not.toBeInTheDocument();
    // A sibling month (Feb 2015) is unaffected — its own header is still
    // there, still closed, still carrying the count its default day loaded.
    await expect(canvas.getByTestId("industry-sp-month-2015-02")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-month-count-2015-02")).toHaveTextContent("1 races");
  },
};

export const DayToggleCollapsesDescendants: Story = {
  parameters: { msw: { handlers: hierarchyHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await drill(canvas, AT_MUSSELBURGH);

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

    await drill(canvas, AT_MUSSELBURGH);

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
  // Bounded to the two years the fixture actually covers. Left unbounded,
  // the filter spans 2015-2026 and one "Expand All" tap fans out into a
  // year probe per year, then a month probe per month it finds, then a day
  // fetch each — ~80 requests, slow enough to blow the runner's per-test
  // timeout while telling us nothing extra about the toggle itself.
  decorators: [withQueryParams("minDate=2015-01-01&maxDate=2016-12-31")],
  play: async ({ canvasElement }) => {
    try {
      const canvas = within(canvasElement);
      await canvas.findByTestId("industry-sp-list");

      const btn = canvas.getByTestId("industry-sp-collapse-all-toggle");
      // Nothing is expanded on load, so the toggle's opening offer is to
      // expand — not to collapse an already-open tree.
      await expect(btn).toHaveTextContent("Expand All");

      await userEvent.click(btn);
      await expect(btn).toHaveTextContent("Collapse All");
      await expect(canvas.getByTestId("industry-sp-month-2015-01")).toBeInTheDocument();
      // 2016's races only exist once the cascade the same tap fired settles:
      // its year probe finds January, that month's probe finds the 1st, that
      // day's page arrives, and expandAllActive opens each new level as it
      // appears. Several sequential round-trips, hence the longer window.
      await waitFor(() => expect(canvas.getByTestId("industry-sp-race-700004")).toBeInTheDocument(), { timeout: 15000 });

      await userEvent.click(btn);
      await expect(btn).toHaveTextContent("Expand All");
      // Nothing below year level survives a full collapse.
      await expect(canvas.queryByTestId("industry-sp-month-2015-01")).not.toBeInTheDocument();
      await expect(canvas.queryByTestId("industry-sp-race-700004")).not.toBeInTheDocument();
      await expect(canvas.getByTestId("industry-sp-year-2015")).toBeInTheDocument();
      await expect(canvas.getByTestId("industry-sp-year-2016")).toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

// 45 2024 races (spans 3 pages at PAGE_SIZE=20 — 20/20/5 — so a within-year
// "Load more" is actually exercised, not just a single page) and 3 2025
// races. Distinct raceId range (600000+) from any other fixture in this
// file, per the by-raceId-collision lesson noted repeatedly elsewhere —
// see git history if you need the details.
function perYearRace(year: number, index: number, idOffset: number) {
  const day = (index % 27) + 1;
  const date = `${year}-06-${String(day).padStart(2, "0")}`;
  return {
    raceId: 600000 + idOffset + index,
    meetingId: `Ascot|${date}`,
    meetingName: `Ascot — ${day} June ${year}`,
    course: "Ascot",
    countryCode: "GB",
    raceTime: `${date}T13:00:00`,
    raceName: "Ascot 13:00",
    raceType: "Flat",
    ran: 1,
    runners: [
      { id: 60100 + idOffset + index, name: `Runner ${year}-${index}`, num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false },
    ],
  };
}

const PER_YEAR_RACES = [
  ...Array.from({ length: 45 }, (_, i) => perYearRace(2024, i, 0)),
  ...Array.from({ length: 3 }, (_, i) => perYearRace(2025, i, 1000)),
];

let perYearRequests: { page: number; limit: number; subMinDate: string | null; subMaxDate: string | null }[] = [];

// Mirrors the real backend's two-stage filtering: an optional sub-date
// range (subMinDate/subMaxDate — see IndustrySpDAO's subMinRaceTime/
// subMaxRaceTime) narrows the matched set *before* skip=(page-1)*limit
// pagination applies, exactly like the real row-range-then-date-match
// pipeline order — a mock that paginated first and filtered after would
// give wrong page boundaries and not actually exercise what's being
// tested (that a year's own request is genuinely scoped and independently
// paginated, not a slice of some other combined set).
const perYearHandlers = [
  http.get(`${BASE}/api/industry-sp`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const subMinDate = url.searchParams.get("subMinDate");
    const subMaxDate = url.searchParams.get("subMaxDate");
    perYearRequests.push({ page, limit, subMinDate, subMaxDate });
    return HttpResponse.json(ispPage(PER_YEAR_RACES, request));
  }),
];

export const LazyYearPlaceholdersRenderFromDateRangeImmediately: Story = {
  parameters: { msw: { handlers: perYearHandlers } },
  decorators: [withQueryParams("minDate=2024-01-01&maxDate=2025-12-31")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");

      // Both years the filter spans render immediately, even though only
      // 2024 (where the mount probe actually landed) has loaded.
      await expect(canvas.getByTestId("industry-sp-year-2024")).toBeInTheDocument();
      await expect(canvas.getByTestId("industry-sp-year-2025")).toBeInTheDocument();

      // 2024's count is the SERVER's count for the whole year (45 races),
      // even though the mount chain only paged in its first day (2 races on
      // 1 June) — see rangeStats/isp-races-rollup-mismatch. The count is the
      // window's truth; the rows under it are what's been fetched.
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");
      }, { timeout: 10000 });

      // Those races are loaded but shut, so 2024's day rows only appear once
      // the year and then the month are opened by hand.
      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2024"));
      await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2024-06"));
      await expect(canvas.getByTestId("industry-sp-day-2024-06-01")).toBeInTheDocument();

      // 2025 hasn't been tapped yet — not "0 races" (which would claim
      // there's confirmed nothing there).
      await expect(canvas.getByTestId("industry-sp-year-count-2025")).toHaveTextContent("Tap to load");
      await expect(canvas.queryByTestId("industry-sp-day-2025-06-01")).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const TappingACollapsedYearFetchesItDirectlyWithoutTouchingOtherYears: Story = {
  parameters: { msw: { handlers: perYearHandlers } },
  decorators: [withQueryParams("minDate=2024-01-01&maxDate=2025-12-31")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");
      }, { timeout: 10000 });

      // Regression proof for the user's report ("2024's numbers changed
      // when I tapped 2025", plus "still broke" tapping a collapsed
      // year): tapping 2025 must fetch *only* 2025, directly — not walk
      // forward from 2024 (which would re-touch/append to 2024's own
      // state), and not fetch more than a small, fixed number of
      // requests regardless of how large 2024's own dataset is.
      // The year count now resolves as soon as the YEAR probe answers, while
      // that year's month probe and first-day page are still in flight — so
      // wait for DOM evidence that the mount chain's last request (2024's
      // first day) has landed before clearing, or its tail gets attributed to
      // the 2025 tap below. Opening these two rows fires nothing itself:
      // loadYearDefaultMonth/loadMonthDefaultDay are both idempotent for an
      // already-initialized node.
      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2024"));
      await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2024-06"));
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-day-count-2024-06-01")).toHaveTextContent("2 races");
      }, { timeout: 10000 });
      perYearRequests = [];
      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2025"));

      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2025")).toHaveTextContent("3 races");
      }, { timeout: 10000 });

      // 2024 is completely untouched — same count as before the tap.
      await expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");

      // Three requests, and every one of them scoped inside 2025: the year
      // probe that finds which month to land in, that month's probe for its
      // first day, and that day's own page. Narrowing at each hop rather
      // than walking forward through 2024's ~45 races. The count above
      // resolves on the first of the three (the year probe answers with the
      // whole year's total now), so wait for the other two to land.
      await waitFor(() => expect(perYearRequests).toHaveLength(3), { timeout: 10000 });
      expect(perYearRequests.map(r => `${r.subMinDate}..${r.subMaxDate}`)).toEqual([
        "2025-01-01..2025-12-31",
        "2025-06-01..2025-06-30",
        "2025-06-01..2025-06-01",
      ]);
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const TappingAYearsTapToLoadCountLoadsItWithoutExpanding: Story = {
  parameters: { msw: { handlers: perYearHandlers } },
  decorators: [withQueryParams("minDate=2024-01-01&maxDate=2025-12-31")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");
      }, { timeout: 10000 });

      // The count itself is a separate tap target from the row, and taps it
      // to mean only what it says: fetch. Reported live via screenshot — a
      // year of "Tap to load" rows where asking one for its number opened it
      // and pushed everything else off-screen.
      await userEvent.click(canvas.getByTestId("industry-sp-year-load-2025"));

      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2025")).toHaveTextContent("3 races");
      }, { timeout: 10000 });

      // Loaded, and still shut — none of 2025's months rendered.
      await expect(canvas.queryByTestId("industry-sp-month-2025-06")).not.toBeInTheDocument();

      // Its own tap target is gone now that it has a real count; the row
      // toggle still opens it, as it always did.
      await expect(canvas.queryByTestId("industry-sp-year-load-2025")).not.toBeInTheDocument();
      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2025"));
      await expect(canvas.getByTestId("industry-sp-month-2025-06")).toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const TappingADaysTapToLoadCountLoadsItWithoutExpanding: Story = {
  parameters: { msw: { handlers: perYearHandlers } },
  decorators: [withQueryParams("minDate=2024-01-01&maxDate=2025-12-31")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");
      }, { timeout: 10000 });
      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2024"));
      await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2024-06"));

      // 2 June has races but nobody has looked at it — the mount chain loads
      // only the month's first day.
      await expect(canvas.getByTestId("industry-sp-day-count-2024-06-02")).toHaveTextContent("Tap to load");

      // Reported live via screenshot: "when I tap on day it still expands. It
      // should load pnl but not expand."
      await userEvent.click(canvas.getByTestId("industry-sp-day-load-2024-06-02"));

      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-day-count-2024-06-02")).toHaveTextContent("2 races");
      }, { timeout: 10000 });
      // Its P&L arrived; its meetings did not.
      await expect(canvas.getByTestId("industry-sp-day-pnl-2024-06-02")).toBeInTheDocument();
      await expect(canvas.queryByTestId("industry-sp-meeting-Ascot|2024-06-02")).not.toBeInTheDocument();

      // Tapping anywhere other than the count still expands, as it always did.
      await expect(canvas.queryByTestId("industry-sp-day-load-2024-06-02")).not.toBeInTheDocument();
      await userEvent.click(canvas.getByTestId("industry-sp-day-toggle-2024-06-02"));
      await expect(canvas.getByTestId("industry-sp-meeting-Ascot|2024-06-02")).toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

// 25 races in June 2024 and 3 in August, deliberately sized so the year's own
// probe (one page, PAGE_SIZE=20) sees June only: August stays a genuinely
// unprobed "Tap to load" month with real data behind it, which is the exact
// state the month-level test below needs. Distinct raceId range (660000+) per
// the by-raceId-collision lesson noted elsewhere in this file.
// August's three races deliberately share one day: a month only ever loads
// its first day with data (see loadMonthDefaultDay), so this is what makes
// the count it lands on a whole, unambiguous "3 races loaded".
function twoMonthRace(month: string, index: number, idOffset: number, fixedDay?: number) {
  const day = fixedDay ?? (index % 25) + 1;
  const date = `2024-${month}-${String(day).padStart(2, "0")}`;
  return {
    raceId: 660000 + idOffset + index,
    meetingId: `Ascot|${date}`,
    meetingName: `Ascot — ${day}/${month} 2024`,
    course: "Ascot",
    countryCode: "GB",
    raceTime: `${date}T13:00:00`,
    raceName: "Ascot 13:00",
    raceType: "Flat",
    ran: 1,
    runners: [
      { id: 66100 + idOffset + index, name: `Runner ${month}-${index}`, num: 1, draw: null, status: "LOSER", sortPriority: 1, isp: 5, ispFraction: "4/1", isFavourite: false },
    ],
  };
}

const TWO_MONTH_RACES = [
  ...Array.from({ length: 25 }, (_, i) => twoMonthRace("06", i, 0)),
  ...Array.from({ length: 3 }, (_, i) => twoMonthRace("08", i, 1000, 5)),
];

const twoMonthHandlers = [
  http.get(`${BASE}/api/industry-sp`, ({ request }) => {
    return HttpResponse.json(ispPage(TWO_MONTH_RACES, request));
  }),
];

export const TappingAMonthsTapToLoadCountLoadsItWithoutExpanding: Story = {
  parameters: { msw: { handlers: twoMonthHandlers } },
  decorators: [withQueryParams("minDate=2024-01-01&maxDate=2024-12-31")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("races");
      }, { timeout: 10000 });

      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2024"));
      // August is past the year probe's first page, so it's still unprobed —
      // the screenshotted state, with real races behind it.
      await expect(canvas.getByTestId("industry-sp-month-count-2024-08")).toHaveTextContent("Tap to load");

      await userEvent.click(canvas.getByTestId("industry-sp-month-load-2024-08"));

      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-month-count-2024-08")).toHaveTextContent("3 races");
      }, { timeout: 10000 });

      // The whole point: a real count, with no wall of day rows under it.
      await expect(canvas.queryByTestId("industry-sp-day-2024-08-05")).not.toBeInTheDocument();

      // And the row toggle still opens it, now showing days that know what
      // they hold rather than a month of unloaded placeholders.
      await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2024-08"));
      await expect(canvas.getByTestId("industry-sp-day-2024-08-05")).toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

// 45 races all on the SAME day (1 June 2024), so a single day genuinely spans
// three pages at PAGE_SIZE=20 (20/20/5) and day-level "Load more" is actually
// exercised. The per-year fixture above can't do this — it spreads its races
// across 27 separate days, so no one day has more than 2.
const BUSY_DAY_RACES = Array.from({ length: 45 }, (_, index) => ({
  raceId: 640000 + index,
  meetingId: "Ascot|2024-06-01",
  meetingName: "Ascot — 1 June 2024",
  course: "Ascot",
  countryCode: "GB",
  raceTime: `2024-06-01T13:00:00`,
  raceName: `Ascot race ${index + 1}`,
  raceType: "Flat",
  ran: 1,
  runners: [
    {
      id: 64100 + index,
      name: `Busy Day Runner ${index}`,
      num: 1,
      draw: null,
      status: "LOSER",
      sortPriority: 1,
      isp: 5,
      ispFraction: "4/1",
      isFavourite: false,
    },
  ],
}));

let busyDayRequests: { page: number; subMinDate: string | null; subMaxDate: string | null }[] = [];

const busyDayHandlers = [
  http.get(`${BASE}/api/industry-sp`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const subMinDate = url.searchParams.get("subMinDate");
    const subMaxDate = url.searchParams.get("subMaxDate");
    busyDayRequests.push({ page, subMinDate, subMaxDate });
    return HttpResponse.json(ispPage(BUSY_DAY_RACES, request));
  }),
];

export const DayLoadMorePaginatesThatDayAlone: Story = {
  parameters: { msw: { handlers: busyDayHandlers } },
  decorators: [withQueryParams("minDate=2024-06-01&maxDate=2024-06-30")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");
      // The mount chain lands on 1 June and pulls its first page — 20 of the
      // day's 45. The header says 45 from that very first response, because a
      // count is the window's own total now, not a tally of fetched rows
      // (isp-races-rollup-mismatch); what "Load more" grows is the rows.
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");
      }, { timeout: 10000 });

      await userEvent.click(canvas.getByTestId("industry-sp-year-toggle-2024"));
      await userEvent.click(canvas.getByTestId("industry-sp-month-toggle-2024-06"));
      await waitFor(() => expect(canvas.getByTestId("industry-sp-day-2024-06-01")).toBeInTheDocument(), {
        timeout: 10000,
      });
      // The day's "Load more" only exists while the day itself is open —
      // paging more races into a collapsed row would be invisible work.
      await userEvent.click(canvas.getByTestId("industry-sp-day-toggle-2024-06-01"));

      // Rendered race rows are what pagination actually moves, so they are
      // what this story counts — which needs the day's one meeting open too,
      // since races live under it.
      await userEvent.click(await canvas.findByTestId("industry-sp-meeting-toggle-Ascot|2024-06-01"));
      const raceRows = () => canvasElement.querySelectorAll('[data-testid^="industry-sp-race-6"]').length;
      await waitFor(() => expect(raceRows()).toBe(20), { timeout: 10000 });

      busyDayRequests = [];
      await userEvent.click(canvas.getByTestId("industry-sp-day-load-more-2024-06-01"));
      await waitFor(() => expect(raceRows()).toBe(40), { timeout: 10000 });

      // Page 2, still scoped to that one day — never widened to the month.
      expect(busyDayRequests).toHaveLength(1);
      expect(busyDayRequests[0].page).toBe(2);
      expect(busyDayRequests[0].subMinDate).toBe("2024-06-01");
      expect(busyDayRequests[0].subMaxDate).toBe("2024-06-01");

      // One more page (5 remaining of 45) exhausts the day — the button
      // disappears once state.races.length >= state.total.
      await userEvent.click(canvas.getByTestId("industry-sp-day-load-more-2024-06-01"));
      await waitFor(() => expect(raceRows()).toBe(45), { timeout: 10000 });
      // Every row the header promised is now on screen, and the button is
      // gone once state.races.length >= state.total.
      await expect(canvas.getByTestId("industry-sp-day-count-2024-06-01")).toHaveTextContent("45 races");
      await expect(canvas.queryByTestId("industry-sp-day-load-more-2024-06-01")).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const ExpandAllLoadsEveryCollapsedYearIndependently: Story = {
  parameters: { msw: { handlers: perYearHandlers } },
  decorators: [withQueryParams("minDate=2024-01-01&maxDate=2025-12-31")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-sp-list");
      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2024")).toHaveTextContent("45 races");
      }, { timeout: 10000 });
      const btn = canvas.getByTestId("industry-sp-collapse-all-toggle");
      // Nothing expands on load, so the tree is already fully collapsed —
      // the first tap is the Expand All this story is about, with no need
      // to collapse first.
      await expect(btn).toHaveTextContent("Expand All");
      perYearRequests = [];
      // 2025 was never tapped before this — Expand All must load it (not
      // just re-reveal 2024's already-loaded data), same as every other
      // not-yet-loaded year, each starting from its own year probe.
      await userEvent.click(btn); // -> Expand All

      await waitFor(() => {
        expect(canvas.getByTestId("industry-sp-year-count-2025")).toHaveTextContent("3 races");
      }, { timeout: 15000 });
      // 2024 was already probed on mount — Expand All doesn't re-probe the
      // year (initializedYears makes that a no-op), only years with no
      // state yet get their own chain kicked off.
      expect(perYearRequests.filter(r => r.subMinDate === "2024-01-01")).toHaveLength(0);
      expect(perYearRequests.filter(r => r.subMinDate === "2025-01-01")).toHaveLength(1);
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
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
