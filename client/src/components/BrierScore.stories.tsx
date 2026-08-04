import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";
import { View } from "react-native";
import { BrierScore } from "./BrierScore";
import { colors } from "../theme";

// The component is the only place any screen formats a Brier score, so these
// stories are where the formatting rules themselves are pinned: 4dp, an
// explicit sign on the model-vs-market gap, "—" rather than a number when there
// is nothing to score, and green meaning "the model's squared error is SMALLER".
// A regression in any of those would otherwise only show up as a subtly wrong
// number on six different screens at once.
const meta: Meta<typeof BrierScore> = {
  title: "Components/BrierScore",
  component: BrierScore,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <View style={{ width: 420, padding: 16 }}>
        <Story />
      </View>
    ),
  ],
  args: {
    testID: "brier",
    // Model 0.0871 against a market on 0.0902 — the model ahead by 0.0031,
    // which is roughly the size of a real edge on this data. Scored over 1,240
    // runners, comfortably past the small-sample threshold.
    brier: { scored: 1240, priced: 1240, model: 0.0871, market: 0.0902 },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ModelBeatsMarket: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const el = canvas.getByTestId("brier");
    // 4dp on both, and the gap carries an explicit + so the direction is
    // readable without comparing the two numbers.
    await expect(el).toHaveTextContent("0.0871");
    await expect(el).toHaveTextContent("0.0902");
    await expect(canvas.getByTestId("brier-edge")).toHaveTextContent("+0.0031");
  },
};

export const MarketBeatsModel: Story = {
  args: { brier: { scored: 1240, priced: 1240, model: 0.0955, market: 0.0902 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A minus sign (U+2212, not a hyphen) — the same character formatPct uses
    // elsewhere in this app.
    await expect(canvas.getByTestId("brier-edge")).toHaveTextContent("−0.0053");
  },
};

export const LevelWithMarket: Story = {
  args: { brier: { scored: 900, priced: 900, model: 0.09, market: 0.09 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Exactly level reads as +0.0000, not −0.0000: the sign is chosen on
    // `edge >= 0`, so a dead heat is never rendered as a loss.
    await expect(canvas.getByTestId("brier-edge")).toHaveTextContent("+0.0000");
  },
};

export const SmallSampleIsFlagged: Story = {
  args: { brier: { scored: 37, priced: 37, model: 0.0611, market: 0.0902 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 37 runners is easy to reach on these screens (one course, one going, one
    // class) and a 0.03 gap over 37 runners is noise. The pill exists so the
    // number is never read as a result at that size.
    const pill = canvas.getByTestId("brier-small-sample");
    await expect(pill).toBeInTheDocument();
    await expect(pill).toHaveTextContent("37 runners");
  },
};

export const LargeSampleHasNoPill: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("brier-small-sample")).not.toBeInTheDocument();
  },
};

export const NothingScoredShowsDash: Story = {
  args: { brier: { scored: 0, priced: 0, model: null, market: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The case that matters most. 0 is the BEST possible Brier score, so a
    // filter matching only pre-ML runners must never render "0.0000" — that
    // would show a flawless forecast where none was made.
    const empty = canvas.getByTestId("brier-empty");
    await expect(empty).toHaveTextContent("—");
    await expect(empty).not.toHaveTextContent("0.0000");
  },
};

export const UndefinedShowsDash: Story = {
  // A response from before this field existed, or one served by a stale cache
  // mid-deploy. Must degrade to the same em dash, not crash the card.
  args: { brier: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("brier-empty")).toHaveTextContent("—");
  },
};

export const MarketOnlyForBetfairSp: Story = {
  // The /runners screen: the Betfair-SP collection has no model column at all.
  args: { brier: { scored: 0, priced: 812, model: null, market: 0.0894 }, label: "Brier (SP)" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const el = canvas.getByTestId("brier");
    await expect(el).toHaveTextContent("0.0894");
    // No model score, so no comparison to render — the gap element is absent
    // rather than showing a fabricated +0.0894 against a zero.
    await expect(canvas.queryByTestId("brier-edge")).not.toBeInTheDocument();
  },
};

export const RowsVariant: Story = {
  args: { variant: "rows" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("brier-model")).toHaveTextContent("0.0871");
    await expect(canvas.getByTestId("brier-market")).toHaveTextContent("0.0902");
    await expect(canvas.getByTestId("brier-edge")).toHaveTextContent("+0.0031");
    // The caption states the direction of "better" explicitly — a lower Brier
    // being the good one is the opposite of every other number on these
    // screens, where bigger is better.
    await expect(canvas.getByTestId("brier-caption")).toHaveTextContent("Lower is better");
    await expect(canvas.getByTestId("brier-caption")).toHaveTextContent("1240 runners");
  },
};

export const RowsVariantSmallSample: Story = {
  args: { variant: "rows", brier: { scored: 12, priced: 12, model: 0.0611, market: 0.0902 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("brier-caption")).toHaveTextContent("Too few to read as a result");
  },
};

export const DarkToneOnASplitCard: Story = {
  args: { tone: "dark" },
  decorators: [
    Story => (
      <View style={{ width: 420, padding: 16, backgroundColor: colors.text }}>
        <Story />
      </View>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Same numbers, same testIDs — only the palette changes, so a screen can
    // swap tone without any of its assertions moving.
    await expect(canvas.getByTestId("brier")).toHaveTextContent("0.0871");
    await expect(canvas.getByTestId("brier-edge")).toHaveTextContent("+0.0031");
  },
};

export const AccessibleVerdict: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The numbers alone don't say which direction is good, so the whole group
    // carries a plain-English label for screen readers.
    await expect(canvas.getByTestId("brier")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("better calibrated than the market")
    );
  },
};
