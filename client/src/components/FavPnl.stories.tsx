import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";
import { View } from "react-native";
import { FavPnl } from "./FavPnl";
import { colors } from "../theme";

// The component is the only place any screen formats the favourite-backed
// baseline, so these stories are where the rules themselves are pinned: the
// edge is a difference of ROIs in POINTS (never a subtraction of two cash
// P&Ls), the colour tracks the edge and never the baseline's own loss, the
// staking convention is honoured, and "no bets" renders "—" rather than a
// break-even £0.00. A regression in any of those would otherwise surface as a
// subtly wrong number on five screens at once.
//
// Default args model the real dataset: backing every favourite loses ~5% at
// level stakes over a big sample, and the selection being measured is the
// -11.8% Split A from the screenshot this feature came from.
const meta: Meta<typeof FavPnl> = {
  title: "Components/FavPnl",
  component: FavPnl,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <View style={{ width: 460, padding: 16 }}>
        <Story />
      </View>
    ),
  ],
  args: {
    testID: "fav",
    // 1,000 races, no joint favourites. To-win: staked £480, returned £420 —
    // -£60.00, -12.5%. Level: £1,000 staked, £950 back — -£50.00, -5.0%.
    fav: {
      races: 1000,
      count: 1000,
      staked: 480,
      returns: 420,
      pnl: -60,
      level: { staked: 1000, returns: 950, pnl: -50 },
    },
    // The filtered selection: -£67.78 on £574.41 staked = -11.8%.
    pnl: { staked: 574.41, returns: 506.63, pnl: -67.78, count: 4200 },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const BeatsTheFavourite: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The baseline's own figure, in the to-win convention the surrounding card
    // shows.
    await expect(canvas.getByTestId("fav-value")).toHaveTextContent("-£60.00");
    await expect(canvas.getByTestId("fav-value")).toHaveTextContent("-12.5%");
    // -11.8% against -12.5% is +0.7 points. The whole point of the feature: a
    // losing selection can still be beating the do-nothing baseline, and the
    // headline P&L alone can never say so.
    await expect(canvas.getByTestId("fav-edge")).toHaveTextContent("+0.7 pts");
  },
};

export const TrailsTheFavourite: Story = {
  // Same baseline, a worse selection: -£120 on £600 = -20.0%, i.e. 7.5 points
  // WORSE than backing favourites blind.
  args: { pnl: { staked: 600, returns: 480, pnl: -120, count: 3000 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A minus sign (U+2212, not a hyphen) — the same character the rest of the
    // app's percentage formatting uses.
    await expect(canvas.getByTestId("fav-edge")).toHaveTextContent("−7.5 pts");
  },
};

export const LevelStakesConventionChangesTheBaseline: Story = {
  // The same bets read the other way: the baseline is -5.0%, not -12.5%. This
  // is why the convention is a prop rather than a fixed choice — a to-win
  // selection compared against a level baseline would gain 7.5 points of pure
  // bet sizing.
  args: { convention: "level", pnl: { staked: 1000, returns: 900, pnl: -100, count: 1000 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("fav-value")).toHaveTextContent("-£50.00");
    await expect(canvas.getByTestId("fav-value")).toHaveTextContent("-5.0%");
    // -10.0% against -5.0%.
    await expect(canvas.getByTestId("fav-edge")).toHaveTextContent("−5.0 pts");
  },
};

export const NoSelectionShowsBaselineAlone: Story = {
  // The header row over the whole matched set, which has no single selection
  // figure beside it. The baseline renders; the edge is absent rather than
  // computed against nothing.
  args: { pnl: undefined, label: "Fav (all races)" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("fav-value")).toHaveTextContent("-£60.00");
    await expect(canvas.queryByTestId("fav-edge")).not.toBeInTheDocument();
  },
};

