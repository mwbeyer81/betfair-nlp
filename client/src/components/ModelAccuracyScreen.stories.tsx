import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ModelAccuracyScreen } from "./ModelAccuracyScreen";
import { ModelAccuracyBand } from "../services/chatApi";

const BASE = "http://localhost:3000";

function band(partial: Partial<ModelAccuracyBand> & { bandKey: string; label: string }): ModelAccuracyBand {
  return {
    minPrice: null,
    maxPrice: null,
    runners: 0,
    wins: 0,
    modelMeanProb: 0,
    actualWinRate: 0,
    marketMeanProbFair: 0,
    marketMeanProbRaw: 0,
    staked: 0,
    returns: 0,
    pnl: 0,
    roiPercent: 0,
    modelErrorPp: 0,
    marketErrorPp: 0,
    modelBrier: 0,
    marketBrier: 0,
    ...partial,
  };
}

// Deliberately shaped like a real result: the model is well calibrated at
// middling prices and over-rates long shots (the classic favourite-longshot
// failure), so the error columns actually differ across rows.
const MOCK_BANDS: ModelAccuracyBand[] = [
  band({ bandKey: "50.0000", label: "under 2.0", minPrice: null, maxPrice: 2, runners: 412, wins: 241, modelMeanProb: 61.2, actualWinRate: 58.5, marketMeanProbFair: 60.1, marketMeanProbRaw: 64.8, staked: 402.1, returns: 393.9, pnl: -8.2, roiPercent: -2.04, modelErrorPp: 2.7, marketErrorPp: 1.6, modelBrier: 0.221, marketBrier: 0.216 }),
  band({ bandKey: "33.3333", label: "2.0 – 3.0", minPrice: 2, maxPrice: 3, runners: 780, wins: 295, modelMeanProb: 39.1, actualWinRate: 37.8, marketMeanProbFair: 38.4, marketMeanProbRaw: 42.6, staked: 690.4, returns: 694.5, pnl: 4.1, roiPercent: 0.59, modelErrorPp: 1.3, marketErrorPp: 0.6, modelBrier: 0.201, marketBrier: 0.198 }),
  band({ bandKey: "20.0000", label: "3.0 – 5.0", minPrice: 3, maxPrice: 5, runners: 1340, wins: 253, modelMeanProb: 25, actualWinRate: 18.9, marketMeanProbFair: 22.1, marketMeanProbRaw: 25.4, staked: 512.3, returns: 451, pnl: -61.3, roiPercent: -11.96, modelErrorPp: 6.1, marketErrorPp: 3.2, modelBrier: 0.176, marketBrier: 0.161 }),
  band({ bandKey: "10.0000", label: "5.0 – 10.0", minPrice: 5, maxPrice: 10, runners: 2100, wins: 290, modelMeanProb: 14.2, actualWinRate: 13.8, marketMeanProbFair: 13.5, marketMeanProbRaw: 15.8, staked: 402.9, returns: 425.6, pnl: 22.7, roiPercent: 5.63, modelErrorPp: 0.4, marketErrorPp: -0.3, modelBrier: 0.118, marketBrier: 0.119 }),
  band({ bandKey: "5.0000", label: "10.0 – 20.0", minPrice: 10, maxPrice: 20, runners: 2650, wins: 135, modelMeanProb: 6.8, actualWinRate: 5.1, marketMeanProbFair: 5.9, marketMeanProbRaw: 7.1, staked: 220.5, returns: 180.4, pnl: -40.1, roiPercent: -18.19, modelErrorPp: 1.7, marketErrorPp: 0.8, modelBrier: 0.049, marketBrier: 0.047 }),
  band({ bandKey: "0.0000", label: "20.0+", minPrice: 20, maxPrice: null, runners: 3900, wins: 66, modelMeanProb: 2.9, actualWinRate: 1.7, marketMeanProbFair: 2.2, marketMeanProbRaw: 2.9, staked: 180, returns: 85, pnl: -95, roiPercent: -52.78, modelErrorPp: 1.2, marketErrorPp: 0.5, modelBrier: 0.017, marketBrier: 0.016 }),
];

const MOCK_OVERALL = band({
  bandKey: "overall", label: "All bands", runners: 11182, wins: 1280,
  modelMeanProb: 11.4, actualWinRate: 11.4, marketMeanProbFair: 11.0, marketMeanProbRaw: 12.9,
  staked: 2408.2, returns: 2230.4, pnl: -177.8, roiPercent: -7.38,
  modelErrorPp: 0, marketErrorPp: -0.4, modelBrier: 0.0921, marketBrier: 0.0904,
});

const EMPTY_BANDS = MOCK_BANDS.map(b => band({ bandKey: b.bandKey, label: b.label, minPrice: b.minPrice, maxPrice: b.maxPrice }));

