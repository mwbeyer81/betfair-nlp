import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { AllRunnersScreen } from "./AllRunnersScreen";

const BASE = "http://localhost:3000";

const MOCK_RACES: Array<{
  marketId: string;
  marketTime: string;
  marketType: string;
  marketName: string;
  eventId: string;
  eventName: string;
  runners: Array<{ id: number; name: string; status: string; sortPriority: number; bsp?: number }>;
}> = [
  {
    marketId: "1.237066150",
    marketTime: "2025-01-01T14:01:00.000Z",
    marketType: "ANTEPOST_WIN",
    marketName: "Cheltenham Chase",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    runners: [
      { id: 26817268, name: "Gemirande", status: "LOSER", sortPriority: 1 },
      { id: 39281327, name: "Springwell Bay", status: "WINNER", sortPriority: 2 },
      { id: 43581487, name: "Madara", status: "LOSER", sortPriority: 3 },
    ],
  },
  {
    marketId: "1.238923739",
    marketTime: "2025-02-01T13:15:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:15",
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
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
      totalRunners: MOCK_RACES.reduce((s, r) => s + r.runners.length, 0),
    })
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

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0, totalRunners: 0 });
        }),
      ],
    },
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/runners`, () => HttpResponse.error())] },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, () =>
          HttpResponse.json({ success: true, data: [], count: 0, totalRunners: 0 })
        ),
      ],
    },
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("all-runners-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-list")).resolves.toBeInTheDocument();

    // Default view: BSP only — 4 runners across 2 Leopardstown races
    await expect(canvas.findByText("All Runners")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("4 runners · 2/3 races")).resolves.toBeInTheDocument();
  },
};

export const EventSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Cheltenham runners have no BSP so the section is hidden by default
    await expect(canvas.queryByTestId("all-runners-event-33858191")).not.toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-event-33988522")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Leopardstown 1st Feb")).resolves.toBeInTheDocument();
  },
};

export const RaceAndRunnerRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Cheltenham race (no BSP runners) is hidden by default
    await expect(canvas.queryByTestId("all-runners-race-1.237066150")).not.toBeInTheDocument();
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
    // Cheltenham runner (no BSP) → no stake or P&L
    await expect(canvas.queryByTestId("all-runner-pnl-26817268")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runner-stake-26817268")).not.toBeInTheDocument();
  },
};

export const ShowAllToggle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Default: Cheltenham hidden, button reads "Show all"
    await expect(canvas.findByTestId("all-runners-list")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runners-event-33858191")).not.toBeInTheDocument();
    const toggle = canvas.getByTestId("all-runners-bsp-toggle");
    await expect(toggle).toHaveTextContent("Show all");

    // After click: all runners visible, button reads "BSP only"
    await userEvent.click(toggle);
    await expect(canvas.findByTestId("all-runners-event-33858191")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Cheltenham 1st Jan")).resolves.toBeInTheDocument();
    await expect(toggle).toHaveTextContent("BSP only");
  },
};

export const NoBspWhenAbsent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Cheltenham ANTEPOST_WIN runners have no bsp
    const cheltenhamRunners = MOCK_RACES.filter(r => r.eventId === "33858191").flatMap(r => r.runners);
    for (const runner of cheltenhamRunners) {
      await expect(canvas.queryByTestId(`all-runner-bsp-${runner.id}`)).not.toBeInTheDocument();
    }
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
