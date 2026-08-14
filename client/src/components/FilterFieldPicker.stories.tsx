import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { FilterFieldPicker } from "./FilterFieldPicker";
import type { FilterFieldDef } from "../utils/filterFields";

// A representative slice of the real catalogue: one race-scoped field, one
// fully-populated runner field, one structurally-sparse one, one enum with the
// "contains" match mode, and one of the three dead comment-derived fields.
// Coverage numbers are the measured production values.
const FIELDS: FilterFieldDef[] = [
  {
    name: "distanceFurlongs",
    label: "Distance (furlongs)",
    family: "race",
    type: "number",
    scope: "race",
    enabled: true,
    coverage: 100,
  },
  {
    name: "officialRating",
    label: "Official rating",
    family: "runner",
    type: "number",
    scope: "runner",
    enabled: true,
    coverage: 78.1,
    note: "Handicaps 99.9%, maidens and novices 16.3% — unrated horses have no mark published.",
  },
  {
    name: "draw",
    label: "Draw (stall)",
    family: "runner",
    type: "number",
    scope: "runner",
    enabled: true,
    coverage: 64.8,
    note: "Flat races only (99.9%). Jumps races have no stalls.",
  },
  {
    name: "hg",
    label: "Headgear",
    family: "runner",
    type: "enum",
    scope: "runner",
    enabled: true,
    coverage: 37.2,
    enumParam: "headgear",
    matchMode: "contains",
    enumValues: [
      { value: "p", label: "Cheekpieces", count: 144212 },
      { value: "t", label: "Tongue tie", count: 129282 },
      { value: "b", label: "Blinkers", count: 59075 },
    ],
    note: "Null means NO headgear — 611,968 runners run bare-headed.",
  },
  {
    name: "horseAvgExcuseScore",
    label: "Avg excuse score",
    family: "horse",
    type: "number",
    scope: "runner",
    enabled: false,
    coverage: 0,
    note: "Always empty. Derived from runners[].comment, which is 0.3% populated.",
  },
];

const meta: Meta<typeof FilterFieldPicker> = {
  title: "Components/FilterFieldPicker",
  component: FilterFieldPicker,
  parameters: { layout: "fullscreen" },
  args: {
    fields: FIELDS,
    value: {},
    onChange: fn(),
    loading: false,
    error: null,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PanelVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-field-picker")).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-field-picker-add")).toBeInTheDocument();
    // Nothing chosen yet, so the empty-state line stands in for the rows.
    await expect(canvas.getByTestId("filter-field-picker-none")).toBeInTheDocument();
  },
};

export const ItemsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    await expect(canvas.getByTestId("filter-field-picker-list")).toBeInTheDocument();
    for (const field of FIELDS) {
      await expect(canvas.getByTestId(`filter-field-option-${field.name}`)).toBeInTheDocument();
    }
  },
};

export const CoverageShownPerField: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    // The whole point of surfacing coverage: draw is 64.8% because it is
    // Flat-only, and a user filtering on it should see that before they do.
    await expect(canvas.getByTestId("filter-field-option-draw-coverage")).toHaveTextContent("64.8%");
    await expect(canvas.getByTestId("filter-field-option-draw-note")).toHaveTextContent("Flat races only");
    await expect(canvas.getByTestId("filter-field-option-officialRating-coverage")).toHaveTextContent("78.1%");
  },
};

export const SearchNarrowsList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    await userEvent.type(canvas.getByTestId("filter-field-picker-search"), "rating");
    await expect(canvas.getByTestId("filter-field-option-officialRating")).toBeInTheDocument();
    await expect(canvas.queryByTestId("filter-field-option-draw")).not.toBeInTheDocument();
  },
};

export const SearchMatchesModelColumnName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    // Someone who has read ml/train_and_predict.py types the column name, not
    // the prose label — so `name` is searchable too.
    await userEvent.type(canvas.getByTestId("filter-field-picker-search"), "distanceFurlongs");
    await expect(canvas.getByTestId("filter-field-option-distanceFurlongs")).toBeInTheDocument();
    await expect(canvas.queryByTestId("filter-field-option-hg")).not.toBeInTheDocument();
  },
};

export const AddingAFieldCallsOnChange: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    await userEvent.click(canvas.getByTestId("filter-field-option-officialRating"));
    await expect(args.onChange).toHaveBeenCalledWith({ officialRating: {} });
  },
};

