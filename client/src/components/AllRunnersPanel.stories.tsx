import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { AllRunnersPanel } from "./AllRunnersPanel";
import { RaceWithEvent } from "../services/chatApi";

const MOCK_RACES: RaceWithEvent[] = [
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
      { id: 21001, name: "Galopin Des Champs", status: "WINNER", sortPriority: 1 },
      { id: 21002, name: "Meetingofthewaters", status: "LOSER", sortPriority: 2 },
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
      { id: 22001, name: "State Man", status: "WINNER", sortPriority: 1 },
      { id: 22002, name: "Brighterdaysahead", status: "LOSER", sortPriority: 2 },
    ],
  },
];

const meta: Meta<typeof AllRunnersPanel> = {
  title: "Components/AllRunnersPanel",
  component: AllRunnersPanel,
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
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    races: [],
    isLoading: true,
    error: null,
  },
};

export const Empty: Story = {
  args: {
    races: [],
    isLoading: false,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    races: [],
    isLoading: false,
    error: "Failed to load runners",
  },
};

export const PanelVisible: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("All Runners")).toBeInTheDocument();
    await expect(canvas.getByText("7 runners · 3 races")).toBeInTheDocument();
  },
};

export const EventSections: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Both event sections present
    await expect(canvas.getByTestId("all-runners-event-33858191")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-event-33988522")).toBeInTheDocument();
    await expect(canvas.getByText("Cheltenham 1st Jan")).toBeInTheDocument();
    await expect(canvas.getByText("Leopardstown 1st Feb")).toBeInTheDocument();
  },
};

export const RaceSections: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Race headers visible with correct testIDs
    await expect(canvas.getByTestId("all-runners-race-1.237066150")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-race-1.238923739")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runners-race-1.238923745")).toBeInTheDocument();

    // Runner rows
    await expect(canvas.getByTestId("all-runner-item-26817268")).toBeInTheDocument();
    await expect(canvas.getByTestId("all-runner-item-21001")).toBeInTheDocument();
    await expect(canvas.getByText("Galopin Des Champs")).toBeInTheDocument();
  },
};

export const CloseButton: Story = {
  args: {
    races: MOCK_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const closeBtn = canvas.getByTestId("all-runners-panel-close");
    await expect(closeBtn).toBeInTheDocument();
    await userEvent.click(closeBtn);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  args: {
    races: [],
    isLoading: true,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runners-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: {
    races: [],
    isLoading: false,
    error: "Failed to load runners",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-error")).toBeInTheDocument();
    await expect(canvas.getByText("Failed to load runners")).toBeInTheDocument();
    await expect(canvas.queryByTestId("all-runners-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  args: {
    races: [],
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("all-runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("No runners found.")).toBeInTheDocument();
  },
};
