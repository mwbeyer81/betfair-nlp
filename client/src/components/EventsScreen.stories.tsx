import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { EventsScreen } from "./EventsScreen";

const MOCK_GROUPS = [
  {
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    marketIds: ["1.237066150"],
    count: 1,
  },
  {
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    marketIds: ["1.238923739", "1.238923745"],
    count: 2,
  },
];

const MOCK_STATS = { totalRaces: 8, totalRunners: 109 };

const BASE = "http://localhost:3000";

const defaultHandlers = [
  http.get(`${BASE}/api/events/grouped`, () =>
    HttpResponse.json({ success: true, data: MOCK_GROUPS })
  ),
  http.get(`${BASE}/api/stats`, () =>
    HttpResponse.json({ success: true, data: MOCK_STATS })
  ),
];

const meta: Meta<typeof EventsScreen> = {
  title: "Components/EventsScreen",
  component: EventsScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    onNavigateToChat: fn(),
    onLogout: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/events/grouped`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [] });
        }),
        http.get(`${BASE}/api/stats`, () =>
          HttpResponse.json({ success: true, data: MOCK_STATS })
        ),
      ],
    },
  },
};

export const WithError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/events/grouped`, () => HttpResponse.error()),
        http.get(`${BASE}/api/stats`, () => HttpResponse.error()),
      ],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/events/grouped`, () =>
          HttpResponse.json({ success: true, data: [] })
        ),
        http.get(`${BASE}/api/stats`, () =>
          HttpResponse.json({ success: true, data: MOCK_STATS })
        ),
      ],
    },
  },
};

export const EventsLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("events-screen")).toBeInTheDocument();

    // Stats bar appears — element exists immediately but content updates async
    await expect(canvas.findByTestId("events-stats-bar")).resolves.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("events-total-runners")).toHaveTextContent("109 runners"), { timeout: 5000 });
    await expect(canvas.getByTestId("events-total-races")).toHaveTextContent("8 races");

    // Event list renders
    await expect(canvas.findByTestId("event-group-item-33858191")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Cheltenham 1st Jan")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("event-group-item-33988522")).resolves.toBeInTheDocument();
  },
};

export const ChatButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const chatBtn = canvas.getByTestId("events-screen-chat-button");
    await expect(chatBtn).toBeInTheDocument();

    await userEvent.click(chatBtn);
    await expect(args.onNavigateToChat).toHaveBeenCalledTimes(1);
  },
};

export const EventBadgesVisible: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Wait for events to load
    const runnersBadge = await canvas.findByTestId("event-runners-badge-33858191");
    await expect(runnersBadge).toBeInTheDocument();
    await expect(canvas.getByTestId("event-docs-badge-33858191")).toBeInTheDocument();
    await expect(canvas.getByTestId("event-price-updates-badge-33858191")).toBeInTheDocument();
  },
};
