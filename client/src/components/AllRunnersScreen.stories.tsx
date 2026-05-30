import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { AllRunnersScreen } from "./AllRunnersScreen";

const BASE = "http://localhost:3000";

const MOCK_RACES = [
  {
    marketId: "1.237066150",
    marketTime: "2025-01-01T14:01:00.000Z",
    marketType: "ANTEPOST_WIN",
    marketName: "Cheltenham Chase",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    runners: [
      { id: 26817268, name: "Gemirande", status: "LOSER", sortPriority: 1 },
      { id: 39281327, name: "Springwell Bay", status: "WINNER", sortPriority: 2 },
      { id: 43581487, name: "Madara", status: "LOSER", sortPriority: 3 },
    ],
  },
  {
    marketId: "1.238923739",
    marketTime: "2025-02-01T13:15:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:15",
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    runners: [
      { id: 21001, name: "Galopin Des Champs", status: "WINNER", sortPriority: 1, bsp: 1.95 },
      { id: 21002, name: "Meetingofthewaters", status: "LOSER", sortPriority: 2, bsp: 5.5 },
    ],
  },
  {
    marketId: "1.238923745",
    marketTime: "2025-02-01T13:50:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:50",
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    runners: [
      { id: 22001, name: "State Man", status: "WINNER", sortPriority: 1, bsp: 1.4 },
      { id: 22002, name: "Brighterdaysahead", status: "LOSER", sortPriority: 2, bsp: 6.0 },
    ],
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/runners`, () =>
    HttpResponse.json({
      success: true,
      data: MOCK_RACES,
      count: MOCK_RACES.length,
      totalRunners: MOCK_RACES.reduce((s, r) => s + r.runners.length, 0),
    })
  ),
];

const meta: Meta<typeof AllRunnersScreen> = {
  title: "Components/AllRunnersScreen",
  component: AllRunnersScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    onNavigateToEvents: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0, totalRunners: 0 });
        }),
      ],
    },
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/runners`, () => HttpResponse.error())] },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/runners`, () =>
          HttpResponse.json({ success: true, data: [], count: 0, totalRunners: 0 })
        ),
      ],
    },
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("all-runners-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-list")).resolves.toBeInTheDocument();

    // Header shows title and runner count
    await expect(canvas.findByText("All Runners")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("7 runners · 3 races")).resolves.toBeInTheDocument();
  },
};

export const EventSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("all-runners-event-33858191")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Cheltenham 1st Jan")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-event-33988522")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Leopardstown 1st Feb")).resolves.toBeInTheDocument();
  },
};

export const RaceAndRunnerRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("all-runners-race-1.237066150")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("all-runners-race-1.238923739")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("all-runner-item-26817268")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
  },
};

export const EventsButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const btn = canvas.getByTestId("all-runners-screen-events-button");
    await expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    await expect(args.onNavigateToEvents).toHaveBeenCalledTimes(1);
  },
};

export const BspDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // WIN market runners have bsp; verify they appear with SP badge
    const bspRunners = MOCK_RACES.filter(r => r.marketType === "WIN").flatMap(r => r.runners);
    for (const runner of bspRunners) {
      const bspEl = await canvas.findByTestId(`all-runner-bsp-${runner.id}`);
      await expect(bspEl).toBeInTheDocument();
      await expect(bspEl).toHaveTextContent(`SP ${runner.bsp}`);
    }
  },
};

export const NoBspWhenAbsent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Cheltenham ANTEPOST_WIN runners have no bsp
    const cheltenhamRunners = MOCK_RACES.filter(r => r.eventId === "33858191").flatMap(r => r.runners);
    for (const runner of cheltenhamRunners) {
      await expect(canvas.queryByTestId(`all-runner-bsp-${runner.id}`)).not.toBeInTheDocument();
    }
  },
};
