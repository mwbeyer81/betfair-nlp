import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { TrainerDetailScreen } from "./TrainerDetailScreen";

const BASE = "http://localhost:3000";

const MOCK_TRAINER_FORM = {
  trainer: "W P Mullins",
  formCategory: "Flat",
  runs: [
    { raceId: 914591, runnerId: 11111, horseName: "Galopin Des Champs", raceDate: "2025-01-01", course: "Ascot", status: "WINNER", pos: "1", isp: 2.5 },
    { raceId: 914592, runnerId: 12347, horseName: "Fact To File", raceDate: "2025-01-08", course: "Cheltenham", status: "WINNER", pos: "1", isp: 2.1 },
    { raceId: 914594, runnerId: 33333, horseName: "State Man", raceDate: "2025-01-15", course: "Newbury", status: "LOSER", pos: "4", isp: 5.0 },
  ],
  totalRuns: 3,
  totalWins: 2,
  lastUpdated: "2025-01-16T00:00:00.000Z",
};

const defaultHandlers = [
  http.get(`${BASE}/api/trainer-form`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("trainer") === "W P Mullins") {
      return HttpResponse.json({ success: true, data: MOCK_TRAINER_FORM });
    }
    return HttpResponse.json({ success: false, error: "Trainer form not found" }, { status: 404 });
  }),
];

const meta: Meta<typeof TrainerDetailScreen> = {
  title: "Components/TrainerDetailScreen",
  component: TrainerDetailScreen,
  parameters: { layout: "fullscreen", msw: { handlers: defaultHandlers } },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    trainer: "W P Mullins",
    formCategory: "Flat",
    onBack: fn(),
    onNavigateToRunner: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("trainer-detail-list")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("trainer-detail-runs")).toHaveTextContent("3");
    await expect(canvas.getByTestId("trainer-detail-wins")).toHaveTextContent("2");
  },
};

export const BackButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("trainer-detail-list");
    await userEvent.click(canvas.getByTestId("trainer-detail-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const RunRowClickCallsOnNavigateToRunner: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("trainer-detail-item-914592-12347");
    await userEvent.click(canvas.getByTestId("trainer-detail-item-914592-12347"));
    await expect(args.onNavigateToRunner).toHaveBeenCalledWith(914592, 12347);
  },
};

export const NotFoundTrainer: Story = {
  args: { trainer: "Nobody" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("trainer-detail-not-found")).resolves.toBeInTheDocument();
  },
};
