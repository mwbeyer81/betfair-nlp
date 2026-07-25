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

const DEFAULT_PNL = { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 };
const ZERO_PNL = { staked: 0, returns: 0, pnl: 0, count: 0 };

// Drives DateRangePicker.tsx the same way the MSW Playwright suite does
// (see pickDateRange in tests-msw/industry-sp.spec.ts) — jump to the year
// via the header's year-grid (always resets to January), step forward to
// the target month, tap the day, repeat for the second date, then Apply.
async function pickDateRangeInCanvas(
  canvas: ReturnType<typeof within>,
  fromDate: string,
  toDate: string
) {
  const prefix = "industry-sp-date-range-picker";
  await userEvent.click(canvas.getByTestId(prefix));
  await canvas.findByTestId(`${prefix}-modal`);

  for (const dateStr of [fromDate, toDate]) {
    const [year, month] = dateStr.split("-").map(Number);
    await userEvent.click(canvas.getByTestId(`${prefix}-header-title`));
    await canvas.findByTestId(`${prefix}-year-grid`);
    await userEvent.click(canvas.getByTestId(`${prefix}-year-${year}`));
    for (let i = 0; i < month - 1; i++) {
      await userEvent.click(canvas.getByTestId(`${prefix}-next-month`));
    }
    await userEvent.click(canvas.getByTestId(`${prefix}-day-${dateStr}`));
  }

  await userEvent.click(canvas.getByTestId(`${prefix}-apply`));
}

// Split cards (and the filter bar's chip rows) now render immediately on
// mount, in a "pending" placeholder state (see renderSplitCard/
// renderChipRow in IndustrySpScreen.tsx) — so `findByTestId("industry-sp-
// split-card-a")` alone no longer signals "real data has loaded" the way
// it used to (it resolves on the very first render). This is the
// replacement wait condition: the loading banner disappearing.
async function waitForLoaded(canvas: ReturnType<typeof within>) {
  // A bare mount (no filter params in the story's own URL — Storybook's
  // iframe URL carries its own ?id=&viewMode=&args=..., which doesn't
  // count) now shows the idle "not yet applied" placeholder instead of
  // auto-fetching (see IndustrySpScreen's hadUrlParamsOnMount gating).
  // Press Apply once here so every story that calls this helper can keep
  // assuming loaded, populated content afterward, same as before that
  // change — stories specifically covering the idle/bare-load behavior
  // itself don't call this helper.
  if (canvas.queryByTestId("industry-sp-split-idle-a")) {
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
  }
  await waitFor(() => {
    expect(canvas.queryByTestId("industry-sp-loading")).not.toBeInTheDocument();
  }, { timeout: 5000 });
}

