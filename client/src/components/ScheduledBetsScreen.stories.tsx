import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { ScheduledBetsScreen } from "./ScheduledBetsScreen";
import { BetOrder } from "../utils/betOrderFormat";

const MOCK_BETS: BetOrder[] = [
  {
    id: "bet_1", runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05",
    targetProfit: 20, maxStake: 10, minQualifyingPrice: 3.0, status: "pending",
    createdAt: "2026-07-29T08:00:00Z",
  },
  {
    id: "bet_2", runnerId: "hrs_2", horse: "Vanilla Skies", course: "Redcar", offTime: "2:40",
    targetProfit: 15, maxStake: 5, minQualifyingPrice: 4.0, status: "triggered",
    createdAt: "2026-07-29T08:05:00Z",
  },
  {
    id: "bet_3", runnerId: "hrs_3", horse: "Wild Dahlia", course: "Redcar", offTime: "3:50",
    targetProfit: 10, maxStake: 10, minQualifyingPrice: 2.0, status: "expired",
    createdAt: "2026-07-29T08:10:00Z",
  },
  {
    id: "bet_4", runnerId: "hrs_4", horse: "Thats My Boy Luke", course: "Redcar", offTime: "4:50",
    targetProfit: 25, maxStake: 10, minQualifyingPrice: 3.5, status: "cancelled",
    createdAt: "2026-07-29T08:15:00Z",
  },
];

const meta: Meta<typeof ScheduledBetsScreen> = {
  title: "Components/ScheduledBetsScreen",
  component: ScheduledBetsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onBack: fn(),
    bets: MOCK_BETS,
    onCancelBet: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bets-screen")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bets-list")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bet-item-bet_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bet-status-bet_1")).toHaveTextContent("Pending");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_2")).toHaveTextContent("Triggered");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_3")).toHaveTextContent("Expired");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_4")).toHaveTextContent("Cancelled");
    await expect(canvas.getByTestId("scheduled-bet-condition-bet_1")).toHaveTextContent(
      "Back at 2/1 (3.00)+ to win £20.00 (stake up to £10.00)"
    );
  },
};

export const EmptyState: Story = {
  args: { bets: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bets-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const OnlyPendingBetsShowCancelButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bet-cancel-bet_1")).toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_2")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_3")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_4")).not.toBeInTheDocument();
  },
};

export const CancelPendingBetCallsOnCancelBet: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("scheduled-bet-cancel-bet_1"));
    await expect(args.onCancelBet).toHaveBeenCalledWith("bet_1");
  },
};
