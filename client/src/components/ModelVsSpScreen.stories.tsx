import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ModelVsSpScreen } from "./ModelVsSpScreen";
import type { ModelVsSpRow } from "../services/chatApi";

const BASE = "http://localhost:3000";

// Hand-built so every edge is an exact, assertable number:
//   isp 4.00 -> SP 25.0% | model 39.0 -> edge +14.0
//   isp 2.00 -> SP 50.0% | model 50.0 -> edge   0.0  (the boundary case)
//   isp 8.00 -> SP 12.5% | model  0.1 -> edge -12.4
function makeRow(i: number, isp: number, model: number, raceDate: string): ModelVsSpRow {
  return {
    raceId: 1000 + i,
    raceTime: `${raceDate}T14:${String(i % 60).padStart(2, "0")}:00.000Z`,
    raceDate,
    meetingId: `m${1000 + i}`,
    meetingName: "Storybook Meeting",
    course: i % 2 === 0 ? "Ascot" : "Newbury",
    countryCode: "GB",
    raceName: `Race ${i}`,
    raceType: "Flat",
    raceClass: "Class 3",
    going: "Good",
    runnerId: 90000 + i,
    runnerName: `Runner ${i}`,
    num: (i % 12) + 1,
    draw: null,
    sortPriority: (i % 12) + 1,
    status: i % 5 === 0 ? "WINNER" : "LOSER",
    isp,
    ispFraction: isp === 4 ? "3/1" : isp === 2 ? "1/1" : "7/1",
    isFavourite: false,
    jockey: "J Storybook",
    trainer: "T Storybook",
    modelWinProbability: model,
    impliedSpProbability: 100 / isp,
    edge: model - 100 / isp,
    modelVersionId: "xgb-story",
  };
}

// EVERY row sits inside the screen's own default window (January 2024), and the
// three landmark rows are dated LAST so they lead under the default
// newest-first sort. Both properties are load-bearing:
//   - a fixture outside the default window only renders behind a URL decorator,
//     and any story that presses Reset then silently empties the list;
//   - landmarks dated earliest would sort onto the LAST page, so the stories
//     asserting on their badges would find nothing on page 1.
const LANDMARK_DATES = ["2024-01-31", "2024-01-30", "2024-01-29"];
const ROWS: ModelVsSpRow[] = [
  makeRow(0, 4, 39, LANDMARK_DATES[0]), // +14.0 — the largest edge in the fixture
  makeRow(1, 2, 50, LANDMARK_DATES[1]), //   0.0
  makeRow(2, 8, 0.1, LANDMARK_DATES[2]), // -12.4
  ...Array.from({ length: 127 }, (_, n) => {
    const i = n + 3;
    // Day 1-28 of the same month, so filler never outranks a landmark by date.
    const day = String((i % 28) + 1).padStart(2, "0");
    // isp 4 (implied 25%) with model 14-24 gives edges of -11 to -1: every
    // filler gap is strictly SMALLER in magnitude than either landmark, which is
    // what lets the gap-sort and difference-band stories assert on the
    // landmarks alone.
    return makeRow(i, 4, 14 + (i % 11), `2024-01-${day}`);
  }),
];

// Captures what the screen actually asked for. Reset inside a play function so a
// story only sees its own requests — meta-level mocks and module state are shared
// across the whole suite by the test runner.
interface CapturedRequest {
  page: string | null;
  limit: string | null;
  sort: string | null;
  minDate: string | null;
  maxDate: string | null;
  minAbsEdge: string | null;
  maxAbsEdge: string | null;
  minModelProb: string | null;
  includeTotal: string | null;
  raw: string;
}
let capturedRequests: CapturedRequest[] = [];

