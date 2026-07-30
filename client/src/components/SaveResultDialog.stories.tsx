import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { SaveResultDialog } from "./SaveResultDialog";

const meta: Meta<typeof SaveResultDialog> = {
  title: "Components/SaveResultDialog",
  component: SaveResultDialog,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    autoNamePreview: "Ascot · 2026-01-01",
    saving: false,
    error: null,
    onSave: fn(),
    onCancel: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DialogVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("save-result-dialog")).toBeInTheDocument();
    await expect(canvas.getByTestId("save-result-dialog-name-input")).toBeInTheDocument();
  },
};

export const ConfirmWithTypedNameCallsOnSave: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("save-result-dialog-name-input"), "My Ascot picks");
    await userEvent.click(canvas.getByTestId("save-result-dialog-confirm"));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
    await expect(args.onSave).toHaveBeenCalledWith("My Ascot picks");
  },
};

export const ConfirmWithBlankNameCallsOnSaveWithEmptyString: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("save-result-dialog-confirm"));
    await expect(args.onSave).toHaveBeenCalledWith("");
  },
};

export const CancelButtonCallsOnCancel: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("save-result-dialog-cancel"));
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
  },
};

export const SavingStateDisablesConfirm: Story = {
  args: { saving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("save-result-dialog-confirm")).toBeDisabled();
  },
};

export const ErrorStateShowsMessage: Story = {
  args: { error: "Failed to save result." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("save-result-dialog-error")).toHaveTextContent("Failed to save result.");
  },
};
