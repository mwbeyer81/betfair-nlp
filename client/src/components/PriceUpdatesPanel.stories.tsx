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
