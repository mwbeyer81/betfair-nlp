import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { ModelPerformanceDashboard, ModelPerformanceFilters } from "./ModelPerformanceDashboard";
import { IspRace, IspRunner, ModelVersion, CalibrationBucket } from "../services/chatApi";
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

// How noisy each version's out-of-sample model probability is relative to the race's
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
// on 1/isp (favourites win more, like a real market) — modelWinProbabilityOos
// is the same latent strength perturbed by this version's own noise level.
function mockRacesForModelVersion(version: ModelVersion, count = 130): IspRace[] {
  const rng = seededRandom(hashCode(version.id));
  const noise = NOISE_BY_VERSION[version.id] ?? 0.3;
  const races: IspRace[] = [];
  // Anchored to this version's own testDateMin (not a fixed calendar date)
  // so every mock race falls within its real held-out test period — matches
  // what GET /api/industry-sp actually returns once IndustrySpScreen passes
  // minDate: runMeta.testDateMin as the default filter (see
  // loadRacesForModelVersion), and keeps the default/reset PnL baseline
  // identical to the unfiltered pool below rather than silently dropping
  // rows the moment a version-switch or Reset applies that default.
  const [testMinYear, testMinMonth, testMinDay] = version.runMeta.testDateMin.split("-").map(Number);
  const testMinUtc = Date.UTC(testMinYear, testMinMonth - 1, testMinDay, 14, 30);

  for (let i = 0; i < count; i++) {
    const course = COURSES[Math.floor(rng() * COURSES.length)];
    const going = GOINGS[Math.floor(rng() * GOINGS.length)];
    const raceClass = RACE_CLASSES[Math.floor(rng() * RACE_CLASSES.length)];
    const raceType = RACE_TYPES[Math.floor(rng() * RACE_TYPES.length)];
    const countryCode = COUNTRIES[Math.floor(rng() * COUNTRIES.length)];
    // Kept narrow (14 days) and anchored just after testDateMin — the date
    // picker's calendar caps its upper bound at *today's real date*
    // (todayYmd() in ModelPerformanceDashboard.tsx), and LATEST's
    // testDateMin is intentionally close to "now" among these fixtures, so
    // a wide spread here risked generating races past that cap and getting
    // silently excluded the moment Apply/Reset re-sends today as maxDate —
    // exactly the bug this file's own fix guards against, just self-
    // inflicted by the fixture instead of a real filter.
    const dayOffset = Math.floor(rng() * 14);
    const raceTime = new Date(testMinUtc + dayOffset * 24 * 60 * 60 * 1000).toISOString();
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
        modelWinProbabilityOos: (perturbed[r] / perturbedSum) * 100,
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

// Stands in for the server-side filtering GET /api/industry-sp now does
// (see loadRacesForModelVersion/onApplyModelPerformanceFilters in
// IndustrySpScreen.tsx) — narrows the full mock pool for a version down to
// whatever ModelPerformanceFilters the dashboard last applied. Deliberately
// does NOT filter by trainer/jockey here: the real backend's $elemMatch
// only confirms a race has *a* matching runner without trimming its other
// runners, so — same as production — that narrowing happens client-side in
// ModelPerformanceDashboard's own pnlRaces (substring match on whatever
// `races` this function returns), not at the mock "server" layer.
function applyMockFilters(races: IspRace[], filters: ModelPerformanceFilters): IspRace[] {
  return races.filter(race => {
    const raceYmd = race.raceTime.slice(0, 10);
    if (filters.minDate && raceYmd < filters.minDate) return false;
    if (filters.maxDate && raceYmd > filters.maxDate) return false;
    if (filters.countries && filters.countries.length > 0 && !filters.countries.includes(race.countryCode)) return false;
    if (filters.courses && filters.courses.length > 0 && !filters.courses.includes(race.course)) return false;
    if (filters.goings && filters.goings.length > 0 && (race.going == null || !filters.goings.includes(race.going))) return false;
    if (
      filters.raceClasses &&
      filters.raceClasses.length > 0 &&
      (race.raceClass == null || !filters.raceClasses.includes(race.raceClass))
    ) {
      return false;
    }
    if (filters.raceTypes && filters.raceTypes.length > 0 && !filters.raceTypes.includes(race.raceType)) return false;
    return true;
  });
}

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
    onApplyFilters: fn(),
    defaultMinDate: LATEST.runMeta.testDateMin,
    availableCountries: COUNTRIES,
    availableCourses: COURSES,
    availableGoings: GOINGS,
    availableRaceClasses: RACE_CLASSES,
    availableRaceTypes: RACE_TYPES,
  },
  // Wraps every story with real useState so version switches and
  // Apply/date-range/Reset actually refetch (via applyMockFilters) the way
  // IndustrySpScreen does against the real API, instead of leaving `races`
  // static — same as a real ChatScreen-style wiring would behave.
  render: args => <StatefulModelPerformanceDashboard {...args} />,
};

