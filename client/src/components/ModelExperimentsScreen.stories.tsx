import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ModelExperimentsScreen } from "./ModelExperimentsScreen";
import {
  ModelExperiment,
  ModelExperimentSummary,
  ExperimentSegment,
  DiscoveredSegment,
} from "../services/chatApi";

const BASE = "http://localhost:3000";

const metrics = (brier: number, auc: number, resolution: number, top1: number) => ({
  n: 189640,
  aucRoc: auc,
  logLoss: 0.3268,
  brierScore: brier,
  resolution,
  reliability: 0.000098,
  uncertainty: 0.1004,
  withinBin: -0.000059,
  top1Rate: top1,
  mrr: 0.42,
  races: 21000,
});

// Numbers deliberately shaped like the real ones: the model loses to industry
// SP on Brier and badly on discrimination, which is the whole finding this
// screen exists to track.
const CONTROL: ModelExperimentSummary = {
  id: "exp-20260806-183001",
  name: "base-binary-control",
  notes: "The deployed feature set and objective, through the new code path.",
  runAt: "2026-08-06T18:30:01Z",
  mode: "fast",
  featureSetName: "baseline",
  objective: "binary",
  featureCount: 27,
  newFeatureCount: 0,
  meta: {
    gitCommit: "abc1234",
    foldYears: ["2022", "2023", "2024", "2025", "2026"],
    foldCount: 5,
    scoredRows: 189640,
    unscoredRows: 296758,
    droppedTrainRaces: 0,
    coverageMinDate: "2022-01-01",
    coverageMaxDate: "2026-08-05",
    totalSeconds: 338.6,
    trainingParams: { maxDepth: 5, nEstimatorsCap: 300 },
  },
  metrics: {
    model: metrics(0.095289, 0.71554, 0.0072138, 0.260771),
    calibrated: metrics(0.095243, 0.715342, 0.0072, 0.260589),
    market: metrics(0.088829, 0.785405, 0.0136362, 0.348483),
    bss: -0.072724,
    deltaVsBaseline: null,
  },
  baselineExperimentId: null,
  discoveredCount: 0,
};

const CANDIDATE: ModelExperimentSummary = {
  ...CONTROL,
  id: "exp-20260806-190210",
  name: "rel-softmax",
  notes: "Within-race relative features plus conditional-logit training.",
  runAt: "2026-08-06T19:02:10Z",
  featureSetName: "all",
  objective: "softmax_race",
  featureCount: 143,
  newFeatureCount: 116,
  metrics: {
    model: metrics(0.093104, 0.7364, 0.0091, 0.2881),
    calibrated: metrics(0.093088, 0.7363, 0.00909, 0.288),
    market: metrics(0.088829, 0.785405, 0.0136362, 0.348483),
    bss: -0.048,
    // Brier and log loss DOWN is an improvement; AUC, resolution and top-1 UP
    // is an improvement. The screen colours these in opposite directions and
    // DeltaColoursAreDirectional below is what pins that.
    deltaVsBaseline: {
      brierScore: -0.002185,
      aucRoc: 0.02086,
      logLoss: -0.0071,
      resolution: 0.0018862,
      top1Rate: 0.027329,
    },
  },
  baselineExperimentId: "exp-20260806-183001",
  discoveredCount: 1,
};

const segment = (
  dimension: string,
  bucket: string,
  bucketOrder: number,
  bss: number,
  roiLevel: number,
  roiToWin: number
): ExperimentSegment => ({
  dimension,
  bucket,
  bucketOrder,
  n: 44000,
  scoredN: 43980,
  wins: 5100,
  strikeRate: 11.6,
  model: metrics(0.0931, 0.736, 0.0091, 0.288),
  market: metrics(0.0888, 0.785, 0.0136, 0.348),
  bss,
  selections: {
    all: {
      n: 44000,
      wins: 5100,
      strikeRate: 11.6,
      pnl: {
        toWin1: { staked: 8000, returns: 8000 * (1 + roiToWin / 100), pnl: 8000 * (roiToWin / 100), roiPct: roiToWin },
        level: { staked: 44000, returns: 44000 * (1 + roiLevel / 100), pnl: 44000 * (roiLevel / 100), roiPct: roiLevel },
      },
      bettableN: 43980,
    },
  },
  yearsPositiveToWin1: 9,
  yearsPositiveLevel: 9,
});

