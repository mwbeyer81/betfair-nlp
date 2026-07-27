import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { PnlConvergencePanel } from "./PnlConvergencePanel";
import { RaceConvergencePoint } from "../services/chatApi";

// startRow defaults to 1 (Split A's own case); a non-1 start models Split
// B's own graph, whose x axis shows its true global race row numbers (e.g.
// 501-1000) while its cumulative sum restarts fresh at startRow — see
// getRaceConvergenceSeries on the backend.
function samplePoints(n: number, startRow = 1): RaceConvergencePoint[] {
  let cumulativeStaked = 0;
  let cumulativeReturns = 0;
  return Array.from({ length: n }, (_, i) => {
    const raceRowNumber = startRow + i;
    cumulativeStaked += 1;
    if (raceRowNumber % 3 === 0) cumulativeReturns += 1.8;
    const cumulativePnl = cumulativeReturns - cumulativeStaked;
    return {
      raceRowNumber,
      cumulativeStaked,
      cumulativeReturns,
      cumulativePnl,
      roiPercent: (cumulativePnl / cumulativeStaked) * 100,
    };
  });
}

const meta: Meta<typeof PnlConvergencePanel> = {
  title: "Components/PnlConvergencePanel",
  component: PnlConvergencePanel,
  parameters: { layout: "fullscreen" },
  args: {
    points: samplePoints(200),
    loading: false,
    error: null,
    filters: [],
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("pnl-convergence-chart")).toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-chart")).toBeInTheDocument();
    await expect(canvas.getByTestId("pnl-convergence-final-roi")).toHaveTextContent("200 races");
  },
};

export const CloseButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("pnl-convergence-panel-close"));
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
    await expect(canvas.getByTestId("pnl-convergence-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("pnl-convergence-chart")).not.toBeInTheDocument();
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
    await expect(canvas.getByTestId("pnl-convergence-error")).toHaveTextContent("Failed to load convergence data.");
    await expect(canvas.queryByTestId("pnl-convergence-chart")).not.toBeInTheDocument();
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
    await expect(canvas.getByTestId("pnl-convergence-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("pnl-convergence-chart")).not.toBeInTheDocument();
  },
};

// Models a real one from production: the very first race in the range had
// a long-odds winner, giving that single point an ROI% in the hundreds/
// thousands (a tiny cumulative stake denominator makes early ROI% wildly
// sensitive) — everything after settles into a much tighter band.
function pointsWithEarlyOutlier(n: number): RaceConvergencePoint[] {
  const points: RaceConvergencePoint[] = [];
  for (let i = 0; i < n; i++) {
    const raceRowNumber = i + 1;
    if (i === 0) {
      points.push({ raceRowNumber, cumulativeStaked: 0.1, cumulativeReturns: 1.3, cumulativePnl: 1.2, roiPercent: 1200 });
    } else {
      // Settles into a -25%..+32% band well within the warm-up window.
      const roiPercent = -25 + ((i * 37) % 57);
      points.push({ raceRowNumber, cumulativeStaked: i, cumulativeReturns: i * (1 + roiPercent / 100), cumulativePnl: i * (roiPercent / 100), roiPercent });
    }
  }
  return points;
}

// A genuinely tight, stable series from the very first point — no cold
// start below its eventual range (unlike a realistic win/loss series,
// which is guaranteed to sit at -100% until its first win lands). Used to
// confirm the clip note only appears when warm-up exclusion actually
// matters, not on every series that happens to have a warm-up period.
function wellBehavedPoints(n: number): RaceConvergencePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const roiPercent = -5 + (i % 7);
    const cumulativeStaked = i + 1;
    const cumulativePnl = (cumulativeStaked * roiPercent) / 100;
    return {
      raceRowNumber: i + 1,
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
    await expect(canvas.getByTestId("pnl-convergence-chart")).toBeInTheDocument();
    await expect(canvas.queryByTestId("pnl-convergence-clip-note")).not.toBeInTheDocument();
  },
};

export const EarlyOutlierDoesNotFlattenTheChart: Story = {
  // Regression: reported live via screenshot — Split A's chart looked
  // completely flat after an initial vertical drop, because its very
  // first race had a ~13/1 winner (+1200% ROI on a near-zero stake), and
  // the Y axis was scaled to include that single point, squashing the real
  // -25%..+32% convergence detail into an invisible sliver. The axis
  // scale now excludes the first few points (SCALE_WARMUP_POINTS) — the
  // clip-note must appear, acknowledging the line runs off-screen early.
  args: {
    points: pointsWithEarlyOutlier(200),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-clip-note")).toBeInTheDocument();
  },
};

export const TappingTheChartShowsASnapTooltip: Story = {
  // Requested live: tap anywhere on the graph and a marker snaps to the
  // nearest point on the line, showing that race's cumulative P&L at that
  // spot.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("pnl-convergence-tooltip")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("pnl-convergence-chart"));

    await expect(canvas.getByTestId("pnl-convergence-snap-dot")).toBeInTheDocument();
    await expect(canvas.getByTestId("pnl-convergence-snap-guide")).toBeInTheDocument();
    const tooltip = canvas.getByTestId("pnl-convergence-tooltip");
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Race");
    await expect(canvas.getByTestId("pnl-convergence-tooltip-pnl")).toHaveTextContent("£");
    await expect(canvas.getByTestId("pnl-convergence-tooltip-position")).toHaveTextContent("of");
  },
};

