import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { IndustrySpScreen } from "./IndustrySpScreen";

const BASE = "http://localhost:3000";

const filterBoundsHandler = http.get(`${BASE}/api/industry-sp/filter-bounds`, () =>
  HttpResponse.json({ success: true, data: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 } })
);

const countriesHandler = http.get(`${BASE}/api/industry-sp/countries`, () =>
  HttpResponse.json({ success: true, data: ["GB", "IE"] })
);

// This screen only ever asks the API for aggregate totals (it renders no
// race list of its own), so the mock response's `data` array is irrelevant —
// only total/totalRunners/pnlStats matter here. Every fetch cycle issues
// three requests to this endpoint (a grand total, then split A and split B
// in parallel) — the flat handler below ignores fromRow/toRow and returns
// the same shape for all three, so split A and split B render identically
// in most stories unless a test needs otherwise (see
// RestrictiveFilterZeroesOutMatches for a param-aware handler).
const defaultHandlers = [
  http.get(`${BASE}/api/industry-sp`, () =>
    HttpResponse.json({
      success: true,
      data: [],
      count: 0,
      total: 2,
      page: 1,
      limit: 1,
      totalPages: 2,
      totalRunners: 4,
      pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
    })
  ),
  countriesHandler,
  filterBoundsHandler,
];

