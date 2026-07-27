import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DailyRaceScreen } from "./DailyRaceScreen";

const BASE = "http://localhost:3000";
const RACE_ID = "rac_1";

const MOCK_RACE = {
  raceId: RACE_ID, eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
  offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
  distanceF: "16.0", region: "GB", raceClass: "Class 4", type: "Hurdle", ageBand: "4yo+",
  prize: "£3,769", fieldSize: "2", going: "Good", surface: "Turf",
  runners: [
    {
      runnerId: "hrs_1", horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
      region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
      damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
      owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
      officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
    },
    {
      runnerId: "hrs_2", horse: "Second Fixture", age: "5", sex: "mare", sexCode: "M", colour: "ch",
      region: "IRE", dam: "Second Dam", damId: "dam_2", sire: "Second Sire", sireId: "sir_2",
      damsire: "Second Damsire", damsireId: "dsi_2", trainer: "C Trainer", trainerId: "trn_2",
      owner: "Owner 2", ownerId: "own_2", number: "2", draw: "0", headgear: "p", lbs: "147",
      officialRating: "91", jockey: "D Jockey", jockeyId: "jky_2", lastRun: "14", form: "3-45",
    },
  ],
};

const defaultHandlers = [
  http.get(`${BASE}/api/daily-races/race/:raceId`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACE })
  ),
];

const meta: Meta<typeof DailyRaceScreen> = {
  title: "Components/DailyRaceScreen",
  component: DailyRaceScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    raceId: RACE_ID,
    onNavigateToEvent: fn(),
    onNavigateToRunner: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-race-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("daily-race-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-race-list");
    for (const runner of MOCK_RACE.runners) {
      await expect(canvas.getByTestId(`daily-race-item-${runner.runnerId}`)).toBeInTheDocument();
    }
  },
};

export const BackButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-race-list");
    await userEvent.click(canvas.getByTestId("daily-race-back-button"));
    await expect(args.onNavigateToEvent).toHaveBeenCalledWith(MOCK_RACE.eventId);
  },
};

export const NavigationTriggered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-race-list");
    await userEvent.click(canvas.getByTestId(`daily-race-item-${MOCK_RACE.runners[0].runnerId}`));
    await expect(args.onNavigateToRunner).toHaveBeenCalledWith(RACE_ID, MOCK_RACE.runners[0].runnerId);
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races/race/:raceId`, async () => {
          await new Promise((r) => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: MOCK_RACE });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-race-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-race-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races/race/:raceId`, () =>
          HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByTestId("daily-race-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("daily-race-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/daily-races/race/:raceId`, () =>
          HttpResponse.json({ success: true, data: { ...MOCK_RACE, runners: [] } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("daily-race-empty")).resolves.toBeInTheDocument();
  },
};
