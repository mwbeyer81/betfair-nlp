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

// The three landmark rows come first so they're always on page 1.
const ROWS: ModelVsSpRow[] = [
  makeRow(0, 4, 39, "2024-01-10"), // +14.0
  makeRow(1, 2, 50, "2024-01-11"), //   0.0
  makeRow(2, 8, 0.1, "2024-01-12"), // -12.4
  ...Array.from({ length: 127 }, (_, n) => {
    const i = n + 3;
    // Spread across 2024 and 2025 so the year/month pills have data to filter.
    const year = i % 2 === 0 ? 2024 : 2025;
    const month = String((i % 12) + 1).padStart(2, "0");
    return makeRow(i, 4, 20 + (i % 30), `${year}-${month}-15`);
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
  minEdge: string | null;
  maxEdge: string | null;
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
  const minEdge = parseFloat(url.searchParams.get("minEdge") ?? "-100");
  const maxEdge = parseFloat(url.searchParams.get("maxEdge") ?? "100");
  const minModelProb = parseFloat(url.searchParams.get("minModelProb") ?? "0");

  let filtered = ROWS.filter(
    r =>
      r.raceDate >= minDate &&
      r.raceDate <= maxDate &&
      r.edge >= minEdge &&
      r.edge <= maxEdge &&
      r.modelWinProbability >= minModelProb
  );

  filtered = [...filtered].sort((a, b) => {
    if (sort === "edge_desc") return b.edge - a.edge;
    if (sort === "edge_asc") return a.edge - b.edge;
    if (sort === "date_asc") return a.raceTime.localeCompare(b.raceTime);
    return b.raceTime.localeCompare(a.raceTime);
  });

  const total = filtered.length;
  const data = filtered.slice((page - 1) * limit, page * limit);

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
    minEdge: url.searchParams.get("minEdge"),
    maxEdge: url.searchParams.get("maxEdge"),
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

// The screen reads its initial state from window.location.search at mount, so a
// story that needs a specific starting URL must push it before the first render —
// doing it inside `play` is one render too late.
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

// The default window is January 2024, which only holds the three landmark rows —
// most stories want the whole fixture, so they widen it via the URL.
const WIDE = "minDate=2024-01-01&maxDate=2024-12-31";
const ALL_2024 = withQueryParams(WIDE);

// Filter and page state carries over between stories in the same suite (the test
// runner reuses the module), so any story asserting on counts starts from Reset.
async function resetToDefaults(canvas: ReturnType<typeof within>) {
  await canvas.findByTestId("model-vs-sp-list");
  await userEvent.click(canvas.getByTestId("model-vs-sp-reset-button"));
  await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 1"));
}

export const Default: Story = {
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    // A gap of exactly zero is a real, meaningful value (the model agreeing
    // precisely with the market) — it must never render as blank or "0".
    await expect(canvas.getByTestId("model-vs-sp-edge-1001-90001")).toHaveTextContent("+0.0 pts");
  },
};

export const NegativeEdgeRendersSigned: Story = {
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    await expect(canvas.getByTestId("model-vs-sp-edge-1002-90002")).toHaveTextContent("-12.4 pts");
  },
};

export const NextGoesToPageTwoAndSkipsTheRecount: Story = {
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-next"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 2"));

    await expect(capturedRequests).toHaveLength(1);
    await expect(capturedRequests[0].page).toBe("2");
    // A pure page step already knows the total, so it opts out of the count query.
    await expect(capturedRequests[0].includeTotal).toBe("false");
  },
};

export const PageStepKeepsTheTotalOnScreen: Story = {
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-first")).toBeDisabled();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-prev")).toBeDisabled();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-next")).not.toBeDisabled();
  },
};

export const LastJumpsToTheFinalPageAndDisablesNext: Story = {
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    const status = canvas.getByTestId("model-vs-sp-pagination-top-status").textContent ?? "";
    const finalPage = status.split("of")[1]?.trim();

    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-last"));
    await waitFor(() =>
      expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent(`Page ${finalPage}`)
    );
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-next")).toBeDisabled();
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-prev")).not.toBeDisabled();
  },
};

export const RowsPerPageChangeResetsToPageOne: Story = {
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-next"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 2"));

    capturedRequests = [];
    await userEvent.click(canvas.getByTestId("model-vs-sp-pagination-top-rows-per-page-100"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 1"));

    await expect(capturedRequests[0].limit).toBe("100");
    await expect(capturedRequests[0].page).toBe("1");
    // A different page size means a different set of pages, so the total has to
    // be re-counted rather than reused.
    await expect(capturedRequests[0].includeTotal).not.toBe("false");
  },
};

export const SortByGapRequestsEdgeDescThenAsc: Story = {
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
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

export const MinEdgeOfZeroIsSentNotDropped: Story = {
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);
    capturedRequests = [];

    const input = canvas.getByTestId("model-vs-sp-min-edge");
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));
    await waitFor(() => expect(capturedRequests.length).toBeGreaterThan(0));

    // 0 is falsy — the whole point. If it were dropped, the server's own -100
    // default would silently win and every negative-gap runner would come back.
    await expect(capturedRequests[0].minEdge).toBe("0");
    await expect(capturedRequests[0].raw).toContain("minEdge=0");
  },
};

export const MaxEdgeOfZeroFindsModelBelowSp: Story = {
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await resetToDefaults(canvas);

    const input = canvas.getByTestId("model-vs-sp-max-edge");
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));

    // The -12.4 row survives; the +14.0 row must not.
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-edge-1002-90002")).toBeInTheDocument());
    await expect(canvas.queryByTestId("model-vs-sp-edge-1000-90000")).not.toBeInTheDocument();
  },
};

export const FiltersRequireApply: Story = {
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");

    const input = canvas.getByTestId("model-vs-sp-min-edge");
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await userEvent.click(canvas.getByTestId("model-vs-sp-apply-button"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-min-edge")).toHaveValue("5"));

    await userEvent.click(canvas.getByTestId("model-vs-sp-reset-button"));
    await waitFor(() => expect(canvas.getByTestId("model-vs-sp-min-edge")).toHaveValue("-100"));
    await expect(canvas.getByTestId("model-vs-sp-pagination-top-status")).toHaveTextContent("Page 1");
  },
};

export const RunnerRowTapNavigatesToTheRunnerScreen: Story = {
  decorators: [ALL_2024],
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
  decorators: [ALL_2024],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("model-vs-sp-list");
    // The header namespaces every testID by testIdPrefix, so this is the same
    // menu item other screens expose as e.g. industry-sp-menu-model-vs-sp-link.
    await expect(canvas.getByTestId("model-vs-sp-menu-model-vs-sp-link")).toBeInTheDocument();
  },
};
