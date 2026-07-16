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
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, isFavourite: true },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, isFavourite: false },
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
      { id: 22001, name: "State Man", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.4, isFavourite: true },
      { id: 22002, name: "Brighterdaysahead", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 6.0, isFavourite: false },
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
    meetingId: MEETING_ID,
    onBack: fn(),
    onNavigateToRace: fn(),
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
    await userEvent.click(canvas.getByTestId("industry-meeting-back"));
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