// This screen fetches the grand total + both splits in a single request to
// /api/industry-sp/splits (see chatApi.getIndustrySpSplits) — this handler
// mirrors the real backend's own default-split behavior: when the caller
// omits fromRowA/toRowA/fromRowB/toRowB entirely, it computes an even
// first-half/second-half divide of the current total; when explicit values
// are passed (Apply, a bookmarked URL), it honors them instead. Most
// stories don't care about the exact split boundaries, but a few
// (DefaultSplitsAreHalfAndHalf, ApplyingCustomSplitUpdatesUrl...)
// specifically exercise this, so it's worth getting right in the mock
// rather than returning a flat, param-blind response.
function splitsHandler(opts?: {
  totalRaces?: number;
  totalRunners?: number;
  pnlStats?: typeof DEFAULT_PNL;
  matchesFilter?: (url: URL) => boolean;
  // 1000 (authenticated) by default — pass 100 to simulate the anonymous
  // cap for stories covering the cap banner.
  raceCap?: number;
}) {
  const totalRaces = opts?.totalRaces ?? 2500;
  const totalRunners = opts?.totalRunners ?? 4;
  const pnlStats = opts?.pnlStats ?? DEFAULT_PNL;
  const raceCap = opts?.raceCap ?? 1000;
  return http.get(`${BASE}/api/industry-sp/splits`, ({ request }) => {
    const url = new URL(request.url);
    const matches = opts?.matchesFilter ? opts.matchesFilter(url) : true;
    const effTotalRaces = matches ? totalRaces : 0;
    const effTotalRunners = matches ? totalRunners : 0;
    const effPnl = matches ? pnlStats : ZERO_PNL;

    const fromRowARaw = url.searchParams.get("fromRowA");
    const toRowARaw = url.searchParams.get("toRowA");
    const fromRowBRaw = url.searchParams.get("fromRowB");
    const toRowBRaw = url.searchParams.get("toRowB");

    let fromRowA: number, toRowA: number | null, fromRowB: number, toRowB: number | null;
    if (fromRowARaw == null && toRowARaw == null && fromRowBRaw == null && toRowBRaw == null) {
      // Mirrors the real backend's even half/half default (see
      // getSplitStats) — guarantees both splits are populated regardless
      // of how small the total is, unlike the old fixed-1000/1000 window.
      const half = Math.floor(effTotalRaces / 2);
      fromRowA = 1;
      toRowA = half;
      fromRowB = half + 1;
      toRowB = null;
    } else {
      fromRowA = fromRowARaw != null ? parseInt(fromRowARaw, 10) : 1;
      toRowA = toRowARaw != null ? parseInt(toRowARaw, 10) : null;
      fromRowB = fromRowBRaw != null ? parseInt(fromRowBRaw, 10) : 1;
      toRowB = toRowBRaw != null ? parseInt(toRowBRaw, 10) : null;
    }

    // A row range is only meaningful relative to an actually-matching
    // dataset — if the filters zero out every race, both splits must be 0
    // regardless of which explicit fromRow/toRow values are requested
    // (mirrors real MongoDB: a row-range query against an empty matched
    // set returns nothing, no matter the range).
    const totalA = effTotalRaces === 0 ? 0 : Math.max(0, (toRowA ?? effTotalRaces) - fromRowA + 1);
    const totalB = effTotalRaces === 0 ? 0 : Math.max(0, (toRowB ?? effTotalRaces) - fromRowB + 1);

    return HttpResponse.json({
      success: true,
      totalRaces: effTotalRaces,
      totalRunners: effTotalRunners,
      raceCap,
      // Rides along on this same response now (see getSplitStats on the
      // backend) — mirrors filterBoundsHandler/countriesHandler below,
      // which stay defined for the few stories/tests that still hit those
      // standalone endpoints directly.
      filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
      countries: ["GB", "IE"],
      courses: ["Ascot", "Cheltenham"],
      goings: ["Good", "Soft"],
      raceClasses: ["Class 1", "Class 2"],
      raceTypes: ["Flat", "Hurdle"],
      splitA: { fromRow: fromRowA, toRow: toRowA, total: totalA, totalRunners: Math.round(effTotalRunners / 2), pnlStats: totalA > 0 ? effPnl : ZERO_PNL },
      splitB: { fromRow: fromRowB, toRow: toRowB, total: totalB, totalRunners: Math.round(effTotalRunners / 2), pnlStats: totalB > 0 ? effPnl : ZERO_PNL },
    });
  });
}

// Mirrors GET /api/industry-sp/runner-convergence — the "Graph" button on
// either split card. A small, deterministic converging series is enough
// for stories/tests; the real convergence shape was verified live against
// production data separately.
const runnerConvergenceHandler = http.get(`${BASE}/api/industry-sp/runner-convergence`, ({ request }) => {
  const url = new URL(request.url);
  const toRunner = Math.max(1, parseInt(url.searchParams.get("toRunner") ?? "1", 10));
  // Defaults to 1 — Split A's own Graph button always sends fromRunner=1
  // explicitly; Split B's sends its own first runner's ordinal, so its own
  // line restarts fresh rather than continuing Split A's already-settled
  // total (mirrors the real backend — see getRunnerConvergenceSeries).
  const fromRunner = Math.max(1, parseInt(url.searchParams.get("fromRunner") ?? "1", 10));
  let cumulativeStaked = 0;
  let cumulativeReturns = 0;
  const data = [];
  for (let ordinal = fromRunner; ordinal <= toRunner; ordinal++) {
    cumulativeStaked += 1;
    if (ordinal % 3 === 0) cumulativeReturns += 1.8;
    const cumulativePnl = cumulativeReturns - cumulativeStaked;
    data.push({
      runnerOrdinal: ordinal,
      cumulativeStaked,
      cumulativeReturns,
      cumulativePnl,
      roiPercent: (cumulativePnl / cumulativeStaked) * 100,
    });
  }
  return HttpResponse.json({ success: true, data, count: data.length });
});

// Mirrors GET /api/auth/me — IndustrySpScreen fetches this whenever
// isAuthenticated flips true, to drive the verify-email reminder banner
// (verification status can't safely live inside the JWT itself, so it's
// always a fresh fetch rather than something baked into the mock token).
function authMeHandler(emailVerified: boolean) {
  return http.get(`${BASE}/api/auth/me`, () =>
    HttpResponse.json({ success: true, email: "test@backbet.co.uk", emailVerified })
  );
}

const resendVerificationHandler = http.post(`${BASE}/api/auth/resend-verification`, () =>
  HttpResponse.json({ success: true, alreadyVerified: false })
);

