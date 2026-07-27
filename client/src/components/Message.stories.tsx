import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";
import { Message } from "./Message";

const meta: Meta<typeof Message> = {
  title: "Components/Message",
  component: Message,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <div style={{ width: "100%", maxWidth: "500px", padding: "16px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    timestamp: new Date("2025-01-01T14:00:00.000Z"),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
  args: {
    text: "Show me all runners from Cheltenham",
    isUser: true,
  },
};

export const BotMessage: Story = {
  args: {
    text: "Here are the runners for **Cheltenham 1st Jan**.",
    isUser: false,
  },
};

export const PanelVisible: Story = {
  args: {
    text: "Show me all runners from Cheltenham",
    isUser: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("message-bubble")).toBeInTheDocument();
    await expect(canvas.getByText("Show me all runners from Cheltenham")).toBeInTheDocument();
  },
};

export const RendersAtIphone12: Story = {
  args: {
    text: "Show me all runners from Cheltenham",
    isUser: true,
  },
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("message-bubble")).toBeInTheDocument();
  },
};