const SEGMENTS: ExperimentSegment[] = [
  segment("spBand", "under 2.0", 0, -0.31, -4.1, -3.2),
  segment("spBand", "5.0-10.0", 3, 0.004, 1.2, 0.9),
  segment("raceType", "Chase", 0, -0.02, -9.4, -8.1),
  segment("raceType", "Flat", 1, -0.06, -12.2, -11.1),
];

const DISCOVERED: DiscoveredSegment[] = [
  {
    dimension: "spBand",
    bucket: "5.0-10.0",
    selection: "all",
    n: 44000,
    bss: 0.004,
    strikeRate: 11.6,
    roiToWin1: 0.9,
    roiLevel: 1.2,
    yearsPositiveToWin1: 9,
    ispFilterable: true,
    filters: { minIsp: "5.0", maxIsp: "10.0" },
  },
  {
    // Real slice, but the Filters screen has no param for it — the screen must
    // say so rather than offer a link that would silently drop the constraint.
    dimension: "isHandicap",
    bucket: "handicap",
    selection: "all",
    n: 130000,
    bss: 0.002,
    strikeRate: 11.1,
    roiToWin1: 0.4,
    roiLevel: 0.6,
    yearsPositiveToWin1: 8,
    ispFilterable: false,
    filters: null,
  },
];

const DETAIL: ModelExperiment = {
  ...CANDIDATE,
  featureCols: ["course", "going", "officialRatingRank", "horseAvgRPRZ"],
  newFeatureCols: ["officialRatingRank", "horseAvgRPRZ"],
  sparseFeatures: [],
  folds: [
    { year: "2022", trainRows: 265382, scoredRows: 42863, seconds: 18.9, raw: { brierScore: 0.0968, aucRoc: 0.7169 } },
    { year: "2023", trainRows: 304972, scoredRows: 42643, seconds: 18.5, raw: { brierScore: 0.0944, aucRoc: 0.7134 } },
  ],
  spBandTable: SEGMENTS.filter(s => s.dimension === "spBand"),
  segments: SEGMENTS,
  segmentDimensions: ["raceType", "spBand"],
  acceptanceRule: { minN: 20000, minBss: 0, requirePositiveUnderBothStakings: true, minYearsPositiveFraction: 8 / 11, minYearsPositive: 4, foldYearsScored: 5 },
  discoveredSegments: DISCOVERED,
  filterBattery: [],
};

const listResponse = (data: ModelExperimentSummary[]) =>
  HttpResponse.json({ success: true, data, count: data.length });

const defaultHandlers = [
  http.get(`${BASE}/api/model-experiments`, () => listResponse([CANDIDATE, CONTROL])),
  http.get(`${BASE}/api/model-experiments/:id`, () => HttpResponse.json({ success: true, data: DETAIL })),
];

const meta: Meta<typeof ModelExperimentsScreen> = {
  title: "Components/ModelExperimentsScreen",
  component: ModelExperimentsScreen,
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

export const ListVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-experiments-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("model-experiments-list")).resolves.toBeInTheDocument();
  },
};

export const RowsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await expect(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`)).toBeInTheDocument();
    await expect(canvas.getByTestId(`model-experiments-row-${CONTROL.id}`)).toBeInTheDocument();
  },
};

// The single most likely misread on this screen: a NEGATIVE Brier delta is an
// IMPROVEMENT, so green means negative there and positive for AUC. If this
// ever inverts, every result on the screen reads backwards.
export const DeltaColoursAreDirectional: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    const row = canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`);
    await expect(row).toHaveTextContent("-0.00218");
    await userEvent.click(canvas.getByTestId("model-experiments-tooltip-toggle-delta"));
    await expect(canvas.getByTestId("model-experiments-tooltip-text-delta")).toHaveTextContent(
      "NEGATIVE number is an IMPROVEMENT"
    );
  },
};

