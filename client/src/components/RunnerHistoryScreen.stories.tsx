import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { RunnerHistoryScreen } from "./RunnerHistoryScreen";

const BASE = "http://localhost:3000";
const RUNNER_NAME = "Galopin Des Champs";

const MOCK_RACE = {
  raceId: 914592,
  meetingId: "Cheltenham|2026-03-01",
  meetingName: "Cheltenham — 1 March 2026",
  course: "Cheltenham",
  countryCode: "GB",
  raceTime: "2026-03-01T14:01:00",
  raceName: "Cheltenham Chase",
  raceType: "Chase",
  raceClass: "Class 1",
  going: "Good",
  ran: 2,
  runners: [
    { id: 21001, name: RUNNER_NAME, num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true, trainer: "W P Mullins" },
    { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "PLACED", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false },
  ],
};

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp/filter-bounds`, () => HttpResponse.json({ success: true, data: { maxRunnersPerRace: 20, maxIsp: 1000, minIsp: 1.1 } })),
  http.get(`${BASE}/api/industry-sp/courses`, () => HttpResponse.json({ success: true, data: ["Cheltenham", "Ascot"] })),
  http.get(`${BASE}/api/industry-sp/goings`, () => HttpResponse.json({ success: true, data: ["Good", "Soft"] })),
  http.get(`${BASE}/api/industry-sp/race-classes`, () => HttpResponse.json({ success: true, data: ["Class 1", "Class 2"] })),
  http.get(`${BASE}/api/industry-sp/race-types`, () => HttpResponse.json({ success: true, data: ["Chase", "Hurdle"] })),
  http.get(`${BASE}/api/industry-sp`, ({ request }) => {
    const url = new URL(request.url);
    const runnerName = url.searchParams.get("runnerName");
    const match = runnerName?.toLowerCase() === RUNNER_NAME.toLowerCase();
    const data = match ? [MOCK_RACE] : [];
    return HttpResponse.json({
      success: true, data, count: data.length, total: data.length, page: 1, limit: 20, totalPages: 1,
      totalRunners: match ? 2 : 0, pnlStats: { staked: 1, returns: 2, pnl: 1, count: 2 },
    });
  }),
];

const meta: Meta<typeof RunnerHistoryScreen> = {
  title: "Components/RunnerHistoryScreen",
  component: RunnerHistoryScreen,
  parameters: { layout: "fullscreen", msw: { handlers: defaultHandlers } },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    runnerName: RUNNER_NAME,
    onBack: fn(),
    onNavigateToRunner: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("runner-history-item-914592")).resolves.toBeInTheDocument();
  },
};

export const BackButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-history-list");
    await userEvent.click(canvas.getByTestId("runner-history-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const RowClickCallsOnNavigateToRunner: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-history-item-914592");
    await userEvent.click(canvas.getByTestId("runner-history-item-914592"));
    await expect(args.onNavigateToRunner).toHaveBeenCalledWith(914592, 21001);
  },
};

export const EmptyState: Story = {
  args: { runnerName: "Nobody" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("No races found for this runner.")).resolves.toBeInTheDocument();
  },
};
