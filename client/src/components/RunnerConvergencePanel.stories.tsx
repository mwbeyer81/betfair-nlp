import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { RunnerConvergencePanel } from "./RunnerConvergencePanel";
import { RunnerConvergencePoint } from "../services/chatApi";

function samplePoints(n: number): RunnerConvergencePoint[] {
  let cumulativeStaked = 0;
  let cumulativeReturns = 0;
  return Array.from({ length: n }, (_, i) => {
    const ordinal = i + 1;
    cumulativeStaked += 1;
    if (ordinal % 3 === 0) cumulativeReturns += 1.8;
    const cumulativePnl = cumulativeReturns - cumulativeStaked;
    return {
      runnerOrdinal: ordinal,
      cumulativeStaked,
      cumulativeReturns,
      cumulativePnl,
      roiPercent: (cumulativePnl / cumulativeStaked) * 100,
    };
  });
}

const meta: Meta<typeof RunnerConvergencePanel> = {
  title: "Components/RunnerConvergencePanel",
  component: RunnerConvergencePanel,
  parameters: { layout: "fullscreen" },
  args: {
    points: samplePoints(200),
    loading: false,
    error: null,
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("runner-convergence-chart")).toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-chart")).toBeInTheDocument();
    await expect(canvas.getByTestId("runner-convergence-final-roi")).toHaveTextContent("200 runners");
  },
};

export const CloseButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("runner-convergence-panel-close"));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  args: {
    points: [],
    loading: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("runner-convergence-chart")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: {
    points: [],
    loading: false,
    error: "Failed to load convergence data.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-error")).toHaveTextContent("Failed to load convergence data.");
    await expect(canvas.queryByTestId("runner-convergence-chart")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  args: {
    points: [],
    loading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("runner-convergence-chart")).not.toBeInTheDocument();
  },
};
