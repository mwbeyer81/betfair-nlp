import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ChatScreen } from "./ChatScreen";

const MOCK_GROUPS = [
  {
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    marketIds: ["1.237066150"],
    count: 25,
  },
  {
    eventId: "33928245",
    eventName: "Newbury 15th Feb",
    marketIds: ["1.238000001"],
    count: 8,
  },
];

const MOCK_PRICE_UPDATES = [
  {
    _id: "pu1",
    marketId: "1.237066150",
    runnerId: 39281327,
    runnerName: "Springwell Bay",
    lastTradedPrice: 4.5,
    timestamp: "2025-01-01T14:10:00.000Z",
    changeId: "12890365544",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
  },
  {
    _id: "pu2",
    marketId: "1.237066150",
    runnerId: 48945543,
    runnerName: "Colonel Harry",
    lastTradedPrice: 7.0,
    timestamp: "2025-01-01T14:09:00.000Z",
    changeId: "12890365543",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
  },
  {
    _id: "pu3",
    marketId: "1.237066150",
    runnerId: 26817268,
    runnerName: "Gemirande",
    lastTradedPrice: 12.0,
    timestamp: "2025-01-01T14:08:00.000Z",
    changeId: "12890365542",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
  },
];

const BASE_HANDLERS = [
  http.get("http://localhost:3000/api/events/grouped", () =>
    HttpResponse.json({ success: true, data: MOCK_GROUPS })
  ),
  http.get("http://localhost:3000/api/events/:eventId/price-updates", () =>
    HttpResponse.json({ success: true, data: MOCK_PRICE_UPDATES, count: MOCK_PRICE_UPDATES.length })
  ),
  http.get("http://localhost:3000/api/events/:eventId/definitions", () =>
    HttpResponse.json({ success: true, data: [], count: 0 })
  ),
];

const meta: Meta<typeof ChatScreen> = {
  title: "Components/ChatScreen",
  component: ChatScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: BASE_HANDLERS },
  },
  decorators: [
    Story => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onNavigateToEvents: fn(),
    onLogout: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EventsButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const eventsBtn = canvas.getByTestId("events-button");
    await expect(eventsBtn).toBeInTheDocument();
    await userEvent.click(eventsBtn);
    await expect(args.onNavigateToEvents).toHaveBeenCalledTimes(1);
  },
};