export default meta;
type Story = StoryObj<typeof meta>;

const StatefulModelPerformanceDashboard: React.FC<React.ComponentProps<typeof ModelPerformanceDashboard>> = props => {
  const [selectedId, setSelectedId] = useState(props.selectedModelVersionId);
  const [races, setRaces] = useState(props.races);

  function handleSelect(id: string) {
    setSelectedId(id);
    setRaces(RACES_BY_VERSION[id] ?? []);
    props.onSelectModelVersion(id);
  }

  function handleApply(filters: ModelPerformanceFilters) {
    setRaces(applyMockFilters(RACES_BY_VERSION[selectedId] ?? [], filters));
    props.onApplyFilters(filters);
  }

  const selectedVersion = props.modelVersions.find(v => v.id === selectedId) ?? props.modelVersions[0] ?? null;

  return (
    <ModelPerformanceDashboard
      {...props}
      selectedModelVersionId={selectedId}
      onSelectModelVersion={handleSelect}
      races={races}
      onApplyFilters={handleApply}
      defaultMinDate={selectedVersion?.runMeta.testDateMin ?? "2000-01-01"}
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
  // (Uses meta's default StatefulModelPerformanceDashboard render, which
  // already tracks selection/races via real useState.)
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
  // the highest-AUC version's modelWinProbabilityOos tracks actual outcomes
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

    // Mock races for LATEST span testDateMin (2026-07-06) .. +13 days; this
    // covers roughly the first half of that window, narrow enough to
    // exclude some races without risking zero matches.
    await pickDateRangeInCanvas(canvas, "2026-07-06", "2026-07-10");

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

export const SortToggleReordersTableByTrainingDate: Story = {
  // Defaults to newest-first (matches how the sort toggle's own label reads
  // on first render); tapping it flips to oldest-first.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rowsBefore = canvas.getAllByTestId(/^model-performance-dashboard-table-row-/);
    expect(rowsBefore[0]).toHaveAttribute("data-testid", `model-performance-dashboard-table-row-${LATEST.id}`);
    await expect(canvas.getByTestId("model-performance-dashboard-sort-toggle")).toHaveTextContent("Newest first");

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-sort-toggle"));

    const rowsAfter = canvas.getAllByTestId(/^model-performance-dashboard-table-row-/);
    expect(rowsAfter[0]).toHaveAttribute("data-testid", `model-performance-dashboard-table-row-${MODEL_VERSIONS[0].id}`);
    await expect(canvas.getByTestId("model-performance-dashboard-sort-toggle")).toHaveTextContent("Oldest first");
  },
};

export const TableMetricTooltipExplainsForLayPerson: Story = {
  // The user reported not knowing what AUC-ROC/LogLoss/Brier mean — these
  // "?" toggles on the table's column headers are the fix.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("model-performance-dashboard-tooltip-text-aucRoc")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-tooltip-toggle-aucRoc"));
    await expect(canvas.getByTestId("model-performance-dashboard-tooltip-text-aucRoc")).toHaveTextContent("coin flip");

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-tooltip-toggle-aucRoc"));
    await expect(canvas.queryByTestId("model-performance-dashboard-tooltip-text-aucRoc")).not.toBeInTheDocument();
  },
};

export const TrainingParamTooltipExplainsForLayPerson: Story = {
  // Same "?" toggle pattern, applied to every training-parameter row in the
  // detail view — n_estimators/learning_rate/etc. are meaningless jargon
  // without an explanation.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDetailInCanvas(canvas, LATEST.id);

    await expect(canvas.queryByTestId("model-performance-dashboard-tooltip-text-learning_rate")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("model-performance-dashboard-tooltip-toggle-learning_rate"));
    await expect(canvas.getByTestId("model-performance-dashboard-tooltip-text-learning_rate")).toHaveTextContent(
      "step"
    );
  },
};