function respond(url: URL) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10));
  const sort = url.searchParams.get("sort") ?? "date_desc";
  const includeTotal = url.searchParams.get("includeTotal") !== "false";
  const minDate = url.searchParams.get("minDate") ?? "2015-01-01";
  const maxDate = url.searchParams.get("maxDate") ?? "2026-12-31";
  // Unsigned, like the real endpoint: the filter selects on the SIZE of the gap.
  const minAbsEdge = parseFloat(url.searchParams.get("minAbsEdge") ?? "0");
  const maxAbsEdge = parseFloat(url.searchParams.get("maxAbsEdge") ?? "100");
  const minModelProb = parseFloat(url.searchParams.get("minModelProb") ?? "0");

  // The summary's denominator deliberately excludes the difference filter.
  const beforeEdgeFilter = ROWS.filter(
    r => r.raceDate >= minDate && r.raceDate <= maxDate && r.modelWinProbability >= minModelProb
  );
  let filtered = beforeEdgeFilter.filter(
    r => Math.abs(r.edge) >= minAbsEdge && Math.abs(r.edge) <= maxAbsEdge
  );

  filtered = [...filtered].sort((a, b) => {
    if (sort === "edge_desc") return b.edge - a.edge;
    if (sort === "edge_asc") return a.edge - b.edge;
    if (sort === "date_asc") return a.raceTime.localeCompare(b.raceTime);
    return b.raceTime.localeCompare(a.raceTime);
  });

  const total = filtered.length;
  const data = filtered.slice((page - 1) * limit, page * limit);

  // Mirrors buildEdgeSummary — EDGE_BAND_BOUNDS [2, 5, 10, 20, 50] plus a tail.
  const bounds = [2, 5, 10, 20, 50];
  const absEdges = beforeEdgeFilter.map(r => Math.abs(r.edge));
  const all = absEdges.length;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const pctOf = (n: number) => (all > 0 ? round1((n / all) * 100) : 0);
  let running = 0;
  const bands = [...bounds, null].map((upper, i) => {
    const lower = i === 0 ? 0 : bounds[i - 1];
    const count = absEdges.filter(e => (upper == null ? e >= lower : e >= lower && e < upper)).length;
    running += count;
    return {
      minAbs: lower,
      maxAbs: upper,
      label: upper == null ? `beyond ±${lower} pts` : lower === 0 ? `within ±${upper} pts` : `±${lower} to ±${upper} pts`,
      count,
      percent: pctOf(count),
      cumulativePercent: upper == null ? null : pctOf(running),
    };
  });

  return HttpResponse.json({
    success: true,
    data,
    count: data.length,
    total: includeTotal ? total : null,
    page,
    limit,
    totalPages: includeTotal ? Math.ceil(total / limit) : null,
    sort,
    minDate,
    maxDate,
    summary: includeTotal
      ? {
          allRunners: all,
          matchedRunners: total,
          matchedPercent: pctOf(total),
          meanAbsEdge: all > 0 ? round1(absEdges.reduce((a, b) => a + b, 0) / all) : 0,
          bands,
        }
      : null,
  });
}

const modelVsSpHandler = http.get(`${BASE}/api/model-vs-sp`, ({ request }) => {
  const url = new URL(request.url);
  capturedRequests.push({
    page: url.searchParams.get("page"),
    limit: url.searchParams.get("limit"),
    sort: url.searchParams.get("sort"),
    minDate: url.searchParams.get("minDate"),
    maxDate: url.searchParams.get("maxDate"),
    minAbsEdge: url.searchParams.get("minAbsEdge"),
    maxAbsEdge: url.searchParams.get("maxAbsEdge"),
    minModelProb: url.searchParams.get("minModelProb"),
    includeTotal: url.searchParams.get("includeTotal"),
    raw: url.search,
  });
  return respond(url);
});

const defaultHandlers = [
  modelVsSpHandler,
  http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ success: true, email: "story@backbet.co.uk" })),
];

// The screen persists its applied filters to the URL (see updateUrlParams), and
// the test-runner reuses one browser page across the whole suite — so a story
// that taps a year pill leaves `minDate=2025-01-01` in the URL, and the NEXT
// story mounts with that range, finds no rows in the January-2024 fixture, and
// fails looking for a list that legitimately isn't there. Clearing the query
// string before every story makes each one independent of the order it runs in.
const withCleanUrl = (Story: React.ComponentType) => {
  window.history.replaceState({}, "", window.location.pathname);
  return <Story />;
};

// The screen reads its initial state from window.location.search at mount, so a
// story that needs a specific starting URL must push it before the first render —
// doing it inside `play` is one render too late. Story-level decorators run
// closer to the story than meta-level ones, so this reliably wins over
// withCleanUrl above.
const withQueryParams = (search: string) => {
  const Decorator = (Story: React.ComponentType) => {
    window.history.pushState({}, "", `${window.location.pathname}?${search}`);
    return <Story />;
  };
  return Decorator;
};

