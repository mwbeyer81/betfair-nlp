import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { IspRacesScreen } from "./IspRacesScreen";

const BASE = "http://localhost:3000";

const MOCK_RACES: Array<{
  raceId: number;
  meetingId: string;
  meetingName: string;
  course: string;
  countryCode: string;
  raceTime: string;
  raceName: string;
  raceType: string;
  ran: number;
  runners: Array<{
    id: number; name: string; num: number | null; draw: number | null; status: string; sortPriority: number;
    isp: number; ispFraction: string; isFavourite: boolean;
    trainer?: string; trainerFormRuns?: number; trainerFormWins?: number; trainerFormWinRate?: number | null;
  }>;
}> = [
  {
    raceId: 914592,
    meetingId: "Leopardstown|2026-02-01",
    meetingName: "Leopardstown — 1 February 2026",
    course: "Leopardstown",
    countryCode: "IE",
    raceTime: "2026-02-01T13:15:00",
    raceName: "Leopardstown 13:15",
    raceType: "Chase",
    ran: 2,
    runners: [
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true, trainer: "W P Mullins", trainerFormRuns: 14, trainerFormWins: 3, trainerFormWinRate: 21.43 },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false, trainer: "Emmet Mullins" },
    ],
  },
  {
    raceId: 914593,
    meetingId: "Leopardstown|2026-02-01",
    meetingName: "Leopardstown — 1 February 2026",
    course: "Leopardstown",
    countryCode: "IE",
    raceTime: "2026-02-01T13:50:00",
    raceName: "Leopardstown 13:50",
    raceType: "Hurdle",
    ran: 2,
    runners: [
      { id: 22001, name: "State Man", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.4, ispFraction: "2/5", isFavourite: true },
      { id: 22002, name: "Brighterdaysahead", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 6.0, ispFraction: "5/1", isFavourite: false },
    ],
  },
];

const TOTAL_RUNNERS_IN_DB = MOCK_RACES.reduce((s, r) => s + r.runners.length, 0); // 4

const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp`, () =>
    HttpResponse.json({
      success: true,
      data: MOCK_RACES,
      count: MOCK_RACES.length,
      total: MOCK_RACES.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      totalRunners: TOTAL_RUNNERS_IN_DB,
      pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
    })
  ),
];

const meta: Meta<typeof IspRacesScreen> = {
  title: "Components/IspRacesScreen",
  component: IspRacesScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    onBack: fn(),
    onNavigateToMeeting: fn(),
    onNavigateToRace: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-sp-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-list")).not.toBeInTheDocument();
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/industry-sp`, () => HttpResponse.error())] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("industry-sp-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-list")).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: [],
            count: 0,
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 1,
            totalRunners: 0,
            pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText("No races found.")).resolves.toBeInTheDocument();
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("industry-sp-races-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-list")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Races")).resolves.toBeInTheDocument();
  },
};

export const BackButtonCallsOnBack: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-races-back");
    await expect(btn).toHaveTextContent("Filters");
    await userEvent.click(btn);
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const MeetingSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("industry-sp-meeting-Leopardstown|2026-02-01")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Leopardstown — 1 February 2026")).resolves.toBeInTheDocument();
  },
};

export const RaceAndRunnerRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("industry-sp-race-914592")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
  },
};

export const MeetingHeaderNavigatesToMeeting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const link = canvas.getByTestId(`industry-sp-meeting-link-${MOCK_RACES[0].meetingId}`);
    await userEvent.click(link);
    await expect(args.onNavigateToMeeting).toHaveBeenCalledWith(MOCK_RACES[0].meetingId);
  },
};

export const RaceRowNavigatesToRace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const raceRow = canvas.getByTestId(`industry-sp-race-${MOCK_RACES[0].raceId}`);
    await userEvent.click(raceRow);
    await expect(args.onNavigateToRace).toHaveBeenCalledWith(MOCK_RACES[0].raceId);
  },
};

export const OddsModeDefaultsToFraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-odds-mode-toggle")).toHaveTextContent("Odds: Fraction");
    await expect(canvas.getByTestId(`industry-sp-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 19/20");
  },
};

export const OddsModeToggleSwitchesToDecimal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await userEvent.click(canvas.getByTestId("industry-sp-odds-mode-toggle"));
    await expect(canvas.getByTestId("industry-sp-odds-mode-toggle")).toHaveTextContent("Odds: Decimal");
    // 19/20 + 1 = 1.95 — a clean 2dp value, never a raw float artifact.
    await expect(canvas.getByTestId(`industry-sp-isp-${MOCK_RACES[0].runners[0].id}`)).toHaveTextContent("ISP 1.95");
  },
};

export const IspDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const runners = MOCK_RACES.flatMap(r => r.runners);
    for (const runner of runners) {
      const ispEl = await canvas.findByTestId(`industry-sp-isp-${runner.id}`);
      await expect(ispEl).toBeInTheDocument();
      await expect(ispEl).toHaveTextContent(`ISP ${runner.ispFraction}`);
    }
  },
};

export const PerRunnerPnl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Galopin Des Champs: WINNER at ISP 1.95, stake £1.05 → +£1.00
    await expect(await canvas.findByTestId("industry-sp-pnl-item-21001")).toHaveTextContent("+£1.00");
    await expect(canvas.getByTestId("industry-sp-stake-21001")).toHaveTextContent("Bet £1.05");
    // Meetingofthewaters: LOSER at ISP 5.5, stake £0.22 → -£0.22
    await expect(canvas.getByTestId("industry-sp-pnl-item-21002")).toHaveTextContent("-£0.22");
    await expect(canvas.getByTestId("industry-sp-stake-21002")).toHaveTextContent("Bet £0.22");
  },
};

export const TrainerFormBadgeDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    // Galopin Des Champs has a 14-day form sample — badge shows win/run/rate.
    await expect(canvas.getByTestId("industry-sp-item-trainer-21001")).toHaveTextContent("W P Mullins");
    await expect(canvas.getByTestId("industry-sp-item-trainer-form-21001")).toHaveTextContent("3/14");
    await expect(canvas.getByTestId("industry-sp-item-trainer-form-21001")).toHaveTextContent("21%");

    // Meetingofthewaters has a trainer but no form sample — name shows, no badge.
    await expect(canvas.getByTestId("industry-sp-item-trainer-21002")).toHaveTextContent("Emmet Mullins");
    await expect(canvas.queryByTestId("industry-sp-item-trainer-form-21002")).not.toBeInTheDocument();
  },
};

export const SortToggleVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-sort-toggle");
    await expect(btn).toBeInTheDocument();
    await expect(btn).toHaveTextContent("First → Last");
  },
};

export const SortToggleSwitchesToDesc: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");

    const btn = canvas.getByTestId("industry-sp-sort-toggle");
    await expect(btn).toHaveTextContent("First → Last");
    await userEvent.click(btn);
    await expect(btn).toHaveTextContent("Last → First");
  },
};

export const LoadMoreVisibleWhenMorePagesExist: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: MOCK_RACES,
            count: MOCK_RACES.length,
            total: 50,
            page: 1,
            limit: 20,
            totalPages: 3,
            totalRunners: TOTAL_RUNNERS_IN_DB,
            pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-load-more")).toHaveTextContent("Load more (48 remaining)");
  },
};

export const RendersAtIphone12: Story = {
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-races-screen")).toBeInTheDocument();
  },
};

export const RendersAtLaptop: Story = {
  parameters: { viewport: { defaultViewport: "laptop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-list");
    await expect(canvas.getByTestId("industry-sp-races-screen")).toBeInTheDocument();
  },
};
