import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { MarketGapScreen } from "./MarketGapScreen";

// Static page — no MSW handlers, because the screen makes no API calls. The
// stories therefore assert on content and on the one interactive affordance
// (back), not on loading/error states, which this screen has no way to reach.
const meta: Meta<typeof MarketGapScreen> = {
  title: "Components/MarketGapScreen",
  component: MarketGapScreen,
  parameters: { layout: "fullscreen" },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onRequestAuth: fn(),
    onBack: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PageVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("market-gap-screen")).toBeInTheDocument();
    await expect(canvas.getByTestId("market-gap-intro")).toBeInTheDocument();
  },
};

export const SectionsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const id of [
      "market-gap-internal-note",
      "market-gap-section-incumbents",
      "market-gap-section-gaps",
      "market-gap-section-retention",
      "market-gap-summary",
      "market-gap-disclaimer",
    ]) {
      await expect(canvas.getByTestId(id)).toBeInTheDocument();
    }
  },
};

// The whole reason the page is safe to put behind a shipped-in-the-bundle key
// is that it labels itself as internal on its face. If this banner is ever
// removed the page reads as a customer-facing claim about named competitors,
// so the test pins the wording rather than just the testID.
export const InternalNoteIsStated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const note = canvas.getByTestId("market-gap-internal-note");
    await expect(note).toHaveTextContent(/internal strategy note/i);
    await expect(note).toHaveTextContent(/not marketing/i);
    await expect(note).toHaveTextContent(/does not make it private/i);
  },
};

// Every self-referential figure on this page is measured, so a typo in one is
// a correctness bug, not a copy tweak. Sources are listed in the component's
// header comment.
export const MeasuredFiguresAreCorrect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const retention = canvas.getByTestId("market-gap-section-retention");
    await expect(retention).toHaveTextContent("0.0932");
    await expect(retention).toHaveTextContent("0.0871");
    await expect(retention).toHaveTextContent("27.36%");
    await expect(retention).toHaveTextContent("34.85%");
  },
};

export const BackButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("market-gap-back-button"));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};
