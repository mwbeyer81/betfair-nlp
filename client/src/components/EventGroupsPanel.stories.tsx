import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { EventGroupsPanel } from "./EventGroupsPanel";
import { EventGroup } from "../services/chatApi";

const MOCK_GROUPS: EventGroup[] = [
  {
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    marketIds: ["1.237066150"],
    count: 25,
  },
  {
    eventId: "33928245",
    eventName: "Newbury 15th Feb",
    marketIds: ["1.238000001", "1.238000002"],
    count: 12,
  },
];

const meta: Meta<typeof EventGroupsPanel> = {
  title: "Components/EventGroupsPanel",
  component: EventGroupsPanel,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <div style={{ width: "400px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onClose: fn(),
    onViewDocs: fn(),
    onViewRunners: fn(),
    onViewPriceUpdates: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    groups: [],
    isLoading: true,
    error: null,
  },
};

export const Empty: Story = {
  args: {
    groups: [],
    isLoading: false,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    groups: [],
    isLoading: false,
    error: "Failed to load events",
  },
};

export const PanelVisible: Story = {
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Panel is visible
    await expect(canvas.getByTestId("events-panel")).toBeInTheDocument();

    // Event items are rendered
    await expect(
      canvas.getByTestId("event-group-item-33858191")
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("event-group-item-33928245")
    ).toBeInTheDocument();

    // Event name is displayed
    await expect(canvas.getByText("Cheltenham 1st Jan")).toBeInTheDocument();
  },
};

export const CloseButton: Story = {
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const closeBtn = canvas.getByTestId("events-panel-close");
    await expect(closeBtn).toBeInTheDocument();

    await userEvent.click(closeBtn);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const DocsBadgeClick: Story = {
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const badge = canvas.getByTestId("event-docs-badge-33858191");
    await expect(badge).toBeInTheDocument();

    await userEvent.click(badge);
    await expect(args.onViewDocs).toHaveBeenCalledWith("33858191", "Cheltenham 1st Jan");
  },
};

export const RunnersBadgeClick: Story = {
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const badge = canvas.getByTestId("event-runners-badge-33858191");
    await expect(badge).toBeInTheDocument();

    await userEvent.click(badge);
    await expect(args.onViewRunners).toHaveBeenCalledWith("33858191", "Cheltenham 1st Jan");
  },
};

export const PriceUpdatesBadgeClick: Story = {
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const badge = canvas.getByTestId("event-price-updates-badge-33858191");
    await expect(badge).toBeInTheDocument();

    await userEvent.click(badge);
    await expect(args.onViewPriceUpdates).toHaveBeenCalledWith("33858191", "Cheltenham 1st Jan");
  },
};

export const LoadingState: Story = {
  args: {
    groups: [],
    isLoading: true,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("event-group-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("event-group-list")).not.toBeInTheDocument();
  },
};