// Verified by default — most stories are about split/filter behavior, not
// the verify-email banner, so this keeps them exactly as they were before
// that banner existed. The dedicated verify-banner stories below override
// this with authMeHandler(false).
const defaultHandlers = [splitsHandler(), countriesHandler, filterBoundsHandler, authMeHandler(true), runnerConvergenceHandler];

const meta: Meta<typeof IndustrySpScreen> = {
  title: "Components/IndustrySpScreen",
  component: IndustrySpScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: defaultHandlers },
  },
  args: {
    // Authenticated by default so existing stories (written before the
    // anonymous-access cap existed) keep seeing the same "no banner, Log
    // Out button" chrome they always have — stories specifically about
    // the anonymous state override isAuthenticated: false below.
    isAuthenticated: true,
    onRequestAuth: fn(),
    onLogout: fn(),
    onViewRaces: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BareLoadShowsIdlePlaceholderNotResults: Story = {
  // Regression coverage for: this screen used to auto-run the default
  // query on every mount, so the first thing a user saw — before touching
  // a single filter — was a fully computed Split A/Split B result and
  // filter chips already populated from real data. A bare mount (no
  // filter params in the story's own URL) must fetch nothing and show
  // nothing until Apply is pressed.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("industry-sp-loading")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-idle-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-idle-a")).toHaveTextContent("Press Apply");
    await expect(canvas.getByTestId("industry-sp-split-idle-b")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-pnl-a")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-split-empty-a")).not.toBeInTheDocument();
    // Chips don't know about the data either — just their own placeholder.
    await expect(canvas.getByTestId("industry-sp-course-loading")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-course-loading")).toHaveTextContent("Apply to load options");
    await expect(canvas.queryByTestId("industry-sp-course-Cheltenham")).not.toBeInTheDocument();

    // "Details"/"View Races" are disabled — there's nothing to view yet.
    await expect(canvas.getByTestId("industry-sp-split-details-button-a")).toBeDisabled();
    await expect(canvas.getByTestId("industry-sp-view-races-button-a")).toBeDisabled();

    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await waitForLoaded(canvas);

    await expect(canvas.queryByTestId("industry-sp-split-idle-a")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-course-Cheltenham")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/splits`, async () => {
          await new Promise(r => setTimeout(r, 99999));
          return HttpResponse.json({ success: true });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Bare mount — idle, nothing fetched yet, so there's nothing "loading"
    // until Apply is pressed.
    await expect(canvas.getByTestId("industry-sp-split-idle-a")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-loading")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await expect(canvas.getByTestId("industry-sp-loading")).toBeInTheDocument();
    // Split cards stay rendered (not hidden behind the loading banner) —
    // each shows an "awaiting results" placeholder instead of real numbers
    // until the fetch resolves.
    await expect(canvas.getByTestId("industry-sp-split-card-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-b")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-pending-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-pending-b")).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-pnl-a")).not.toBeInTheDocument();
    // The filter bar (including chip rows, shown with their own
    // "Loading…" placeholder) is visible throughout too.
    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-course-loading")).toBeInTheDocument();
  },
};

export const WithError: Story = {
  parameters: {
    msw: { handlers: [http.get(`${BASE}/api/industry-sp/splits`, () => HttpResponse.error()), countriesHandler, filterBoundsHandler] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("industry-sp-split-idle-a")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await expect(canvas.findByTestId("industry-sp-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-split-card-a")).not.toBeInTheDocument();
  },
};

export const ZeroMatchesShowsZeroCount: Story = {
  parameters: {
    msw: { handlers: [splitsHandler({ totalRaces: 0, totalRunners: 0, pnlStats: ZERO_PNL }), countriesHandler, filterBoundsHandler] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    const cardA = canvas.getByTestId("industry-sp-split-card-a");
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
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-split-card-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-b")).toBeInTheDocument();
    await expect(canvas.findByText("BackBet")).resolves.toBeInTheDocument();
    await expect(canvas.findByTestId("industry-sp-pnl-a")).resolves.toHaveTextContent("+£1.58");
    await expect(canvas.findByTestId("industry-sp-pnl-b")).resolves.toHaveTextContent("+£1.58");
  },
};

export const SuccessfulLoadPopulatesTheSessionCache: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    // The actual "does returning to /isp reuse this?" behavior needs a
    // real unmount/remount, which isn't practical within one Storybook
    // story — that's covered by the MSW Playwright suite instead
    // (tests-msw/industry-sp.spec.ts, "session cache across navigation").
    // This just verifies the write side: a successful load leaves exactly
    // one entry behind for a subsequent mount to find.
    const cacheKeys = Object.keys(window.sessionStorage).filter(k => k.startsWith("isp-splits-cache:"));
    await expect(cacheKeys.length).toBe(1);
  },
};

export const DefaultSplitsAreHalfAndHalf: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    // The manual race-range boxes are only rendered in "Split by races"
    // mode (checked by default) — unchecking it reveals them without
    // re-fetching (a pure local draft-state toggle), so this still reads
    // the values from the load that already happened above.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

    // Mock total is 2500 (see splitsHandler's default) — half/half is
    // 1-1250 / 1251-<end>. The "to" box shows the grand total (2500) as
    // the open-ended upper bound's display value.
    await expect((canvas.getByTestId("industry-sp-from-row-a") as HTMLInputElement).value).toBe("1");
    await expect((canvas.getByTestId("industry-sp-to-row-a") as HTMLInputElement).value).toBe("1250");
    await expect((canvas.getByTestId("industry-sp-from-row-b") as HTMLInputElement).value).toBe("1251");
    await expect((canvas.getByTestId("industry-sp-to-row-b") as HTMLInputElement).value).toBe("2500");
  },
};

