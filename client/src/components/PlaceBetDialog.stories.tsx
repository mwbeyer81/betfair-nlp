import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { PlaceBetDialog } from "./PlaceBetDialog";

const meta: Meta<typeof PlaceBetDialog> = {
  title: "Components/PlaceBetDialog",
  component: PlaceBetDialog,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    horseName: "Artagnan",
    raceSummary: "Redcar · 2:05",
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
    await expect(canvas.getByTestId("place-bet-dialog")).toBeInTheDocument();
    await expect(canvas.getByTestId("place-bet-dialog-target-profit-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("place-bet-dialog-max-stake-input")).toBeInTheDocument();
  },
};

export const MinPricePreviewUpdates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("place-bet-dialog-target-profit-input"), "20");
    await userEvent.type(canvas.getByTestId("place-bet-dialog-max-stake-input"), "10");
    // 1 + 20/10 = 3.00 -> nearest ladder price is "2/1".
    await expect(canvas.getByTestId("place-bet-dialog-min-price-preview")).toHaveTextContent("2/1 (3.00)");
  },
};

export const ConfirmCallsOnSave: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("place-bet-dialog-target-profit-input"), "20");
    await userEvent.type(canvas.getByTestId("place-bet-dialog-max-stake-input"), "10");
    await userEvent.click(canvas.getByTestId("place-bet-dialog-confirm"));
    await expect(args.onSave).toHaveBeenCalledWith({ targetProfit: 20, maxStake: 10 });
  },
};

export const CancelButtonCallsOnCancel: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("place-bet-dialog-cancel"));
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
  },
};

export const ValidationErrorOnZeroStake: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("place-bet-dialog-target-profit-input"), "20");
    await userEvent.type(canvas.getByTestId("place-bet-dialog-max-stake-input"), "0");
    await expect(canvas.getByTestId("place-bet-dialog-error")).toHaveTextContent(
      "Enter a target profit and max stake greater than zero."
    );
    await expect(canvas.queryByTestId("place-bet-dialog-min-price-preview")).not.toBeInTheDocument();
    // Confirm is disabled in this state (pointer-events: none), so a real
    // click can't even land — the disabled assertion itself is the proof
    // onSave can't fire, matching SavingStateDisablesConfirm's approach.
    await expect(canvas.getByTestId("place-bet-dialog-confirm")).toBeDisabled();
  },
};

export const SavingStateDisablesConfirm: Story = {
  args: { saving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("place-bet-dialog-confirm")).toBeDisabled();
  },
};

export const ErrorPropShowsMessage: Story = {
  args: { error: "Failed to schedule bet." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("place-bet-dialog-error")).toHaveTextContent("Failed to schedule bet.");
  },
};
