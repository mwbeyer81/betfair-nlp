import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { IndustryRaceScreen } from "./IndustryRaceScreen";

const BASE = "http://localhost:3000";
const RACE_ID = 914592;

const MOCK_RACE = {
  raceId: RACE_ID,
  meetingId: "Cheltenham|2026-03-01",
  meetingName: "Cheltenham — 1 March 2026",
  course: "Cheltenham",
  countryCode: "GB",
  raceTime: "2026-03-01T14:01:00",
  raceName: "Cheltenham Chase",
  raceType: "Chase",
  ran: 3,
  runners: [
    { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43 },
    { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "PLACED", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false },
    { id: 21003, name: "Fastorslow", num: 3, draw: null, status: "LOSER", sortPriority: 3, isp: 9.0, ispFraction: "8/1", isFavourite: false },
  ],
};

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp/race/:raceId`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACE })
  ),
];

const meta: Meta<typeof IndustryRaceScreen> = {
  title: "Components/IndustryRaceScreen",
  component: IndustryRaceScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    raceId: RACE_ID,
    onNavigateToMeeting: fn(),
    onNavigateToIsp: fn(),
    onNavigateToRunner: fn(),
    onNavigateToTrainer: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-race-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-race-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-race-list");
    for (const runner of MOCK_RACE.runners) {
      await expect(canvas.getByTestId(`industry-race-item-${runner.id}`)).toBeInTheDocument();
      await expect(canvas.getByTestId(`industry-race-isp-${runner.id}`)).toBeInTheDocument();
    }
  },
};

export const TrainerFormBadgeDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-race-list");

    await expect(canvas.getByTestId("industry-race-item-trainer-21001")).toHaveTextContent("W P Mullins");
    await expect(canvas.getByTestId("industry-race-item-trainer-form-21001")).toHaveTextContent("3/14");
    await expect(canvas.getByTestId("industry-race-item-trainer-form-21001")).toHaveTextContent("21%");
  },
};

export const BackButtonNavigatesToMeeting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-race-list");
    await userEvent.click(canvas.getByTestId("industry-race-back-button"));
    await expect(args.onNavigateToMeeting).toHaveBeenCalledWith(MOCK_RACE.meetingId);
  },
};

export const OddsModeToggle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-race-list");
    await expect(canvas.getByTestId("industry-race-odds-mode-toggle")).toHaveTextContent("Odds: Fraction");
    await expect(canvas.getByTestId(`industry-race-isp-${MOCK_RACE.runners[0].id}`)).toHaveTextContent("ISP 19/20");

    await userEvent.click(canvas.getByTestId("industry-race-odds-mode-toggle"));
    await expect(canvas.getByTestId("industry-race-odds-mode-toggle")).toHaveTextContent("Odds: Decimal");
    await expect(canvas.getByTestId(`industry-race-isp-${MOCK_RACE.runners[0].id}`)).toHaveTextContent("ISP 1.95");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/race/:raceId`, async () => {
          await new Promise((r) => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: MOCK_RACE });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-race-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-race-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/race/:raceId`, () =>
          HttpResponse.json({ success: false, error: "Race not found" }, { status: 404 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("industry-race-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("industry-race-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/race/:raceId`, () =>
          HttpResponse.json({ success: true, data: { ...MOCK_RACE, runners: [] } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("No runners found.")).resolves.toBeInTheDocument();
  },
};

export const RendersAtIphone12: Story = {
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-race-list");
    await expect(canvas.getByTestId("industry-race-screen")).toBeInTheDocument();
  },
};

export const RendersAtLaptop: Story = {
  parameters: { viewport: { defaultViewport: "laptop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-race-list");
    await expect(canvas.getByTestId("industry-race-screen")).toBeInTheDocument();
  },
};