export const SmallSampleIsFlagged: Story = {
  args: {
    fav: { races: 42, count: 42, staked: 20, returns: 31, pnl: 11, level: { staked: 42, returns: 58, pnl: 16 } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 42 races is easy to reach on these screens (one course, one class, one
    // going) and favourite-backing over 42 races is dominated by whether a
    // couple of 5/1 shots obliged. The pill exists so a +55% baseline is never
    // read as a fact about favourites.
    const pill = canvas.getByTestId("fav-small-sample");
    await expect(pill).toBeInTheDocument();
    await expect(pill).toHaveTextContent("42 races");
  },
};

export const LargeSampleHasNoPill: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("fav-small-sample")).not.toBeInTheDocument();
  },
};

export const NoBetsShowsDash: Story = {
  // A filter matching no race at all. £0.00 would read as a baseline that
  // broke even — the one number backing favourites never does.
  args: { fav: { races: 0, count: 0, staked: 0, returns: 0, pnl: 0, level: { staked: 0, returns: 0, pnl: 0 } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = canvas.getByTestId("fav-empty");
    await expect(empty).toHaveTextContent("—");
    await expect(empty).not.toHaveTextContent("£0.00");
  },
};

export const UndefinedShowsDash: Story = {
  // A saved result from before this field existed, or a response served by a
  // stale service worker mid-deploy. Must degrade to the same em dash rather
  // than crash the card.
  args: { fav: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("fav-empty")).toHaveTextContent("—");
  },
};

export const RowsVariant: Story = {
  args: { variant: "rows" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("fav-pnl")).toHaveTextContent("-£60.00");
    await expect(canvas.getByTestId("fav-book")).toHaveTextContent("1000 bets");
    await expect(canvas.getByTestId("fav-book")).toHaveTextContent("1000 races");
    await expect(canvas.getByTestId("fav-edge")).toHaveTextContent("+0.7 pts");
    // The caption spells out what the baseline actually bets, because "Fav"
    // alone doesn't say that it ignores every filter on screen.
    await expect(canvas.getByTestId("fav-caption")).toHaveTextContent("backed whatever the filters say");
  },
};

export const RowsVariantCountsJointFavourites: Story = {
  // 500 races, 530 bets — 30 races had joint favourites, each backed in full.
  // The pair has to be visible or the extra 30 bets look like an arithmetic
  // error against the race count everything else on the card shows.
  args: {
    variant: "rows",
    fav: { races: 500, count: 530, staked: 250, returns: 240, pnl: -10, level: { staked: 530, returns: 505, pnl: -25 } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("fav-book")).toHaveTextContent("530 bets");
    await expect(canvas.getByTestId("fav-book")).toHaveTextContent("500 races");
    await expect(canvas.getByTestId("fav-caption")).toHaveTextContent("30 joint favourites");
  },
};

export const RowsVariantSmallSample: Story = {
  args: {
    variant: "rows",
    fav: { races: 12, count: 12, staked: 6, returns: 9, pnl: 3, level: { staked: 12, returns: 17, pnl: 5 } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("fav-caption")).toHaveTextContent("Too few races to read as a result");
  },
};

export const DarkToneOnASplitCard: Story = {
  args: { tone: "dark" },
  decorators: [
    Story => (
      <View style={{ width: 460, padding: 16, backgroundColor: colors.text }}>
        <Story />
      </View>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Same numbers, same testIDs — only the palette changes, so a screen can
    // swap tone without any of its assertions moving.
    await expect(canvas.getByTestId("fav-value")).toHaveTextContent("-£60.00");
    await expect(canvas.getByTestId("fav-edge")).toHaveTextContent("+0.7 pts");
  },
};

export const AccessibleVerdict: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The numbers alone don't say which direction is good — a -12.5% baseline
    // beside a -11.8% selection reads as two losses until you know one is the
    // thing the other has to beat.
    await expect(canvas.getByTestId("fav")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("beats it by 0.7 points")
    );
  },
};
