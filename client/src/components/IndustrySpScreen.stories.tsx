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
// only total/totalRunners/pnlStats matter here.
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
    await expect(canvas.queryByTestId("industry-sp-view-races-card")).not.toBeInTheDocument();
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/industry-sp`, () => HttpResponse.error()), countriesHandler, filterBoundsHandler] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("industry-sp-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-view-races-card")).not.toBeInTheDocument();
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
    const card = await canvas.findByTestId("industry-sp-view-races-card");
    await expect(card).toHaveTextContent("0");
    await expect(card).toHaveTextContent("races match your filters");
    // No stake was placed on zero races, so the PnL bar shouldn't render.
    await expect(canvas.queryByTestId("industry-sp-pnl-bar")).not.toBeInTheDocument();
  },
};

export const ScreenLoaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("industry-sp-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-view-races-card")).resolves.toBeInTheDocument();
    await expect(canvas.findByText("Industry Starting Price")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-pnl-count")).resolves.toHaveTextContent("Horses 4");
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

export const ViewRacesButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    const btn = canvas.getByTestId("industry-sp-view-races-button");
    await expect(btn).toHaveTextContent("View Races");
    await userEvent.click(btn);
    await expect(args.onViewRaces).toHaveBeenCalledTimes(1);
  },
};

export const FiltersToggleHidesAndShowsFilterBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-filters-toggle")).toHaveTextContent("Hide filters");

    await userEvent.click(canvas.getByTestId("industry-sp-filters-toggle"));
    await expect(canvas.queryByTestId("industry-sp-filter-bar")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-filters-toggle")).toHaveTextContent("Show filters");

    await userEvent.click(canvas.getByTestId("industry-sp-filters-toggle"));
    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
  },
};

export const PnlBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const bar = await canvas.findByTestId("industry-sp-pnl-bar");
    await expect(bar).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-pnl")).toHaveTextContent("+£1.58");
    await expect(bar).toHaveTextContent("£3.97");
    await expect(bar).toHaveTextContent("£5.55");
    await expect(canvas.getByTestId("industry-sp-pnl-races")).toHaveTextContent("Races 2");
  },
};

export const RunnersInRangeFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");
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
    await canvas.findByTestId("industry-sp-view-races-card");
    const maxInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, "1");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await waitFor(() => {
      expect(canvas.getByTestId("industry-sp-view-races-card")).toHaveTextContent("0");
    }, { timeout: 3000 });
  },
};

let capturedIspParams: { minIsp: string | null; maxIsp: string | null } = { minIsp: null, maxIsp: null };

export const FilterRowsAreGridAligned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    // The whole point of the grid redesign: every row's min-input starts at
    // the same x position, so columns read as aligned rather than each row
    // being its own independently-sized flow.
    const lefts = ["isp", "runners", "inIsp", "race"].map(key =>
      canvas.getByTestId(`industry-sp-filter-row-${key}`).querySelector('input')!.getBoundingClientRect().left
    );
    await expect(lefts[1]).toBe(lefts[0]);
    await expect(lefts[2]).toBe(lefts[0]);
    await expect(lefts[3]).toBe(lefts[0]);
  },
};

export const GridInputsAreLargeEnoughToType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    for (const testId of ["industry-sp-min-isp", "industry-sp-max-isp", "industry-sp-min-value", "industry-sp-max-value", "industry-sp-min-rir-value", "industry-sp-max-rir-value", "industry-sp-from-row", "industry-sp-to-row"]) {
      const box = canvas.getByTestId(testId).getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(60);
      await expect(box.height).toBeGreaterThanOrEqual(40);
    }
  },
};

export const RunnersHeadingGroupedWithInputs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

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
    await canvas.findByTestId("industry-sp-view-races-card");

    await expect(canvas.queryByTestId("industry-sp-tooltip-text-runners")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-runners")).toHaveTextContent(
      "Only show races with this many total runners taking part."
    );

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-runners")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-isp"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-isp")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-race"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-race")).toBeInTheDocument();
    // Opening a new tooltip closes the previous one — only one shown at a time.
    await expect(canvas.queryByTestId("industry-sp-tooltip-text-isp")).not.toBeInTheDocument();
  },
};

export const TooltipDoesNotShiftFilterLayout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    const applyButton = canvas.getByTestId("industry-sp-filter-apply");
    const raceLabelBefore = canvas.getByTestId("industry-sp-from-row").getBoundingClientRect().top;
    const applyBefore = applyButton.getBoundingClientRect().top;

    // Opening a tooltip must overlay the filter bar, not push rows below it
    // down the page — regression: it used to occupy a full-width flow line.
    await userEvent.click(canvas.getByTestId("industry-sp-tooltip-toggle-runners"));
    await expect(canvas.getByTestId("industry-sp-tooltip-text-runners")).toBeInTheDocument();

    const raceLabelAfter = canvas.getByTestId("industry-sp-from-row").getBoundingClientRect().top;
    const applyAfter = applyButton.getBoundingClientRect().top;

    await expect(raceLabelAfter).toBe(raceLabelBefore);
    await expect(applyAfter).toBe(applyBefore);
  },
};

export const ApplyAndResetShareTheSameLine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    const applyBox = canvas.getByTestId("industry-sp-filter-apply").getBoundingClientRect();
    const resetBox = canvas.getByTestId("industry-sp-filter-reset").getBoundingClientRect();

    await expect(resetBox.top).toBe(applyBox.top);
  },
};

export const TooltipToggleHasAdequateTapTarget: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

    for (const key of ["isp", "runners", "inIsp", "race"]) {
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
    await canvas.findByTestId("industry-sp-view-races-card");

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
    await canvas.findByTestId("industry-sp-view-races-card");

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
    await canvas.findByTestId("industry-sp-view-races-card");

    const maxRirInput = canvas.getByTestId("industry-sp-max-rir-value");
    await userEvent.clear(maxRirInput);
    await userEvent.type(maxRirInput, "5");
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(window.location.search).toContain("maxInIspRange=5");
    }, { timeout: 3000 });
  },
};

export const ResetButtonRestoresDefaultsAndClearsUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");

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
  },
};

export const InIspBoundDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("industry-sp-view-races-card");
    const bound = await canvas.findByTestId("industry-sp-max-rir-bound");
    await expect(bound).toBeInTheDocument();
    await expect(bound).toHaveTextContent("/29");
  },
};
