import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ScheduledBetsScreen } from "./ScheduledBetsScreen";
import { BetOrder } from "../services/chatApi";

const BASE = "http://localhost:3000";

const MOCK_BETS: BetOrder[] = [
  {
    id: "bet_1", runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", offDt: "2026-07-29T14:05:00+01:00", raceId: "rac_1", eventId: "redcar-2026-07-29",
    targetProfit: 20, maxStake: 10, minQualifyingPrice: 3.0, status: "pending", orderType: "scheduled",
    createdAt: "2026-07-29T08:00:00Z",
  },
  {
    id: "bet_2", runnerId: "hrs_2", horse: "Vanilla Skies", course: "Redcar", offTime: "2:40", offDt: "2026-07-29T14:40:00+01:00", raceId: "rac_2", eventId: "redcar-2026-07-29",
    targetProfit: 15, maxStake: 5, minQualifyingPrice: 4.0, status: "triggered", orderType: "instant", dryRun: true, matchedPrice: 4.2,
    createdAt: "2026-07-29T08:05:00Z",
  },
  {
    id: "bet_3", runnerId: "hrs_3", horse: "Wild Dahlia", course: "Redcar", offTime: "3:50", offDt: "2026-07-29T15:50:00+01:00", raceId: "rac_3", eventId: "redcar-2026-07-29",
    targetProfit: 10, maxStake: 10, minQualifyingPrice: 2.0, status: "expired", orderType: "scheduled", note: "Off time passed without the price condition being met",
    createdAt: "2026-07-29T08:10:00Z",
  },
  {
    id: "bet_4", runnerId: "hrs_4", horse: "Thats My Boy Luke", course: "Redcar", offTime: "4:50", offDt: "2026-07-29T16:50:00+01:00", raceId: "rac_4", eventId: "redcar-2026-07-29",
    targetProfit: 25, maxStake: 10, minQualifyingPrice: 3.5, status: "cancelled", orderType: "scheduled",
    createdAt: "2026-07-29T08:15:00Z",
  },
  {
    id: "bet_5", runnerId: "hrs_5", horse: "Best Rate", course: "Sandown", offTime: "5:45", offDt: "2026-07-29T17:45:00+01:00", raceId: "rac_5", eventId: "sandown-2026-07-29",
    targetProfit: 20, maxStake: 10, minQualifyingPrice: 3.0, status: "unmatched", orderType: "scheduled", note: "No Betfair GB horse racing market found for \"Sandown\"",
    createdAt: "2026-07-29T08:20:00Z",
  },
];

// A settled mix — one real winner, one real loser and one sandbox loser,
// across two race days and two courses — so the P&L totals, the All-tab
// real/sandbox breakdown and every filter dimension have something real
// to bite on.
const MOCK_SETTLED_BETS: BetOrder[] = [
  {
    id: "bet_r1", runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", offDt: "2026-07-28T14:05:00+01:00", raceId: "rac_1", eventId: "redcar-2026-07-28",
    targetProfit: 20, maxStake: 10, minQualifyingPrice: 3.0, status: "triggered", orderType: "instant", matchedPrice: 4.0,
    betOutcome: "WON", settledProfit: 30, settledAt: "2026-07-28T14:20:00+01:00",
    createdAt: "2026-07-28T08:00:00Z",
  },
  {
    id: "bet_r2", runnerId: "hrs_2", horse: "Vanilla Skies", course: "Sandown", offTime: "2:40", offDt: "2026-07-29T14:40:00+01:00", raceId: "rac_2", eventId: "sandown-2026-07-29",
    targetProfit: 15, maxStake: 5, minQualifyingPrice: 4.0, status: "triggered", orderType: "scheduled", matchedPrice: 4.2,
    betOutcome: "LOST", settledProfit: -5, settledAt: "2026-07-29T14:55:00+01:00",
    createdAt: "2026-07-29T08:05:00Z",
  },
  {
    id: "bet_s1", runnerId: "hrs_3", horse: "Silken Bay", course: "Leicester", offTime: "8:40", offDt: "2026-07-29T20:40:00+01:00", raceId: "rac_3", eventId: "leicester-2026-07-29",
    targetProfit: 10, maxStake: 2, minQualifyingPrice: 6.0, status: "triggered", orderType: "instant", sandbox: true, dryRun: true, matchedPrice: 8.4,
    betOutcome: "LOST", settledProfit: -2, settledAt: "2026-07-29T20:55:00+01:00",
    note: "Dry run — no real bet was placed.",
    createdAt: "2026-07-29T19:00:00Z",
  },
  {
    id: "bet_s2", runnerId: "hrs_4", horse: "Battosai", course: "Leicester", offTime: "8:40", offDt: "2026-07-29T20:40:00+01:00", raceId: "rac_3", eventId: "leicester-2026-07-29",
    targetProfit: 50, maxStake: 50, minQualifyingPrice: 2.0, status: "triggered", orderType: "instant", sandbox: true, dryRun: true, matchedPrice: 6.2,
    createdAt: "2026-07-29T19:05:00Z",
  },
];

