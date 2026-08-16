import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { DataSourceComparisonScreen } from "./DataSourceComparisonScreen";
import type { DataSourceComparison } from "../services/chatApi";

const BASE = "http://localhost:3000";

// A small but structurally real slice of the payload: one field row per
// verdict, so the colour coding, the counts and the filter chips are all
// exercised without pasting all 37 rows in here.
const COMPARISON: DataSourceComparison = {
  generatedAt: "2026-08-16",
  headline: [
    "The Kaggle CSV is a Racing Post results feed built on the same data model as RacingAPI's /results endpoints.",
    "/racecards is a different shape from /results, and the CSV matches the results shape.",
  ],
  samples: [
    { name: "CSV", what: "mini-update.csv", scale: "3,653 rows · 385 races", window: "2026-05-28 → 06-03" },
    { name: "API results", what: "industry_starting_prices", scale: "529 races · 4,221 runners", window: "2026-07-01 → 08-15" },
  ],
  caveats: ["API values were read back from Atlas after mapping, not from raw HTTP responses."],
  fields: [
    {
      csv: "date",
      results: "date",
      racecards: "date",
      verdict: "same",
      level: "race",
      note: "YYYY-MM-DD, local track date, both.",
    },
    {
      csv: "or",
      results: "or",
      racecards: "ofr",
      verdict: "caution",
      level: "runner",
      note: "Same value, three different null tokens: CSV en dash, racecards ASCII hyphen, results empty string.",
    },
    {
      csv: "comment",
      results: "comment",
      racecards: "comment",
      verdict: "different",
      level: "runner",
      note: "Four different meanings across the two sources.",
    },
    {
      csv: "ran",
      results: null,
      racecards: "field_size",
      verdict: "different",
      level: "race",
      note: "The only CSV column with no results counterpart.",
    },
  ],
  commentMeanings: [
    { where: "CSV comment", meaning: "Racing Post post-race in-running commentary, with market moves." },
    { where: "/results runner comment", meaning: "RacingAPI's own post-race analyst note." },
    { where: "/racecards runner comment", meaning: "A PRE-race analyst preview of the runner." },
    { where: "/results race-level comments", meaning: "Official stewards' notes." },
  ],
  commentStyle: [
    { label: "Mean length", csv: "99 chars", api: "142 chars" },
    { label: "Market move (op 40/1)", csv: "67%", api: "0%" },
  ],
  lexiconRates: [
    { label: "hasWeakened", csv: "53.2%", api: "25.5%" },
    { label: "hasGreenness", csv: "8.6%", api: "0.4%" },
  ],
  populationEras: [
    { field: "rpr", csvEra: "90%", apiEra: "0%", why: "Removed by the API in June 2026." },
    { field: "comment", csvEra: "0% (field absent)", apiEra: "84%", why: "The importer only started mapping it on 2026-07-25." },
  ],
  apiOnly: [{ group: "Identity and joins", fields: "horse_id · jockey_id · trainer_id" }],
  normalisation: ["Map Evens ↔ 1/1 before comparing any stored fraction."],
};

const okHandler = http.get(`${BASE}/api/admin/data-sources`, () =>
  HttpResponse.json({ success: true, data: COMPARISON })
);

const meta: Meta<typeof DataSourceComparisonScreen> = {
  title: "Components/DataSourceComparisonScreen",
  component: DataSourceComparisonScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: [okHandler] },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onBack: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ScreenVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("data-sources-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("data-sources-fields")).resolves.toBeInTheDocument();
  },
};

// The colour coding is meaningless without it — a reader has to be told that
// ✕ means "genuinely different", not "broken".
export const VerdictLegendExplainsTheMarks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const legend = await canvas.findByTestId("data-sources-verdict-legend");
    await expect(legend).toHaveTextContent("genuinely different");
    await expect(legend).toHaveTextContent("same concept, different encoding");
    await expect(legend).toHaveTextContent("values agree");
  },
};

export const FieldRowsRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("data-sources-fields");
    for (const field of COMPARISON.fields) {
      await expect(canvas.getByTestId(`data-sources-field-${field.csv}`)).toBeInTheDocument();
    }
  },
};

// The note is the actual content of each row — collapsed until asked for, so
// the 37-row table stays readable.
export const RowExpandsToShowTheNote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("data-sources-fields");
    await expect(canvas.queryByTestId("data-sources-field-note-comment")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("data-sources-field-comment"));

    await expect(canvas.findByTestId("data-sources-field-note-comment")).resolves.toBeInTheDocument();
  },
};

export const VerdictFilterNarrowsTheTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("data-sources-fields");

    await userEvent.click(canvas.getByTestId("data-sources-filter-different"));

    // Only the two "different" rows survive the filter.
    await expect(canvas.getByTestId("data-sources-field-comment")).toBeInTheDocument();
    await expect(canvas.getByTestId("data-sources-field-ran")).toBeInTheDocument();
    await expect(canvas.queryByTestId("data-sources-field-date")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("data-sources-field-or")).not.toBeInTheDocument();
  },
};

export const FilterTogglesBackOff: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("data-sources-fields");

    await userEvent.click(canvas.getByTestId("data-sources-filter-same"));
    await expect(canvas.queryByTestId("data-sources-field-comment")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("data-sources-filter-same"));
    await expect(canvas.getByTestId("data-sources-field-comment")).toBeInTheDocument();
  },
};

// All four meanings must be on screen at once — the point of the section is
// that they are different, which a reader can only judge side by side.
export const FourCommentMeaningsShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("data-sources-comment");
    await expect(canvas.getByTestId("data-sources-meaning-csv-comment")).toBeInTheDocument();
    await expect(canvas.getByTestId("data-sources-meaning-results-runner-comment")).toBeInTheDocument();
    await expect(canvas.getByTestId("data-sources-meaning-racecards-runner-comment")).toBeInTheDocument();
    await expect(canvas.getByTestId("data-sources-meaning-results-race-level-comments")).toBeInTheDocument();
  },
};

export const PopulationErasRendered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("data-sources-population");
    await expect(canvas.getByTestId("data-sources-population-rpr")).toBeInTheDocument();
    await expect(canvas.getByTestId("data-sources-population-comment")).toBeInTheDocument();
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/admin/data-sources`, async () => {
          await new Promise(resolve => setTimeout(resolve, 10000));
          return HttpResponse.json({ success: true, data: COMPARISON });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("data-sources-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("data-sources-fields")).not.toBeInTheDocument();
  },
};

// A 403 is not a failure — it's the permission working. It must not show the
// error state, which would read as "the site is broken" to a non-admin who
// followed a link.
export const ForbiddenStateForNonAdmin: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/admin/data-sources`, () =>
          HttpResponse.json({ success: false, error: "Admin access required" }, { status: 403 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("data-sources-forbidden")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("data-sources-error")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("data-sources-fields")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/admin/data-sources`, () =>
          HttpResponse.json({ success: false }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("data-sources-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("data-sources-forbidden")).not.toBeInTheDocument();
  },
};
