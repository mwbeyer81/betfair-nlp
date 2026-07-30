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

// Same decorator pattern IspRacesScreen.stories.tsx uses to simulate
// arriving with filter query params already in the URL (see App.tsx's
// onNavigateToMeeting/onNavigateToRace, threaded from SavedResultDetailScreen's
// Live Performance section) — this screen reads them directly via
// ispUrlParams.ts's urlQualifyingFilterParams(), not via props.
const withQueryParams = (search: string) => {
  const Decorator = (Story: React.ComponentType) => {
    window.history.pushState({}, "", `${window.location.pathname}?${search}`);
    return <Story />;
  };
  return Decorator;
};

// Regression coverage for a real prod bug (reported live with a
// screenshot): tapping through from a saved filter's Live Performance
// section into a meeting showed every race/runner at that meeting, not
// just what the filter actually selected. Race 1 has one qualifying and
// one non-qualifying runner; race 2 has none at all, so under a filter it
// should be dropped entirely rather than shown empty.
const FILTERED_MOCK_RACES = [
  {
    ...MOCK_RACES[0],
    runners: [
      { id: 21001, name: "Galopin Des Champs", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.95, ispFraction: "19/20", isFavourite: true, modelWinProbability: 60 },
      { id: 21002, name: "Meetingofthewaters", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 5.5, ispFraction: "9/2", isFavourite: false },
    ],
  },
  {
    ...MOCK_RACES[1],
    runners: [
      { id: 22001, name: "State Man", num: 1, draw: null, status: "WINNER", sortPriority: 1, isp: 1.4, ispFraction: "2/5", isFavourite: true },
      { id: 22002, name: "Brighterdaysahead", num: 2, draw: null, status: "LOSER", sortPriority: 2, isp: 6.0, ispFraction: "5/1", isFavourite: false },
    ],
  },
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

export const FilterActiveShowsOnlyQualifyingRacesAndRunners: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/meeting/:meetingId`, () =>
          HttpResponse.json({ success: true, data: FILTERED_MOCK_RACES, count: FILTERED_MOCK_RACES.length })
        ),
      ],
    },
  },
  decorators: [withQueryParams("onlyModelBeatsSp=true&minModelWinProbability=20")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await canvas.findByTestId("industry-meeting-list");

      // Race 1 shows only its one qualifying runner...
      await expect(canvas.getByTestId("industry-meeting-race-914592")).toBeInTheDocument();
      await expect(canvas.getByTestId("industry-meeting-item-21001")).toBeInTheDocument();
      await expect(canvas.queryByTestId("industry-meeting-item-21002")).not.toBeInTheDocument();
      // ...race 2 has zero qualifying runners, so it's dropped entirely.
      await expect(canvas.queryByTestId("industry-meeting-race-914593")).not.toBeInTheDocument();

      await expect(canvas.getByTestId("industry-meeting-screen")).toHaveTextContent("1 races");
      await expect(canvas.getByTestId("industry-meeting-screen")).toHaveTextContent("1 qualifying runners");
    } finally {
      window.history.pushState({}, "", window.location.pathname);
    }
  },
};

export const NoFilterInUrlShowsEveryRaceAndRunner: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/meeting/:meetingId`, () =>
          HttpResponse.json({ success: true, data: FILTERED_MOCK_RACES, count: FILTERED_MOCK_RACES.length })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-meeting-list");
    // A plain browse-in (no filter query params at all) shows every race
    // and runner, unchanged from before filter-awareness existed.
    await expect(canvas.getByTestId("industry-meeting-race-914592")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-meeting-race-914593")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-meeting-item-21002")).toBeInTheDocument();
  },
};