export const LogOutButtonCallsOnLogout: Story = {
  // A fresh mock, not meta.args' shared instance — args objects (and the
  // fn() they hold) aren't re-created per story, so asserting an exact
  // call count against the shared instance would pick up clicks from
  // whichever other story happened to run first.
  args: { onLogout: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const btn = canvas.getByTestId("industry-sp-logout-button");
    await expect(btn).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-signup-button")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-login-button")).not.toBeInTheDocument();
    await userEvent.click(btn);
    await expect(args.onLogout).toHaveBeenCalledTimes(1);
  },
};

export const AnonymousShowsSignUpAndLoginButtons: Story = {
  args: { isAuthenticated: false, onRequestAuth: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const signUpBtn = canvas.getByTestId("industry-sp-signup-button");
    const loginBtn = canvas.getByTestId("industry-sp-login-button");
    await expect(signUpBtn).toBeInTheDocument();
    await expect(loginBtn).toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-logout-button")).not.toBeInTheDocument();

    await userEvent.click(signUpBtn);
    await expect(args.onRequestAuth).toHaveBeenCalledTimes(1);

    await userEvent.click(loginBtn);
    await expect(args.onRequestAuth).toHaveBeenCalledTimes(2);
  },
};

export const AnonymousOverCapShowsBanner: Story = {
  args: { isAuthenticated: false, onRequestAuth: fn() },
  parameters: {
    msw: { handlers: [splitsHandler({ totalRaces: 2500, raceCap: 100 }), countriesHandler, filterBoundsHandler] },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    const banner = await canvas.findByTestId("industry-sp-cap-banner");
    await expect(banner).toHaveTextContent("Showing 100 of 2500 races");
    await userEvent.click(canvas.getByTestId("industry-sp-cap-banner-signup"));
    await expect(args.onRequestAuth).toHaveBeenCalledTimes(1);
  },
};

export const AuthenticatedNeverShowsBanner: Story = {
  // isAuthenticated: true comes from meta.args — the banner is gated on
  // !isAuthenticated first, so an authenticated view never shows it
  // regardless of totalRaces vs raceCap.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.queryByTestId("industry-sp-cap-banner")).not.toBeInTheDocument();
  },
};

export const BenefitsBannerVisibleWhenAnonymous: Story = {
  args: { isAuthenticated: false, onRequestAuth: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByTestId("industry-sp-benefits-banner");
    await expect(banner).toBeInTheDocument();
    await expect(banner).toHaveTextContent("1000");
    await expect(banner).toHaveTextContent("100");

    await userEvent.click(canvas.getByTestId("industry-sp-benefits-banner-signup"));
    await expect(args.onRequestAuth).toHaveBeenCalledTimes(1);
  },
};

export const BenefitsBannerHiddenWhenAuthenticated: Story = {
  // isAuthenticated: true comes from meta.args.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("industry-sp-benefits-banner")).not.toBeInTheDocument();
  },
};

export const VerifyEmailBannerShowsWhenUnverified: Story = {
  parameters: {
    msw: { handlers: [splitsHandler(), countriesHandler, filterBoundsHandler, authMeHandler(false), resendVerificationHandler] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = await canvas.findByTestId("industry-sp-verify-banner");
    await expect(banner).toHaveTextContent("verify your email");

    await userEvent.click(canvas.getByTestId("industry-sp-verify-resend"));
    await waitFor(() => expect(banner).toHaveTextContent("Verification email sent"));
  },
};

export const VerifyEmailBannerHiddenWhenVerified: Story = {
  // isAuthenticated: true + authMeHandler(true) both come from meta.args/
  // defaultHandlers — this confirms the banner stays hidden in the common
  // (already-verified) case.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.queryByTestId("industry-sp-verify-banner")).not.toBeInTheDocument());
  },
};

