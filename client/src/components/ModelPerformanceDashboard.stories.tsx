import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { ModelPerformanceDashboard, ModelVersion, CalibrationBucket } from "./ModelPerformanceDashboard";
import { IspRace, IspRunner } from "../services/chatApi";
import { computeRangePnl, computeModelFilteredPnl } from "../utils/ispFormat";

// Deterministic PRNG (not Math.random()) so every story run — and every CI
// run — generates the exact same mock race pool, keeping assertions stable.
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const COURSES = ["Ascot", "Newmarket", "Cheltenham", "York", "Doncaster", "Kempton", "Haydock", "Newbury"];
const GOINGS = ["Good", "Good To Soft", "Soft", "Firm"];
const RACE_CLASSES = ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6"];
const RACE_TYPES = ["Flat", "Jumps"];
const COUNTRIES = ["GB", "IE"];
const TRAINERS = ["J Gosden", "A King", "N Henderson", "W Haggas", "D O'Meara", "P Nicholls", "C Fellowes", "R Varian", "M Johnston", "H Fry"];
const JOCKEYS = ["F Dettori", "R Doyle", "H Cobden", "O Murphy", "T Marquand", "J Bowen", "S Crosse", "P Mathers", "L Piggott", "R Kingscote"];

// Mirrors ml/train_and_predict.py's FEATURE_COLS (CAT_COLS + NUM_COLS).
const FEATURE_COLS = [
  "course", "going", "raceType", "raceClass", "trainer", "jockey", "sex", "hg",
  "distance", "ran", "num", "draw", "officialRating", "wgt", "age", "daysSinceLastRun",
];

// How noisy each version's modelWinProbability is relative to the race's
// "true" latent strength — lower noise means the model's probability tracks
// actual outcomes more tightly, which is what makes the highest-AUC version's
// "with model" P&L look meaningfully better than the baseline. Not derived
// from the (realistically close) aucRoc deltas below — this is synthetic
// demo data, tuned directly for a legible before/after story.
const NOISE_BY_VERSION: Record<string, number> = {
  "xgb-2026-01-15": 0.55,
  "xgb-2026-04-02": 0.3,
  "xgb-2026-07-10": 0.08,
};

function buildCalibrationTable(auc: number): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < 10; i++) {
    const meanPredicted = 5 + i * 10;
    const spread = (0.85 - auc) * 120;
    const wobble = (i % 2 === 0 ? 1 : -1) * spread * 0.4;
    const actualWinRate = Math.min(98, Math.max(2, meanPredicted + wobble));
    buckets.push({ meanPredicted, actualWinRate, n: 2000 + i * 120 });
  }
  return buckets;
}

const MODEL_VERSIONS: ModelVersion[] = [
  {
    id: "xgb-2026-01-15",
    runLabel: "xgb-2026-01-15",
    runAt: "2026-01-15T09:00:00.000Z",
    trainingParams: {
      nEstimators: 2000, learningRate: 0.03, maxDepth: 5, subsample: 0.8,
      colsampleBytree: 0.8, minChildWeight: 8, randomState: 42, earlyStoppingRounds: 50,
    },
    runMeta: {
      featureCols: FEATURE_COLS, trainRows: 180000, testRows: 20000,
      trainDateMax: "2026-01-10", testDateMin: "2026-01-11", bestIteration: 842,
    },
    performanceMetrics: { aucRoc: 0.712, logLoss: 0.601, brierScore: 0.211, calibrationTable: buildCalibrationTable(0.712) },
  },
  {
    id: "xgb-2026-04-02",
    runLabel: "xgb-2026-04-02",
    runAt: "2026-04-02T09:00:00.000Z",
    trainingParams: {
      nEstimators: 2000, learningRate: 0.05, maxDepth: 4, subsample: 0.8,
      colsampleBytree: 0.7, minChildWeight: 10, randomState: 42, earlyStoppingRounds: 50,
    },
    runMeta: {
      featureCols: FEATURE_COLS, trainRows: 210000, testRows: 24000,
      trainDateMax: "2026-03-28", testDateMin: "2026-03-29", bestIteration: 615,
    },
    performanceMetrics: { aucRoc: 0.724, logLoss: 0.588, brierScore: 0.204, calibrationTable: buildCalibrationTable(0.724) },
  },
  {
    id: "xgb-2026-07-10",
    runLabel: "xgb-2026-07-10",
    runAt: "2026-07-10T09:00:00.000Z",
    trainingParams: {
      nEstimators: 2000, learningRate: 0.03, maxDepth: 6, subsample: 0.85,
      colsampleBytree: 0.8, minChildWeight: 6, randomState: 42, earlyStoppingRounds: 50,
    },
    runMeta: {
      featureCols: FEATURE_COLS, trainRows: 260000, testRows: 30000,
      trainDateMax: "2026-07-05", testDateMin: "2026-07-06", bestIteration: 1105,
    },
    performanceMetrics: { aucRoc: 0.731, logLoss: 0.579, brierScore: 0.199, calibrationTable: buildCalibrationTable(0.731) },
  },
];

