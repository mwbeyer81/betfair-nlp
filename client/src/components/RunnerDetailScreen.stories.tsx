import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { RunnerDetailScreen } from "./RunnerDetailScreen";

const BASE = "http://localhost:3000";
const RACE_ID = 914592;
const RUNNER_ID = 21001;

const MOCK_RACE = {
  raceId: RACE_ID,
  meetingId: "Cheltenham|2026-03-01",
  meetingName: "Cheltenham — 1 March 2026",
  course: "Cheltenham",
  countryCode: "GB",
  raceTime: "2026-03-01T14:01:00",
  raceName: "Cheltenham Chase",
  raceType: "Chase",
  raceClass: "Class 1",
  going: "Good",
  ran: 3,
  runners: [
    { id: RUNNER_ID, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43 },
    { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "PLACED", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false },
  ],
};

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp/race/:raceId`, () => HttpResponse.json({ success: true, data: MOCK_RACE })),
];

const meta: Meta<typeof RunnerDetailScreen> = {
  title: "Components/RunnerDetailScreen",
  component: RunnerDetailScreen,
  parameters: { layout: "fullscreen", msw: { handlers: defaultHandlers } },
  args: {
    raceId: RACE_ID,
    runnerId: RUNNER_ID,
    onBack: fn(),
    onNavigateToHistory: fn(),
    onNavigateToTrainer: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("runner-detail-list")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("runner-detail-course")).toHaveTextContent("Cheltenham");
    await expect(canvas.getByTestId("runner-detail-trainer-form")).toHaveTextContent("3/14");
  },
};

export const BackButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-detail-list");
    await userEvent.click(canvas.getByTestId("runner-detail-back"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const ViewHistoryButtonCallsOnNavigateToHistory: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-detail-list");
    await userEvent.click(canvas.getByTestId("runner-detail-view-history"));
    await expect(args.onNavigateToHistory).toHaveBeenCalledWith("Galopin Des Champs");
  },
};

export const TrainerLinkCallsOnNavigateToTrainer: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-detail-list");
    await userEvent.click(canvas.getByTestId("runner-detail-trainer-link"));
    await expect(args.onNavigateToTrainer).toHaveBeenCalledWith("W P Mullins", "Flat");
  },
};

export const RunnerNotFoundInRace: Story = {
  args: { runnerId: 999999 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("runner-detail-not-found")).resolves.toBeInTheDocument();
  },
};