export const AccountButtonOnlyWhenAuthenticated: Story = {
  args: { isAuthenticated: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("industry-sp-account-button")).not.toBeInTheDocument();
  },
};

export const AccountButtonTogglesPanelWithSignedInEmail: Story = {
  // isAuthenticated: true + authMeHandler(true) (email: "test@backbet.co.uk")
  // both come from meta.args/defaultHandlers.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("industry-sp-account-panel")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("industry-sp-account-button"));
    const panel = await canvas.findByTestId("industry-sp-account-panel");
    // The panel renders immediately on click, but the email itself comes
    // from an independent chatApi.getMe() fetch (the isAuthenticated
    // effect) that may not have resolved yet — wait for the real value
    // rather than the "…" not-yet-loaded placeholder.
    await waitFor(() => expect(panel).toHaveTextContent("test@backbet.co.uk"));
    await expect(panel).toHaveTextContent("Email verified");

    await userEvent.click(canvas.getByTestId("industry-sp-account-panel-close"));
    await expect(canvas.queryByTestId("industry-sp-account-panel")).not.toBeInTheDocument();
  },
};

export const AccountPanelShowsUnverifiedStatus: Story = {
  parameters: {
    msw: { handlers: [splitsHandler(), countriesHandler, filterBoundsHandler, authMeHandler(false), resendVerificationHandler] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("industry-sp-account-button"));
    const panel = await canvas.findByTestId("industry-sp-account-panel");
    await waitFor(() => expect(panel).toHaveTextContent("Email not verified"));
  },
};

export const ViewRacesButtonsNavigateWithTheirOwnSplit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    const btnA = canvas.getByTestId("industry-sp-view-races-button-a");
    await expect(btnA).toHaveTextContent(/View \d+ Races/);
    await userEvent.click(btnA);
    // Split A defaults to the first half (mock total 2500 -> 1-1250).
    await expect(args.onViewRaces).toHaveBeenLastCalledWith(1, 1250);

    const btnB = canvas.getByTestId("industry-sp-view-races-button-b");
    await userEvent.click(btnB);
    // Split B defaults to the second half, open-ended (null = "to the end").
    await expect(args.onViewRaces).toHaveBeenLastCalledWith(1251, null);
  },
};

export const FiltersToggleHidesAndShowsFilterBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

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
    await waitForLoaded(canvas);

    for (const id of ["a", "b"]) {
      await expect(canvas.findByTestId(`industry-sp-split-card-${id}`)).resolves.toBeInTheDocument();
      await expect(canvas.getByTestId(`industry-sp-pnl-${id}`)).toHaveTextContent("+£1.58");
    }
  },
};

export const DetailsButtonOpensFullBreakdown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    await expect(canvas.queryByTestId("split-detail-panel-a")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("industry-sp-split-details-button-a"));

    const panel = await canvas.findByTestId("split-detail-panel-a");
    await expect(panel).toBeInTheDocument();
    // Split A's own range defaults to the first half (mock total 2500 -> 1250).
    await expect(canvas.getByTestId("split-detail-row-races-a")).toHaveTextContent("1250");
    await expect(canvas.getByTestId("split-detail-row-horses-a")).toHaveTextContent("4");
    await expect(canvas.getByTestId("split-detail-row-staked-a")).toHaveTextContent("£3.97");
    await expect(canvas.getByTestId("split-detail-row-return-a")).toHaveTextContent("£5.55");
    await expect(canvas.getByTestId("split-detail-pnl-a")).toHaveTextContent("+£1.58");
  },
};

export const GraphButtonOpensConvergencePanel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    await expect(canvas.queryByTestId("runner-convergence-panel")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("industry-sp-split-graph-button-a"));

    const panel = await canvas.findByTestId("runner-convergence-panel");
    await expect(panel).toBeInTheDocument();
    await waitFor(() => {
      expect(canvas.queryByTestId("runner-convergence-loading")).not.toBeInTheDocument();
    }, { timeout: 5000 });
    await expect(canvas.getByTestId("runner-convergence-chart")).toBeInTheDocument();
    // Mock's default split totals are 2 runners each — Split A's own graph
    // is runners 1-2, not the mock's combined 1-4 total.
    await expect(canvas.getByTestId("runner-convergence-range-subtitle")).toHaveTextContent("Runners 1–2");

    await userEvent.click(canvas.getByTestId("runner-convergence-panel-close"));
    await expect(canvas.queryByTestId("runner-convergence-panel")).not.toBeInTheDocument();

    // Split B's own Graph button opens a panel scoped to its own range —
    // 3-4, not a repeat of Split A's 1-2 and not the combined 1-4.
    await userEvent.click(canvas.getByTestId("industry-sp-split-graph-button-b"));
    await canvas.findByTestId("runner-convergence-panel");
    await waitFor(() => {
      expect(canvas.queryByTestId("runner-convergence-loading")).not.toBeInTheDocument();
    }, { timeout: 5000 });
    await expect(canvas.getByTestId("runner-convergence-range-subtitle")).toHaveTextContent("Runners 3–4");
  },
};

