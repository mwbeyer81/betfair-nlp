import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DailyRunnerDetailScreen } from "./DailyRunnerDetailScreen";

const BASE = "http://localhost:3000";
const RACE_ID = "rac_1";
const RUNNER_ID = "hrs_1";

const MOCK_RACE = {
  raceId: RACE_ID, eventId: "newton-abbot-2026-06-03", course: "Newton Abbot", date: "2026-06-03",
  offTime: "1:50", offDt: "2026-06-03T13:50:00+01:00", raceName: "Novices' Hurdle",
  distanceF: "16.0", region: "GB", raceClass: "Class 4", type: "Hurdle", ageBand: "4yo+",
  prize: "£3,769", fieldSize: "1", going: "Good", surface: "Turf",
  runners: [
    {
      runnerId: RUNNER_ID, horse: "Fixture Star", age: "6", sex: "gelding", sexCode: "G", colour: "b",
      region: "GB", dam: "Star Dam", damId: "dam_1", sire: "Star Sire", sireId: "sir_1",
      damsire: "Star Damsire", damsireId: "dsi_1", trainer: "A Trainer", trainerId: "trn_1",
      owner: "Owner", ownerId: "own_1", number: "1", draw: "0", headgear: "", lbs: "154",
      officialRating: "98", jockey: "B Jockey", jockeyId: "jky_1", lastRun: "21", form: "1-21",
      modelWinProbability: 41.7, modelVersionId: "xgb-test-version",
    },
  ],
};

const defaultHandlers = [
  http.get(`${BASE}/api/daily-races/race/:raceId`, () =>
    HttpResponse.json({ success: true, data: MOCK_RACE })
  ),
];

const meta: Meta<typeof DailyRunnerDetailScreen> = {
  title: "Components/DailyRunnerDetailScreen",
  component: DailyRunnerDetailScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    raceId: RACE_ID,
    runnerId: RUNNER_ID,
    onBack: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("daily-runner-detail-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("daily-runner-detail-list")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-runner-detail-list");
    await expect(canvas.getByTestId("daily-runner-detail-course")).toHaveTextContent("Newton Abbot");
    await expect(canvas.getByTestId("daily-runner-detail-trainer")).toHaveTextContent("A Trainer");
    await expect(canvas.getByTestId("daily-runner-detail-jockey")).toHaveTextContent("B Jockey");
    await expect(canvas.getByTestId("daily-runner-detail-form")).toHaveTextContent("1-21");
    await expect(canvas.getByTestId("daily-runner-detail-model-win-probability")).toHaveTextContent("41.7%");
  },
};

export const BackButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("daily-runner-detail-list");
    await userEvent.click(canvas.getByTestId("daily-runner-detail-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
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
    await expect(canvas.getByTestId("daily-runner-detail-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("daily-runner-detail-list")).not.toBeInTheDocument();
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
      await expect(canvas.getByTestId("daily-runner-detail-error")).toBeInTheDocument();
    });
    await expect(canvas.queryByTestId("daily-runner-detail-list")).not.toBeInTheDocument();
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
    await expect(canvas.findByTestId("daily-runner-detail-not-found")).resolves.toBeInTheDocument();
  },
};
