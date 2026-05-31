import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { RunnerScreen } from "./RunnerScreen";

const BASE = "http://localhost:3000";

const MOCK_UPDATES = [
  { _id: "pu1", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs", lastTradedPrice: 1.95, timestamp: "2025-02-01T13:14:00.000Z", changeId: "c1", eventId: "33988522", eventName: "Leopardstown 1st Feb" },
  { _id: "pu2", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs", lastTradedPrice: 1.9, timestamp: "2025-02-01T13:10:00.000Z", changeId: "c2", eventId: "33988522", eventName: "Leopardstown 1st Feb" },
  { _id: "pu3", marketId: "1.238923739", runnerId: 21001, runnerName: "Galopin Des Champs", lastTradedPrice: 2.0, timestamp: "2025-02-01T13:05:00.000Z", changeId: "c3", eventId: "33988522", eventName: "Leopardstown 1st Feb" },
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
    await expect(canvas.findByTestId("runner-screen-item-1")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("runner-screen-item-2")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("£1.95")).resolves.toBeInTheDocument();
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
