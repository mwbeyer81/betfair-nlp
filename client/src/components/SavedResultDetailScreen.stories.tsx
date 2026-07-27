import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { SavedResultDetailScreen } from "./SavedResultDetailScreen";

const BASE = "http://localhost:3000";

const MOCK_RESULT = {
  id: "result-1",
  name: "Ascot favourites",
  filters: { courses: "Ascot", minDate: "2026-01-01", maxDate: "2026-01-01" },
  splitA: {
    fromRow: 1,
    toRow: 2,
    total: 2,
    totalRunners: 6,
    pnlStats: { staked: 10, returns: 11, pnl: 1, count: 2 },
    graphPoints: [
      { raceRowNumber: 1, cumulativeStaked: 5, cumulativeReturns: 6, cumulativePnl: 1, roiPercent: 20 },
      { raceRowNumber: 2, cumulativeStaked: 10, cumulativeReturns: 11, cumulativePnl: 1, roiPercent: 10 },
    ],
  },
  splitB: {
    fromRow: 3,
    toRow: 4,
    total: 2,
    totalRunners: 6,
    pnlStats: { staked: 10, returns: 6, pnl: -4, count: 2 },
    graphPoints: [
      { raceRowNumber: 3, cumulativeStaked: 5, cumulativeReturns: 5, cumulativePnl: 0, roiPercent: 0 },
      { raceRowNumber: 4, cumulativeStaked: 10, cumulativeReturns: 6, cumulativePnl: -4, roiPercent: -40 },
    ],
  },
  createdAt: "2026-01-15T09:00:00.000Z",
};

const defaultHandlers = [
  http.get(`${BASE}/api/saved-filter-sets/:id`, () => HttpResponse.json({ success: true, data: MOCK_RESULT })),
  http.delete(`${BASE}/api/saved-filter-sets/:id`, () => HttpResponse.json({ success: true })),
];

const meta: Meta<typeof SavedResultDetailScreen> = {
  title: "Components/SavedResultDetailScreen",
  component: SavedResultDetailScreen,
  parameters: { layout: "fullscreen", msw: { handlers: defaultHandlers } },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    id: "result-1",
    onBack: fn(),
    onRestore: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-result-detail-screen")).resolves.toBeInTheDocument();
  },
};

// This screen previously had no header at all — now it shares the standard
// AppHeader (BackBet branding + back arrow) like every other screen.
export const HeaderRenders: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-result-detail-title")).resolves.toHaveTextContent("BackBet");
    await expect(canvas.getByTestId("saved-result-detail-back-button")).toBeInTheDocument();
  },
};

// Requested live (screenshot): the detail view only ever showed one
// combined number, while the live /isp screen it was saved from always
// shows Split A and Split B as two independent tests — the saved snapshot
// must show the same two-split breakdown, not a merged summary.
export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-result-split-card-a")).resolves.toHaveTextContent("races 1–2");
    await expect(canvas.getByTestId("saved-result-split-pnl-a")).toHaveTextContent("+£1.00");
    await expect(canvas.getByTestId("saved-result-split-card-b")).toHaveTextContent("races 3–4");
    await expect(canvas.getByTestId("saved-result-split-pnl-b")).toHaveTextContent("-£4.00");
  },
};

export const BackButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const backBtn = await canvas.findByTestId("saved-result-detail-back-button");
    await userEvent.click(backBtn);
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/saved-filter-sets/:id`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: MOCK_RESULT });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("saved-result-detail-loading")).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/saved-filter-sets/:id`, () => HttpResponse.error())] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-result-detail-error")).resolves.toBeInTheDocument();
  },
};

// This screen doesn't have a distinct "empty" state of its own (a missing
// result is an error, not an empty list) — a 404 is the closest analog,
// covered structurally the same way as ErrorState above.
export const NotFoundShowsError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/saved-filter-sets/:id`, () =>
          HttpResponse.json({ success: false, error: "Not found" }, { status: 404 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("saved-result-detail-error")).resolves.toBeInTheDocument();
  },
};

export const SplitDetailsButtonOpensSplitDetailPanel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const detailsBtn = await canvas.findByTestId("saved-result-split-details-button-a");
    await userEvent.click(detailsBtn);
    await expect(canvas.findByTestId("split-detail-panel-a")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("split-detail-pnl-a")).toHaveTextContent("+£1.00");

    const closeBtn = await canvas.findByTestId("split-detail-panel-filters-a");
    await userEvent.click(closeBtn);
    await expect(canvas.queryByTestId("split-detail-panel-a")).not.toBeInTheDocument();
  },
};

export const SplitGraphButtonOpensThatSplitsOwnPnlConvergencePanel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const graphBtnB = await canvas.findByTestId("saved-result-split-graph-button-b");
    await userEvent.click(graphBtnB);
    await expect(canvas.findByTestId("pnl-convergence-panel")).resolves.toBeInTheDocument();
    // Split B's own range (3–4), not Split A's or a combined range.
    await expect(canvas.getByTestId("pnl-convergence-range-subtitle")).toHaveTextContent("Races 3–4");

    // The saved result's own filters (courses/dates) must show up on the
    // graph the same way a live convergence result's do — the graph is a
    // static snapshot, so this is the only place left that still shows
    // what actually produced it.
    await expect(canvas.getByTestId("pnl-convergence-filter-chip-courses")).toHaveTextContent("Courses: Ascot");
    await expect(canvas.getByTestId("pnl-convergence-filter-chip-date")).toHaveTextContent(
      "Date: 2026-01-01 → 2026-01-01"
    );
  },
};

export const RestoreButtonCallsOnRestoreWithFilters: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const restoreBtn = await canvas.findByTestId("saved-result-detail-restore");
    await userEvent.click(restoreBtn);
    await expect(args.onRestore).toHaveBeenCalledWith(MOCK_RESULT.filters);
  },
};

export const DeleteButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const deleteBtn = await canvas.findByTestId("saved-result-detail-delete");
    await userEvent.click(deleteBtn);
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};