export const DetailsPanelFiltersButtonReturnsToSplitCards: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    await userEvent.click(canvas.getByTestId("industry-sp-split-details-button-b"));
    await canvas.findByTestId("split-detail-panel-b");

    const filtersBtn = canvas.getByTestId("split-detail-panel-filters-b");
    await expect(filtersBtn).toHaveTextContent("← Filters");
    await userEvent.click(filtersBtn);
    await expect(canvas.queryByTestId("split-detail-panel-b")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-b")).toBeInTheDocument();
  },
};

export const DetailsPanelViewRacesButtonNavigates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    await userEvent.click(canvas.getByTestId("industry-sp-split-details-button-a"));
    await canvas.findByTestId("split-detail-panel-a");

    await userEvent.click(canvas.getByTestId("split-detail-view-races-button-a"));
    await expect(args.onViewRaces).toHaveBeenLastCalledWith(1, 1250);
    // Navigating away from the detail panel also closes it.
    await expect(canvas.queryByTestId("split-detail-panel-a")).not.toBeInTheDocument();
  },
};

export const RunnersInRangeFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-min-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-max-rir-value")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-in-isp-label")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-in-isp-label")).toHaveTextContent("# in ISP");
  },
};

export const TrainerFormFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-trainer-form-min-win-rate")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-has-trainer-form")).toBeInTheDocument();
  },
};

export const ModelWinProbabilityFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-min-model-win-probability")).toBeInTheDocument();
  },
};

export const OnlyModelBeatsSpFilterVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-only-model-beats-sp")).toBeInTheDocument();
  },
};

export const RestrictiveFilterZeroesOutMatches: Story = {
  parameters: {
    msw: {
      // Real filtering by maxInIspRange, mirroring server behavior — the flat
      // defaultHandlers ignore query params entirely, which isn't enough here.
      handlers: [
        splitsHandler({
          matchesFilter: url => parseInt(url.searchParams.get("maxInIspRange") ?? "30") >= 2,
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
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
let capturedDateParams: { minDate: string | null; maxDate: string | null } = { minDate: null, maxDate: null };

export const FilterRowsAreGridAligned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    // Split A/B's race-range boxes only render in "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

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
    await waitForLoaded(canvas);
    // Split A/B's race-range boxes only render in "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

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
    await waitForLoaded(canvas);

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
    await waitForLoaded(canvas);
    // Split A/B's race-range rows (and their tooltip toggles) only render
    // in "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

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
    await waitForLoaded(canvas);
    // Split A/B's race-range boxes only render in "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

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
    await waitForLoaded(canvas);

    const applyBox = canvas.getByTestId("industry-sp-filter-apply").getBoundingClientRect();
    const resetBox = canvas.getByTestId("industry-sp-filter-reset").getBoundingClientRect();

    await expect(resetBox.top).toBe(applyBox.top);
  },
};

export const TooltipToggleHasAdequateTapTarget: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    // Split A/B's race-range rows (and their tooltip toggles) only render
    // in "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

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
        http.get(`${BASE}/api/industry-sp/splits`, ({ request }) => {
          const url = new URL(request.url);
          capturedIspParams = {
            minIsp: url.searchParams.get("minIsp"),
            maxIsp: url.searchParams.get("maxIsp"),
          };
          return HttpResponse.json({
            success: true,
            totalRaces: 2,
            totalRunners: 4,
            filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
            countries: ["GB", "IE"],
            courses: ["Ascot", "Cheltenham"],
            goings: ["Good", "Soft"],
            raceClasses: ["Class 1", "Class 2"],
            raceTypes: ["Flat", "Hurdle"],
            splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
            splitB: { fromRow: 2, toRow: null, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

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
    await waitForLoaded(canvas);

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
    await waitForLoaded(canvas);

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
    await waitForLoaded(canvas);
    // Manual split-range editing only exists in "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

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
    await waitForLoaded(canvas);

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

    // Reset also hands "Split by runners" back to checked, hiding the
    // race-range boxes again — reveal them to read the recomputed values.
    await expect(canvas.getByTestId("industry-sp-split-by-runners")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));

    // Reset also hands the split boundaries back to auto mode — they
    // recompute to the fresh half/half default (mock total 2500 -> 1251).
    await waitFor(() => {
      expect((canvas.getByTestId("industry-sp-from-row-a") as HTMLInputElement).value).toBe("1");
      expect((canvas.getByTestId("industry-sp-from-row-b") as HTMLInputElement).value).toBe("1251");
    }, { timeout: 3000 });
  },
};

export const InIspBoundDisplayed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    const bound = await canvas.findByTestId("industry-sp-max-rir-bound");
    await expect(bound).toBeInTheDocument();
    await expect(bound).toHaveTextContent("/29");
  },
};

export const RaceBoundsDisplayedForBothSplits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    // The race-bound hints live on the race-range boxes, only rendered in
    // "Split by races" mode.
    await userEvent.click(canvas.getByTestId("industry-sp-split-by-runners"));
    const boundA = await canvas.findByTestId("industry-sp-race-bound-a");
    const boundB = await canvas.findByTestId("industry-sp-race-bound-b");
    await expect(boundA).toHaveTextContent("/2500");
    await expect(boundB).toHaveTextContent("/2500");
  },
};

export const DateFilterDefaultsToOneMonth: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    const trigger = canvas.getByTestId("industry-sp-date-range-picker");
    await expect(trigger).toHaveTextContent("Jan 1, 2024");
    await expect(trigger).toHaveTextContent("Jan 31, 2024");
  },
};