// Generates a deterministic pool of races/runners shaped exactly like the
// real IspRace/IspRunner types, so the component can compute "without model"
// P&L via the existing computeRangePnl with zero new code, and "with model"
// via computeModelFilteredPnl. Winners are chosen by a weighted-random draw
// on 1/isp (favourites win more, like a real market) — modelWinProbability
// is the same latent strength perturbed by this version's own noise level.
function mockRacesForModelVersion(version: ModelVersion, count = 130): IspRace[] {
  const rng = seededRandom(hashCode(version.id));
  const noise = NOISE_BY_VERSION[version.id] ?? 0.3;
  const races: IspRace[] = [];

  for (let i = 0; i < count; i++) {
    const course = COURSES[Math.floor(rng() * COURSES.length)];
    const going = GOINGS[Math.floor(rng() * GOINGS.length)];
    const raceClass = RACE_CLASSES[Math.floor(rng() * RACE_CLASSES.length)];
    const raceType = RACE_TYPES[Math.floor(rng() * RACE_TYPES.length)];
    const countryCode = COUNTRIES[Math.floor(rng() * COUNTRIES.length)];
    const dayOffset = Math.floor(rng() * 200);
    const raceTime = new Date(Date.UTC(2026, 0, 1 + dayOffset, 14, 30)).toISOString();
    const runnerCount = 6 + Math.floor(rng() * 7);

    const isps: number[] = [];
    const trueStrengths: number[] = [];
    for (let r = 0; r < runnerCount; r++) {
      const isp = Math.round((1.5 + Math.pow(rng(), 2) * 32) * 100) / 100;
      isps.push(isp);
      trueStrengths.push(1 / isp);
    }
    const strengthSum = trueStrengths.reduce((a, b) => a + b, 0);

    let pick = rng() * strengthSum;
    let winnerIdx = runnerCount - 1;
    for (let r = 0; r < runnerCount; r++) {
      pick -= trueStrengths[r];
      if (pick <= 0) {
        winnerIdx = r;
        break;
      }
    }

    let favIdx = 0;
    for (let r = 1; r < runnerCount; r++) {
      if (isps[r] < isps[favIdx]) favIdx = r;
    }

    const perturbed = trueStrengths.map(s => Math.max(0.001, s + (rng() - 0.5) * noise));
    const perturbedSum = perturbed.reduce((a, b) => a + b, 0);

    const runners: IspRunner[] = [];
    for (let r = 0; r < runnerCount; r++) {
      runners.push({
        id: i * 100 + r,
        name: `Runner ${r + 1}`,
        num: r + 1,
        draw: r + 1,
        status: r === winnerIdx ? "WINNER" : "LOSER",
        sortPriority: r,
        isp: isps[r],
        ispFraction: null,
        isFavourite: r === favIdx,
        trainer: TRAINERS[Math.floor(rng() * TRAINERS.length)],
        jockey: JOCKEYS[Math.floor(rng() * JOCKEYS.length)],
        modelWinProbability: (perturbed[r] / perturbedSum) * 100,
      });
    }

    races.push({
      raceId: i + 1,
      meetingId: `${course}-${raceTime.slice(0, 10)}`,
      meetingName: course,
      course,
      countryCode,
      raceTime,
      raceName: `${course} ${raceClass} Race ${i + 1}`,
      raceType,
      raceClass,
      going,
      ran: runnerCount,
      runners,
    });
  }
  return races;
}

const RACES_BY_VERSION: Record<string, IspRace[]> = Object.fromEntries(
  MODEL_VERSIONS.map(v => [v.id, mockRacesForModelVersion(v)])
);

const LATEST = MODEL_VERSIONS[2];