const meta: Meta<typeof ModelVsSpScreen> = {
  title: "Components/ModelVsSpScreen",
  component: ModelVsSpScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  decorators: [withCleanUrl],
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onBack: fn(),
    onNavigateToRunner: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Filter and page state carries over between stories in the same suite (the test
// runner reuses the module), so any story asserting on counts starts from Reset.
// Safe now that the whole fixture lives inside the default window — Reset used to
// narrow the date range back to January 2024 and empty a widened list.
async function resetToDefaults(canvas: ReturnType<typeof within>) {
  await canvas.findByTestId("model-vs-sp-list");
  await userEvent.click(canvas.getByTestId("model-vs-sp-reset-button"));
  await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 1"));
  await waitUntilIdle(canvas);
}

// The pagination controls are disabled while a fetch is in flight, and both Reset
// and Apply start one — so a click issued the moment the rows appear lands on a
// button with `pointer-events: none` and silently does nothing. Every story that
// clicks a pagination control waits on this first.
async function waitUntilIdle(canvas: ReturnType<typeof within>) {
  await waitFor(() => expect(canvas.queryByTestId("model-vs-sp-loading")).not.toBeInTheDocument(), {
    timeout: 10000,
  });
  await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-next")).not.toBeDisabled(), {
    timeout: 10000,
  });
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    await expect(canvas.getByTestId("model-vs-sp-result-count")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-vs-sp-pagination-bottom")).toBeInTheDocument();
  },
};