export const ApplyingACustomDateRangeSendsItToTheApi: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/splits`, ({ request }) => {
          const url = new URL(request.url);
          capturedDateParams = {
            minDate: url.searchParams.get("minDate"),
            maxDate: url.searchParams.get("maxDate"),
          };
          return HttpResponse.json({
            success: true,
            totalRaces: 2,
            totalRunners: 4,
            filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
            countries: ["GB", "IE"],
            courses: ["Ascot", "Cheltenham"],
            goings: ["Good", "Soft"],
            raceClasses: ["Class 1", "Class 2"],
            raceTypes: ["Flat", "Hurdle"],
            splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
            splitB: { fromRow: 2, toRow: null, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    // Within the one-year cap, so it applies exactly as picked.
    await pickDateRangeInCanvas(canvas, "2023-01-01", "2023-01-20");

    capturedDateParams = { minDate: null, maxDate: null };
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(capturedDateParams.minDate).toBe("2023-01-01");
      expect(capturedDateParams.maxDate).toBe("2023-01-20");
    }, { timeout: 3000 });
  },
};

export const DateRangeWiderThanOneYearIsClampedOnApply: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/splits`, ({ request }) => {
          const url = new URL(request.url);
          capturedDateParams = {
            minDate: url.searchParams.get("minDate"),
            maxDate: url.searchParams.get("maxDate"),
          };
          return HttpResponse.json({
            success: true,
            totalRaces: 2,
            totalRunners: 4,
            filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
            countries: ["GB", "IE"],
            courses: ["Ascot", "Cheltenham"],
            goings: ["Good", "Soft"],
            raceClasses: ["Class 1", "Class 2"],
            raceTypes: ["Flat", "Hurdle"],
            splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
            splitB: { fromRow: 2, toRow: null, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    // A 14-month pick gets silently pulled back to minDate + 1 year on
    // Apply, same as every other range filter self-correcting instead of
    // erroring on an out-of-bounds value.
    await pickDateRangeInCanvas(canvas, "2023-01-01", "2024-03-01");

    capturedDateParams = { minDate: null, maxDate: null };
    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(capturedDateParams.minDate).toBe("2023-01-01");
      expect(capturedDateParams.maxDate).toBe("2024-01-01");
    }, { timeout: 3000 });

    const trigger = canvas.getByTestId("industry-sp-date-range-picker");
    await expect(trigger).toHaveTextContent("Jan 1, 2024");
  },
};

export const CourseGoingRaceClassRaceTypeChipsVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    await expect(canvas.findByTestId("industry-sp-course")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-course-Ascot")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-course-Cheltenham")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-going")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-going-Good")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-race-class")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-race-class-Class 1")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-race-type")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-race-type-Flat")).toBeInTheDocument();
  },
};

let capturedChipParams: { courses: string | null } = { courses: null };

