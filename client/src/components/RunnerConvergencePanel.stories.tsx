import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { RunnerConvergencePanel } from "./RunnerConvergencePanel";
import { RunnerConvergencePoint } from "../services/chatApi";

// startOrdinal defaults to 1 (Split A's own case); a non-1 start models
// Split B's own graph, whose x axis shows its true global ordinals (e.g.
// 1001-2000) while its cumulative sum restarts fresh at startOrdinal — see
// getRunnerConvergenceSeries on the backend.
function samplePoints(n: number, startOrdinal = 1): RunnerConvergencePoint[] {
  let cumulativeStaked = 0;
  let cumulativeReturns = 0;
  return Array.from({ length: n }, (_, i) => {
    const ordinal = startOrdinal + i;
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

// Models a real one from production: the very first runner in the range
// won at long odds, giving that single point an ROI% in the hundreds/
// thousands (a tiny cumulative stake denominator makes early ROI% wildly
// sensitive) — everything after settles into a much tighter band.
function pointsWithEarlyOutlier(n: number): RunnerConvergencePoint[] {
  const points: RunnerConvergencePoint[] = [];
  for (let i = 0; i < n; i++) {
    const ordinal = i + 1;
    if (i === 0) {
      points.push({ runnerOrdinal: ordinal, cumulativeStaked: 0.1, cumulativeReturns: 1.3, cumulativePnl: 1.2, roiPercent: 1200 });
    } else {
      // Settles into a -25%..+32% band well within the 50-point warm-up.
      const roiPercent = -25 + ((i * 37) % 57);
      points.push({ runnerOrdinal: ordinal, cumulativeStaked: i, cumulativeReturns: i * (1 + roiPercent / 100), cumulativePnl: i * (roiPercent / 100), roiPercent });
    }
  }
  return points;
}

// A genuinely tight, stable series from the very first point — no cold
// start below its eventual range (unlike a realistic win/loss series,
// which is guaranteed to sit at -100% until its first win lands). Used to
// confirm the clip note only appears when warm-up exclusion actually
// matters, not on every series that happens to have a warm-up period.
function wellBehavedPoints(n: number): RunnerConvergencePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const roiPercent = -5 + (i % 7);
    const cumulativeStaked = i + 1;
    const cumulativePnl = (cumulativeStaked * roiPercent) / 100;
    return {
      runnerOrdinal: i + 1,
      cumulativeStaked,
      cumulativeReturns: cumulativeStaked + cumulativePnl,
      cumulativePnl,
      roiPercent,
    };
  });
}

export const NoClipNoteForAWellBehavedSeries: Story = {
  args: {
    points: wellBehavedPoints(200),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-chart")).toBeInTheDocument();
    await expect(canvas.queryByTestId("runner-convergence-clip-note")).not.toBeInTheDocument();
  },
};

export const EarlyOutlierDoesNotFlattenTheChart: Story = {
  // Regression: reported live via screenshot — Split A's chart looked
  // completely flat after an initial vertical drop, because its very
  // first runner won at ~13/1 (+1200% ROI on a near-zero stake), and the
  // Y axis was scaled to include that single point, squashing the real
  // -25%..+32% convergence detail into an invisible sliver. The axis
  // scale now excludes the first 50 points (SCALE_WARMUP_POINTS) — the
  // clip-note must appear, acknowledging the line runs off-screen early.
  args: {
    points: pointsWithEarlyOutlier(200),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-clip-note")).toBeInTheDocument();
  },
};

export const TappingTheChartShowsASnapTooltip: Story = {
  // Requested live: tap anywhere on the graph and a marker snaps to the
  // nearest point on the line, showing that runner's count and cumulative
  // P&L at that spot.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("runner-convergence-tooltip")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("runner-convergence-chart"));

    await expect(canvas.getByTestId("runner-convergence-snap-dot")).toBeInTheDocument();
    await expect(canvas.getByTestId("runner-convergence-snap-guide")).toBeInTheDocument();
    const tooltip = canvas.getByTestId("runner-convergence-tooltip");
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Runner");
    await expect(canvas.getByTestId("runner-convergence-tooltip-pnl")).toHaveTextContent("£");
    await expect(canvas.getByTestId("runner-convergence-tooltip-position")).toHaveTextContent("of");
  },
};