export const DisabledFieldNotSelectable: Story = {
  // Its own onChange rather than meta.args': this is the one story asserting a
  // NEGATIVE, and the shared mock accumulates calls across every story in the
  // session, so AddingAFieldCallsOnChange's click would otherwise show up here.
  args: { onChange: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    const dead = canvas.getByTestId("filter-field-option-horseAvgExcuseScore");
    // Listed with its reason rather than hidden — someone who knows the model's
    // column list should find it and learn why it is empty.
    await expect(dead).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-field-option-horseAvgExcuseScore-coverage"))
      .toHaveTextContent("Not filterable");
    // Asserted through the DOM rather than by clicking. TouchableRipple's
    // disabled state sets `pointer-events: none`, and every way of forcing a
    // click past that in this runner either throws (failing the test for the
    // wrong reason) or bypasses the browser's own hit-testing, which is the
    // exact mechanism under test. So check the mechanism directly: the element
    // cannot receive a pointer event, therefore onChange cannot fire.
    await expect(dead).toHaveStyle({ pointerEvents: "none" });
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const CloseButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByTestId("filter-field-picker-add");
    await userEvent.click(toggle);
    await expect(canvas.getByTestId("filter-field-picker-list")).toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(canvas.queryByTestId("filter-field-picker-list")).not.toBeInTheDocument();
  },
};

export const ChosenNumericRow: Story = {
  args: { value: { officialRating: { min: "90", max: "" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-field-row-officialRating")).toBeInTheDocument();
    await expect(canvas.getByTestId("filter-field-min-officialRating")).toHaveValue("90");
    await expect(canvas.getByTestId("filter-field-coverage-officialRating")).toHaveTextContent("78.1%");
    await expect(canvas.getByTestId("filter-field-note-officialRating")).toHaveTextContent("maidens");
  },
};

export const ChosenEnumRow: Story = {
  args: { value: { hg: { values: ["b"] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-field-chips-hg")).toBeInTheDocument();
    // Asserted by the human-readable label rather than the raw code, since that
    // mapping is the reason enumValues carries a label at all — a chip reading
    // "b" would tell a punter nothing.
    await expect(canvas.getByTestId("filter-field-chip-hg-b")).toHaveTextContent("Blinkers");
    await expect(canvas.getByTestId("filter-field-chip-hg-t")).toHaveTextContent("Tongue tie");
  },
};

export const TogglingAnEnumChipCallsOnChange: Story = {
  args: { value: { hg: { values: ["b"] } } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Selection state is asserted through behaviour, not through ARIA
    // attributes: react-native-paper's web Chip does not surface
    // accessibilityState as aria-selected, so an attribute assertion would be
    // testing the library rather than this component.
    await userEvent.click(canvas.getByTestId("filter-field-chip-hg-t"));
    await expect(args.onChange).toHaveBeenCalledWith({ hg: { values: ["b", "t"] } });
  },
};

export const TogglingAnAlreadySelectedChipRemovesIt: Story = {
  args: { value: { hg: { values: ["b", "t"] } } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-chip-hg-b"));
    await expect(args.onChange).toHaveBeenCalledWith({ hg: { values: ["t"] } });
  },
};

export const RemoveButton: Story = {
  args: { value: { officialRating: { min: "90" } } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-remove-officialRating"));
    await expect(args.onChange).toHaveBeenCalledWith({});
  },
};

export const AlreadyChosenFieldLeavesThePicker: Story = {
  args: { value: { officialRating: { min: "90" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    // Picking the same field twice has no meaning, and the list is long enough
    // that every removable row is worth removing.
    await expect(canvas.queryByTestId("filter-field-option-officialRating")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("filter-field-option-draw")).toBeInTheDocument();
  },
};

export const LoadingState: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-field-picker-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("filter-field-picker-add")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: { error: "Failed to load model fields." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-field-picker-error")).toHaveTextContent("Failed to load model fields.");
    await expect(canvas.queryByTestId("filter-field-picker-add")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  args: { fields: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-field-picker-none")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    await expect(canvas.getByTestId("filter-field-picker-empty")).toBeInTheDocument();
  },
};

export const NoSearchMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("filter-field-picker-add"));
    await userEvent.type(canvas.getByTestId("filter-field-picker-search"), "zzzz");
    await expect(canvas.getByTestId("filter-field-picker-empty")).toHaveTextContent("zzzz");
  },
};