const settledHandlers = [
  http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: true, data: MOCK_SETTLED_BETS, count: MOCK_SETTLED_BETS.length })),
  http.delete(`${BASE}/api/bet-orders/:id`, () => HttpResponse.json({ success: true })),
];

const defaultHandlers = [
  http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: true, data: MOCK_BETS, count: MOCK_BETS.length })),
  http.delete(`${BASE}/api/bet-orders/:id`, () => HttpResponse.json({ success: true })),
];

const meta: Meta<typeof ScheduledBetsScreen> = {
  title: "Components/ScheduledBetsScreen",
  component: ScheduledBetsScreen,
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

export const PopulatedList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bets-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("scheduled-bets-list")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bet-item-bet_1")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bet-status-bet_1")).toHaveTextContent("Pending");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_2")).toHaveTextContent("Triggered");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_3")).toHaveTextContent("Expired");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_4")).toHaveTextContent("Cancelled");
    await expect(canvas.getByTestId("scheduled-bet-status-bet_5")).toHaveTextContent("Unmatched");
    await expect(canvas.getByTestId("scheduled-bet-condition-bet_1")).toHaveTextContent(
      "Back at 2/1 (3.00)+ to win £20.00 (stake up to £10.00)"
    );
    await expect(canvas.getByTestId("scheduled-bet-note-bet_5")).toHaveTextContent("No Betfair GB horse racing market found");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/bet-orders`, async () => {
          await new Promise(r => setTimeout(r, 60000));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("scheduled-bets-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: false }, { status: 500 }))],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("scheduled-bets-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/bet-orders`, () => HttpResponse.json({ success: true, data: [], count: 0 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("scheduled-bets-empty")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};

export const OnlyPendingAndUnmatchedBetsShowCancelButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await expect(canvas.getByTestId("scheduled-bet-cancel-bet_1")).toBeInTheDocument(); // pending
    await expect(canvas.getByTestId("scheduled-bet-cancel-bet_5")).toBeInTheDocument(); // unmatched
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_2")).not.toBeInTheDocument(); // triggered
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_3")).not.toBeInTheDocument(); // expired
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_4")).not.toBeInTheDocument(); // cancelled
  },
};

export const CancelPendingBetCallsApiAndUpdatesStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bet-cancel-bet_1"));
    await waitFor(() => expect(canvas.getByTestId("scheduled-bet-status-bet_1")).toHaveTextContent("Cancelled"));
    await expect(canvas.queryByTestId("scheduled-bet-cancel-bet_1")).not.toBeInTheDocument();
  },
};

// Drives DateRangePicker.tsx exactly like IndustrySpScreen.stories.tsx's
// helper does — the picker is shared, so the interaction is too.
async function pickDateRangeInCanvas(
  canvas: ReturnType<typeof within>,
  fromDate: string,
  toDate: string
) {
  const prefix = "scheduled-bets-date-range-picker";
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

export const PnlOnAllTabTotalsRealAndSandbox: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await expect(canvas.getByTestId("scheduled-bets-pnl-title")).toHaveTextContent("P&L (all bets)");
    // +£30 real win, -£5 real loss, -£2 sandbox loss.
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("+£23.00");
    await expect(canvas.getByTestId("scheduled-bets-pnl-meta")).toHaveTextContent("Staked £17.00 across 3 settled bets");
    // bet_s2 is triggered but has no result yet — counted, never assumed lost.
    await expect(canvas.getByTestId("scheduled-bets-pnl-meta")).toHaveTextContent("1 more not settled yet");
    await expect(canvas.getByTestId("scheduled-bets-pnl-breakdown")).toHaveTextContent("Real +£25.00 · Sandbox -£2.00");
  },
};

