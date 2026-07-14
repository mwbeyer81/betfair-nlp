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
  runners: Array<{ id: number; name: string; num: number | null; draw: number | null; status: string; sortPriority: number; isp: number; isFavourite: boolean }>;
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
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, isFavourite: true },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, isFavourite: false },
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
      { id: 22001, name: "State Man", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.4, isFavourite: true },
      { id: 22002, name: "Brighterdaysahead", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 6.0, isFavourite: false },
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

export const IspDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const runners = MOCK_RACES.flatMap(r => r.runners);
    for (const runner of runners) {
      const ispEl = await canvas.findByTestId(`industry-sp-isp-${runner.id}`);
      await expect(ispEl).toBeInTheDocument();
      await expect(ispEl).toHaveTextContent(`ISP ${runner.isp}`);
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

export const InIspBoundDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    const bound = await canvas.findByTestId("industry-sp-max-rir-bound");
    await expect(bound).toBeInTheDocument();
    await expect(bound).toHaveTextContent("of 29");
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
