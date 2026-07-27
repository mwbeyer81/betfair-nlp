import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DailyRaceEventScreen } from "./DailyRaceEventScreen";

const BASE = "http://localhost:3000";
const EVENT_ID = "newton-abbot-2026-06-03";

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
    raceId: "rac_1", eventId: EVENT_ID, course: "Newton Abbot", date: "2026-06-03",
    offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
    distanceF: "16.0", region: "GB", raceClass: "Class 4", type: "Hurdle", ageBand: "4yo+",
    prize: "£3,769", fieldSize: "1", going: "Good", surface: "Turf",
    runners: [runner()],
  },
  {
    raceId: "rac_2", eventId: EVENT_ID, course: "Newton Abbot", date: "2026-06-03",
    offTime: "2:25", offDt: "2026-06-03T14:25:00+01:00", raceName: "Handicap Chase",
    distanceF: "24.0", region: "GB", raceClass: "Class 3", type: "Chase", ageBand: "5yo+",
    prize: "£5,912", fieldSize: "1", going: "Good", surface: "Turf",
    runners: [runner({ runnerId: "hrs_2", horse: "Chase Fixture" })],
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/daily-races/event/:eventId`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACES, count: MOCK_RACES.length })
  ),
];

const meta: Meta<typeof DailyRaceEventScreen> = {
  title: "Components/DailyRaceEventScreen",
  component: DailyRaceEventScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    eventId: EVENT_ID,
    onBack: fn(),
    onNavigateToRace: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-race-event-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("daily-race-event-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-race-event-list");
    for (const race of MOCK_RACES) {
      await expect(canvas.getByTestId(`daily-race-event-race-${race.raceId}`)).toBeInTheDocument();
    }
  },
};

export const BackButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-race-event-list");
    await userEvent.click(canvas.getByTestId("daily-race-event-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const NavigationTriggered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-race-event-list");
    await userEvent.click(canvas.getByTestId(`daily-race-event-race-${MOCK_RACES[0].raceId}`));
    await expect(args.onNavigateToRace).toHaveBeenCalledWith(MOCK_RACES[0].raceId);
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races/event/:eventId`, async () => {
          await new Promise((r) => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-race-event-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-race-event-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races/event/:eventId`, () =>
          HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("daily-race-event-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("daily-race-event-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races/event/:eventId`, () =>
          HttpResponse.json({ success: true, data: [], count: 0 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("daily-race-event-empty")).resolves.toBeInTheDocument();
  },
};
