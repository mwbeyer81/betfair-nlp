import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, screen, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { AllRunnersScreen } from "./AllRunnersScreen";

const BASE = "http://localhost:3000";

const MOCK_RACES: Array<{
  marketId: string;
  marketTime: string;
  marketType: string;
  marketName: string;
  countryCode: string;
  eventId: string;
  eventName: string;
  runners: Array<{ id: number; name: string; status: string; sortPriority: number; bsp: number }>;
}> = [
  {
    marketId: "1.238923739",
    marketTime: "2025-02-01T13:15:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:15",
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    countryCode: "IE",
    runners: [
      { id: 21001, name: "Galopin Des Champs", status: "WINNER", sortPriority: 1, bsp: 1.95 },
      { id: 21002, name: "Meetingofthewaters", status: "LOSER", sortPriority: 2, bsp: 5.5 },
    ],
  },
  {
    marketId: "1.238923745",
    marketTime: "2025-02-01T13:50:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:50",
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    countryCode: "IE",
    runners: [
      { id: 22001, name: "State Man", status: "WINNER", sortPriority: 1, bsp: 1.4 },
      { id: 22002, name: "Brighterdaysahead", status: "LOSER", sortPriority: 2, bsp: 6.0 },
    ],
  },
];

const MOCK_PRICE_UPDATES = [
  { _id: "pu1", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs", lastTradedPrice: 1.9, timestamp: "2025-02-01T13:10:00.000Z", changeId: "c1", eventId: "33988522", eventName: "Leopardstown 1st Feb" },
  { _id: "pu2", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs", lastTradedPrice: 1.95, timestamp: "2025-02-01T13:05:00.000Z", changeId: "c2", eventId: "33988522", eventName: "Leopardstown 1st Feb" },
];

const TOTAL_RUNNERS_IN_DB = MOCK_RACES.reduce((s, r) => s + r.runners.length, 0); // 4

const filterBoundsHandler = http.get(`${BASE}/api/runners/filter-bounds`, () =>
  HttpResponse.json({ success: true, data: { maxRunnersPerRace: 29, maxBsp: 1000, minBsp: 1.1 } })
);

const defaultHandlers = [
  http.get(`${BASE}/api/runners`, () =>
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
  http.get(`${BASE}/api/stats`, () =>
    HttpResponse.json({ success: true, data: { totalRaces: MOCK_RACES.length, totalRunners: TOTAL_RUNNERS_IN_DB } })
  ),
  http.get(`${BASE}/api/runners/countries`, () =>
    HttpResponse.json({ success: true, data: ["GB", "IE"] })
  ),
  filterBoundsHandler,
  http.get(`${BASE}/api/runners/pnl-stats`, () =>
    HttpResponse.json({ success: true, data: { staked: 3.97, returns: 5.55, pnl: 1.58 } })
  ),
  http.get(`${BASE}/api/events/:eventId/runners/:runnerId/price-updates`, () =>
    HttpResponse.json({ success: true, data: MOCK_PRICE_UPDATES, count: MOCK_PRICE_UPDATES.length })
  ),
];

const meta: Meta<typeof AllRunnersScreen> = {
  title: "Components/AllRunnersScreen",
  component: AllRunnersScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    onNavigateToEvents: fn(),
    onNavigateToRunner: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const countriesHandler = http.get(`${BASE}/api/runners/countries`, () =>
  HttpResponse.json({ success: true, data: ["GB", "IE"] })
);

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
        http.get(`${BASE}/api/stats`, () =>
          HttpResponse.json({ success: true, data: { totalRaces: 0, totalRunners: 0 } })
        ),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/runners`, () => HttpResponse.error()), countriesHandler, filterBoundsHandler] },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, () =>
          HttpResponse.json({ success: true, data: [], count: 0 })
        ),
        http.get(`${BASE}/api/stats`, () =>
          HttpResponse.json({ success: true, data: { totalRaces: 0, totalRunners: 0 } })
        ),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("all-runners-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-list")).resolves.toBeInTheDocument();

    await expect(canvas.findByText("All Runners")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("4/4 runners · 2/2 races")).resolves.toBeInTheDocument();
  },
};

export const EventSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("all-runners-event-33988522")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Leopardstown 1st Feb")).resolves.toBeInTheDocument();
  },
};

export const RaceAndRunnerRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("all-runners-race-1.238923739")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
  },
};

export const EventsButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const btn = canvas.getByTestId("all-runners-screen-events-button");
    await expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    await expect(args.onNavigateToEvents).toHaveBeenCalledTimes(1);
  },
};

export const BspDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // WIN market runners have bsp; verify they appear with SP badge
    const bspRunners = MOCK_RACES.filter(r => r.marketType === "WIN").flatMap(r => r.runners);
    for (const runner of bspRunners) {
      const bspEl = await canvas.findByTestId(`all-runner-bsp-${runner.id}`);
      await expect(bspEl).toBeInTheDocument();
      await expect(bspEl).toHaveTextContent(`SP ${runner.bsp}`);
    }
  },
};

export const PnlBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Stake to win £1 each: staked ≈ £3.97, returns ≈ £5.55, P&L ≈ +£1.58
    const bar = await canvas.findByTestId("all-runners-pnl-bar");
    await expect(bar).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-pnl")).toHaveTextContent("+£1.58");
    await expect(bar).toHaveTextContent("£3.97");
    await expect(bar).toHaveTextContent("£5.55");
  },
};

export const PerRunnerPnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    // Galopin Des Champs: WINNER at SP 1.95, stake £1.05 → +£1.00
    await expect(await canvas.findByTestId("all-runner-pnl-21001")).toHaveTextContent("+£1.00");
    await expect(canvas.getByTestId("all-runner-stake-21001")).toHaveTextContent("Bet £1.05");
    // Meetingofthewaters: LOSER at SP 5.5, stake £0.22 → -£0.22
    await expect(canvas.getByTestId("all-runner-pnl-21002")).toHaveTextContent("-£0.22");
    await expect(canvas.getByTestId("all-runner-stake-21002")).toHaveTextContent("Bet £0.22");
    // State Man: WINNER at SP 1.4, stake £2.50 → +£1.00
    await expect(canvas.getByTestId("all-runner-pnl-22001")).toHaveTextContent("+£1.00");
    await expect(canvas.getByTestId("all-runner-stake-22001")).toHaveTextContent("Bet £2.50");
    // Brighterdaysahead: LOSER at SP 6.0, stake £0.20 → -£0.20
    await expect(canvas.getByTestId("all-runner-pnl-22002")).toHaveTextContent("-£0.20");
    await expect(canvas.getByTestId("all-runner-stake-22002")).toHaveTextContent("Bet £0.20");
  },
};

export const RunnerClick: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Wait for runners to load
    await canvas.findByTestId("all-runner-item-21001");

    // Row has a chevron indicating it's tappable
    const row = canvas.getByTestId("all-runner-item-21001");
    await expect(row).toHaveTextContent("›");

    // Click Galopin Des Champs → fires onNavigateToRunner
    await userEvent.click(row);
    await expect(args.onNavigateToRunner).toHaveBeenCalledWith(
      "33988522",
      21001,
      "Galopin Des Champs"
    );
  },
};

export const RunnersInRangeFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");
    await expect(canvas.getByTestId("all-runners-min-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-max-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-in-sp-label")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-in-sp-label")).toHaveTextContent("# in SP");
  },
};

export const RunnersInRangeFilterHides: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");
    const maxInput = canvas.getByTestId("all-runners-max-rir-value");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "1");
    await userEvent.click(canvas.getByTestId("all-runners-filter-apply"));
    await expect(canvas.findByText("No runners found.")).resolves.toBeInTheDocument();
  },
};

export const RunnersInRangeFilterShows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");
    const minInput = canvas.getByTestId("all-runners-min-rir-value");
    await userEvent.clear(minInput);
    await userEvent.type(minInput, "2");
    const maxInput = canvas.getByTestId("all-runners-max-rir-value");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "2");
    await userEvent.click(canvas.getByTestId("all-runners-filter-apply"));
    await expect(canvas.findByTestId("all-runners-race-1.238923739")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-race-1.238923745")).resolves.toBeInTheDocument();
  },
};

let capturedBspParams: { minBsp: string | null; maxBsp: string | null } = { minBsp: null, maxBsp: null };

export const BspFilterParamsPassedToApi: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, ({ request }) => {
          const url = new URL(request.url);
          capturedBspParams = {
            minBsp: url.searchParams.get("minBsp"),
            maxBsp: url.searchParams.get("maxBsp"),
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
        http.get(`${BASE}/api/runners/countries`, () =>
          HttpResponse.json({ success: true, data: ["GB", "IE"] })
        ),
        filterBoundsHandler,
        http.get(`${BASE}/api/runners/pnl-stats`, () =>
          HttpResponse.json({ success: true, data: { staked: 3.97, returns: 5.55, pnl: 1.58 } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const minBspInput = canvas.getByTestId("all-runners-min-bsp");
    const maxBspInput = canvas.getByTestId("all-runners-max-bsp");
    await userEvent.clear(minBspInput);
    await userEvent.type(minBspInput, "5");
    await userEvent.clear(maxBspInput);
    await userEvent.type(maxBspInput, "20");

    capturedBspParams = { minBsp: null, maxBsp: null };
    await userEvent.click(canvas.getByTestId("all-runners-filter-apply"));

    await waitFor(() => {
      expect(capturedBspParams.minBsp).toBe("5");
      expect(capturedBspParams.maxBsp).toBe("20");
    }, { timeout: 3000 });
  },
};

export const BspFilterEmptyFromServer: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, ({ request }) => {
          const url = new URL(request.url);
          const minBsp = url.searchParams.get("minBsp");
          // Return empty data when a narrow BSP filter is applied — simulates server-side BSP filtering
          const isEmpty = minBsp !== null && parseFloat(minBsp) > 1;
          return HttpResponse.json({
            success: true,
            data: isEmpty ? [] : MOCK_RACES,
            count: isEmpty ? 0 : MOCK_RACES.length,
            total: isEmpty ? 0 : MOCK_RACES.length,
            page: 1,
            limit: 20,
            totalPages: isEmpty ? 1 : 1,
            totalRunners: isEmpty ? 0 : TOTAL_RUNNERS_IN_DB,
            pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
          });
        }),
        http.get(`${BASE}/api/runners/countries`, () =>
          HttpResponse.json({ success: true, data: ["GB", "IE"] })
        ),
        filterBoundsHandler,
        http.get(`${BASE}/api/runners/pnl-stats`, () =>
          HttpResponse.json({ success: true, data: { staked: 0, returns: 0, pnl: 0 } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const minBspInput = canvas.getByTestId("all-runners-min-bsp");
    await userEvent.clear(minBspInput);
    await userEvent.type(minBspInput, "500");
    await userEvent.click(canvas.getByTestId("all-runners-filter-apply"));

    // Server returns 0 results — "No runners found" should show but NO "Load more" button
    await expect(canvas.findByText("No runners found.")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runners-load-more")).not.toBeInTheDocument();
  },
};

export const ExportModalVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const exportBtn = await canvas.findByTestId("all-runners-export-btn");
    await expect(exportBtn).toBeInTheDocument();
    await userEvent.click(exportBtn);

    // Modal renders via RN portal outside canvasElement — use screen to query full document
    await expect(await screen.findByTestId("all-runners-export-modal")).toBeInTheDocument();
    await expect(screen.getByTestId("all-runners-export-csv")).toBeInTheDocument();
    await expect(screen.getByTestId("all-runners-export-xlsx")).toBeInTheDocument();
  },
};

export const ExportModalDismisses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    await userEvent.click(await canvas.findByTestId("all-runners-export-btn"));
    await screen.findByTestId("all-runners-export-modal");

    await userEvent.click(screen.getByTestId("all-runners-export-cancel"));
    // Wait for fade animation to complete before asserting modal is gone
    await waitFor(() => expect(screen.queryByTestId("all-runners-export-modal")).not.toBeInTheDocument(), { timeout: 2000 });
  },
};

export const SortToggleVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const btn = canvas.getByTestId("all-runners-sort-toggle");
    await expect(btn).toBeInTheDocument();
    await expect(btn).toHaveTextContent("First → Last");
  },
};

export const SortToggleSwitchesToDesc: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const btn = canvas.getByTestId("all-runners-sort-toggle");
    await expect(btn).toHaveTextContent("First → Last");
    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("Last → First");
  },
};

export const SortToggleSwitchesBackToAsc: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const btn = canvas.getByTestId("all-runners-sort-toggle");
    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("Last → First");
    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("First → Last");
  },
};

let capturedSortParam: string | null = null;

export const SortToggleSendsDescParam: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, ({ request }) => {
          const url = new URL(request.url);
          capturedSortParam = url.searchParams.get("sort");
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
        http.get(`${BASE}/api/stats`, () =>
          HttpResponse.json({ success: true, data: { totalRaces: MOCK_RACES.length, totalRunners: TOTAL_RUNNERS_IN_DB } })
        ),
        http.get(`${BASE}/api/runners/countries`, () =>
          HttpResponse.json({ success: true, data: ["GB", "IE"] })
        ),
        filterBoundsHandler,
        http.get(`${BASE}/api/runners/pnl-stats`, () =>
          HttpResponse.json({ success: true, data: { staked: 3.97, returns: 5.55, pnl: 1.58 } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    capturedSortParam = null;
    const btn = canvas.getByTestId("all-runners-sort-toggle");
    await userEvent.click(btn);

    await waitFor(() => expect(capturedSortParam).toBe("desc"), { timeout: 3000 });
  },
};

// ── Responsive stories ──────────────────────────────────────────────────────

export const MobileHeaderButtonsVisible: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    const sortBtn = canvas.getByTestId("all-runners-sort-toggle");
    const eventsBtn = canvas.getByTestId("all-runners-screen-events-button");

    await expect(sortBtn).toBeInTheDocument();
    await expect(eventsBtn).toBeInTheDocument();

    const sortRect = sortBtn.getBoundingClientRect();
    const eventsRect = eventsBtn.getBoundingClientRect();
    await expect(sortRect.right).toBeLessThanOrEqual(window.innerWidth + 1);
    await expect(eventsRect.right).toBeLessThanOrEqual(window.innerWidth + 1);
  },
};

export const MobileFilterBarScrollable: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    // Filter bar and apply button must be in the DOM (scrollable, not clipped away)
    await expect(canvas.getByTestId("all-runners-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-filter-apply")).toBeInTheDocument();
  },
};

export const MobileExportModalFitsViewport: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-list");

    await userEvent.click(await canvas.findByTestId("all-runners-export-btn"));
    const modal = await screen.findByTestId("all-runners-export-modal");
    await expect(modal).toBeInTheDocument();

    const rect = modal.getBoundingClientRect();
    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1);
  },
};

export const MobilePnlBarWraps: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("all-runners-pnl-bar");

    const bar = canvas.getByTestId("all-runners-pnl-bar");
    const pnl = canvas.getByTestId("all-runners-pnl");

    await expect(bar).toBeInTheDocument();
    await expect(pnl).toBeInTheDocument();

    // PnL value must not overflow the bar horizontally
    const barRect = bar.getBoundingClientRect();
    const pnlRect = pnl.getBoundingClientRect();
    await expect(pnlRect.right).toBeLessThanOrEqual(barRect.right + 2);
  },
};