const meta: Meta<typeof ModelPerformanceDashboard> = {
  title: "Components/ModelPerformanceDashboard",
  component: ModelPerformanceDashboard,
  parameters: { layout: "fullscreen" },
  args: {
    modelVersions: MODEL_VERSIONS,
    selectedModelVersionId: LATEST.id,
    onSelectModelVersion: fn(),
    races: RACES_BY_VERSION[LATEST.id],
    loading: false,
    error: null,
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Wraps the (parent-controlled) component with real useState so stories that
// exercise switching model versions can observe the props actually swapping,
// same as a future ChatScreen-style wiring would do.
const ControlledModelPerformanceDashboard: React.FC<{
  initialSelectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}> = ({ initialSelectedId, onSelect, onClose }) => {
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  return (
    <ModelPerformanceDashboard
      modelVersions={MODEL_VERSIONS}
      selectedModelVersionId={selectedId}
      onSelectModelVersion={id => {
        setSelectedId(id);
        onSelect(id);
      }}
      races={RACES_BY_VERSION[selectedId]}
      loading={false}
      error={null}
      onClose={onClose}
    />
  );
};

// Drills from the table into a version's detail view — most stories below
// only care about detail-view content (training params/metrics/filters/
// P&L), which is now hidden behind a tap since the table view became the
// default landing screen.
async function openDetailInCanvas(canvas: ReturnType<typeof within>, versionId: string) {
  await userEvent.click(canvas.getByTestId(`model-performance-dashboard-table-row-${versionId}`));
  await canvas.findByTestId("model-performance-dashboard-training-params");
}

async function pickDateRangeInCanvas(canvas: ReturnType<typeof within>, fromDate: string, toDate: string) {
  const prefix = "model-performance-dashboard-date-range-picker";
  await userEvent.click(canvas.getByTestId(prefix));
  await canvas.findByTestId(`${prefix}-modal`);

  for (const dateStr of [fromDate, toDate]) {
    const [year, month] = dateStr.split("-").map(Number);
    await userEvent.click(canvas.getByTestId(`${prefix}-header-title`));
    await canvas.findByTestId(`${prefix}-year-grid`);
    await userEvent.click(canvas.getByTestId(`${prefix}-year-${year}`));
    for (let i = 0; i < month - 1; i++) {
      await userEvent.click(canvas.getByTestId(`${prefix}-next-month`));
    }
    await userEvent.click(canvas.getByTestId(`${prefix}-day-${dateStr}`));
  }

  await userEvent.click(canvas.getByTestId(`${prefix}-apply`));
}

export const PanelVisible: Story = {
  // The table listing every model version is now the landing screen — the
  // detail panel (training params/metrics/filters/P&L) stays hidden until a
  // row is tapped.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-performance-dashboard-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-list")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-table")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-performance-dashboard-training-params")).not.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  // "Items" here means every model version's own row in the table.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const version of MODEL_VERSIONS) {
      await expect(canvas.getByTestId(`model-performance-dashboard-table-row-${version.id}`)).toBeInTheDocument();
    }
  },
};

export const TableRowTapOpensDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);

    await expect(canvas.getByTestId("model-performance-dashboard-training-params")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-metrics")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-filters")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-pnl-without")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-pnl-with")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-performance-dashboard-table")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-back-to-table")).toBeInTheDocument();
  },
};

export const BackButtonReturnsToTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-back-to-table"));

    await expect(canvas.getByTestId("model-performance-dashboard-table")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-performance-dashboard-training-params")).not.toBeInTheDocument();
    for (const version of MODEL_VERSIONS) {
      await expect(canvas.getByTestId(`model-performance-dashboard-table-row-${version.id}`)).toBeInTheDocument();
    }
  },
};

export const CloseButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("model-performance-dashboard-panel-close"));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  args: {
    loading: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-performance-dashboard-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-performance-dashboard-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: {
    loading: false,
    error: "Failed to load model performance.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-performance-dashboard-error")).toHaveTextContent("Failed to load model performance.");
    await expect(canvas.queryByTestId("model-performance-dashboard-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  args: {
    modelVersions: [],
    races: [],
    loading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-performance-dashboard-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-performance-dashboard-list")).not.toBeInTheDocument();
  },
};

export const SwitchingModelVersionUpdatesTrainingParamsAndMetrics: Story = {
  // Switching versions now goes through the table: open the latest
  // version's detail, go back, then open a different version's detail.
  render: args => (
    <ControlledModelPerformanceDashboard
      initialSelectedId={LATEST.id}
      onSelect={args.onSelectModelVersion}
      onClose={args.onClose}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    await expect(canvas.getByTestId("model-performance-dashboard-auc")).toHaveTextContent("0.731");

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-back-to-table"));
    await openDetailInCanvas(canvas, MODEL_VERSIONS[0].id);

    await expect(canvas.getByTestId("model-performance-dashboard-auc")).toHaveTextContent("0.712");
  },
};