export const ScopedToASplitsOwnRange: Story = {
  // Models Split B's own Graph button: a range that doesn't start at 1
  // (e.g. races 501-700). The subtitle/axis caption must show the TRUE
  // range, not a re-based 1..N index, and "Converges to X% after N races"
  // must count the races in THIS range (200), not the last row number
  // (700).
  args: {
    points: samplePoints(200, 501),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-range-subtitle")).toHaveTextContent("Races 501–700");
    await expect(canvas.getByTestId("pnl-convergence-final-roi")).toHaveTextContent("after 200 races");

    // The tooltip's position line must tie the true global row number to
    // the local "N of 200" count — "N of 200" always stays within the
    // local count, even while the row number above it is a much larger
    // global number.
    await userEvent.click(canvas.getByTestId("pnl-convergence-chart"));
    const position = canvas.getByTestId("pnl-convergence-tooltip-position");
    await expect(position).toHaveTextContent("of 200 in this split");
    const match = position.textContent?.match(/^(\d+) of 200/);
    expect(match).toBeTruthy();
    const localPosition = Number(match![1]);
    expect(localPosition).toBeGreaterThanOrEqual(1);
    expect(localPosition).toBeLessThanOrEqual(200);
  },
};

export const JumpToRaceInputSnapsToTheExactRace: Story = {
  // Requested live: dragging a finger along the chart to land on one exact
  // race is imprecise, especially on a small screen — typing the race row
  // number directly should snap the marker/tooltip exactly like a tap
  // would, no dragging required.
  args: {
    points: samplePoints(200, 501),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("pnl-convergence-tooltip")).not.toBeInTheDocument();

    await userEvent.type(canvas.getByTestId("pnl-convergence-jump-input"), "557");
    await userEvent.click(canvas.getByTestId("pnl-convergence-jump-button"));

    await expect(canvas.getByTestId("pnl-convergence-snap-dot")).toBeInTheDocument();
    await expect(canvas.getByTestId("pnl-convergence-snap-guide")).toBeInTheDocument();
    const tooltip = canvas.getByTestId("pnl-convergence-tooltip");
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Race 557");
  },
};

export const JumpToRaceViaKeyboardSubmit: Story = {
  // Pressing Enter (onSubmitEditing) must work the same as tapping the
  // Go button, so the whole interaction can happen without leaving the
  // keyboard.
  args: {
    points: samplePoints(200, 501),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("pnl-convergence-jump-input");
    await userEvent.type(input, "600{enter}");

    const tooltip = canvas.getByTestId("pnl-convergence-tooltip");
    await expect(tooltip).toBeInTheDocument();
    await expect(tooltip).toHaveTextContent("Race 600");
  },
};

export const JumpToRaceOutsideRangeSnapsToTheNearestEnd: Story = {
  // A target below firstRowNumber or above lastRowNumber still resolves
  // sensibly — snaps to whichever end of the split's own range is closer,
  // same "snap to nearest" behavior a tap already has at the chart edges.
  args: {
    points: samplePoints(200, 501),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("pnl-convergence-jump-input"), "1");
    await userEvent.click(canvas.getByTestId("pnl-convergence-jump-button"));
    await expect(canvas.getByTestId("pnl-convergence-tooltip")).toHaveTextContent("Race 501");
  },
};

export const JumpToRaceButtonDisabledWhenInputEmpty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-jump-button")).toBeDisabled();
  },
};

export const NoFiltersAppliedMessageWhenFiltersEmpty: Story = {
  // Requested live: the graph gave no indication of which filters produced
  // its result set. An empty filters array (the default range, nothing
  // narrowed) must say so explicitly rather than showing nothing.
  args: {
    filters: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-no-filters")).toHaveTextContent("No filters applied");
    await expect(canvas.queryByTestId("pnl-convergence-filters-summary")).not.toBeInTheDocument();
  },
};

export const FiltersSummaryRendersEveryAppliedFilter: Story = {
  // Requested live: the exact filters behind a convergence result (date
  // range, course, model thresholds, ...) should be visible on the graph
  // screen itself, not just implicitly held in the Filters screen's state.
  args: {
    filters: [
      { key: "date", label: "Date: 2024-01-01 → 2024-01-31" },
      { key: "courses", label: "Courses: Ascot, Newmarket" },
      { key: "modelWinProbability", label: "Model win probability: ≥60%" },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("pnl-convergence-no-filters")).not.toBeInTheDocument();
    const summary = canvas.getByTestId("pnl-convergence-filters-summary");
    await expect(summary).toBeInTheDocument();
    await expect(canvas.getByTestId("pnl-convergence-filter-chip-date")).toHaveTextContent(
      "Date: 2024-01-01 → 2024-01-31"
    );
    await expect(canvas.getByTestId("pnl-convergence-filter-chip-courses")).toHaveTextContent(
      "Courses: Ascot, Newmarket"
    );
    await expect(canvas.getByTestId("pnl-convergence-filter-chip-modelWinProbability")).toHaveTextContent(
      "Model win probability: ≥60%"
    );
  },
};

export const FiltersSummaryVisibleWhileLoading: Story = {
  // The filter summary is captured at the moment the graph is opened, so
  // it must render even before the data itself has loaded — otherwise a
  // slow request briefly looks like the filters weren't applied at all.
  args: {
    points: [],
    loading: true,
    filters: [{ key: "date", label: "Date: 2024-01-01 → 2024-01-31" }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pnl-convergence-loading")).toBeInTheDocument();
    await expect(canvas.getByTestId("pnl-convergence-filter-chip-date")).toBeInTheDocument();
  },
};
