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
    pnlStats: { staked: 20, returns: 15, pnl: -5, count: 4 },
    graphPoints: [
      { raceRowNumber: 1, cumulativeStaked: 10, cumulativeReturns: 8, cumulativePnl: -2, roiPercent: -20 },
      { raceRowNumber: 2, cumulativeStaked: 20, cumulativeReturns: 15, cumulativePnl: -5, roiPercent: -25 },
    ],
    createdAt: "2026-01-15T09:00:00.000Z",
  },
  {
    id: "result-2",
    name: "Nottingham class 1",
    filters: { courses: "Nottingham" },
    pnlStats: { staked: 10, returns: 18, pnl: 8, count: 2 },
    graphPoints: [
      { raceRowNumber: 1, cumulativeStaked: 5, cumulativeReturns: 9, cumulativePnl: 4, roiPercent: 80 },
      { raceRowNumber: 2, cumulativeStaked: 10, cumulativeReturns: 18, cumulativePnl: 8, roiPercent: 80 },
    ],
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
    onBack: fn(),
    onOpenResult: fn(),
    onNavigateToChat: fn(),
    onNavigateToEvents: fn(),
    onNavigateToRunners: fn(),
    onNavigateToIsp: fn(),
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
