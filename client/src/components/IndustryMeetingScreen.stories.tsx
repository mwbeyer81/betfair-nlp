import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { IndustryMeetingScreen } from "./IndustryMeetingScreen";

const BASE = "http://localhost:3000";
const MEETING_ID = "Cheltenham|2026-03-01";

const MOCK_RACES = [
  {
    raceId: 914592,
    meetingId: MEETING_ID,
    meetingName: "Cheltenham — 1 March 2026",
    course: "Cheltenham",
    countryCode: "GB",
    raceTime: "2026-03-01T14:01:00",
    raceName: "Cheltenham Chase",
    raceType: "Chase",
    ran: 2,
    runners: [
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false },
    ],
  },
  {
    raceId: 914593,
    meetingId: MEETING_ID,
    meetingName: "Cheltenham — 1 March 2026",
    course: "Cheltenham",
    countryCode: "GB",
    raceTime: "2026-03-01T14:35:00",
    raceName: "Cheltenham Hurdle",
    raceType: "Hurdle",
    ran: 2,
    runners: [
      { id: 22001, name: "State Man", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.4, ispFraction: "2/5", isFavourite: true },
      { id: 22002, name: "Brighterdaysahead", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 6.0, ispFraction: "5/1", isFavourite: false },
    ],
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp/meeting/:meetingId`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACES, count: MOCK_RACES.length })
  ),
];

const meta: Meta<typeof IndustryMeetingScreen> = {
  title: "Components/IndustryMeetingScreen",
  component: IndustryMeetingScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    meetingId: MEETING_ID,
    onBack: fn(),
    onNavigateToRace: fn(),
    onNavigateToRunner: fn(),
    onNavigateToTrainer: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-meeting-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-meeting-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    for (const race of MOCK_RACES) {
      await expect(canvas.getByTestId(`industry-meeting-race-${race.raceId}`)).toBeInTheDocument();
      for (const runner of race.runners) {
        await expect(canvas.getByTestId(`industry-meeting-item-${runner.id}`)).toBeInTheDocument();
      }
    }
  },
};

export const BackButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    await userEvent.click(canvas.getByTestId("industry-meeting-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const RaceRowNavigatesToRace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    await userEvent.click(canvas.getByTestId(`industry-meeting-race-${MOCK_RACES[0].raceId}`));
    await expect(args.onNavigateToRace).toHaveBeenCalledWith(MOCK_RACES[0].raceId);
  },
};

export const OddsModeToggle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    await expect(canvas.getByTestId("industry-meeting-odds-mode-toggle")).toHaveTextContent("Odds: Fraction");
    await expect(canvas.getByTestId(`industry-meeting-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 19/20");

    await userEvent.click(canvas.getByTestId("industry-meeting-odds-mode-toggle"));
    await expect(canvas.getByTestId("industry-meeting-odds-mode-toggle")).toHaveTextContent("Odds: Decimal");
    await expect(canvas.getByTestId(`industry-meeting-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 1.95");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/meeting/:meetingId`, async () => {
          await new Promise((r) => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-meeting-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-meeting-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/meeting/:meetingId`, () =>
          HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("industry-meeting-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("industry-meeting-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/meeting/:meetingId`, () =>
          HttpResponse.json({ success: true, data: [], count: 0 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("No races found.")).resolves.toBeInTheDocument();
  },
};

export const RendersAtIphone12: Story = {
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    await expect(canvas.getByTestId("industry-meeting-screen")).toBeInTheDocument();
  },
};

export const RendersAtLaptop: Story = {
  parameters: { viewport: { defaultViewport: "laptop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    await expect(canvas.getByTestId("industry-meeting-screen")).toBeInTheDocument();
  },
};