// coverage defaults to a window where a chunk of the runners had no prior
// history to be scored from — the ordinary case for a range reaching back to
// the start of the data, and the state the note under the table describes.
const accuracyResponse = (
  bands: ModelAccuracyBand[],
  overall: ModelAccuracyBand,
  coverage = { eligibleRunners: 1200, scoredRunners: 900, unscoredRunners: 300, coveragePercent: 75 }
) => HttpResponse.json({ success: true, data: bands, count: bands.length, overall, coverage });

const defaultHandlers = [
  http.get(`${BASE}/api/model-accuracy`, () => accuracyResponse(MOCK_BANDS, MOCK_OVERALL)),
];

const meta: Meta<typeof ModelAccuracyScreen> = {
  title: "Components/ModelAccuracyScreen",
  component: ModelAccuracyScreen,
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

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-accuracy-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("model-accuracy-table")).resolves.toBeInTheDocument();
  },
};

export const BandsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-accuracy-table");
    for (const b of MOCK_BANDS) {
      await expect(canvas.getByTestId(`model-accuracy-band-${b.bandKey}`)).toBeInTheDocument();
    }
    await expect(canvas.getByTestId("model-accuracy-overall-row")).toBeInTheDocument();
  },
};

// The whole point of the screen: the 3.0-5.0 band claims 25% but only wins
// 18.9%, and the market was closer. If this assertion ever breaks, the
// columns have been mixed up.
export const OverRatedBandShowsBothErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-accuracy-table");
    const row = canvas.getByTestId("model-accuracy-band-20.0000");
    await expect(row).toHaveTextContent("25.0%");
    await expect(row).toHaveTextContent("18.9%");
    await expect(row).toHaveTextContent("+6.1");
    await expect(row).toHaveTextContent("+3.2");
  },
};

// Replaces InSampleWarningShown. The screen used to apologise for its own
// numbers ("these figures flatter the model") because they came from a model
// refit on the races it then scored. It now reads modelWinProbabilityOos, so
// the note states the method instead — and the old wording must be gone, not
// merely supplemented, or the screen contradicts itself.
export const MethodNoteShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-accuracy-method-note")).toHaveTextContent(
      "trained only on races that finished before it"
    );
    await expect(canvas.queryByTestId("model-accuracy-insample-warning")).not.toBeInTheDocument();
  },
};

export const CoverageNoteStatesWhatCouldNotBeScored: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const note = await canvas.findByTestId("model-accuracy-coverage-note");
    await expect(note).toHaveTextContent("900 of 1,200 runners");
    await expect(note).toHaveTextContent("75.0%");
    await expect(note).toHaveTextContent("300");
  },
};

// Full coverage is the state where every runner in the window had prior form
// behind it. The note would then be a distraction, so it isn't rendered at all
// — an "everything was scored" line adds nothing.
export const CoverageNoteHiddenWhenEverythingWasScored: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-accuracy`, () =>
          accuracyResponse(MOCK_BANDS, MOCK_OVERALL, {
            eligibleRunners: 900,
            scoredRunners: 900,
            unscoredRunners: 0,
            coveragePercent: 100,
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-accuracy-table");
    await expect(canvas.getByTestId("model-accuracy-method-note")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-accuracy-coverage-note")).not.toBeInTheDocument();
  },
};

// The version picker was removed with the move to out-of-sample scoring: each
// year's rows come from a different model, so there is nothing for it to select.
export const NoModelVersionFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-accuracy-table");
    await expect(canvas.queryByTestId("model-accuracy-model-version-row")).not.toBeInTheDocument();
  },
};

export const BrierVerdictShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-accuracy-table");
    // Market Brier 0.0904 < model 0.0921, so the verdict must credit the market.
    await expect(canvas.getByTestId("model-accuracy-brier")).toHaveTextContent(
      "The market was more accurate than the model"
    );
  },
};

export const TooltipOpensOnQuestionMark: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-accuracy-table");
    await expect(canvas.queryByTestId("model-accuracy-tooltip-text-Market said")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("model-accuracy-tooltip-toggle-Market said"));
    await expect(
      canvas.findByTestId("model-accuracy-tooltip-text-Market said")
    ).resolves.toHaveTextContent("margin");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-accuracy`, async () => {
          await new Promise(r => setTimeout(r, 60000));
          return accuracyResponse([], MOCK_OVERALL);
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("model-accuracy-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-accuracy-table")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-accuracy`, () =>
          HttpResponse.json({ success: false }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("model-accuracy-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("model-accuracy-table")).not.toBeInTheDocument();
  },
};

// The backend always returns all six bands, so "empty" means every band has
// zero runners, not an empty array.
export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-accuracy`, () =>
          accuracyResponse(EMPTY_BANDS, band({ bandKey: "overall", label: "All bands" }))
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("model-accuracy-empty")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("model-accuracy-table")).not.toBeInTheDocument();
  },
};
