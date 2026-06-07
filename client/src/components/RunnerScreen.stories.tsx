import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { RunnerScreen } from "./RunnerScreen";

const BASE = "http://localhost:3000";

const MOCK_UPDATES = [
  {
    _id: "pu1", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs",
    lastTradedPrice: 1.95, tradedVolume: 1500,
    bestBackPrice: 1.96, bestBackSize: 312,
    bestLayPrice: 1.97, bestLaySize: 88,
    timestamp: "2025-02-01T13:14:00.000Z", changeId: "c1", eventId: "33988522", eventName: "Leopardstown 1st Feb",
  },
  {
    _id: "pu2", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs",
    lastTradedPrice: 1.9, tradedVolume: 1350,
    bestBackPrice: 1.91, bestBackSize: 550,
    bestLayPrice: 1.92, bestLaySize: 140,
    timestamp: "2025-02-01T13:10:00.000Z", changeId: "c2", eventId: "33988522", eventName: "Leopardstown 1st Feb",
  },
  {
    _id: "pu3", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs",
    lastTradedPrice: 2.0, tradedVolume: 1200,
    bestBackPrice: 2.02, bestBackSize: 780,
    bestLayPrice: 2.04, bestLaySize: 200,
    timestamp: "2025-02-01T13:05:00.000Z", changeId: "c3", eventId: "33988522", eventName: "Leopardstown 1st Feb",
  },
];

const defaultHandlers = [
  http.get(`${BASE}/api/events/:eventId/runners/:runnerId/price-updates`, () =>
    HttpResponse.json({ success: true, data: MOCK_UPDATES, count: MOCK_UPDATES.length })
  ),
];

const meta: Meta<typeof RunnerScreen> = {
  title: "Components/RunnerScreen",
  component: RunnerScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    eventId: "33988522",
    runnerId: 21001,
    runnerName: "Galopin Des Champs",
    onBack: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/events/:eventId/runners/:runnerId/price-updates`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
      ],
    },
  },
};

export const WithError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/events/:eventId/runners/:runnerId/price-updates`, () =>
          HttpResponse.error()
        ),
      ],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/events/:eventId/runners/:runnerId/price-updates`, () =>
          HttpResponse.json({ success: true, data: [], count: 0 })
        ),
      ],
    },
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("runner-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("runner-screen-list")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Galopin Des Champs")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("3 price updates")).resolves.toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.findByTestId("runner-screen-item-0")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("runner-screen-item-2")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("1.95")).resolves.toBeInTheDocument();

    // Implied probability shown
    await expect(canvas.findByTestId("runner-screen-prob-0")).resolves.toHaveTextContent("51.3%");

    // Order book chips shown when data present
    await expect(canvas.findByTestId("runner-screen-back-0")).resolves.toHaveTextContent("Back £312 @ 1.96");
    await expect(canvas.findByTestId("runner-screen-lay-0")).resolves.toHaveTextContent("Lay £88 @ 1.97");

    // Volume delta shown
    await expect(canvas.findByTestId("runner-screen-volume-0")).resolves.toHaveTextContent("+£150 matched");
  },
};

export const BackButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const btn = canvas.getByTestId("runner-screen-back");
    await expect(btn).toBeInTheDocument();
    await expect(btn).toHaveTextContent("← Runners");
    await userEvent.click(btn);
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  parameters: Loading.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runner-screen-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("runner-screen-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: WithError.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("runner-screen-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("runner-screen-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: Empty.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("runner-screen-list")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("No price updates found.")).resolves.toBeInTheDocument();
  },
};

export const PriceDirection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-screen-item-0");
    // Row 0 (1.95) vs row 1 (1.90): price went up → drifted → ▲ red
    await expect(canvas.getByTestId("runner-screen-direction-0")).toHaveTextContent("▲");
    // Row 1 (1.90) vs row 2 (2.00): price shortened → ▼ green
    await expect(canvas.getByTestId("runner-screen-direction-1")).toHaveTextContent("▼");
    // Last row: no previous → –
    await expect(canvas.getByTestId("runner-screen-direction-2")).toHaveTextContent("–");
  },
};

export const VolumeDelta: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("runner-screen-item-0");
    // Row 0: 1500 - 1350 = 150 matched
    await expect(canvas.getByTestId("runner-screen-volume-0")).toHaveTextContent("+£150 matched");
    // Row 1: 1350 - 1200 = 150 matched
    await expect(canvas.getByTestId("runner-screen-volume-1")).toHaveTextContent("+£150 matched");
    // Last row: no previous volume → no volume element
    await expect(canvas.queryByTestId("runner-screen-volume-2")).not.toBeInTheDocument();
  },
};
