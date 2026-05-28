import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { EventDocsPanel } from "./EventDocsPanel";
import { MarketDefinitionDoc } from "../services/chatApi";

const MOCK_DOCS: MarketDefinitionDoc[] = [
  {
    _id: "doc1",
    changeId: "12890365544",
    marketId: "1.237066150",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    status: "CLOSED",
    marketType: "ANTEPOST_WIN",
    marketTime: "2025-01-01T14:01:00.000Z",
    numberOfActiveRunners: 0,
    timestamp: "2025-01-01T14:16:00.000Z",
    runners: [
      { id: 39281327, name: "Springwell Bay", status: "WINNER", sortPriority: 3 },
      { id: 48945543, name: "Colonel Harry", status: "LOSER", sortPriority: 4 },
      { id: 26817268, name: "Gemirande", status: "LOSER", sortPriority: 1 },
    ],
  },
  {
    _id: "doc2",
    changeId: "12890365545",
    marketId: "1.237066150",
    eventId: "33858191",
    eventName: "Cheltenham 1st Jan",
    status: "OPEN",
    marketType: "WIN",
    marketTime: "2025-01-01T15:30:00.000Z",
    numberOfActiveRunners: 8,
    timestamp: "2025-01-01T13:00:00.000Z",
    runners: [
      { id: 1, name: "Horse A", status: "ACTIVE", sortPriority: 1 },
      { id: 2, name: "Horse B", status: "ACTIVE", sortPriority: 2 },
    ],
  },
];

const meta: Meta<typeof EventDocsPanel> = {
  title: "Components/EventDocsPanel",
  component: EventDocsPanel,
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
    docs: MOCK_DOCS,
    isLoading: false,
    error: null,
  },
};

export const Loading: Story = {
  args: {
    docs: [],
    isLoading: true,
    error: null,
  },
};

export const Empty: Story = {
  args: {
    docs: [],
    isLoading: false,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    docs: [],
    isLoading: false,
    error: "Failed to load documents",
  },
};

export const PanelRendered: Story = {
  args: {
    docs: MOCK_DOCS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("event-docs-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("event-docs-list")).toBeInTheDocument();
    await expect(canvas.getByTestId("event-doc-item-0")).toBeInTheDocument();
    await expect(canvas.getByTestId("event-doc-item-1")).toBeInTheDocument();
  },
};

export const DocContent: Story = {
  args: {
    docs: MOCK_DOCS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Status badges
    await expect(canvas.getByTestId("event-doc-status-0")).toBeInTheDocument();

    // Runner names appear
    await expect(canvas.getByText(/Springwell Bay/)).toBeInTheDocument();

    // Market type shown
    await expect(canvas.getByText(/ANTEPOST_WIN/)).toBeInTheDocument();
  },
};

export const CloseButton: Story = {
  args: {
    docs: MOCK_DOCS,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const closeBtn = canvas.getByTestId("event-docs-close");
    await expect(closeBtn).toBeInTheDocument();

    await userEvent.click(closeBtn);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const LoadingState: Story = {
  args: {
    docs: [],
    isLoading: true,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("event-docs-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("event-docs-list")).not.toBeInTheDocument();
  },
};
