import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { View } from "react-native";
import { PaginationControls } from "./PaginationControls";

const meta: Meta<typeof PaginationControls> = {
  title: "Components/PaginationControls",
  component: PaginationControls,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <View style={{ width: 640 }}>
        <Story />
      </View>
    ),
  ],
  args: {
    testIdPrefix: "pagination",
    page: 3,
    totalPages: 26,
    total: 1284,
    limit: 50,
    onPageChange: fn(),
    onLimitChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pagination-status")).toHaveTextContent("Page 3 of 26");
    await expect(canvas.getByTestId("pagination-total")).toHaveTextContent("1,284 total");
    await expect(canvas.getByTestId("pagination-first")).not.toBeDisabled();
    await expect(canvas.getByTestId("pagination-last")).not.toBeDisabled();
  },
};

export const OnFirstPageDisablesFirstAndPrev: Story = {
  args: { page: 1 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pagination-first")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-prev")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-next")).not.toBeDisabled();
    await expect(canvas.getByTestId("pagination-last")).not.toBeDisabled();
  },
};

export const OnLastPageDisablesNextAndLast: Story = {
  args: { page: 26 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pagination-next")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-last")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-prev")).not.toBeDisabled();
  },
};

export const SinglePageDisablesEverything: Story = {
  args: { page: 1, totalPages: 1, total: 12 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("pagination-first")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-prev")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-next")).toBeDisabled();
    await expect(canvas.getByTestId("pagination-last")).toBeDisabled();
  },
};

export const UnknownTotalHidesLast: Story = {
  args: { totalPages: null, total: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // There is no last page to jump to when the count was skipped, and a
    // permanently-dead button reads as a bug — so it's absent, not disabled.
    await expect(canvas.queryByTestId("pagination-last")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("pagination-total")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("pagination-status")).toHaveTextContent("Page 3");
    await expect(canvas.getByTestId("pagination-next")).not.toBeDisabled();
  },
};

export const NextAndPrevReportTheTargetPage: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // meta.args mocks are shared across the suite, so compare call-count diffs
    // rather than asserting a total.
    const mock = args.onPageChange as ReturnType<typeof fn>;
    const before = mock.mock.calls.length;

    await userEvent.click(canvas.getByTestId("pagination-next"));
    await expect(mock).toHaveBeenLastCalledWith(4);
    await userEvent.click(canvas.getByTestId("pagination-prev"));
    await expect(mock).toHaveBeenLastCalledWith(2);
    await userEvent.click(canvas.getByTestId("pagination-first"));
    await expect(mock).toHaveBeenLastCalledWith(1);
    await userEvent.click(canvas.getByTestId("pagination-last"));
    await expect(mock).toHaveBeenLastCalledWith(26);
    await expect(mock.mock.calls.length).toBe(before + 4);
  },
};

export const RowsPerPageSelectionMarksTheActiveOption: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Paper renders a Button as role="button", for which React Native Web emits
    // no aria-selected — the active option carries its state in the label.
    await expect(canvas.getByTestId("pagination-rows-per-page-50")).toHaveAttribute(
      "aria-label",
      "50 rows per page (selected)"
    );
    await expect(canvas.getByTestId("pagination-rows-per-page-100")).toHaveAttribute(
      "aria-label",
      "100 rows per page"
    );

    await userEvent.click(canvas.getByTestId("pagination-rows-per-page-100"));
    await expect(args.onLimitChange).toHaveBeenLastCalledWith(100);
  },
};

export const DisabledWhileLoading: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const id of ["first", "prev", "next", "last", "rows-per-page-25", "rows-per-page-100"]) {
      await expect(canvas.getByTestId(`pagination-${id}`)).toBeDisabled();
    }
  },
};