export const LoadingState: Story = {
  parameters: {
    // Listed BEFORE the defaults: MSW resolves on FIRST match, not last, so an
    // override placed after them would never be reached.
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-vs-sp`, async () => {
          await new Promise(resolve => setTimeout(resolve, 60000));
          return HttpResponse.json({ success: true, data: [] });
        }),
        ...defaultHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("model-vs-sp-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-vs-sp-list")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-vs-sp`, () => new HttpResponse(null, { status: 500 })),
        ...defaultHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("model-vs-sp-error")).toBeInTheDocument();
    await expect(canvas.queryByTestId("model-vs-sp-list")).not.toBeInTheDocument();
  },
};

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/model-vs-sp`, () =>
          HttpResponse.json({
            success: true,
            data: [],
            count: 0,
            total: 0,
            page: 1,
            limit: 50,
            totalPages: 0,
            sort: "date_desc",
            minDate: "2024-01-01",
            maxDate: "2024-01-31",
          })
        ),
        ...defaultHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("model-vs-sp-empty");
    // The empty state must explain WHY — a row needs both a model score and a
    // real SP, so an unsatisfiable filter looks identical to a data gap.
    await expect(empty).toHaveTextContent(/model score/i);
    await expect(canvas.queryByTestId("model-vs-sp-list")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("model-vs-sp-result-count")).toHaveTextContent("0 runners");
  },
};

export const RowShowsModelSpAndSignedEdge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    const key = "1000-90000"; // the +14.0 landmark row
    await expect(canvas.getByTestId(`model-vs-sp-model-${key}`)).toHaveTextContent("Model 39.0%");
    await expect(canvas.getByTestId(`model-vs-sp-sp-${key}`)).toHaveTextContent("SP 25.0%");
    await expect(canvas.getByTestId(`model-vs-sp-edge-${key}`)).toHaveTextContent("+14.0 pts");
  },
};

export const ZeroEdgeRendersAsPlusZeroNotBlank: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    // A gap of exactly zero is a real, meaningful value (the model agreeing
    // precisely with the market) — it must never render as blank or "0".
    await expect(canvas.getByTestId("model-vs-sp-edge-1001-90001")).toHaveTextContent("+0.0 pts");
  },
};

export const NegativeEdgeRendersSigned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    await expect(canvas.getByTestId("model-vs-sp-edge-1002-90002")).toHaveTextContent("-12.4 pts");
  },
};

export const NextGoesToPageTwoAndSkipsTheRecount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-next"));
    // Wait on the REQUEST, not the page label: `page` is component state that
    // updates synchronously on click, so the status reads "Page 2" before the
    // fetch has even been issued — asserting on the label first would check
    // capturedRequests while it's still empty.
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0), { timeout: 10000 });

    await expect(capturedRequests).toHaveLength(1);
    await expect(capturedRequests[0].page).toBe("2");
    // A pure page step already knows the total, so it opts out of the count query.
    await expect(capturedRequests[0].includeTotal).toBe("false");
  },
};

export const PageStepKeepsTheTotalOnScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    const before = canvas.getByTestId("model-vs-sp-result-count").textContent;

    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-next"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 2"));

    // The response carried total: null, so the count must persist rather than
    // flashing "0 runners".
    await expect(canvas.getByTestId("model-vs-sp-result-count")).toHaveTextContent(before ?? "");
  },
};

export const FirstAndPrevDisabledOnPageOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-first")).toBeDisabled();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-prev")).toBeDisabled();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-next")).not.toBeDisabled();
  },
};

export const LastJumpsToTheFinalPageAndDisablesNext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    const status = canvas.getByTestId("model-vs-sp-pagination-top-status").textContent ?? "";
    const finalPage = status.split("of")[1]?.trim();
    await expect(finalPage).toBeTruthy();

    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-last"));
    await waitFor(() =>
      expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent(`Page ${finalPage}`)
    );
    await waitFor(() => expect(canvas.queryByTestId("model-vs-sp-loading")).not.toBeInTheDocument());
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-next")).toBeDisabled();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-prev")).not.toBeDisabled();
  },
};

export const RowsPerPageChangeResetsToPageOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-next"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 2"));
    await waitUntilIdle(canvas);

    capturedRequests = [];
    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-rows-per-page-100"));
    // Same reason as above — wait for the request, not the synchronously-updated
    // page label.
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0), { timeout: 10000 });
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 1"));

    await expect(capturedRequests[0].limit).toBe("100");
    await expect(capturedRequests[0].page).toBe("1");
    // A different page size means a different set of pages, so the total has to
    // be re-counted rather than reused.
    await expect(capturedRequests[0].includeTotal).not.toBe("false");
  },
};

export const SortByGapRequestsEdgeDescThenAsc: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    await userEvent.click(canvas.getByTestId("model-vs-sp-sort-edge"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));
    await expect(capturedRequests[0].sort).toBe("edge_desc");

    capturedRequests = [];
    await userEvent.click(canvas.getByTestId("model-vs-sp-sort-edge"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));
    await expect(capturedRequests[0].sort).toBe("edge_asc");
  },
};

export const SortByDateTogglesAscDesc: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    await userEvent.click(canvas.getByTestId("model-vs-sp-sort-date"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));
    await expect(capturedRequests[0].sort).toBe("date_asc");
    await expect(canvas.getByTestId("model-vs-sp-sort-date")).toHaveTextContent("Oldest first");
  },
};

export const GapSortPutsTheBiggestGapFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    await userEvent.click(canvas.getByTestId("model-vs-sp-sort-edge"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-list")).toBeInTheDocument());

    // The +14.0 landmark is the largest edge in the fixture, so it must be the
    // first row once sorted biggest-gap-first.
    await waitFor(() =>
      expect(canvas.getByTestId("model-vs-sp-list").firstElementChild).toHaveAttribute(
        "data-testid",
        "model-vs-sp-row-1000-90000"
      )
    );
  },
};

export const MaxDifferenceOfZeroIsSentNotDropped: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    const input = canvas.getByTestId("model-vs-sp-max-edge");
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));

    // 0 is falsy — the whole point. If it were dropped, the server's own 100
    // default would silently win and every runner would come back.
    await expect(capturedRequests[0].maxAbsEdge).toBe("0");
    await expect(capturedRequests[0].raw).toContain("maxAbsEdge=0");
  },
};

export const DifferenceFilterIgnoresDirection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);

    // 12 to 15 pts apart. The +14.0 landmark AND the -12.4 one both qualify —
    // proving the filter selects on magnitude, not sign.
    const min = canvas.getByTestId("model-vs-sp-min-edge");
    await userEvent.clear(min);
    await userEvent.type(min, "12");
    const max = canvas.getByTestId("model-vs-sp-max-edge");
    await userEvent.clear(max);
    await userEvent.type(max, "15");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));

    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-edge-1000-90000")).toBeInTheDocument());
    await expect(canvas.getByTestId("model-vs-sp-edge-1002-90002")).toBeInTheDocument();
    // The exactly-zero row is far too close to qualify.
    await expect(canvas.queryByTestId("model-vs-sp-edge-1001-90001")).not.toBeInTheDocument();
  },
};

export const SummaryShowsTheDistributionOverAllRunners: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);

    await expect(canvas.getByTestId("model-vs-sp-summary")).toBeInTheDocument();
    await expect(canvas.getByTestId("model-vs-sp-summary-headline")).toHaveTextContent(/average gap/i);
    // One row per band bound plus the open-ended tail.
    for (const key of ["2", "5", "10", "20", "50", "beyond"]) {
      await expect(canvas.getByTestId(`model-vs-sp-summary-band-${key}`)).toBeInTheDocument();
    }
  },
};

export const SummaryDenominatorIgnoresTheDifferenceFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    const before = canvas.getByTestId("model-vs-sp-summary-headline").textContent;

    const min = canvas.getByTestId("model-vs-sp-min-edge");
    await userEvent.clear(min);
    await userEvent.type(min, "12");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));

    // Narrowing the difference filter must not move the summary's own baseline,
    // or every band would read 100%.
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-summary-selection")).toBeInTheDocument());
    await expect(canvas.getByTestId("model-vs-sp-summary-headline")).toHaveTextContent(before ?? "");
  },
};

export const FiltersRequireApply: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    const input = canvas.getByTestId("model-vs-sp-min-model-prob");
    await userEvent.clear(input);
    await userEvent.type(input, "35");
    // Typing alone must not fetch — each request is a paged query against a
    // free-tier cluster.
    await expect(capturedRequests).toHaveLength(0);

    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));
    await waitFor(() => expect(capturedRequests.length).toBe(1));
    await expect(capturedRequests[0].minModelProb).toBe("35");
  },
};

export const YearPillSetsTheWholeYearAndRefetches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    await userEvent.click(canvas.getByTestId("model-vs-sp-year-pill-2025"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));

    await expect(capturedRequests[0].minDate).toBe("2025-01-01");
    await expect(capturedRequests[0].maxDate).toBe("2025-12-31");
    // A pill is a shortcut, so it bypasses Apply and resets to page 1.
    await expect(capturedRequests[0].page).toBe("1");
  },
};

export const YearPillHighlightsWhenTheRangeIsExactlyThatYear: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    await userEvent.click(canvas.getByTestId("model-vs-sp-year-pill-2025"));
    // Paper renders a Chip as role="button", for which React Native Web emits no
    // aria-selected — the pill carries its state in its accessible label instead.
    await waitFor(() =>
      expect(canvas.getByTestId("model-vs-sp-year-pill-2025")).toHaveAttribute("aria-label", "2025 (selected)")
    );
  },
};

export const MonthPillSetsTheWholeMonth: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    capturedRequests = [];

    // February 2024 — a leap year on purpose, so an off-by-one in the
    // last-day-of-month calculation shows up here.
    await userEvent.click(canvas.getByTestId("model-vs-sp-month-pill-2024-02"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));

    await expect(capturedRequests[0].minDate).toBe("2024-02-01");
    await expect(capturedRequests[0].maxDate).toBe("2024-02-29");
  },
};

export const ArbitraryDateRangeHighlightsNoPill: Story = {
  decorators: [withQueryParams("minDate=2024-03-07&maxDate=2024-05-19")],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-year-pills");
    // Pill selection is derived from the applied range, so a range that isn't a
    // whole year or whole month lights nothing.
    await expect(canvas.getByTestId("model-vs-sp-year-pill-2024")).toHaveAttribute("aria-label", "2024");
    await expect(canvas.getByTestId("model-vs-sp-month-pill-2024-03")).toHaveAttribute("aria-label", "2024-03");
  },
};

export const ResetRestoresDefaults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");

    const input = canvas.getByTestId("model-vs-sp-min-edge");
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-min-edge")).toHaveValue("5"));

    await userEvent.click(canvas.getByTestId("model-vs-sp-reset-button"));
    // 0, not -100 — the difference filter is unsigned, so its floor is zero.
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-min-edge")).toHaveValue("0"));
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 1");
  },
};

export const RunnerRowTapNavigatesToTheRunnerScreen: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");

    // meta.args mocks are one shared instance across the whole suite, not reset
    // per story — so assert on the call-count DIFF, never "was never called".
    const before = (args.onNavigateToRunner as ReturnType<typeof fn>).mock.calls.length;
    await userEvent.click(canvas.getByTestId("model-vs-sp-row-1000-90000"));
    await waitFor(() =>
      expect((args.onNavigateToRunner as ReturnType<typeof fn>).mock.calls.length).toBe(before + 1)
    );
    await expect(args.onNavigateToRunner).toHaveBeenLastCalledWith(1000, 90000);
  },
};

export const MenuHasTheModelVsSpLink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    // The header namespaces every testID by testIdPrefix, so this is the same
    // menu item other screens expose as e.g. industry-sp-menu-model-vs-sp-link.
    await expect(canvas.getByTestId("model-vs-sp-menu-model-vs-sp-link")).toBeInTheDocument();
  },
};
