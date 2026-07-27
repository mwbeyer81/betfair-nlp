import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { SavedResultsListScreen } from "./SavedResultsListScreen";

const BASE = "http://localhost:3000";

const MOCK_RESULTS = [
  {
    id: "result-1",
    name: "Ascot favourites",
    filters: { courses: "Ascot" },
    // Combined across both splits (staked 20, returns 15, pnl -5) is what
    // the list card's headline shows — see combinedPnlStats below.
    splitA: {
      fromRow: 1,
      toRow: 1,
      total: 1,
      totalRunners: 3,
      pnlStats: { staked: 10, returns: 8, pnl: -2, count: 2 },
      graphPoints: [
        { raceRowNumber: 1, cumulativeStaked: 10, cumulativeReturns: 8, cumulativePnl: -2, roiPercent: -20 },
      ],
    },
    splitB: {
      fromRow: 2,
      toRow: 2,
      total: 1,
      totalRunners: 3,
      pnlStats: { staked: 10, returns: 7, pnl: -3, count: 2 },
      graphPoints: [
        { raceRowNumber: 2, cumulativeStaked: 10, cumulativeReturns: 7, cumulativePnl: -3, roiPercent: -30 },
      ],
    },
    createdAt: "2026-01-15T09:00:00.000Z",
  },
  {
    id: "result-2",
    name: "Nottingham class 1",
    filters: { courses: "Nottingham" },
    // Combined: staked 10, returns 18, pnl 8.
    splitA: {
      fromRow: 1,
      toRow: 1,
      total: 1,
      totalRunners: 2,
      pnlStats: { staked: 5, returns: 9, pnl: 4, count: 1 },
      graphPoints: [{ raceRowNumber: 1, cumulativeStaked: 5, cumulativeReturns: 9, cumulativePnl: 4, roiPercent: 80 }],
    },
    splitB: {
      fromRow: 2,
      toRow: 2,
      total: 1,
      totalRunners: 2,
      pnlStats: { staked: 5, returns: 9, pnl: 4, count: 1 },
      graphPoints: [{ raceRowNumber: 2, cumulativeStaked: 5, cumulativeReturns: 9, cumulativePnl: 4, roiPercent: 80 }],
    },
    createdAt: "2026-01-20T09:00:00.000Z",
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/saved-filter-sets`, () =>
    HttpResponse.json({ success: true, data: MOCK_RESULTS, count: MOCK_RESULTS.length })
  ),
  http.delete(`${BASE}/api/saved-filter-sets/:id`, () => HttpResponse.json({ success: true })),
];

const meta: Meta<typeof SavedResultsListScreen> = {
  title: "Components/SavedResultsListScreen",
  component: SavedResultsListScreen,
  parameters: { layout: "fullscreen", msw: { handlers: defaultHandlers } },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onBack: fn(),
    onOpenResult: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("saved-results-screen")).toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-results-item-result-1")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Ascot favourites")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("saved-results-item-result-2")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Nottingham class 1")).resolves.toBeInTheDocument();
  },
};

export const CloseButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("saved-results-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/saved-filter-sets`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("saved-results-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("saved-results-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/saved-filter-sets`, () => HttpResponse.error())] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-results-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("saved-results-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [http.get(`${BASE}/api/saved-filter-sets`, () => HttpResponse.json({ success: true, data: [], count: 0 }))],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-results-empty")).resolves.toBeInTheDocument();
  },
};

export const ClickingItemCallsOnOpenResult: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const item = await canvas.findByTestId("saved-results-item-result-1");
    await userEvent.click(item);
    await expect(args.onOpenResult).toHaveBeenCalledWith("result-1");
  },
};

export const SortToggleReorders: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByTestId("saved-results-sort-toggle");
    await expect(toggle).toHaveTextContent("Newest");
    await userEvent.click(toggle);
    await expect(toggle).toHaveTextContent("PnL");
  },
};

export const DeleteButtonRemovesItemAfterConfirm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("saved-results-item-result-1");
    await userEvent.click(canvas.getByTestId("saved-results-item-result-1-delete"));
    await userEvent.click(canvas.getByTestId("saved-results-item-result-1-confirm-delete"));
    await waitFor(() => expect(canvas.queryByTestId("saved-results-item-result-1")).not.toBeInTheDocument());
  },
};

// Regression coverage for a real production bug (reported live: clicking
// Results showed a blank white screen). A result saved before the Split
// A/B schema change has no splitA/splitB fields at all — this must render
// a degraded, delete-only card rather than crashing the whole list (there
// is no error boundary anywhere in this app to catch a render-time throw).
export const LegacyResultWithoutSplitsShowsDegradedCard: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/saved-filter-sets`, () =>
          HttpResponse.json({
            success: true,
            count: 1,
            data: [
              {
                id: "legacy-result-1",
                name: "Pre-fix save",
                filters: { courses: "Ascot" },
                pnlStats: { staked: 20, returns: 15, pnl: -5, count: 4 },
                graphPoints: [{ raceRowNumber: 1, cumulativeStaked: 20, cumulativeReturns: 15, cumulativePnl: -5, roiPercent: -25 }],
                createdAt: "2026-01-15T09:00:00.000Z",
              },
            ],
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-results-item-legacy-result-1")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("saved-results-item-legacy-result-1-legacy-notice")).toHaveTextContent(
      "Split A/B update"
    );
    // No PnL headline/sparkline shown — there's no split data to render.
    await expect(canvas.getByTestId("saved-results-item-legacy-result-1")).not.toHaveTextContent("£");
    // The screen itself must still be present — the whole point of this
    // regression test.
    await expect(canvas.getByTestId("saved-results-screen")).toBeInTheDocument();
  },
};
