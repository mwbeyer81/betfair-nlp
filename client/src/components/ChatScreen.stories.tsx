import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect } from "@storybook/test";
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
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EventsPanelFlow: Story = {
  parameters: {
    msw: { handlers: BASE_HANDLERS },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Open events panel
    const eventsBtn = canvas.getByTestId("events-button");
    await expect(eventsBtn).toBeInTheDocument();
    await userEvent.click(eventsBtn);

    // Wait for panel + data to load
    await expect(canvas.getByTestId("events-panel")).toBeInTheDocument();
    const cheltenhamItem = await canvas.findByTestId("event-group-item-33858191", {}, { timeout: 8000 });
    await expect(cheltenhamItem).toBeInTheDocument();

    // Both badges should be visible
    await expect(canvas.getByTestId("event-docs-badge-33858191")).toBeInTheDocument();
    await expect(canvas.getByTestId("event-price-updates-badge-33858191")).toBeInTheDocument();
  },
};

export const PriceUpdatesFlow: Story = {
  parameters: {
    msw: { handlers: BASE_HANDLERS },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 1. Open events panel
    await userEvent.click(canvas.getByTestId("events-button"));

    // 2. Wait for Cheltenham event to appear
    const cheltenhamItem = await canvas.findByTestId("event-group-item-33858191", {}, { timeout: 8000 });
    await expect(cheltenhamItem).toBeInTheDocument();

    // 3. Click the price updates badge
    const priceUpdatesBadge = canvas.getByTestId("event-price-updates-badge-33858191");
    await userEvent.click(priceUpdatesBadge);

    // 4. Price updates panel should open
    await expect(canvas.getByTestId("price-updates-panel")).toBeInTheDocument();

    // 5. Wait for records to load
    const firstItem = await canvas.findByTestId("price-update-item-0", {}, { timeout: 8000 });
    await expect(firstItem).toBeInTheDocument();

    // 6. Verify runner name from mock data
    await expect(canvas.getByText(/Springwell Bay/)).toBeInTheDocument();

    // 7. Close the panel
    await userEvent.click(canvas.getByTestId("price-updates-close"));
    await expect(canvas.queryByTestId("price-updates-panel")).not.toBeInTheDocument();
  },
};
