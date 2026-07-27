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
    createdBy: "user" as const,
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
    createdBy: "user" as const,
  },
  {
    id: "result-3",
    name: "AI Training · All races · xgb-20260301-090000",
    filters: {},
    splitA: {
      fromRow: 1,
      toRow: 1,
      total: 1,
      totalRunners: 5,
      pnlStats: { staked: 20, returns: 25, pnl: 5, count: 3 },
      graphPoints: [{ raceRowNumber: 1, cumulativeStaked: 20, cumulativeReturns: 25, cumulativePnl: 5, roiPercent: 25 }],
    },
    splitB: {
      fromRow: 2,
      toRow: 2,
      total: 1,
      totalRunners: 5,
      pnlStats: { staked: 20, returns: 22, pnl: 2, count: 3 },
      graphPoints: [{ raceRowNumber: 2, cumulativeStaked: 20, cumulativeReturns: 22, cumulativePnl: 2, roiPercent: 10 }],
    },
    createdAt: "2026-03-01T09:00:00.000Z",
    createdBy: "agent" as const,
    modelVersionId: "xgb-20260301-090000",
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

export const AgentBadgeShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-results-item-result-3-agent-badge")).resolves.toBeInTheDocument();
    await canvas.findByTestId("saved-results-item-result-1");
    await expect(canvas.queryByTestId("saved-results-item-result-1-agent-badge")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("saved-results-item-result-2-agent-badge")).not.toBeInTheDocument();
  },
};

export const AgentResultHasNoDeleteButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("saved-results-item-result-3-agent-badge");
    await expect(canvas.queryByTestId("saved-results-item-result-3-delete")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("saved-results-item-result-1-delete")).toBeInTheDocument();
  },
};