export const ScopedToASplitsOwnRange: Story = {
  // Models Split B's own Graph button: a range that doesn't start at 1
  // (e.g. runners 1001-1200), reported live — "the graphs should
  // actually use the same race numbers on its x axis, eg 1 to 500, or
  // 1000 to 2000." The subtitle/axis caption must show the TRUE range,
  // not a re-based 1..N index, and "Converges to X% after N runners"
  // must count the runners in THIS range (200), not the last ordinal
  // (1200).
  args: {
    points: samplePoints(200, 1001),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-range-subtitle")).toHaveTextContent("Runners 1001–1200");
    await expect(canvas.getByTestId("runner-convergence-final-roi")).toHaveTextContent("after 200 runners");

    // Regression: reported live — tapping near the right edge showed a
    // tooltip ordinal (e.g. "Runner 1187", the TRUE global number) that
    // looked impossibly large next to the headline's "after 200 runners"
    // (a count local to this split). The tooltip's position line must tie
    // the two together — "N of 200" always stays within the local count,
    // even while the ordinal above it is a much larger global number.
    await userEvent.click(canvas.getByTestId("runner-convergence-chart"));
    const position = canvas.getByTestId("runner-convergence-tooltip-position");
    await expect(position).toHaveTextContent("of 200 in this split");
    const match = position.textContent?.match(/^(\d+) of 200/);
    expect(match).toBeTruthy();
    const localPosition = Number(match![1]);
    expect(localPosition).toBeGreaterThanOrEqual(1);
    expect(localPosition).toBeLessThanOrEqual(200);
  },
};

export const JumpToRunnerInputSnapsToTheExactRunner: Story = {
  // Requested live: dragging a finger along the chart to land on one
  // exact runner is imprecise, especially on a small screen — typing the
  // runner number directly should snap the marker/tooltip exactly like a
  // tap would, no dragging required.
  args: {
    points: samplePoints(200, 1001),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("runner-convergence-tooltip")).not.toBeInTheDocument();

    await userEvent.type(canvas.getByTestId("runner-convergence-jump-input"), "1057");
    await userEvent.click(canvas.getByTestId("runner-convergence-jump-button"));

    await expect(canvas.getByTestId("runner-convergence-snap-dot")).toBeInTheDocument();
    await expect(canvas.getByTestId("runner-convergence-snap-guide")).toBeInTheDocument();
    const tooltip = canvas.getByTestId("runner-convergence-tooltip");
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Runner 1057");
  },
};

export const JumpToRunnerViaKeyboardSubmit: Story = {
  // Pressing Enter (onSubmitEditing) must work the same as tapping the
  // Go button, so the whole interaction can happen without leaving the
  // keyboard.
  args: {
    points: samplePoints(200, 1001),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("runner-convergence-jump-input");
    await userEvent.type(input, "1100{enter}");

    const tooltip = canvas.getByTestId("runner-convergence-tooltip");
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Runner 1100");
  },
};

export const JumpToRunnerOutsideRangeSnapsToTheNearestEnd: Story = {
  // A target below firstOrdinal or above lastOrdinal still resolves
  // sensibly — snaps to whichever end of the split's own range is closer,
  // same "snap to nearest" behavior a tap already has at the chart edges.
  args: {
    points: samplePoints(200, 1001),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("runner-convergence-jump-input"), "1");
    await userEvent.click(canvas.getByTestId("runner-convergence-jump-button"));
    await expect(canvas.getByTestId("runner-convergence-tooltip")).toHaveTextContent("Runner 1001");
  },
};

export const JumpToRunnerButtonDisabledWhenInputEmpty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-convergence-jump-button")).toBeDisabled();
  },
};
