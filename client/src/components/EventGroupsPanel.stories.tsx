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
    earliestMarketTime: "2024-01-01T13:00:00.000Z",
  },
  {
    eventId: "33928245",
    eventName: "Newbury 15th Feb",
    marketIds: ["1.238000001", "1.238000002"],
    count: 12,
    earliestMarketTime: "2024-02-15T14:00:00.000Z",
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
    onViewAllRunners: fn(),
    totalRaces: 8,
    totalRunners: 110,
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

export const RunnersStatClick: Story = {
  name: "Runners stat — click opens all-runners view",
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const runnersBtn = canvas.getByTestId("events-total-runners");
    await expect(runnersBtn).toBeInTheDocument();
    await expect(runnersBtn).toHaveTextContent("110 runners");

    await userEvent.click(runnersBtn);
    await expect(args.onViewAllRunners).toHaveBeenCalledTimes(1);
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

export const WithStats: Story = {
  name: "With stats bar",
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
    totalRaces: 8,
    totalRunners: 110,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const bar = canvas.getByTestId("events-stats-bar");
    await expect(bar).toBeInTheDocument();
    await expect(canvas.getByTestId("events-total-runners")).toHaveTextContent("110 runners");
    await expect(canvas.getByTestId("events-total-races")).toHaveTextContent("8 races");
  },
};

export const StatsBarAboveHeader: Story = {
  name: "Stats bar renders above Events header",
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
    totalRaces: 8,
    totalRunners: 110,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const statsBar = canvas.getByTestId("events-stats-bar");
    const header = canvas.getByText("Events");

    // Stats bar and header are both present
    await expect(statsBar).toBeInTheDocument();
    await expect(header).toBeInTheDocument();

    // Stats bar appears before header in DOM order
    expect(
      statsBar.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  },
};

export const NoStats: Story = {
  name: "Without stats (stats bar hidden)",
  args: {
    groups: MOCK_GROUPS,
    isLoading: false,
    error: null,
    totalRaces: undefined,
    totalRunners: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("events-stats-bar")).not.toBeInTheDocument();
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
