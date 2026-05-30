import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { RunnersPanel } from "./RunnersPanel";
import { Runner } from "../services/chatApi";

const MOCK_RUNNERS: Runner[] = [
  { id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1 },
  { id: 12346, name: "Gaelic Warrior", status: "ACTIVE", sortPriority: 2 },
  { id: 12347, name: "Navan Rullah", status: "ACTIVE", sortPriority: 3 },
  { id: 12348, name: "Fact To File", status: "WINNER", sortPriority: 4 },
  { id: 12349, name: "Embassy Gardens", status: "LOSER", sortPriority: 5 },
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
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    runners: MOCK_RUNNERS,
    isLoading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    runners: [],
    isLoading: true,
    error: null,
  },
};

export const Empty: Story = {
  args: {
    runners: [],
    isLoading: false,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    runners: [],
    isLoading: false,
    error: "Failed to load runners",
  },
};

export const PanelVisible: Story = {
  args: {
    runners: MOCK_RUNNERS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("runners-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("Cheltenham 1st Jan")).toBeInTheDocument();
    await expect(canvas.getByText(`Runners · ${MOCK_RUNNERS.length} unique`)).toBeInTheDocument();
  },
};

export const RunnerItems: Story = {
  args: {
    runners: MOCK_RUNNERS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const runner of MOCK_RUNNERS) {
      await expect(canvas.getByTestId(`runner-item-${runner.id}`)).toBeInTheDocument();
      await expect(canvas.getByText(runner.name)).toBeInTheDocument();
    }
  },
};

export const CloseButton: Story = {
  args: {
    runners: MOCK_RUNNERS,
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
    runners: [],
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
    runners: [],
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
    runners: [],
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("runners-list")).toBeInTheDocument();
    await expect(canvas.getByText("No runners found.")).toBeInTheDocument();
  },
};
