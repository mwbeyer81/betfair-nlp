import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { RunnersPanel } from "./RunnersPanel";
import { Race } from "../services/chatApi";

const CHELTENHAM_RACES: Race[] = [
  {
    marketId: "1.237066150",
    marketTime: "2025-01-01T14:01:00.000Z",
    marketType: "ANTEPOST_WIN",
    marketName: "Cheltenham Chase",
    runners: [
      { id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1 },
      { id: 12346, name: "Gaelic Warrior", status: "ACTIVE", sortPriority: 2 },
      { id: 12347, name: "Navan Rullah", status: "ACTIVE", sortPriority: 3 },
      { id: 12348, name: "Fact To File", status: "WINNER", sortPriority: 4 },
      { id: 12349, name: "Embassy Gardens", status: "LOSER", sortPriority: 5 },
    ],
  },
];

const LEOPARDSTOWN_RACES: Race[] = [
  {
    marketId: "1.238923739",
    marketTime: "2025-02-01T13:15:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:15",
    runners: [
      { id: 21001, name: "Galopin Des Champs", status: "WINNER", sortPriority: 1 },
      { id: 21002, name: "Meetingofthewaters", status: "LOSER", sortPriority: 2 },
      { id: 21003, name: "Gerri Colombe", status: "LOSER", sortPriority: 3 },
    ],
  },
  {
    marketId: "1.238923745",
    marketTime: "2025-02-01T13:50:00.000Z",
    marketType: "WIN",
    marketName: "Leopardstown 13:50",
    runners: [
      { id: 22001, name: "State Man", status: "WINNER", sortPriority: 1 },
      { id: 22002, name: "Brighterdaysahead", status: "LOSER", sortPriority: 2 },
      { id: 22003, name: "Lossiemouth", status: "LOSER", sortPriority: 3 },
    ],
  },
];

const meta: Meta<typeof RunnersPanel> = {
  title: "Components/RunnersPanel",
  component: RunnersPanel,
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
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    onClose: fn(),
    onRunnerSelect: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    races: CHELTENHAM_RACES,
    isLoading: false,
    error: null,
  },
};

export const MultiRace: Story = {
  name: "Multi-race event — Leopardstown",
  args: {
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    races: LEOPARDSTOWN_RACES,
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
    races: CHELTENHAM_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runners-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("Cheltenham 1st Jan")).toBeInTheDocument();
  },
};

export const RunnerItems: Story = {
  args: {
    races: CHELTENHAM_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const runner of CHELTENHAM_RACES[0].runners) {
      await expect(canvas.getByTestId(`runner-item-${runner.id}`)).toBeInTheDocument();
      await expect(canvas.getByText(runner.name)).toBeInTheDocument();
    }
  },
};

export const MultiRaceItems: Story = {
  name: "Multi-race — race headers visible",
  args: {
    eventId: "33988522",
    eventName: "Leopardstown 1st Feb",
    races: LEOPARDSTOWN_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("runners-panel")).toBeInTheDocument();
    await expect(canvas.getByText("2 races · 6 runners")).toBeInTheDocument();
    for (const race of LEOPARDSTOWN_RACES) {
      await expect(canvas.getByTestId(`race-section-${race.marketId}`)).toBeInTheDocument();
      for (const runner of race.runners) {
        await expect(canvas.getByTestId(`runner-item-${runner.id}`)).toBeInTheDocument();
      }
    }
  },
};

export const CloseButton: Story = {
  args: {
    races: CHELTENHAM_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const closeBtn = canvas.getByTestId("runners-panel-close");
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
    await expect(canvas.getByTestId("runners-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("runners-list")).not.toBeInTheDocument();
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
    await expect(canvas.getByTestId("runners-error")).toBeInTheDocument();
    await expect(canvas.getByText("Failed to load runners")).toBeInTheDocument();
    await expect(canvas.queryByTestId("runners-list")).not.toBeInTheDocument();
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
    await expect(canvas.getByTestId("runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("No runners found.")).toBeInTheDocument();
  },
};

export const RunnerClick: Story = {
  args: {
    races: CHELTENHAM_RACES,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const firstRunner = CHELTENHAM_RACES[0].runners[0];
    const item = canvas.getByTestId(`runner-item-${firstRunner.id}`);
    await expect(item).toBeInTheDocument();
    await userEvent.click(item);
    await expect(args.onRunnerSelect).toHaveBeenCalledWith(firstRunner.id, firstRunner.name);
  },
};
