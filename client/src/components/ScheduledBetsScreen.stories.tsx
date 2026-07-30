import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ScheduledBetsScreen } from "./ScheduledBetsScreen";
import { BetOrder } from "../services/chatApi";

const BASE = "http://localhost:3000";

const MOCK_BETS: BetOrder[] = [
  {
    id: "bet_1", runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", raceId: "rac_1", eventId: "redcar-2026-07-29",
    targetProfit: 20, maxStake: 10, minQualifyingPrice: 3.0, status: "pending", orderType: "scheduled",
    createdAt: "2026-07-29T08:00:00Z",
  },
  {
    id: "bet_2", runnerId: "hrs_2", horse: "Vanilla Skies", course: "Redcar", offTime: "2:40", raceId: "rac_2", eventId: "redcar-2026-07-29",
    targetProfit: 15, maxStake: 5, minQualifyingPrice: 4.0, status: "triggered", orderType: "instant", dryRun: true, matchedPrice: 4.2,
    createdAt: "2026-07-29T08:05:00Z",
  },
  {
    id: "bet_3", runnerId: "hrs_3", horse: "Wild Dahlia", course: "Redcar", offTime: "3:50", raceId: "rac_3", eventId: "redcar-2026-07-29",
    targetProfit: 10, maxStake: 10, minQualifyingPrice: 2.0, status: "expired", orderType: "scheduled", note: "Off time passed without the price condition being met",
    createdAt: "2026-07-29T08:10:00Z",
  },
  {
    id: "bet_4", runnerId: "hrs_4", horse: "Thats My Boy Luke", course: "Redcar", offTime: "4:50", raceId: "rac_4", eventId: "redcar-2026-07-29",
    targetProfit: 25, maxStake: 10, minQualifyingPrice: 3.5, status: "cancelled", orderType: "scheduled",
    createdAt: "2026-07-29T08:15:00Z",
  },
  {
    id: "bet_5", runnerId: "hrs_5", horse: "Best Rate", course: "Sandown", offTime: "5:45", raceId: "rac_5", eventId: "sandown-2026-07-29",
    targetProfit: 20, maxStake: 10, minQualifyingPrice: 3.0, status: "unmatched", orderType: "scheduled", note: "No Betfair GB horse racing market found for \"Sandown\"",
    createdAt: "2026-07-29T08:20:00Z",
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: true, data: MOCK_BETS, count: MOCK_BETS.length })),
  http.delete(`${BASE}/api/bet-orders/:id`, () => HttpResponse.json({ success: true })),
];

const meta: Meta<typeof ScheduledBetsScreen> = {
  title: "Components/ScheduledBetsScreen",
  component: ScheduledBetsScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onBack: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bets-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("scheduled-bets-list")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bet-item-bet_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bet-status-bet_1")).toHaveTextContent("Pending");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_2")).toHaveTextContent("Triggered");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_3")).toHaveTextContent("Expired");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_4")).toHaveTextContent("Cancelled");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_5")).toHaveTextContent("Unmatched");
    await expect(canvas.getByTestId("scheduled-bet-condition-bet_1")).toHaveTextContent(
      "Back at 2/1 (3.00)+ to win £20.00 (stake up to £10.00)"
    );
    await expect(canvas.getByTestId("scheduled-bet-note-bet_5")).toHaveTextContent("No Betfair GB horse racing market found");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/bet-orders`, async () => {
          await new Promise(r => setTimeout(r, 60000));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bets-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: false }, { status: 500 }))],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("scheduled-bets-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: true, data: [], count: 0 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("scheduled-bets-empty")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const OnlyPendingAndUnmatchedBetsShowCancelButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await expect(canvas.getByTestId("scheduled-bet-cancel-bet_1")).toBeInTheDocument(); // pending
    await expect(canvas.getByTestId("scheduled-bet-cancel-bet_5")).toBeInTheDocument(); // unmatched
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_2")).not.toBeInTheDocument(); // triggered
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_3")).not.toBeInTheDocument(); // expired
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_4")).not.toBeInTheDocument(); // cancelled
  },
};

export const CancelPendingBetCallsApiAndUpdatesStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bet-cancel-bet_1"));
    await waitFor(() => expect(canvas.getByTestId("scheduled-bet-status-bet_1")).toHaveTextContent("Cancelled"));
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_1")).not.toBeInTheDocument();
  },
};
