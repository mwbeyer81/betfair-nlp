import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { IndustrySpScreen } from "./IndustrySpScreen";

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
  runners: Array<{ id: number; name: string; num: number | null; draw: number | null; status: string; sortPriority: number; isp: number; ispFraction: string; isFavourite: boolean }>;
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
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false },
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

const filterBoundsHandler = http.get(`${BASE}/api/industry-sp/filter-bounds`, () =>
  HttpResponse.json({ success: true, data: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 } })
);

const countriesHandler = http.get(`${BASE}/api/industry-sp/countries`, () =>
  HttpResponse.json({ success: true, data: ["GB", "IE"] })
);

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
  countriesHandler,
  filterBoundsHandler,
  http.get(`${BASE}/api/industry-sp/pnl-stats`, () =>
    HttpResponse.json({ success: true, data: { staked: 3.97, returns: 5.55, pnl: 1.58 } })
  ),
];

const meta: Meta<typeof IndustrySpScreen> = {
  title: "Components/IndustrySpScreen",
  component: IndustrySpScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    onNavigateToEvents: fn(),
    onNavigateToMeeting: fn(),
    onNavigateToRace: fn(),
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
        countriesHandler,
        filterBoundsHandler,
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
    msw: { handlers: [http.get(`${BASE}/api/industry-sp`, () => HttpResponse.error()), countriesHandler, filterBoundsHandler] },
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
        countriesHandler,
        filterBoundsHandler,
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

    await expect(canvas.getByTestId("industry-sp-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-list")).resolves.toBeInTheDocument();

    // Note: react-native-paper's Appbar.Content does not render its `subtitle`
    // prop on web, so the "N/N runners · N/N races" text is set but never in
    // the DOM — assert against content that actually renders instead.
    await expect(canvas.findByText("Industry Starting Price")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-pnl-count")).resolves.toHaveTextContent("Horses 4");
  },
};

export const MeetingSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("industry-sp-meeting-Leopardstown|2026-02-01")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Leopardstown — 1 February 2026")).resolves.toBeInTheDocument();
  },
};

export const RaceAndRunnerRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("industry-sp-race-914592")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
  },
};

export const EventsButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const btn = canvas.getByTestId("industry-sp-screen-events-button");
    await expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    await expect(args.onNavigateToEvents).toHaveBeenCalledTimes(1);
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

export const FiltersToggleHidesAndShowsFilterBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-filters-toggle")).toHaveTextContent("Hide filters");

    await userEvent.click(canvas.getByTestId("industry-sp-filters-toggle"));
    await expect(canvas.queryByTestId("industry-sp-filter-bar")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-filters-toggle")).toHaveTextContent("Show filters");

    await userEvent.click(canvas.getByTestId("industry-sp-filters-toggle"));
    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
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

export const PnlBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const bar = await canvas.findByTestId("industry-sp-pnl-bar");
    await expect(bar).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-pnl")).toHaveTextContent("+£1.58");
    await expect(bar).toHaveTextContent("£3.97");
    await expect(bar).toHaveTextContent("£5.55");
    await expect(canvas.getByTestId("industry-sp-pnl-races")).toHaveTextContent(`Races ${MOCK_RACES.length}`);
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

export const RunnersInRangeFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-min-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-max-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-in-isp-label")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-in-isp-label")).toHaveTextContent("# in ISP");
  },
};

export const RunnersInRangeFilterHides: Story = {
  parameters: {
    msw: {
      // Real filtering by maxInIspRange, mirroring server behavior — the flat
      // defaultHandlers ignore query params entirely, which isn't enough here.
      handlers: [
        http.get(`${BASE}/api/industry-sp`, ({ request }) => {
          const url = new URL(request.url);
          const maxInIspRange = parseInt(url.searchParams.get("maxInIspRange") ?? "30");
          const data = maxInIspRange >= 2 ? MOCK_RACES : [];
          return HttpResponse.json({
            success: true,
            data,
            count: data.length,
            total: data.length,
            page: 1,
            limit: 20,
            totalPages: 1,
            totalRunners: data.length > 0 ? TOTAL_RUNNERS_IN_DB : 0,
            pnlStats: data.length > 0 ? { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } : { staked: 0, returns: 0, pnl: 0, count: 0 },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    const maxInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "1");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await expect(canvas.findByText("No races found.")).resolves.toBeInTheDocument();
  },
};

let capturedIspParams: { minIsp: string | null; maxIsp: string | null } = { minIsp: null, maxIsp: null };

export const RunnersHeadingGroupedWithInputs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const runnersLabel = canvas.getByText("Runners");
    const minInput = canvas.getByTestId("industry-sp-min-value");
    const maxInput = canvas.getByTestId("industry-sp-max-value");

    // The "Runners" heading must live in the same row container as its own
    // Min/Max inputs, not float off as an unrelated sibling elsewhere in the
    // filter bar (regression: it used to wrap onto a different line).
    await expect(runnersLabel.parentElement).toBe(minInput.parentElement);
    await expect(runnersLabel.parentElement).toBe(maxInput.parentElement);
  },
};

export const TooltipTogglesShowAndHideExplanation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    await expect(canvas.queryByTestId("industry-sp-tooltip-text-runners")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-runners")).toHaveTextContent(
      "Only show races with this many total runners taking part."
    );

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-runners")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-isp"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-isp")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-race"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-race")).toBeInTheDocument();
    // Opening a new tooltip closes the previous one — only one shown at a time.
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-isp")).not.toBeInTheDocument();
  },
};

export const TooltipDoesNotShiftFilterLayout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const applyButton = canvas.getByTestId("industry-sp-filter-apply");
    const raceLabelBefore = canvas.getByTestId("industry-sp-from-row").getBoundingClientRect().top;
    const applyBefore = applyButton.getBoundingClientRect().top;

    // Opening a tooltip must overlay the filter bar, not push rows below it
    // down the page — regression: it used to occupy a full-width flow line.
    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-runners")).toBeInTheDocument();

    const raceLabelAfter = canvas.getByTestId("industry-sp-from-row").getBoundingClientRect().top;
    const applyAfter = applyButton.getBoundingClientRect().top;

    await expect(raceLabelAfter).toBe(raceLabelBefore);
    await expect(applyAfter).toBe(applyBefore);
  },
};

