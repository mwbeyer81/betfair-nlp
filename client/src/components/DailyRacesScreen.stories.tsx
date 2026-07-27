import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DailyRacesScreen } from "./DailyRacesScreen";

const BASE = "http://localhost:3000";

function runner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runnerId: "hrs_1", horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
    region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
    damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
    owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
    officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
    ...overrides,
  };
}

const MOCK_RACES = [
  {
    raceId: "rac_1", eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
    offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
    distanceF: "16.0", region: "GB", raceClass: "Class 4", type: "Hurdle", ageBand: "4yo+",
    prize: "£3,769", fieldSize: "1", going: "Good", surface: "Turf",
    runners: [runner()],
  },
  {
    raceId: "rac_2", eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
    offTime: "2:25", offDt: "2026-06-03T14:25:00+01:00", raceName: "Handicap Chase",
    distanceF: "24.0", region: "GB", raceClass: "Class 3", type: "Chase", ageBand: "5yo+",
    prize: "£5,912", fieldSize: "1", going: "Good", surface: "Turf",
    runners: [runner({ runnerId: "hrs_2", horse: "Chase Fixture" })],
  },
  {
    raceId: "rac_3", eventId: "ascot-2026-06-03", course: "Ascot", date: "2026-06-03",
    offTime: "3:05", offDt: "2026-06-03T15:05:00+01:00", raceName: "Maiden Stakes",
    distanceF: "8.0", region: "GB", raceClass: "Class 2", type: "Flat", ageBand: "3yo",
    prize: "£9,400", fieldSize: "1", going: "Good to Firm", surface: "Turf",
    runners: [runner({ runnerId: "hrs_3", horse: "Ascot Fixture" })],
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/daily-races`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACES, count: MOCK_RACES.length })
  ),
];

const meta: Meta<typeof DailyRacesScreen> = {
  title: "Components/DailyRacesScreen",
  component: DailyRacesScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onNavigateToEvent: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-races-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("daily-races-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await expect(canvas.getByTestId("daily-races-event-newton-abbot-2026-06-03")).toBeInTheDocument();
    await expect(canvas.getByTestId("daily-races-event-ascot-2026-06-03")).toBeInTheDocument();
  },
};

export const NavigationTriggered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-races-list");
    await userEvent.click(canvas.getByTestId("daily-races-event-ascot-2026-06-03"));
    await expect(args.onNavigateToEvent).toHaveBeenCalledWith("ascot-2026-06-03");
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, async () => {
          await new Promise((r) => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-races-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-races-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("daily-races-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("daily-races-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races`, () =>
          HttpResponse.json({ success: true, data: [], count: 0 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("daily-races-empty")).resolves.toBeInTheDocument();
  },
};
