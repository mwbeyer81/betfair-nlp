import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { AllRunnersPanel } from "./AllRunnersPanel";
import { RaceWithEvent } from "../services/chatApi";

const BASE = "http://localhost:3000";

const MOCK_RACES: RaceWithEvent[] = [
  {
    marketId: "1.237066150",
    marketTime: "2025-01-01T14:01:00.000Z",
    marketType: "ANTEPOST_WIN",
    marketName: "Cheltenham Chase",
    countryCode: "GB",
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
    countryCode: "IE",
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
    countryCode: "IE",
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    runners: [
      { id: 22001, name: "State Man", status: "WINNER", sortPriority: 1, bsp: 1.4 },
      { id: 22002, name: "Brighterdaysahead", status: "LOSER", sortPriority: 2, bsp: 6.0 },
    ],
  },
];

const MOCK_PNL = { staked: 3.97, returns: 5.55, pnl: 1.58 };

const pnlHandler = http.get(`${BASE}/api/runners/pnl-stats`, () =>
  HttpResponse.json({ success: true, data: MOCK_PNL })
);

const meta: Meta<typeof AllRunnersPanel> = {
  title: "Components/AllRunnersPanel",
  component: AllRunnersPanel,
  parameters: { layout: "centered", msw: { handlers: [pnlHandler] } },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <div style={{ width: "420px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    races: [],
    isLoading: true,
    error: null,
  },
};

export const Empty: Story = {
  args: {
    races: [],
    isLoading: false,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    races: [],
    isLoading: false,
    error: "Failed to load runners",
  },
};

export const PanelVisible: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("All Runners")).toBeInTheDocument();
    // Default is BSP only: 4 Leopardstown runners across 2 races
    await expect(canvas.getByText("4 runners · 2 races")).toBeInTheDocument();
  },
};

export const EventSections: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Cheltenham runners have no BSP — hidden by default
    await expect(canvas.queryByTestId("all-runners-event-33858191")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-event-33988522")).toBeInTheDocument();
    await expect(canvas.getByText("Leopardstown 1st Feb")).toBeInTheDocument();
  },
};

export const RaceSections: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Cheltenham race (no BSP runners) hidden by default
    await expect(canvas.queryByTestId("all-runners-race-1.237066150")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-race-1.238923739")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-race-1.238923745")).toBeInTheDocument();

    // Only BSP runner rows visible
    await expect(canvas.queryByTestId("all-runner-item-26817268")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("all-runner-item-21001")).toBeInTheDocument();
    await expect(canvas.getByText("Galopin Des Champs")).toBeInTheDocument();
  },
};

export const PnlBar: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
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
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

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
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Default: Cheltenham hidden, toggle reads "Show all"
    await expect(canvas.queryByTestId("all-runners-event-33858191")).not.toBeInTheDocument();
    const toggle = canvas.getByTestId("all-runners-bsp-toggle");
    await expect(toggle).toHaveTextContent("Show all");

    // After click: all runners visible, toggle reads "BSP only"
    await userEvent.click(toggle);
    await expect(canvas.getByTestId("all-runners-event-33858191")).toBeInTheDocument();
    await expect(canvas.getByText("Cheltenham 1st Jan")).toBeInTheDocument();
    await expect(toggle).toHaveTextContent("BSP only");
  },
};

export const CloseButton: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const closeBtn = canvas.getByTestId("all-runners-panel-close");
    await expect(closeBtn).toBeInTheDocument();
    await userEvent.click(closeBtn);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  args: {
    races: [],
    isLoading: true,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runners-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: {
    races: [],
    isLoading: false,
    error: "Failed to load runners",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-error")).toBeInTheDocument();
    await expect(canvas.getByText("Failed to load runners")).toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runners-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  args: {
    races: [],
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("No runners found.")).toBeInTheDocument();
  },
};

export const BspDisplayed: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // BSP races are the Leopardstown WIN markets
    const bspRunners = MOCK_RACES.filter(r => r.marketType === "WIN").flatMap(r => r.runners);
    for (const runner of bspRunners) {
      const bspEl = canvas.getByTestId(`all-runner-bsp-${runner.id}`);
      await expect(bspEl).toBeInTheDocument();
      await expect(bspEl).toHaveTextContent(`SP ${runner.bsp}`);
    }
  },
};

export const NoBspWhenAbsent: Story = {
  args: {
    races: [MOCK_RACES[0]], // Cheltenham ANTEPOST_WIN — no bsp on runners
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const runner of MOCK_RACES[0].runners) {
      await expect(canvas.queryByTestId(`all-runner-bsp-${runner.id}`)).not.toBeInTheDocument();
    }
  },
};