export const PnlOnRealTabExcludesSandbox: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-real"));
    await waitFor(() => expect(canvas.getByTestId("scheduled-bets-pnl-title")).toHaveTextContent("Real P&L"));
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("+£25.00");
    await expect(canvas.getByTestId("scheduled-bets-pnl-meta")).toHaveTextContent("Staked £15.00 across 2 settled bets");
    await expect(canvas.queryByTestId("scheduled-bets-pnl-breakdown")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("scheduled-bet-item-bet_s1")).not.toBeInTheDocument();
  },
};

export const PnlOnSandboxTabExcludesRealBets: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-sandbox"));
    await waitFor(() => expect(canvas.getByTestId("scheduled-bets-pnl-title")).toHaveTextContent("Sandbox P&L"));
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("-£2.00");
    await expect(canvas.getByTestId("scheduled-bets-pnl-meta")).toHaveTextContent("Staked £2.00 across 1 settled bet");
    await expect(canvas.queryByTestId("scheduled-bet-item-bet_r1")).not.toBeInTheDocument();
  },
};

export const CourseFilterNarrowsListAndPnl: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filters-toggle"));
    await canvas.findByTestId("scheduled-bets-filters");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-chip-course-Redcar"));
    await waitFor(() => expect(canvas.queryByTestId("scheduled-bet-item-bet_r2")).not.toBeInTheDocument());
    await expect(canvas.getByTestId("scheduled-bet-item-bet_r1")).toBeInTheDocument();
    // The headline figure always describes exactly the filtered list.
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("+£30.00");
    await expect(canvas.getByTestId("scheduled-bets-filters-toggle")).toHaveTextContent("(1)");
  },
};

export const OutcomeFilterShowsOnlyWinners: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filters-toggle"));
    await canvas.findByTestId("scheduled-bets-filters");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-chip-outcome-WON"));
    await waitFor(() => expect(canvas.queryByTestId("scheduled-bet-item-bet_s1")).not.toBeInTheDocument());
    await expect(canvas.getByTestId("scheduled-bet-item-bet_r1")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("+£30.00");
  },
};

export const DateFilterNarrowsToOneRaceDay: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filters-toggle"));
    await canvas.findByTestId("scheduled-bets-filters");
    // Race date, not created-at: bet_r1's race ran on the 28th.
    await pickDateRangeInCanvas(canvas, "2026-07-28", "2026-07-28");
    await waitFor(() => expect(canvas.queryByTestId("scheduled-bet-item-bet_r2")).not.toBeInTheDocument());
    await expect(canvas.getByTestId("scheduled-bet-item-bet_r1")).toBeInTheDocument();
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("+£30.00");
  },
};

export const ResetRestoresEveryBet: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filters-toggle"));
    await canvas.findByTestId("scheduled-bets-filters");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-chip-course-Leicester"));
    await waitFor(() => expect(canvas.queryByTestId("scheduled-bet-item-bet_r1")).not.toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("scheduled-bets-filters-reset"));
    await waitFor(() => expect(canvas.getByTestId("scheduled-bet-item-bet_r1")).toBeInTheDocument());
    await expect(canvas.getByTestId("scheduled-bets-pnl-value")).toHaveTextContent("+£23.00");
  },
};

export const ContradictoryFiltersShowEmptyState: Story = {
  parameters: { msw: { handlers: settledHandlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("scheduled-bets-list");
    await userEvent.click(canvas.getByTestId("scheduled-bets-filters-toggle"));
    await canvas.findByTestId("scheduled-bets-filters");
    // Redcar has a winner but no loser — the two together match nothing.
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-chip-course-Redcar"));
    await userEvent.click(canvas.getByTestId("scheduled-bets-filter-chip-outcome-LOST"));
    await waitFor(() => expect(canvas.getByTestId("scheduled-bets-filter-empty")).toBeInTheDocument());
    await expect(canvas.getByTestId("scheduled-bets-filter-empty")).toHaveTextContent("No bets match these filters");
    await expect(canvas.queryByTestId("scheduled-bets-list")).not.toBeInTheDocument();
  },
};