export const RowOpensDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    await expect(canvas.findByTestId("model-experiments-detail")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("model-experiments-metrics")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-experiments-fold-table")).toBeInTheDocument();
  },
};

export const BackReturnsToList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    await canvas.findByTestId("model-experiments-detail");
    await userEvent.click(canvas.getByTestId("model-experiments-back-to-list"));
    await expect(canvas.findByTestId("model-experiments-list")).resolves.toBeInTheDocument();
  },
};

export const SegmentDimensionSwitch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    await canvas.findByTestId("model-experiments-segment-table");
    // Opens on the first dimension...
    await expect(canvas.getByTestId("model-experiments-segment-row-raceType-Chase")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("model-experiments-segment-dimension-spBand"));
    // ...and switching swaps the rows entirely, rather than appending.
    await expect(canvas.findByTestId("model-experiments-segment-row-spBand-under 2.0")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("model-experiments-segment-row-raceType-Chase")).not.toBeInTheDocument();
  },
};

export const DiscoveredSegmentNavigatesToFilters: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    await canvas.findByTestId("model-experiments-discovered-list");
    await userEvent.click(canvas.getByTestId("model-experiments-discovered-view-in-filters-0"));
    await expect(args.navigate).toHaveBeenCalledWith("/isp", "minIsp=5.0&maxIsp=10.0");
  },
};

// A discovery the Filters screen cannot express must say so, not offer a
// button that would drop the constraint and show a different set of races.
export const InexpressibleDiscoveryOffersNoLink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    const row = await canvas.findByTestId("model-experiments-discovered-row-1");
    await expect(row).toHaveTextContent("Not expressible as a saved filter");
    await expect(canvas.queryByTestId("model-experiments-discovered-view-in-filters-1")).not.toBeInTheDocument();
  },
};

// The lesson from the previous P&L analysis, put in front of whoever is
// reading a result rather than left in a markdown file.
export const BothStakingsTooltipExplainsTheNoiseRule: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    await canvas.findByTestId("model-experiments-discovered-list");
    await userEvent.click(canvas.getByTestId("model-experiments-tooltip-toggle-bothStakings"));
    await expect(canvas.getByTestId("model-experiments-tooltip-text-bothStakings")).toHaveTextContent(
      "noise, not an edge"
    );
  },
};

export const CoverageWarningShownWhenAFeatureIsAllNull: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-experiments`, () => listResponse([CANDIDATE])),
        http.get(`${BASE}/api/model-experiments/:id`, () =>
          HttpResponse.json({
            success: true,
            data: {
              ...DETAIL,
              sparseFeatures: [
                { col: "horseAvgExcuseScore", populatedPct: 0 },
                { col: "horseTroubleInRunningRate", populatedPct: 0 },
              ],
            },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-experiments-list");
    await userEvent.click(canvas.getByTestId(`model-experiments-row-${CANDIDATE.id}`));
    const warning = await canvas.findByTestId("model-experiments-coverage-warning");
    await expect(warning).toHaveTextContent("horseAvgExcuseScore");
    await expect(warning).toHaveTextContent("almost entirely missing");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-experiments`, async () => {
          await new Promise(resolve => setTimeout(resolve, 10000));
          return listResponse([]);
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-experiments-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-experiments-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-experiments`, () =>
          HttpResponse.json({ success: false }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // An error, deliberately — not an empty list, which would read as "no
    // experiments have been run yet" and is a different claim.
    await expect(canvas.findByTestId("model-experiments-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("model-experiments-list")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("model-experiments-empty")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [http.get(`${BASE}/api/model-experiments`, () => listResponse([]))],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("model-experiments-empty")).resolves.toBeInTheDocument();
  },
};