// Clicking a chip must NOT query the backend by itself — it only updates
// the draft (shown as a "pending" gray chip with a trailing "•"). The
// /splits handler below intentionally throws if hit with courses=Ascot
// before Apply, so this test fails loudly if a regression reintroduces
// the old "chips apply immediately" behavior instead of silently passing.
export const ClickingACourseChipShowsPendingWithoutQueryingApi: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/splits`, ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("courses") === "Ascot") {
            throw new Error("Regression: chip click queried the API before Apply was pressed");
          }
          return HttpResponse.json({
            success: true,
            totalRaces: 2,
            totalRunners: 4,
            filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
            countries: ["GB", "IE"],
            courses: ["Ascot", "Cheltenham"],
            goings: ["Good", "Soft"],
            raceClasses: ["Class 1", "Class 2"],
            raceTypes: ["Flat", "Hurdle"],
            splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
            splitB: { fromRow: 2, toRow: null, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    const chip = await canvas.findByTestId("industry-sp-course-Ascot");

    await expect(chip).not.toHaveTextContent("•");
    await userEvent.click(chip);
    // Pending state — selected, but visually distinct (trailing "•") and
    // not yet reflected in the URL, since Apply hasn't been pressed.
    await expect(chip).toHaveTextContent("Ascot •");
    await expect(window.location.search).not.toContain("courses=Ascot");
  },
};

export const ApplyingAPendingCourseChipQueriesApiAndUpdatesUrl: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/industry-sp/splits`, ({ request }) => {
          const url = new URL(request.url);
          capturedChipParams = { courses: url.searchParams.get("courses") };
          return HttpResponse.json({
            success: true,
            totalRaces: 2,
            totalRunners: 4,
            filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
            countries: ["GB", "IE"],
            courses: ["Ascot", "Cheltenham"],
            goings: ["Good", "Soft"],
            raceClasses: ["Class 1", "Class 2"],
            raceTypes: ["Flat", "Hurdle"],
            splitA: { fromRow: 1, toRow: 1, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
            splitB: { fromRow: 2, toRow: null, total: 1, totalRunners: 2, pnlStats: DEFAULT_PNL },
          });
        }),
        countriesHandler,
        filterBoundsHandler,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    const chip = await canvas.findByTestId("industry-sp-course-Ascot");

    capturedChipParams = { courses: null };
    await userEvent.click(chip);
    await expect(chip).toHaveTextContent("Ascot •");

    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));

    await waitFor(() => {
      expect(capturedChipParams.courses).toBe("Ascot");
      expect(window.location.search).toContain("courses=Ascot");
    }, { timeout: 3000 });
    // Applied — solid, no more pending marker.
    await expect(chip).not.toHaveTextContent("•");
  },
};

export const TrainerJockeySearchIsHidden: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);

    // Little practical use as a filter (free-text prefix match over
    // thousands of names) — hidden, though the underlying state/query
    // support stays in place (see the comment above its removed render
    // call in IndustrySpScreen.tsx).
    await expect(canvas.queryByTestId("industry-sp-trainer-search")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("industry-sp-jockey-search")).not.toBeInTheDocument();
  },
};

export const ResetClearsCourseChipsSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    const chip = await canvas.findByTestId("industry-sp-course-Ascot");

    await userEvent.click(chip);
    await expect(chip).toHaveTextContent("Ascot •");

    await userEvent.click(canvas.getByTestId("industry-sp-filter-apply"));
    await waitFor(() => {
      expect(window.location.search).toContain("courses=Ascot");
    }, { timeout: 3000 });
    // Applied — solid, no pending marker anymore.
    await expect(chip).not.toHaveTextContent("•");

    await userEvent.click(canvas.getByTestId("industry-sp-filter-reset"));

    await waitFor(() => {
      expect(window.location.search).not.toContain("courses");
    }, { timeout: 3000 });
    // The chip itself is no longer selected at all post-Reset.
    await expect(canvas.getByTestId("industry-sp-course-Ascot")).not.toHaveTextContent("•");
  },
};

export const RendersAtIphone12: Story = {
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-screen")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-b")).toBeInTheDocument();
  },
};

export const RendersAtIpad: Story = {
  parameters: { viewport: { defaultViewport: "ipad" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-filter-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-split-card-b")).toBeInTheDocument();
  },
};

// At >=1024px the split cards go side-by-side instead of stacked (see
// isDesktop in useResponsive) — verify both still render their full content
// rather than just checking presence, since a row layout is more likely to
// clip something a column layout wouldn't.
export const RendersAtLaptop: Story = {
  parameters: { viewport: { defaultViewport: "laptop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLoaded(canvas);
    await expect(canvas.getByTestId("industry-sp-pnl-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-pnl-b")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-view-races-button-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("industry-sp-view-races-button-b")).toBeInTheDocument();
  },
};