export const ApplyAndResetShareTheSameLine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const applyBox = canvas.getByTestId("industry-sp-filter-apply").getBoundingClientRect();
    const resetBox = canvas.getByTestId("industry-sp-filter-reset").getBoundingClientRect();

    // Regression: Apply used to ride along the end of the Race row while
    // Reset wrapped alone onto its own line below.
    await expect(resetBox.top).toBe(applyBox.top);
  },
};

export const TooltipToggleHasAdequateTapTarget: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Real, rendered box size — on web, RN's hitSlop prop is a no-op, so the
    // actual tap target is whatever the element itself renders at. Regression:
    // it used to be an 18x18 circle that was hard to hit on a phone.
    for (const key of ["isp", "runners", "inIsp", "race"]) {
      const toggle = canvas.getByTestId(`industry-sp-tooltip-toggle-${key}`);
      const box = toggle.getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(24);
      await expect(box.height).toBeGreaterThanOrEqual(24);
    }
  },
};

export const IspFilterParamsPassedToApi: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, ({ request }) => {
          const url = new URL(request.url);
          capturedIspParams = {
            minIsp: url.searchParams.get("minIsp"),
            maxIsp: url.searchParams.get("maxIsp"),
          };
          return HttpResponse.json({
            success: true,
            data: MOCK_RACES,
            count: MOCK_RACES.length,
            total: MOCK_RACES.length,
            page: 1,
            limit: 20,
            totalPages: 1,
            totalRunners: TOTAL_RUNNERS_IN_DB,
            pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const minInput = canvas.getByTestId("industry-sp-min-isp");
    const maxInput = canvas.getByTestId("industry-sp-max-isp");
    await userEvent.clear(minInput);
    await userEvent.type(minInput, "5");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "20");

    capturedIspParams = { minIsp: null, maxIsp: null };
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(capturedIspParams.minIsp).toBe("5");
      expect(capturedIspParams.maxIsp).toBe("20");
    }, { timeout: 3000 });
  },
};

export const IspInputsAcceptDecimals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const minInput = canvas.getByTestId("industry-sp-min-isp");
    const maxInput = canvas.getByTestId("industry-sp-max-isp");

    // "decimal" (not "numeric") is what puts a decimal point on the mobile
    // keyboard — regression: "numeric" renders a phone-style pad with no ".".
    await expect(minInput).toHaveAttribute("inputmode", "decimal");
    await expect(maxInput).toHaveAttribute("inputmode", "decimal");

    await userEvent.clear(minInput);
    await userEvent.type(minInput, "4.5");
    await expect(minInput).toHaveValue("4.5");
  },
};

export const ApplyingFilterUpdatesUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const maxRirInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxRirInput);
    await userEvent.type(maxRirInput, "5");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(window.location.search).toContain("maxInIspRange=5");
    }, { timeout: 3000 });
  },
};

export const ResetButtonRestoresDefaultsAndClearsUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const maxRirInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxRirInput);
    await userEvent.type(maxRirInput, "5");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await waitFor(() => {
      expect(window.location.search).toContain("maxInIspRange=5");
    }, { timeout: 3000 });

    await userEvent.click(canvas.getByTestId("industry-sp-filter-reset"));

    await waitFor(() => {
      expect((canvas.getByTestId("industry-sp-max-rir-value") as HTMLInputElement).value).toBe("30");
      expect(window.location.search).not.toContain("maxInIspRange");
    }, { timeout: 3000 });
  },
};

export const InIspBoundDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    const bound = await canvas.findByTestId("industry-sp-max-rir-bound");
    await expect(bound).toBeInTheDocument();
    await expect(bound).toHaveTextContent("/29");
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
  },
};