const meta: Meta<typeof IndustrySpScreen> = {
  title: "Components/IndustrySpScreen",
  component: IndustrySpScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    onNavigateToEvents: fn(),
    onViewRaces: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true, data: [], count: 0 });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-sp-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-split-card-a")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-split-card-b")).not.toBeInTheDocument();
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/industry-sp`, () => HttpResponse.error()), countriesHandler, filterBoundsHandler] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("industry-sp-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-split-card-a")).not.toBeInTheDocument();
  },
};

export const ZeroMatchesShowsZeroCount: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, () =>
          HttpResponse.json({
            success: true,
            data: [],
            count: 0,
            total: 0,
            page: 1,
            limit: 1,
            totalPages: 0,
            totalRunners: 0,
            pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
          })
        ),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cardA = await canvas.findByTestId("industry-sp-split-card-a");
    const cardB = canvas.getByTestId("industry-sp-split-card-b");
    await expect(cardA).toHaveTextContent("View 0 Races");
    await expect(cardB).toHaveTextContent("View 0 Races");
    // No stake was placed on zero races, so neither PnL headline should render.
    await expect(canvas.queryByTestId("industry-sp-pnl-a")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-pnl-b")).not.toBeInTheDocument();
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("industry-sp-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-split-card-a")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-split-card-b")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Industry Starting Price")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-pnl-a")).resolves.toHaveTextContent("+£1.58");
    await expect(canvas.findByTestId("industry-sp-pnl-b")).resolves.toHaveTextContent("+£1.58");
  },
};

export const DefaultSplitsAreFirstAndSecondHalf: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    // Mock grand total is 2 races, so the default split is 1–1 / 2–(end).
    await expect((canvas.getByTestId("industry-sp-from-row-a") as HTMLInputElement).value).toBe("1");
    await expect((canvas.getByTestId("industry-sp-to-row-a") as HTMLInputElement).value).toBe("1");
    await expect((canvas.getByTestId("industry-sp-from-row-b") as HTMLInputElement).value).toBe("2");
    await expect((canvas.getByTestId("industry-sp-to-row-b") as HTMLInputElement).value).toBe("2");
  },
};

export const EventsButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const btn = canvas.getByTestId("industry-sp-screen-events-button");
    await expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    await expect(args.onNavigateToEvents).toHaveBeenCalledTimes(1);
  },
};

export const ViewRacesButtonsNavigateWithTheirOwnSplit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const btnA = canvas.getByTestId("industry-sp-view-races-button-a");
    await expect(btnA).toHaveTextContent(/View \d+ Races/);
    await userEvent.click(btnA);
    // Mock grand total is 2, so split A defaults to races 1–1.
    await expect(args.onViewRaces).toHaveBeenLastCalledWith(1, 1);

    const btnB = canvas.getByTestId("industry-sp-view-races-button-b");
    await userEvent.click(btnB);
    // Split B defaults to race 2 through the (open-ended) end.
    await expect(args.onViewRaces).toHaveBeenLastCalledWith(2, null);
  },
};

export const FiltersToggleHidesAndShowsFilterBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-filters-toggle")).toHaveTextContent("Hide filters");

    await userEvent.click(canvas.getByTestId("industry-sp-filters-toggle"));
    await expect(canvas.queryByTestId("industry-sp-filter-bar")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-filters-toggle")).toHaveTextContent("Show filters");

    await userEvent.click(canvas.getByTestId("industry-sp-filters-toggle"));
    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
  },
};

export const PnlHeadlinesShowIndependentStats: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const id of ["a", "b"]) {
      await expect(canvas.findByTestId(`industry-sp-split-card-${id}`)).resolves.toBeInTheDocument();
      await expect(canvas.getByTestId(`industry-sp-pnl-${id}`)).toHaveTextContent("+£1.58");
    }
  },
};

export const DetailsButtonOpensFullBreakdown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    await expect(canvas.queryByTestId("split-detail-panel-a")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("industry-sp-split-details-button-a"));

    const panel = await canvas.findByTestId("split-detail-panel-a");
    await expect(panel).toBeInTheDocument();
    await expect(canvas.getByTestId("split-detail-row-races-a")).toHaveTextContent("2");
    await expect(canvas.getByTestId("split-detail-row-horses-a")).toHaveTextContent("4");
    await expect(canvas.getByTestId("split-detail-row-staked-a")).toHaveTextContent("£3.97");
    await expect(canvas.getByTestId("split-detail-row-return-a")).toHaveTextContent("£5.55");
    await expect(canvas.getByTestId("split-detail-pnl-a")).toHaveTextContent("+£1.58");
  },
};

export const DetailsPanelCloseButtonReturnsToSplitCards: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-b");

    await userEvent.click(canvas.getByTestId("industry-sp-split-details-button-b"));
    await canvas.findByTestId("split-detail-panel-b");

    await userEvent.click(canvas.getByTestId("split-detail-panel-close-b"));
    await expect(canvas.queryByTestId("split-detail-panel-b")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-b")).toBeInTheDocument();
  },
};

export const DetailsPanelViewRacesButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    await userEvent.click(canvas.getByTestId("industry-sp-split-details-button-a"));
    await canvas.findByTestId("split-detail-panel-a");

    await userEvent.click(canvas.getByTestId("split-detail-view-races-button-a"));
    await expect(args.onViewRaces).toHaveBeenLastCalledWith(1, 1);
    // Navigating away from the detail panel also closes it.
    await expect(canvas.queryByTestId("split-detail-panel-a")).not.toBeInTheDocument();
  },
};

export const RunnersInRangeFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");
    await expect(canvas.getByTestId("industry-sp-min-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-max-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-in-isp-label")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-in-isp-label")).toHaveTextContent("# in ISP");
  },
};

export const RestrictiveFilterZeroesOutMatches: Story = {
  parameters: {
    msw: {
      // Real filtering by maxInIspRange, mirroring server behavior — the flat
      // defaultHandlers ignore query params entirely, which isn't enough here.
      handlers: [
        http.get(`${BASE}/api/industry-sp`, ({ request }) => {
          const url = new URL(request.url);
          const maxInIspRange = parseInt(url.searchParams.get("maxInIspRange") ?? "30");
          const matches = maxInIspRange >= 2;
          return HttpResponse.json({
            success: true,
            data: [],
            count: 0,
            total: matches ? 2 : 0,
            page: 1,
            limit: 1,
            totalPages: matches ? 2 : 0,
            totalRunners: matches ? 4 : 0,
            pnlStats: matches ? { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } : { staked: 0, returns: 0, pnl: 0, count: 0 },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");
    const maxInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "1");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await waitFor(() => {
      expect(canvas.getByTestId("industry-sp-split-card-a")).toHaveTextContent("View 0 Races");
      expect(canvas.getByTestId("industry-sp-split-card-b")).toHaveTextContent("View 0 Races");
    }, { timeout: 3000 });
  },
};

let capturedIspParams: { minIsp: string | null; maxIsp: string | null } = { minIsp: null, maxIsp: null };

export const FilterRowsAreGridAligned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    // The whole point of the grid redesign: every row's min-input starts at
    // the same x position, so columns read as aligned rather than each row
    // being its own independently-sized flow.
    const lefts = ["isp", "runners", "inIsp", "raceA", "raceB"].map(key =>
      canvas.getByTestId(`industry-sp-filter-row-${key}`).querySelector('input')!.getBoundingClientRect().left
    );
    for (const left of lefts.slice(1)) {
      await expect(left).toBe(lefts[0]);
    }
  },
};

export const GridInputsAreLargeEnoughToType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    for (const testId of [
      "industry-sp-min-isp", "industry-sp-max-isp",
      "industry-sp-min-value", "industry-sp-max-value",
      "industry-sp-min-rir-value", "industry-sp-max-rir-value",
      "industry-sp-from-row-a", "industry-sp-to-row-a",
      "industry-sp-from-row-b", "industry-sp-to-row-b",
    ]) {
      const box = canvas.getByTestId(testId).getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(60);
      await expect(box.height).toBeGreaterThanOrEqual(40);
    }
  },
};

export const RunnersHeadingGroupedWithInputs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    // The "Runners" heading must live in the same row as its own Min/Max
    // inputs, not float off as an unrelated sibling elsewhere in the filter
    // bar (regression: it used to wrap onto a different line).
    const row = within(canvas.getByTestId("industry-sp-filter-row-runners"));
    await expect(row.getByText("Runners")).toBeInTheDocument();
    await expect(row.getByTestId("industry-sp-min-value")).toBeInTheDocument();
    await expect(row.getByTestId("industry-sp-max-value")).toBeInTheDocument();
  },
};

export const TooltipTogglesShowAndHideExplanation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    await expect(canvas.queryByTestId("industry-sp-tooltip-text-runners")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-runners")).toHaveTextContent(
      "Only show races with this many total runners taking part."
    );

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-runners")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-isp"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-isp")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-raceA"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-raceA")).toBeInTheDocument();
    // Opening a new tooltip closes the previous one — only one shown at a time.
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-isp")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-raceB"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-raceB")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-raceA")).not.toBeInTheDocument();
  },
};

export const TooltipDoesNotShiftFilterLayout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const applyButton = canvas.getByTestId("industry-sp-filter-apply");
    const raceLabelBefore = canvas.getByTestId("industry-sp-from-row-a").getBoundingClientRect().top;
    const applyBefore = applyButton.getBoundingClientRect().top;

    // Opening a tooltip must overlay the filter bar, not push rows below it
    // down the page — regression: it used to occupy a full-width flow line.
    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-runners")).toBeInTheDocument();

    const raceLabelAfter = canvas.getByTestId("industry-sp-from-row-a").getBoundingClientRect().top;
    const applyAfter = applyButton.getBoundingClientRect().top;

    await expect(raceLabelAfter).toBe(raceLabelBefore);
    await expect(applyAfter).toBe(applyBefore);
  },
};

export const ApplyAndResetShareTheSameLine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const applyBox = canvas.getByTestId("industry-sp-filter-apply").getBoundingClientRect();
    const resetBox = canvas.getByTestId("industry-sp-filter-reset").getBoundingClientRect();

    await expect(resetBox.top).toBe(applyBox.top);
  },
};

export const TooltipToggleHasAdequateTapTarget: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    for (const key of ["isp", "runners", "inIsp", "raceA", "raceB"]) {
      const toggle = canvas.getByTestId(`industry-sp-tooltip-toggle-${key}`);
      const box = toggle.getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(24);
      await expect(box.height).toBeGreaterThanOrEqual(24);
    }
  },
};

export const IspFilterParamsPassedToApi: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp`, ({ request }) => {
          const url = new URL(request.url);
          capturedIspParams = {
            minIsp: url.searchParams.get("minIsp"),
            maxIsp: url.searchParams.get("maxIsp"),
          };
          return HttpResponse.json({
            success: true,
            data: [],
            count: 0,
            total: 2,
            page: 1,
            limit: 1,
            totalPages: 2,
            totalRunners: 4,
            pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const minInput = canvas.getByTestId("industry-sp-min-isp");
    const maxInput = canvas.getByTestId("industry-sp-max-isp");
    await userEvent.clear(minInput);
    await userEvent.type(minInput, "5");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "20");

    capturedIspParams = { minIsp: null, maxIsp: null };
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(capturedIspParams.minIsp).toBe("5");
      expect(capturedIspParams.maxIsp).toBe("20");
    }, { timeout: 3000 });
  },
};

