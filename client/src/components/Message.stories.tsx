import type { Meta, StoryObj } from "@storybook/react";
import { within, screen, userEvent, expect, waitFor } from "@storybook/test";
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

export const WithMongoScript: Story = {
  args: {
    text: "Query executed successfully.",
    isUser: false,
    mongoScript: 'db.runners.find({ eventId: "33858191" })',
    aiAnalysis: { naturalLanguageInterpretation: "Find all runners for the Cheltenham event." },
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

export const ItemsRendered: Story = {
  args: {
    text: "Query executed successfully.",
    isUser: false,
    mongoScript: 'db.runners.find({ eventId: "33858191" })',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("message-bubble")).toBeInTheDocument();
    await expect(canvas.getByTestId("message-mongo-script-button")).toBeInTheDocument();
  },
};

export const MongoScriptDialogOpens: Story = {
  args: {
    text: "Query executed successfully.",
    isUser: false,
    mongoScript: 'db.runners.find({ eventId: "33858191" })',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId("message-mongo-script-button");
    await userEvent.click(openBtn);

    // Dialog renders via RN Portal outside canvasElement — query the full document
    await expect(await screen.findByTestId("message-mongo-dialog")).toBeInTheDocument();
    await expect(screen.getByText('db.runners.find({ eventId: "33858191" })')).toBeInTheDocument();
  },
};

export const CloseButton: Story = {
  args: {
    text: "Query executed successfully.",
    isUser: false,
    mongoScript: 'db.runners.find({ eventId: "33858191" })',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("message-mongo-script-button"));
    await screen.findByTestId("message-mongo-dialog");

    await userEvent.click(screen.getByTestId("message-mongo-dialog-close"));
    await waitFor(
      () => expect(screen.queryByTestId("message-mongo-dialog")).not.toBeInTheDocument(),
      { timeout: 2000 }
    );
  },
};

export const NoScriptButtonWithoutScript: Story = {
  args: {
    text: "Just a plain reply, no script.",
    isUser: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("message-mongo-script-button")).not.toBeInTheDocument();
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