export const SwitchingModelVersionRecomputesPnlComparison: Story = {
  render: args => (
    <ControlledModelPerformanceDashboard
      initialSelectedId={LATEST.id}
      onSelect={args.onSelectModelVersion}
      onClose={args.onClose}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const before = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-back-to-table"));
    await openDetailInCanvas(canvas, MODEL_VERSIONS[0].id);

    await waitFor(() => {
      const after = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;
      expect(after).not.toBe(before);
    });
  },
};

export const WithModelBeatsWithoutModelForTheHighestAucVersion: Story = {
  // Protects the core value-proposition semantics baked into the mock data:
  // the highest-AUC version's modelWinProbability tracks actual outcomes
  // tightly enough that only staking on runners it likes should out-perform
  // staking on everything.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const races = RACES_BY_VERSION[LATEST.id];
    const without = computeRangePnl(races);
    const withModel = computeModelFilteredPnl(races, 0);
    expect(withModel.pnl).toBeGreaterThan(without.pnl);

    await openDetailInCanvas(canvas, LATEST.id);
    await expect(canvas.getByTestId("model-performance-dashboard-pnl-without")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-performance-dashboard-pnl-with")).toBeInTheDocument();
  },
};

export const ApplyingCourseFilterNarrowsPnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const before = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-chip-course-Ascot"));
    await expect(canvas.getByTestId("model-performance-dashboard-chip-course-Ascot")).toHaveTextContent("•");

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-apply-button"));

    await expect(canvas.getByTestId("model-performance-dashboard-chip-course-Ascot")).not.toHaveTextContent("•");
    await waitFor(() => {
      const after = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;
      expect(after).not.toBe(before);
    });
  },
};

export const ApplyingDateRangeFilterNarrowsPnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const before = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;

    await pickDateRangeInCanvas(canvas, "2026-02-01", "2026-02-10");

    await waitFor(() => {
      const after = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;
      expect(after).not.toBe(before);
    });
  },
};

export const TrainerFilterNarrowsPnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const before = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;

    await userEvent.type(canvas.getByTestId("model-performance-dashboard-trainer-input"), "Henderson");
    await userEvent.click(canvas.getByTestId("model-performance-dashboard-apply-button"));

    await waitFor(() => {
      const after = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;
      expect(after).not.toBe(before);
    });
  },
};

export const RaisingMinModelWinProbabilityChangesWithModelPnlOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const beforeWithout = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;
    const beforeWith = canvas.getByTestId("model-performance-dashboard-pnl-with").textContent;

    const input = canvas.getByTestId("model-performance-dashboard-min-model-prob-input");
    await userEvent.clear(input);
    await userEvent.type(input, "60");
    await userEvent.click(canvas.getByTestId("model-performance-dashboard-apply-button"));

    await waitFor(() => {
      const afterWithout = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;
      const afterWith = canvas.getByTestId("model-performance-dashboard-pnl-with").textContent;
      expect(afterWithout).toBe(beforeWithout);
      expect(afterWith).not.toBe(beforeWith);
    });
  },
};

export const ResetClearsFiltersAndRestoresBaselinePnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const baseline = canvas.getByTestId("model-performance-dashboard-pnl-without").textContent;

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-chip-course-Ascot"));
    await userEvent.click(canvas.getByTestId("model-performance-dashboard-apply-button"));

    await waitFor(() => {
      expect(canvas.getByTestId("model-performance-dashboard-pnl-without").textContent).not.toBe(baseline);
    });

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-reset-button"));

    await waitFor(() => {
      expect(canvas.getByTestId("model-performance-dashboard-pnl-without").textContent).toBe(baseline);
    });
    await expect(canvas.getByTestId("model-performance-dashboard-chip-course-Ascot")).not.toHaveTextContent("•");
  },
};

export const CalibrationChartRenders: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    const chart = canvas.getByTestId("model-performance-dashboard-calibration-chart");
    await expect(chart).toBeInTheDocument();
    expect(chart.querySelectorAll("circle").length).toBe(10);
  },
};

export const RestrictiveFilterComboShowsNoQualifyingRunners: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);
    await userEvent.type(canvas.getByTestId("model-performance-dashboard-trainer-input"), "NoSuchTrainerZZZ");
    await userEvent.click(canvas.getByTestId("model-performance-dashboard-apply-button"));

    await expect(canvas.getByTestId("model-performance-dashboard-pnl-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-performance-dashboard-pnl-without")).not.toBeInTheDocument();
  },
};
