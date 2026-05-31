import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { PriceUpdatesPanel } from "./PriceUpdatesPanel";
import { PriceUpdate } from "../services/chatApi";

const MOCK_UPDATES: PriceUpdate[] = [
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

const meta: Meta<typeof PriceUpdatesPanel> = {
  title: "Components/PriceUpdatesPanel",
  component: PriceUpdatesPanel,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <div style={{ width: "420px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    onClose: fn(),
    onSortChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    updates: MOCK_UPDATES,
    isLoading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    updates: [],
    isLoading: true,
    error: null,
  },
};

export const Empty: Story = {
  args: {
    updates: [],
    isLoading: false,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    updates: [],
    isLoading: false,
    error: "Failed to load price updates",
  },
};

export const PanelRendered: Story = {
  args: {
    updates: MOCK_UPDATES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("price-updates-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("price-updates-list")).toBeInTheDocument();
    await expect(canvas.getByTestId("price-update-item-0")).toBeInTheDocument();
    await expect(canvas.getByTestId("price-update-item-1")).toBeInTheDocument();
  },
};

export const ItemContent: Story = {
  args: {
    updates: MOCK_UPDATES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText(/Springwell Bay/)).toBeInTheDocument();
    await expect(canvas.getByText("4.5")).toBeInTheDocument();
    await expect(canvas.getByText(/Colonel Harry/)).toBeInTheDocument();
  },
};

export const CloseButton: Story = {
  args: {
    updates: MOCK_UPDATES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const closeBtn = canvas.getByTestId("price-updates-close");
    await expect(closeBtn).toBeInTheDocument();

    await userEvent.click(closeBtn);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  args: {
    updates: [],
    isLoading: true,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("price-updates-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("price-updates-list")).not.toBeInTheDocument();
  },
};

const SPRINGWELL_UPDATES: PriceUpdate[] = [
  {
    _id: "pu10",
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
    _id: "pu11",
    marketId: "1.237066150",
    runnerId: 39281327,
    runnerName: "Springwell Bay",
    lastTradedPrice: 4.2,
    timestamp: "2025-01-01T14:08:00.000Z",
    changeId: "12890365540",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
  },
  {
    _id: "pu12",
    marketId: "1.237066150",
    runnerId: 39281327,
    runnerName: "Springwell Bay",
    lastTradedPrice: 5.0,
    timestamp: "2025-01-01T14:05:00.000Z",
    changeId: "12890365536",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
  },
];

export const SingleRunner: Story = {
  name: "Single Runner — Springwell Bay",
  args: {
    eventName: "Springwell Bay",
    updates: SPRINGWELL_UPDATES,
    isLoading: false,
    error: null,
    sort: "desc",
  },
};

export const SingleRunnerItems: Story = {
  name: "Single Runner — items rendered",
  args: {
    eventName: "Springwell Bay",
    updates: SPRINGWELL_UPDATES,
    isLoading: false,
    error: null,
    sort: "desc",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("price-updates-panel")).toBeInTheDocument();
    // eventName appears in header AND in each runner row — use getAllByText
    await expect(canvas.getAllByText("Springwell Bay").length).toBeGreaterThan(0);
    await expect(canvas.getByText(`Price updates · ${SPRINGWELL_UPDATES.length} records`)).toBeInTheDocument();

    for (let i = 0; i < SPRINGWELL_UPDATES.length; i++) {
      await expect(canvas.getByTestId(`price-update-item-${i}`)).toBeInTheDocument();
    }

    const prices = canvas.getAllByText(/^(4\.5|4\.2|5)$/);
    expect(prices.length).toBeGreaterThan(0);
  },
};

export const SingleRunnerSortNewest: Story = {
  name: "Single Runner — sort Newest active",
  args: {
    eventName: "Springwell Bay",
    updates: SPRINGWELL_UPDATES,
    isLoading: false,
    error: null,
    sort: "desc",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const newestBtn = canvas.getByTestId("price-updates-sort-desc");
    const oldestBtn = canvas.getByTestId("price-updates-sort-asc");

    await expect(newestBtn).toBeInTheDocument();
    await expect(oldestBtn).toBeInTheDocument();

    await userEvent.click(oldestBtn);
    await expect(args.onSortChange).toHaveBeenCalledWith("asc");
  },
};

export const SingleRunnerSortOldest: Story = {
  name: "Single Runner — sort Oldest active",
  args: {
    eventName: "Springwell Bay",
    updates: [...SPRINGWELL_UPDATES].reverse(),
    isLoading: false,
    error: null,
    sort: "asc",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const newestBtn = canvas.getByTestId("price-updates-sort-desc");
    await expect(newestBtn).toBeInTheDocument();

    await userEvent.click(newestBtn);
    await expect(args.onSortChange).toHaveBeenCalledWith("desc");
  },
};

export const SingleRunnerEmpty: Story = {
  name: "Single Runner — no data",
  args: {
    eventName: "Springwell Bay",
    updates: [],
    isLoading: false,
    error: null,
    sort: "desc",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Springwell Bay")).toBeInTheDocument();
    await expect(canvas.getByText("No price updates found.")).toBeInTheDocument();
  },
};