export const IspInputsAcceptDecimals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const minInput = canvas.getByTestId("industry-sp-min-isp");
    const maxInput = canvas.getByTestId("industry-sp-max-isp");

    // "decimal" (not "numeric") is what puts a decimal point on the mobile
    // keyboard — regression: "numeric" renders a phone-style pad with no ".".
    await expect(minInput).toHaveAttribute("inputmode", "decimal");
    await expect(maxInput).toHaveAttribute("inputmode", "decimal");

    await userEvent.clear(minInput);
    await userEvent.type(minInput, "4.5");
    await expect(minInput).toHaveValue("4.5");
  },
};

export const ApplyingFilterUpdatesUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const maxRirInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxRirInput);
    await userEvent.type(maxRirInput, "5");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(window.location.search).toContain("maxInIspRange=5");
    }, { timeout: 3000 });
  },
};

export const ApplyingCustomSplitUpdatesUrlWithBothRanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const toRowA = canvas.getByTestId("industry-sp-to-row-a");
    await userEvent.clear(toRowA);
    await userEvent.type(toRowA, "1");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(window.location.search).toContain("fromRowA=1");
      expect(window.location.search).toContain("toRowA=1");
      expect(window.location.search).toContain("fromRowB=");
    }, { timeout: 3000 });
  },
};

export const ResetButtonRestoresDefaultsAndClearsUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");

    const maxRirInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxRirInput);
    await userEvent.type(maxRirInput, "5");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await waitFor(() => {
      expect(window.location.search).toContain("maxInIspRange=5");
    }, { timeout: 3000 });

    await userEvent.click(canvas.getByTestId("industry-sp-filter-reset"));

    await waitFor(() => {
      expect((canvas.getByTestId("industry-sp-max-rir-value") as HTMLInputElement).value).toBe("30");
      expect(window.location.search).not.toContain("maxInIspRange");
    }, { timeout: 3000 });

    // Reset also hands the split boundaries back to auto mode — they
    // recompute to the fresh first-half/second-half default.
    await waitFor(() => {
      expect((canvas.getByTestId("industry-sp-from-row-a") as HTMLInputElement).value).toBe("1");
      expect((canvas.getByTestId("industry-sp-from-row-b") as HTMLInputElement).value).toBe("2");
    }, { timeout: 3000 });
  },
};

export const InIspBoundDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");
    const bound = await canvas.findByTestId("industry-sp-max-rir-bound");
    await expect(bound).toBeInTheDocument();
    await expect(bound).toHaveTextContent("/29");
  },
};

export const RaceBoundsDisplayedForBothSplits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-split-card-a");
    const boundA = await canvas.findByTestId("industry-sp-race-bound-a");
    const boundB = await canvas.findByTestId("industry-sp-race-bound-b");
    await expect(boundA).toHaveTextContent("/2");
    await expect(boundB).toHaveTextContent("/2");
  },
};
