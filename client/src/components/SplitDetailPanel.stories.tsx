import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { SplitDetailPanel } from "./SplitDetailPanel";

const meta: Meta<typeof SplitDetailPanel> = {
  title: "Components/SplitDetailPanel",
  component: SplitDetailPanel,
  parameters: { layout: "fullscreen" },
  args: {
    id: "a",
    label: "Split A",
    fromRow: 1,
    toRow: 54621,
    totalRaces: 54621,
    totalRunners: 486325,
    pnl: { staked: 92301.13, returns: 81489.88, pnl: -10811.25, count: 486325 },
    onClose: fn(),
    onViewRaces: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("split-detail-panel-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("split-detail-body-a")).toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("split-detail-row-races-a")).toHaveTextContent("54621");
    await expect(canvas.getByTestId("split-detail-row-runners-a")).toHaveTextContent("486325");
    await expect(canvas.getByTestId("split-detail-row-horses-a")).toHaveTextContent("486325");
    await expect(canvas.getByTestId("split-detail-row-staked-a")).toHaveTextContent("£92301.13");
    await expect(canvas.getByTestId("split-detail-row-return-a")).toHaveTextContent("£81489.88");
    await expect(canvas.getByTestId("split-detail-pnl-a")).toHaveTextContent("-£10811.25");
    await expect(canvas.getByTestId("split-detail-pnl-a")).toHaveTextContent("-11.7%");
  },
};

export const CloseButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("split-detail-panel-close-a"));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const ViewRacesButtonCallsHandler: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("split-detail-view-races-button-a"));
    await expect(args.onViewRaces).toHaveBeenCalledTimes(1);
  },
};

export const PositivePnlShowsGreen: Story = {
  args: {
    pnl: { staked: 100, returns: 150, pnl: 50, count: 10 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pnlEl = canvas.getByTestId("split-detail-pnl-a");
    await expect(pnlEl).toHaveTextContent("+£50.00");
  },
};

export const SplitBRendersWithBSuffixedTestIds: Story = {
  args: {
    id: "b",
    label: "Split B",
    fromRow: 54622,
    toRow: 109243,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("split-detail-panel-b")).toBeInTheDocument();
    await expect(canvas.getByTestId("split-detail-panel-b")).toHaveTextContent("Races 54622–109243");
  },
};

export const NoHorsesCountHidesRowWhenCountUndefined: Story = {
  args: {
    pnl: { staked: 100, returns: 150, pnl: 50 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("split-detail-row-horses-a")).not.toBeInTheDocument();
  },
};
