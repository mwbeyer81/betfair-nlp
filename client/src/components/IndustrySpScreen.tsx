import React, { useState, useEffect, useRef } from "react";
import {
  View,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardTypeOptions,
} from "react-native";
import {
  Text,
  Button,
  Chip,
  Checkbox,
  ActivityIndicator,
} from "react-native-paper";
import { chatApi, IspFilterBounds, PnlStats, BrierStats, RaceConvergencePoint, IspRace, ModelVersion } from "../services/chatApi";
import { SplitDetailPanel } from "./SplitDetailPanel";
import { BrierScore } from "./BrierScore";
import { PnlConvergencePanel } from "./PnlConvergencePanel";
import { ModelPerformanceDashboard, ModelPerformanceFilters } from "./ModelPerformanceDashboard";
import { SaveResultDialog } from "./SaveResultDialog";
import { buildAutoResultNamePreview } from "../utils/savedResultName";
import { DateRangePicker } from "./DateRangePicker";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";
import { buildSplitsCacheKey, readSplitsCache, writeSplitsCache, CachedSplitsResult } from "../utils/ispSplitsCache";
import { useResponsive } from "../utils/responsive";
import { colors, radii, spacing } from "../theme";
import { formatPnl, formatPct } from "../utils/ispFormat";
import {
  urlIntParam,
  urlFloatParam,
  urlStringParam,
  urlToRowParam,
  urlCountriesParam,
  urlSetParam,
  urlHasParam,
  urlHasAnyParams,
  updateUrlParams,
} from "../utils/ispUrlParams";

interface IndustrySpScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onRequestAuth: () => void;
  onLogout: () => void;
  onViewRaces: (fromRow: number, toRow: number | null) => void;
}

// Filter values are persisted to the URL query string (using the same param
// names the API itself uses) so a filtered view can be bookmarked, shared,
// carried over to the races screen, or survive a refresh. Only non-default
// values are written, so the URL stays clean (just "/isp") until the user
// actually changes something.
// minDate/maxDate default to January 2024 rather than the full dataset
// (races go back to 2015) — the full dataset's aggregations are expensive
// enough on Atlas M0's shared, throughput-throttled free tier that even a
// single warm, uncontended query costs ~2.5s server-side, and that's
// before accounting for the extra latency variance under concurrent load.
// Restricting the *default* view to a much smaller date window directly
// shrinks the matched-race count for the query MongoDB actually has to
// run, rather than just avoiding self-inflicted request concurrency the
// way the /splits combining fix did. This also has to fit the one-year
// max span enforced in applyFilter() below — move the window any time via
// Apply, but it can never be widened past one year.
const FILTER_DEFAULTS = {
  minRunners: 1,
  maxRunners: 20,
  minIsp: 1,
  maxIsp: 1000,
  minInIspRange: 1,
  maxInIspRange: 30,
  minDate: "2024-01-01",
  maxDate: "2024-01-31",
  // trainerFormMinWinRate is just the "in form" threshold definition — it
  // has no effect on results by itself. Only minTrainerFormRunners > 0
  // actually narrows anything, so leaving it at 0 (a true no-op, same
  // as minInIspRange's own "count >= 0 always true" default) keeps this
  // filter inert until the user opts in, exactly like every other filter
  // here on first load. Default 0 (not some positive threshold) so that
  // simply checking "Has trainer form" below — without also typing a win
  // rate — means "any non-null sample", i.e. exactly "has trainer form
  // available", per the literal ask; the win-rate field only narrows
  // further if the user explicitly raises it above 0.
  trainerFormMinWinRate: 0,
  // maxTrainerFormRunners has no real ceiling to express here (no race has
  // anywhere near 100 runners) — fixed rather than user-editable; only
  // minTrainerFormRunners (0 or 1, driven by the "Has trainer form"
  // checkbox below) actually toggles this filter on/off.
  minTrainerFormRunners: 0,
  maxTrainerFormRunners: 100,
  // Same "0 is a true no-op" convention as trainerFormMinWinRate above —
  // the XGBoost model's win-probability estimate is populated on every
  // runner (no cold-start gap), so this alone (no separate "has" checkbox
  // needed) is enough to gate the filter on/off.
  minModelWinProbability: 0,
  // Percentage POINTS of model-vs-SP edge required, not a relative %: a
  // runner the model gives 25% and whose SP implies 20% has an edge of 5.
  // Same "0 is a true no-op" convention as the two above — at 0 the
  // "Model beats SP" checkbox alone decides, exactly as before this
  // field existed.
  minModelSpEdgePts: 0,
};

// Loose client-side guardrails for the date inputs — not round-tripped
// from the backend (unlike filterBounds' numeric limits) to avoid adding
// another query to the already-optimized /splits critical path for a
// slow-changing value. The real dataset's earliest date may be later than
// this; an overly generous lower bound just means a query that matches
// nothing, not an error.
const ABSOLUTE_MIN_DATE = "2015-01-01";
const ABSOLUTE_MAX_DATE = "2026-12-31";

const FILTER_TOOLTIPS: Record<string, string> = {
  isp: "Only show races where the runner's official starting price (ISP) falls in this range.",
  runners: "Only show races with this many total runners taking part.",
  inIsp: "Only show races with this many runners priced inside the ISP range above, out of the full field.",
  date: "Only show races in this date range (YYYY-MM-DD), up to one year wide. Move the window any time via Apply.",
  raceA: "The first split — defaults to roughly the first half of the matching races or runners (whichever \"Split by runners\" is set to), so you can test a filter combination here first. Edit the range to test a specific slice instead.",
  raceB: "The second split — defaults to the rest of the matching races or runners. Check whether the same filters are still profitable here before trusting them.",
  course: "Only show races run at the selected course(s) — course specialists and course bias are a classic handicapping factor.",
  going: "Only show races run on the selected going (ground conditions) — ground suitability is one of the strongest form factors.",
  raceClass: "Only show races of the selected class — lets you segment by competitiveness tier.",
  raceType: "Only show races of the selected type (Flat, Hurdle, Chase, ...).",
  trainer: "Only show races with a runner trained by a name starting with this text.",
  jockey: "Only show races with a runner ridden by a name starting with this text.",
  trainerFormWinRate: "Once \"Has trainer form\" is checked below, only count a runner's trainer as \"in form\" if their win rate over their last 14 days of same-type (Flat/Jumps) runs is at least this percentage. Leave at 0 to just require any recent form sample.",
  hasTrainerForm: "Only show races with at least one runner whose trainer has a recent-form sample available (they've run at least once in the last 14 days). Runners with \"No recent form sample\" are excluded.",
  minModelWinProbability: "Only show races with a runner whose XGBoost-predicted win probability is at least this percentage. The model is trained on course/going/class/distance/draw/trainer-form/jockey — deliberately not on ISP, so it's an independent view, not a recalibration of the market's own price.",
  onlyModelBeatsSp: "Only show races with a runner whose model win probability is higher than the win probability implied by their own industry SP (100/isp) — i.e. the model rates them a better chance than the market's own price does.",
  minModelSpEdgePts: "Tightens \"Model beats SP\" to a minimum size of edge, in percentage points: the model's win probability minus the one the runner's own ISP implies (100/isp). A runner the model gives 25% whose ISP implies 20% has an edge of 5 points. This is the same number shown on each runner as \"+5.0 pts\". Any value above 0 applies on its own — the checkbox above doesn't also need ticking. Note points, not a relative percentage: at long odds even a small points edge is a big overlay, so a high value here concentrates on shorter prices.",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Adds one calendar year to a YYYY-MM-DD string, used to cap the date
// filter's span in applyFilter() below. Parsed/computed in UTC so this
// can't shift by a day depending on the browser's local timezone. Note JS
// Date's own leap-day rollover quirk applies here same as everywhere else
// (e.g. 2024-02-29 + 1 year lands on 2025-03-01, not a clamped "Feb 28"),
// which is an acceptable approximation for a filter-width cap.
function addOneYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  return dt.toISOString().slice(0, 10);
}

const EMPTY_PNL: PnlStats = { staked: 0, returns: 0, pnl: 0 };

// Mirrors the authenticated cap enforced server-side in
// IndustrySpService.getSplitStats — used only for the cap banner's copy,
// not for any request logic (the actual cap always comes from the
// response's own `raceCap` field).
const AUTHENTICATED_RACE_CAP = 10000;

// An explicit split's fromRowB can only be valid if the matched set is
// actually that large — anything beyond totalRaces is unambiguously stale
// (computed against a different, larger total than the one currently in
// effect), never a legitimate "empty split" the user asked for on purpose.
function isStaleSplit(splitBFromRow: number, totalRaces: number): boolean {
  return splitBFromRow > totalRaces && totalRaces > 0;
}

// Resolves a Split A/B draft box pair (a "from"/"to" string) into the
// committed {from, to} bound Apply sends. Normally the "to" value is
// clamped to `total` and converted to null (open-ended) once it reaches it.
// But when `total` isn't known yet (0 — no fetch has ever resolved) and the
// user has actually typed into the box (trustTyped), that clamp would crush
// any positive typed number down to 1 and then read it as "reached the end"
// (null) — silently discarding real user intent as if the box were still
// its pre-fetch placeholder. In that case, skip the clamp and pass the
// typed value straight through; the backend resolves/clamps it for real
// once it knows the actual total.
function resolveSplitBound(
  fromDraft: string,
  toDraft: string,
  total: number,
  trustTyped: boolean
): { from: number; to: number | null } {
  const from = Math.max(1, parseInt(fromDraft) || 1);
  if (trustTyped && total <= 0) {
    const parsedTo = parseInt(toDraft);
    const to = Number.isFinite(parsedTo) && parsedTo > 0 ? Math.max(from, parsedTo) : null;
    return { from, to };
  }
  const toRaw = Math.min(total || 1, Math.max(from, parseInt(toDraft) || total));
  const to = toRaw >= total ? null : toRaw;
  return { from, to };
}

// Resolves BOTH Split A and Split B's draft boxes together, rather than
// each in isolation via resolveSplitBound — needed so that editing only
// one side can carry the other, untouched side forward to stay contiguous.
//
// Reported live via screenshot: editing only Split A's "to" box (extending
// it from 1586 to 2983) and pressing Apply sent Split B's *stale* prior
// boundary (still 1587, left over from before A moved) instead of
// continuing right after A's new one. The two ranges silently overlapped —
// runners 1587-2983 got counted in both splits' P&L — while the result
// card's label for Split B (fabricated from splitA.totalRunners +
// splitB.totalRunners, not from what was actually queried) looked like a
// clean, non-overlapping continuation even though it wasn't.
//
// When exactly one side was actually edited, the other side is recomputed
// as "everything else" (1..edited side's start, or edited side's end+1..the
// total) rather than read from its own possibly-stale box. When both sides
// were edited (or neither — the auto-compute default path), each side is
// resolved independently exactly as resolveSplitBound already did.
function resolveSplitPair(
  fromDraftA: string,
  toDraftA: string,
  fromDraftB: string,
  toDraftB: string,
  total: number,
  aEdited: boolean,
  bEdited: boolean
): { fromA: number; toA: number | null; fromB: number; toB: number | null } {
  if (aEdited && !bEdited) {
    const { from: fromA, to: toA } = resolveSplitBound(fromDraftA, toDraftA, total, true);
    const fromB = toA != null ? toA + 1 : (total > 0 ? total + 1 : fromA + 1);
    return { fromA, toA, fromB, toB: null };
  }
  if (bEdited && !aEdited) {
    const { from: fromB, to: toB } = resolveSplitBound(fromDraftB, toDraftB, total, true);
    // Reported live via screenshot: typing "1" into Split B's "from" box
    // (claiming the entire dataset from the very start) left literally
    // nothing before it for Split A — the naive complementary range would
    // be fromA=1/toA=0, an inverted, empty range. That "0" doesn't survive
    // the round trip, though: the backend's explicit-runner-split resolver
    // floors any "to" target up to 1 (Math.max(1, target), for the normal
    // case of clamping an out-of-range positive target) — so "empty" and
    // "exactly runner 1" become indistinguishable, and Split A's card came
    // back showing a fabricated 1-runner result instead of 0. Rather than
    // send a boundary neither side of the pipe agrees on the meaning of,
    // fall through below to resolving A independently from its own
    // last-committed box (the same, always-well-defined behavior already
    // used when both sides are edited) — a real but comparatively minor
    // overlap with B in this one edge case, instead of a fabricated result.
    if (fromB > 1) {
      return { fromA: 1, toA: fromB - 1, fromB, toB };
    }
  }
  const { from: fromA, to: toA } = resolveSplitBound(fromDraftA, toDraftA, total, aEdited);
  const { from: fromB, to: toB } = resolveSplitBound(fromDraftB, toDraftB, total, bEdited);
  return { fromA, toA, fromB, toB };
}

export const IndustrySpScreen: React.FC<IndustrySpScreenProps> = ({
  navigate,
  isAuthenticated,
  onRequestAuth,
  onLogout,
  onViewRaces,
}) => {
  const { isDesktop } = useResponsive();
  // A bare, untouched load of /isp (no query string at all) should show
  // nothing until the user explicitly presses Apply — the filter bar and
  // split cards must not silently run a default query and present results
  // the user never asked for. A URL that already carries params (a
  // bookmark, a shared link, or navigating back from /isp/races) is
  // treated as already-applied filter state and fetches immediately, same
  // as before. Captured once at mount — this component remounts on route
  // changes, so it can't go stale mid-session.
  const [hadUrlParamsOnMount] = useState(() => urlHasAnyParams());
  const [isLoading, setIsLoading] = useState(() => hadUrlParamsOnMount);
  // True once a fetch has ever completed successfully — distinguishes the
  // real "not yet applied, nothing fetched" idle state from "no matches"
  // (both show total 0 / EMPTY_PNL, but only the latter is genuine).
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftMin, setDraftMin] = useState(() => String(urlIntParam("minRunners", FILTER_DEFAULTS.minRunners)));
  const [draftMax, setDraftMax] = useState(() => String(urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners)));
  const [draftMinIsp, setDraftMinIsp] = useState(() => String(urlFloatParam("minIsp", FILTER_DEFAULTS.minIsp)));
  const [draftMaxIsp, setDraftMaxIsp] = useState(() => String(urlFloatParam("maxIsp", FILTER_DEFAULTS.maxIsp)));
  const [draftMinRIR, setDraftMinRIR] = useState(() => String(urlIntParam("minInIspRange", FILTER_DEFAULTS.minInIspRange)));
  const [draftMaxRIR, setDraftMaxRIR] = useState(() => String(urlIntParam("maxInIspRange", FILTER_DEFAULTS.maxInIspRange)));
  const [draftMinDate, setDraftMinDate] = useState(() => urlStringParam("minDate", FILTER_DEFAULTS.minDate));
  const [draftMaxDate, setDraftMaxDate] = useState(() => urlStringParam("maxDate", FILTER_DEFAULTS.maxDate));
  const [minRunners, setMinRunners] = useState(() => urlIntParam("minRunners", FILTER_DEFAULTS.minRunners));
  const [maxRunners, setMaxRunners] = useState(() => urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners));
  const [minIsp, setMinIsp] = useState(() => urlFloatParam("minIsp", FILTER_DEFAULTS.minIsp));
  const [maxIsp, setMaxIsp] = useState(() => urlFloatParam("maxIsp", FILTER_DEFAULTS.maxIsp));
  const [minRunnersInRange, setMinRunnersInRange] = useState(() => urlIntParam("minInIspRange", FILTER_DEFAULTS.minInIspRange));
  const [maxRunnersInRange, setMaxRunnersInRange] = useState(() => urlIntParam("maxInIspRange", FILTER_DEFAULTS.maxInIspRange));
  const [minDate, setMinDate] = useState(() => urlStringParam("minDate", FILTER_DEFAULTS.minDate));
  const [maxDate, setMaxDate] = useState(() => urlStringParam("maxDate", FILTER_DEFAULTS.maxDate));
  // Chip filters follow the same draft/committed split as the numeric
  // filters (draftMinIsp/minIsp etc.) — tapping a chip only updates the
  // draft set (and its "pending" visual), the committed set (used for
  // fetching + URL sync) only changes when Apply is pressed. See
  // renderChipRow for the 3-state visual (unselected / pending / applied).
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(() => urlCountriesParam());
  const [draftSelectedCountries, setDraftSelectedCountries] = useState<Set<string>>(() => urlCountriesParam());
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(() => urlSetParam("courses"));
  const [draftSelectedCourses, setDraftSelectedCourses] = useState<Set<string>>(() => urlSetParam("courses"));
  const [availableCourses, setAvailableCourses] = useState<string[]>([]);
  const [selectedGoings, setSelectedGoings] = useState<Set<string>>(() => urlSetParam("goings"));
  const [draftSelectedGoings, setDraftSelectedGoings] = useState<Set<string>>(() => urlSetParam("goings"));
  const [availableGoings, setAvailableGoings] = useState<string[]>([]);
  const [selectedRaceClasses, setSelectedRaceClasses] = useState<Set<string>>(() => urlSetParam("raceClasses"));
  const [draftSelectedRaceClasses, setDraftSelectedRaceClasses] = useState<Set<string>>(() => urlSetParam("raceClasses"));
  const [availableRaceClasses, setAvailableRaceClasses] = useState<string[]>([]);
  const [selectedRaceTypes, setSelectedRaceTypes] = useState<Set<string>>(() => urlSetParam("raceTypes"));
  const [draftSelectedRaceTypes, setDraftSelectedRaceTypes] = useState<Set<string>>(() => urlSetParam("raceTypes"));
  const [availableRaceTypes, setAvailableRaceTypes] = useState<string[]>([]);
  const [draftTrainer, setDraftTrainer] = useState(() => urlStringParam("trainer", ""));
  const [trainerSearch, setTrainerSearch] = useState(() => urlStringParam("trainer", ""));
  const [draftJockey, setDraftJockey] = useState(() => urlStringParam("jockey", ""));
  const [jockeySearch, setJockeySearch] = useState(() => urlStringParam("jockey", ""));
  const [draftTrainerFormMinWinRate, setDraftTrainerFormMinWinRate] = useState(() =>
    String(urlFloatParam("trainerFormMinWinRate", FILTER_DEFAULTS.trainerFormMinWinRate))
  );
  const [trainerFormMinWinRate, setTrainerFormMinWinRate] = useState(() =>
    urlFloatParam("trainerFormMinWinRate", FILTER_DEFAULTS.trainerFormMinWinRate)
  );
  // "Has trainer form" checkbox — the sole control for minTrainerFormRunners
  // (0 or 1). maxTrainerFormRunners has no meaningful ceiling to expose (no
  // race has anywhere near 100 runners), so it's a fixed constant rather
  // than user-editable state.
  const [draftHasTrainerForm, setDraftHasTrainerForm] = useState(() => urlStringParam("hasTrainerForm", "") === "true");
  const [hasTrainerForm, setHasTrainerForm] = useState(() => urlStringParam("hasTrainerForm", "") === "true");
  const [minTrainerFormRunners, setMinTrainerFormRunners] = useState(() =>
    urlStringParam("hasTrainerForm", "") === "true" ? 1 : FILTER_DEFAULTS.minTrainerFormRunners
  );
  const maxTrainerFormRunners = FILTER_DEFAULTS.maxTrainerFormRunners;
  const [draftMinModelWinProbability, setDraftMinModelWinProbability] = useState(() =>
    String(urlFloatParam("minModelWinProbability", FILTER_DEFAULTS.minModelWinProbability))
  );
  const [minModelWinProbability, setMinModelWinProbability] = useState(() =>
    urlFloatParam("minModelWinProbability", FILTER_DEFAULTS.minModelWinProbability)
  );
  // "Model beats SP" checkbox — a per-runner comparison (model win% >
  // SP-implied win%), not a fixed threshold, so unlike minModelWinProbability
  // it's boolean-only, same shape as hasTrainerForm.
  const [draftOnlyModelBeatsSp, setDraftOnlyModelBeatsSp] = useState(() => urlStringParam("onlyModelBeatsSp", "") === "true");
  const [onlyModelBeatsSp, setOnlyModelBeatsSp] = useState(() => urlStringParam("onlyModelBeatsSp", "") === "true");
  // The size of that edge, in percentage points — see FILTER_DEFAULTS'
  // comment. Text-field state (a string) like every other numeric filter
  // here, so a half-typed "1." doesn't get coerced mid-keystroke.
  const [draftMinModelSpEdgePts, setDraftMinModelSpEdgePts] = useState(() =>
    String(urlFloatParam("minModelSpEdgePts", FILTER_DEFAULTS.minModelSpEdgePts))
  );
  const [minModelSpEdgePts, setMinModelSpEdgePts] = useState(() =>
    urlFloatParam("minModelSpEdgePts", FILTER_DEFAULTS.minModelSpEdgePts)
  );
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [totalRaces, setTotalRaces] = useState(0);
  const [totalRunners, setTotalRunners] = useState(0);
  // 100 for an anonymous caller, 10000 once logged in — see
  // IndustrySpService.getSplitStats. Drives the cap banner below.
  const [raceCap, setRaceCap] = useState(1000);
  // null = "not fetched yet" (also the state while anonymous — there's
  // nothing to verify) so the reminder banner never flashes on briefly
  // before the real value is known. Not derived from the JWT — see
  // AuthResult in chatApi.ts for why verification status lives outside it.
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "already-verified" | "error">("idle");
  // Which email is actually signed in — drives the verify-email reminder
  // banner below (the header's own Account button/panel, in AppHeader,
  // fetches this independently for its own display). Fetched alongside
  // emailVerified (same chatApi.getMe() call), since there's no other
  // reason to hit that endpoint separately.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [filterBounds, setFilterBounds] = useState<IspFilterBounds | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const [detailSplit, setDetailSplit] = useState<"a" | "b" | null>(null);

  // "Graph" button on either split card — requested live to show how the
  // running ROI% is volatile over a small sample and settles down as more
  // races are included, from race 1 up to Split B's upper limit. Both
  // split cards' Graph buttons open this same chart (see loadConvergence).
  const [showConvergencePanel, setShowConvergencePanel] = useState(false);
  const [convergencePoints, setConvergencePoints] = useState<RaceConvergencePoint[]>([]);
  const [convergenceLoading, setConvergenceLoading] = useState(false);
  const [convergenceError, setConvergenceError] = useState<string | null>(null);
  // Human-readable summary of whichever filters actually narrowed the
  // convergence result being viewed — captured at the moment "Graph" is
  // pressed (see loadConvergence) so it can't drift out of sync with a
  // filter the user goes on to edit but hasn't re-Applied yet.
  const [convergenceFilters, setConvergenceFilters] = useState<{ key: string; label: string }[]>([]);

  // "Model Performance" button — opens a dashboard of every model-training
  // run (params + metrics), with P&L for the currently-selected version
  // shown with/without the model, filterable the same way the rest of this
  // screen is. See loadModelPerformance.
  const [showModelPerformancePanel, setShowModelPerformancePanel] = useState(false);
  const [modelVersions, setModelVersions] = useState<ModelVersion[]>([]);
  const [selectedModelVersionId, setSelectedModelVersionId] = useState<string>("");
  const [modelPerformanceRaces, setModelPerformanceRaces] = useState<IspRace[]>([]);
  const [modelPerformanceLoading, setModelPerformanceLoading] = useState(false);
  const [modelPerformanceError, setModelPerformanceError] = useState<string | null>(null);

  // Two independent race-row splits, so a filter combination can be tested
  // on one slice of the historical data and checked for profit on another.
  // Until the user has applied an explicit split (or one arrived via a
  // bookmarked URL), the splits auto-compute to an even first-half/
  // second-half divide of the grand total once it's known — this
  // guarantees both splits are populated even for a small total (the date
  // filter caps the default view to one month, see FILTER_DEFAULTS above),
  // unlike a fixed-size window that could leave split B empty.
  const splitsAreDefaultRef = useRef(!urlHasParam("fromRowA"));
  // Tracks whether the user has actually typed into Split A's or Split B's
  // own boxes (as opposed to those boxes still holding their pre-fetch
  // placeholder values, or a stale value left over from a *previous* Apply).
  // Two separate refs, not one shared flag — Apply needs to know not just
  // "did *something* get edited" but *which side*, for two different
  // reasons:
  // 1. Distinguishing "the user's very first interaction with this screen
  //    was editing a split box, then Apply" (their typed value must be
  //    honored) from "boxes are untouched placeholders on a bare first
  //    Apply" (must stay on the auto-compute path — see the hasLoadedOnce
  //    comment below). hasLoadedOnce alone can't make that distinction: it
  //    only flips after a fetch resolves, so an edit-then-Apply before any
  //    fetch has ever completed was previously indistinguishable from an
  //    untouched box, and got silently discarded as "still default".
  // 2. Reported live via screenshot: editing only Split A's "to" box (e.g.
  //    extending it from 1586 to 2983) and pressing Apply sent Split B's
  //    *stale* prior boundary (still 1587, from before A moved) instead of
  //    continuing right after A's new one — the two ranges silently
  //    overlapped (1587–2983 double-counted in both splits' P&L), while the
  //    result card's *label* for Split B was fabricated from
  //    splitA.totalRunners + splitB.totalRunners and looked like a clean,
  //    non-overlapping continuation even though the underlying query wasn't.
  //    Knowing *which single side* changed lets Apply auto-carry the other,
  //    untouched side forward to stay contiguous — see the "only one side
  //    edited" branch below.
  const splitAEditedRef = useRef(false);
  const splitBEditedRef = useRef(false);
  const [fromRowA, setFromRowA] = useState(() => urlIntParam("fromRowA", 1));
  const [toRowA, setToRowA] = useState<number | null>(() => urlToRowParam("toRowA"));
  const [draftFromA, setDraftFromA] = useState(() => String(urlIntParam("fromRowA", 1)));
  const [draftToA, setDraftToA] = useState(() => {
    const t = urlToRowParam("toRowA");
    return t != null ? String(t) : "0";
  });
  const [fromRowB, setFromRowB] = useState(() => urlIntParam("fromRowB", 1));
  const [toRowB, setToRowB] = useState<number | null>(() => urlToRowParam("toRowB"));
  const [draftFromB, setDraftFromB] = useState(() => String(urlIntParam("fromRowB", 1)));
  const [draftToB, setDraftToB] = useState(() => {
    const t = urlToRowParam("toRowB");
    return t != null ? String(t) : "0";
  });

  const [totalRacesA, setTotalRacesA] = useState(0);
  const [totalRunnersA, setTotalRunnersA] = useState(0);
  // undefined, not a zeroed BrierStats: "no score yet" and "scored 0.0000"
  // must stay distinguishable, since 0 is the best Brier score there is.
  const [brierA, setBrierA] = useState<BrierStats | undefined>(undefined);
  const [brierB, setBrierB] = useState<BrierStats | undefined>(undefined);
  // The whole filtered set, before either split window narrows it.
  const [brierTotal, setBrierTotal] = useState<BrierStats | undefined>(undefined);
  const [pnlStatsA, setPnlStatsA] = useState<PnlStats>(EMPTY_PNL);
  const [totalRacesB, setTotalRacesB] = useState(0);
  const [totalRunnersB, setTotalRunnersB] = useState(0);
  const [pnlStatsB, setPnlStatsB] = useState<PnlStats>(EMPTY_PNL);

  useEffect(() => {
    if (!saveConfirmed) return;
    const timer = setTimeout(() => setSaveConfirmed(false), 3000);
    return () => clearTimeout(timer);
  }, [saveConfirmed]);

  // Re-checks verification status whenever the auth session actually
  // changes (login, signup, logout) — covers both "session restored from
  // localStorage on app mount" and "just signed up via the overlay on this
  // same page" without this screen needing to know which one happened.
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setEmailVerified(null);
      setResendStatus("idle");
      setAccountEmail(null);
      return;
    }
    // Never left uncaught — a network hiccup here must not crash the page,
    // just leave verification status unknown (no banner) until it succeeds.
    chatApi.getMe().then(me => {
      if (!cancelled) {
        setEmailVerified(me?.emailVerified ?? null);
        setAccountEmail(me?.email ?? null);
      }
    }).catch(() => {
      if (!cancelled) setEmailVerified(null);
    });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  async function handleResendVerification() {
    setResendStatus("sending");
    try {
      const { alreadyVerified } = await chatApi.resendVerification();
      if (alreadyVerified) {
        setEmailVerified(true);
        setResendStatus("already-verified");
      } else {
        setResendStatus("sent");
      }
    } catch {
      setResendStatus("error");
    }
  }

  async function handleRefreshVerification() {
    try {
      const me = await chatApi.getMe();
      setEmailVerified(me?.emailVerified ?? null);
    } catch {
      // Leave emailVerified as-is — a failed refresh shouldn't wipe out
      // whatever status we already knew.
    }
  }

  function applyFilter() {
    const maxRunnersLimit = filterBounds?.maxRunnersPerRace ?? 100;
    const maxIspLimit = filterBounds?.maxIsp ?? 100000;

    const min = Math.max(1, parseInt(draftMin) || 1);
    const max = Math.max(min, Math.min(maxRunnersLimit, parseInt(draftMax) || maxRunnersLimit));
    setDraftMin(String(min));
    setDraftMax(String(max));
    setMinRunners(min);
    setMaxRunners(max);

    const minI = Math.max(1, parseFloat(draftMinIsp) || 1);
    const maxI = Math.min(maxIspLimit, Math.max(minI, parseFloat(draftMaxIsp) || maxIspLimit));
    setDraftMinIsp(String(minI));
    setDraftMaxIsp(String(maxI));
    setMinIsp(minI);
    setMaxIsp(maxI);

    const minRIR = Math.max(1, parseInt(draftMinRIR) || 1);
    const maxRIR = Math.max(minRIR, Math.min(maxRunnersLimit, parseInt(draftMaxRIR) || maxRunnersLimit));
    setDraftMinRIR(String(minRIR));
    setDraftMaxRIR(String(maxRIR));
    setMinRunnersInRange(minRIR);
    setMaxRunnersInRange(maxRIR);

    // Malformed input (wrong shape, or min after max) falls back to the
    // full absolute range rather than silently keeping the last-applied
    // value — clearer to the user than a filter that looks applied but
    // quietly didn't change. The date range is then capped to one year
    // wide (same latency reasoning as the FILTER_DEFAULTS comment above) —
    // a maxDate more than a year past minDate is silently pulled back to
    // minDate + 1 year rather than rejected, matching how every other
    // range filter here self-corrects on Apply instead of erroring.
    const dMin = DATE_RE.test(draftMinDate) ? draftMinDate : ABSOLUTE_MIN_DATE;
    const dMaxRaw = DATE_RE.test(draftMaxDate) ? draftMaxDate : ABSOLUTE_MAX_DATE;
    const dMaxAfterMin = dMaxRaw < dMin ? dMin : dMaxRaw;
    const oneYearCap = addOneYear(dMin);
    const dMax = dMaxAfterMin > oneYearCap ? oneYearCap : dMaxAfterMin;
    setDraftMinDate(dMin);
    setDraftMaxDate(dMax);
    setMinDate(dMin);
    setMaxDate(dMax);

    const trimmedTrainer = draftTrainer.trim();
    setDraftTrainer(trimmedTrainer);
    setTrainerSearch(trimmedTrainer);

    const trimmedJockey = draftJockey.trim();
    setDraftJockey(trimmedJockey);
    setJockeySearch(trimmedJockey);

    const tfWinRate = Math.min(100, Math.max(0, parseFloat(draftTrainerFormMinWinRate) || 0));
    setDraftTrainerFormMinWinRate(String(tfWinRate));
    setTrainerFormMinWinRate(tfWinRate);

    setHasTrainerForm(draftHasTrainerForm);
    setMinTrainerFormRunners(draftHasTrainerForm ? 1 : 0);

    const modelWinProb = Math.min(100, Math.max(0, parseFloat(draftMinModelWinProbability) || 0));
    setDraftMinModelWinProbability(String(modelWinProb));
    setMinModelWinProbability(modelWinProb);

    setOnlyModelBeatsSp(draftOnlyModelBeatsSp);

    // Clamped to 0-100 like every other percentage field here — 100 is the
    // widest two probabilities can possibly be apart, so anything above it
    // could only ever match zero runners.
    const modelSpEdgePts = Math.min(100, Math.max(0, parseFloat(draftMinModelSpEdgePts) || 0));
    setDraftMinModelSpEdgePts(String(modelSpEdgePts));
    setMinModelSpEdgePts(modelSpEdgePts);

    // Commit every chip filter's draft (pending) selection to the applied
    // set actually used for fetching — this is the point where a chip's
    // visual flips from "pending" (gray) to "applied" (solid).
    setSelectedCountries(new Set(draftSelectedCountries));
    setSelectedCourses(new Set(draftSelectedCourses));
    setSelectedGoings(new Set(draftSelectedGoings));
    setSelectedRaceClasses(new Set(draftSelectedRaceClasses));
    setSelectedRaceTypes(new Set(draftSelectedRaceTypes));

    // Once the user applies filters explicitly, the two race splits are no
    // longer auto-derived from the total — whatever's in the two Race boxes
    // (even if it's still the auto-filled half/half default) becomes the
    // committed split from here on.
    //
    // Exception: the very first Apply from a bare, never-loaded screen
    // (see hadUrlParamsOnMount/hasLoadedOnce) can't trust those boxes yet —
    // they still hold their pre-fetch placeholder values ("1"/"0", see
    // draftFromA/draftToA's initializers below), not a real total. Reading
    // them here as if they were meaningful computed a bogus split A of
    // "races 1-<end>" (toA null, since totalRaces is still 0) and split B
    // identical to it — both showing the same full range instead of two
    // actual halves. Staying on the auto-compute path for this one fetch
    // lets the backend derive the real half/half split from the total it
    // returns, same as a fresh mount would; only an edit *after* a real
    // load has happened is genuine explicit user intent.
    const aEdited = splitAEditedRef.current;
    const bEdited = splitBEditedRef.current;
    if (hasLoadedOnce || aEdited || bEdited) {
      splitsAreDefaultRef.current = false;
    }

    const { fromA, toA, fromB, toB } = resolveSplitPair(
      draftFromA, draftToA, draftFromB, draftToB, totalRaces, aEdited, bEdited
    );
    setDraftFromA(String(fromA));
    setDraftToA(String(toA ?? totalRaces));
    setFromRowA(fromA);
    setToRowA(toA);

    setDraftFromB(String(fromB));
    setDraftToB(String(toB ?? totalRaces));
    setFromRowB(fromB);
    setToRowB(toB);

    setFetchTrigger(t => t + 1);
  }

  // Re-applies the draft filters (so a saved snapshot always matches
  // committed, URL-synced state — never a stray draft edit the user
  // hadn't hit Apply on) then opens the naming dialog. The dialog's
  // confirm button stays disabled while isLoading is true (see
  // SaveResultDialog's `saving` prop below), so by the time the user can
  // actually submit, syncUrl (fired once the apply fetch resolves) has
  // already written the committed filters to window.location.search.
  function handleOpenSaveDialog() {
    if (!isAuthenticated) {
      onRequestAuth();
      return;
    }
    applyFilter();
    setSaveError(null);
    setSaveConfirmed(false);
    setShowSaveDialog(true);
  }

  async function handleConfirmSave(name: string) {
    setSavingResult(true);
    setSaveError(null);
    try {
      const filters = Object.fromEntries(new URLSearchParams(window.location.search));
      await chatApi.saveFilterSet(filters, name || undefined);
      setShowSaveDialog(false);
      setSaveConfirmed(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save result.");
    } finally {
      setSavingResult(false);
    }
  }

  function resetFilters() {
    setMinRunners(FILTER_DEFAULTS.minRunners);
    setMaxRunners(FILTER_DEFAULTS.maxRunners);
    setDraftMin(String(FILTER_DEFAULTS.minRunners));
    setDraftMax(String(FILTER_DEFAULTS.maxRunners));
    setMinIsp(FILTER_DEFAULTS.minIsp);
    setMaxIsp(FILTER_DEFAULTS.maxIsp);
    setDraftMinIsp(String(FILTER_DEFAULTS.minIsp));
    setDraftMaxIsp(String(FILTER_DEFAULTS.maxIsp));
    setMinRunnersInRange(FILTER_DEFAULTS.minInIspRange);
    setMaxRunnersInRange(FILTER_DEFAULTS.maxInIspRange);
    setDraftMinRIR(String(FILTER_DEFAULTS.minInIspRange));
    setDraftMaxRIR(String(FILTER_DEFAULTS.maxInIspRange));
    setMinDate(FILTER_DEFAULTS.minDate);
    setMaxDate(FILTER_DEFAULTS.maxDate);
    setDraftMinDate(FILTER_DEFAULTS.minDate);
    setDraftMaxDate(FILTER_DEFAULTS.maxDate);
    setSelectedCountries(new Set());
    setDraftSelectedCountries(new Set());
    setSelectedCourses(new Set());
    setDraftSelectedCourses(new Set());
    setSelectedGoings(new Set());
    setDraftSelectedGoings(new Set());
    setSelectedRaceClasses(new Set());
    setDraftSelectedRaceClasses(new Set());
    setSelectedRaceTypes(new Set());
    setDraftSelectedRaceTypes(new Set());
    setDraftTrainer("");
    setTrainerSearch("");
    setDraftJockey("");
    setJockeySearch("");
    setDraftTrainerFormMinWinRate(String(FILTER_DEFAULTS.trainerFormMinWinRate));
    setTrainerFormMinWinRate(FILTER_DEFAULTS.trainerFormMinWinRate);
    setDraftHasTrainerForm(false);
    setHasTrainerForm(false);
    setMinTrainerFormRunners(FILTER_DEFAULTS.minTrainerFormRunners);
    setDraftMinModelWinProbability(String(FILTER_DEFAULTS.minModelWinProbability));
    setMinModelWinProbability(FILTER_DEFAULTS.minModelWinProbability);
    setDraftMinModelSpEdgePts(String(FILTER_DEFAULTS.minModelSpEdgePts));
    setMinModelSpEdgePts(FILTER_DEFAULTS.minModelSpEdgePts);
    setDraftOnlyModelBeatsSp(false);
    setOnlyModelBeatsSp(false);

    // Hand the two splits back to auto (half/half) mode — the next fetch
    // recomputes them from the fresh grand total.
    splitsAreDefaultRef.current = true;
    splitAEditedRef.current = false;
    splitBEditedRef.current = false;
    setFromRowA(1);
    setToRowA(null);
    setDraftFromA("1");
    setDraftToA("0");
    setFromRowB(1);
    setToRowB(null);
    setDraftFromB("1");
    setDraftToB("0");

    setFetchTrigger(t => t + 1);
  }

  useEffect(() => {
    let cancelled = false;

    function applyResult(result: CachedSplitsResult) {
      setHasLoadedOnce(true);
      setTotalRaces(result.totalRaces);
      setTotalRunners(result.totalRunners);
      setRaceCap(result.raceCap);
      setFilterBounds(result.filterBounds);
      setAvailableCountries(result.countries);
      setAvailableCourses(result.courses);
      setAvailableGoings(result.goings);
      setAvailableRaceClasses(result.raceClasses);
      setAvailableRaceTypes(result.raceTypes);

      setFromRowA(result.splitA.fromRow);
      setToRowA(result.splitA.toRow);
      setFromRowB(result.splitB.fromRow);
      setToRowB(result.splitB.toRow);

      // Keep the draft boxes in sync with whatever range was actually
      // queried — including filling in an open-ended ("no cap") upper
      // bound with the grand total, so a box never shows a stale
      // placeholder value (e.g. when a bookmarked URL set fromRowA/
      // fromRowB explicitly but left the upper bound uncapped).
      setDraftFromA(String(result.splitA.fromRow));
      setDraftToA(String(result.splitA.toRow ?? result.totalRaces));
      setDraftFromB(String(result.splitB.fromRow));
      setDraftToB(String(result.splitB.toRow ?? result.totalRaces));

      setTotalRacesA(result.splitA.total);
      setTotalRunnersA(result.splitA.totalRunners);
      setPnlStatsA(result.splitA.pnlStats ?? EMPTY_PNL);
      setBrierA(result.splitA.brier);
      setTotalRacesB(result.splitB.total);
      setTotalRunnersB(result.splitB.totalRunners);
      setPnlStatsB(result.splitB.pnlStats ?? EMPTY_PNL);
      setBrierB(result.splitB.brier);
      setBrierTotal(result.brier);
    }

    // Keeps the URL query string in sync with the currently *applied*
    // filters/split (not draft/in-progress typing) so a filtered view can
    // be bookmarked, shared, carried over to the races screen, or survive
    // a refresh. Called synchronously right after applyResult(), in the
    // same tick, rather than as its own reactive useEffect watching
    // fromRowA/toRowA/etc — those values change *as a result of* this
    // fetch, so a separate effect reacting to them lags by one extra
    // render/commit. That gap is enough for a fast click on "View Races"
    // (a real risk in an automated test, and in principle for a human too)
    // to read window.location.search before the split boundaries had
    // landed in it, silently dropping them for the return trip and
    // defeating the sessionStorage cache below (a differently-shaped
    // request — no fromRowA/toRowA — can't hit the same cache entry).
    function syncUrl(result: CachedSplitsResult, isDefault: boolean) {
      updateUrlParams({
        minRunners: minRunners !== FILTER_DEFAULTS.minRunners ? String(minRunners) : undefined,
        maxRunners: maxRunners !== FILTER_DEFAULTS.maxRunners ? String(maxRunners) : undefined,
        minIsp: minIsp !== FILTER_DEFAULTS.minIsp ? String(minIsp) : undefined,
        maxIsp: maxIsp !== FILTER_DEFAULTS.maxIsp ? String(maxIsp) : undefined,
        minInIspRange: minRunnersInRange !== FILTER_DEFAULTS.minInIspRange ? String(minRunnersInRange) : undefined,
        maxInIspRange: maxRunnersInRange !== FILTER_DEFAULTS.maxInIspRange ? String(maxRunnersInRange) : undefined,
        // Deliberately compared against ABSOLUTE_MIN_DATE/ABSOLUTE_MAX_DATE
        // here, NOT FILTER_DEFAULTS.minDate/maxDate — an absent minDate/
        // maxDate query param means "no bound at all" server-side (see
        // router.ts parseDateRangeParams), which only matches
        // FILTER_DEFAULTS' arbitrary "last month" convenience default by
        // coincidence. A user who explicitly applies a range that happens
        // to start on FILTER_DEFAULTS.minDate ("2024-01-01" — a very
        // plausible real choice, not just the untouched default) would
        // otherwise have minDate silently dropped from the URL, and
        // IspRacesScreen reads a *missing* minDate as "" (no lower bound
        // at all, not "2024-01-01") — so /isp/races would fetch with no
        // lower bound, matching every race back to the dataset's true
        // earliest date instead of the applied one.
        minDate: minDate !== ABSOLUTE_MIN_DATE ? minDate : undefined,
        maxDate: maxDate !== ABSOLUTE_MAX_DATE ? maxDate : undefined,
        countries: selectedCountries.size > 0 ? [...selectedCountries].sort().join(",") : undefined,
        courses: selectedCourses.size > 0 ? [...selectedCourses].sort().join(",") : undefined,
        goings: selectedGoings.size > 0 ? [...selectedGoings].sort().join(",") : undefined,
        raceClasses: selectedRaceClasses.size > 0 ? [...selectedRaceClasses].sort().join(",") : undefined,
        raceTypes: selectedRaceTypes.size > 0 ? [...selectedRaceTypes].sort().join(",") : undefined,
        trainer: trainerSearch ? trainerSearch : undefined,
        jockey: jockeySearch ? jockeySearch : undefined,
        trainerFormMinWinRate: trainerFormMinWinRate !== FILTER_DEFAULTS.trainerFormMinWinRate ? String(trainerFormMinWinRate) : undefined,
        hasTrainerForm: hasTrainerForm ? "true" : undefined,
        minModelWinProbability: minModelWinProbability !== FILTER_DEFAULTS.minModelWinProbability ? String(minModelWinProbability) : undefined,
        onlyModelBeatsSp: onlyModelBeatsSp ? "true" : undefined,
        minModelSpEdgePts: minModelSpEdgePts !== FILTER_DEFAULTS.minModelSpEdgePts ? String(minModelSpEdgePts) : undefined,
        // Only write the split boundaries once the user has explicitly
        // applied a custom split — writing the auto-computed default here
        // too would make the *next* mount think a custom split was already
        // set (urlHasParam("fromRowA") would find it), silently switching
        // that mount from "ask the backend for the default" to "request
        // this exact fromRowA/toRowA": a differently shaped request that
        // couldn't reuse the sessionStorage cache, even though nothing had
        // actually changed since the previous visit.
        fromRowA: !isDefault ? String(result.splitA.fromRow) : undefined,
        toRowA: !isDefault && result.splitA.toRow != null ? String(result.splitA.toRow) : undefined,
        fromRowB: !isDefault ? String(result.splitB.fromRow) : undefined,
        toRowB: !isDefault && result.splitB.toRow != null ? String(result.splitB.toRow) : undefined,
      });
    }

    // A bare load (no URL params, Apply/Reset never pressed this session)
    // stays idle — no fetch, no cache lookup, nothing computed. The filter
    // bar and split cards render their "not yet applied" placeholder state
    // (see hasLoadedOnce) until the user does something.
    if (fetchTrigger === 0 && !hadUrlParamsOnMount) {
      return;
    }

    (async () => {
      setError(null);
      const isDefault = splitsAreDefaultRef.current;
      // Only the currently-active unit's explicit values are ever sent in
      // the actual request or written to the URL (see below) — the
      // inactive unit's component state can hold a stale *resolved* value
      // (e.g. a race index derived from a runner-target lookup) that isn't
      // reconstructible from the URL alone on a fresh remount, since it
      // was never persisted there. Neutralizing the inactive unit to a
      // fixed placeholder keeps the cache key exactly reproducible across
      // a mount/remount, instead of spuriously missing the cache because
      // an unused field happened to differ.
      const cacheKey = buildSplitsCacheKey({
        minRunners, maxRunners, countries: [...selectedCountries], minIsp, maxIsp,
        minRunnersInRange, maxRunnersInRange, minDate, maxDate, isDefault,
        fromRowA, toRowA, fromRowB, toRowB,
        courses: [...selectedCourses], goings: [...selectedGoings],
        raceClasses: [...selectedRaceClasses], raceTypes: [...selectedRaceTypes],
        trainerSearch, jockeySearch, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
        minModelWinProbability, onlyModelBeatsSp, minModelSpEdgePts,
        isAuthenticated,
      });

      // fetchTrigger only ever increments via Apply/Reset — anything else
      // that re-runs this effect (fetchTrigger still 0) is a re-mount, not
      // a user asking for fresh data: navigating to /isp/races and back via
      // "← Filters", re-opening the split detail panel, etc. Reuse the last
      // known-good result for this exact filter/split combination instead
      // of re-fetching — this is what used to make "tap Filters" feel like
      // it reloaded from scratch even though nothing had changed.
      if (fetchTrigger === 0) {
        const cached = readSplitsCache(cacheKey);
        // A cached *explicit* (non-default) split whose start is beyond the
        // total it was cached under is known-broken the same way the
        // network-fetch path detects it below — treat exactly like a cache
        // miss so it falls through to a fresh, self-correcting fetch.
        // Guarded to !isDefault: a cached *default* split legitimately ends
        // up with an empty (or entirely absent) Split B whenever the total
        // is under 1001 — that's correct-as-computed, not staleness, and
        // flagging it here would reject an otherwise-valid cache hit every
        // time (this bucket's own key already guarantees it was computed
        // fresh, so there's nothing to re-derive from a different total).
        if (cached && (isDefault || !isStaleSplit(cached.splitB.fromRow, cached.totalRaces))) {
          applyResult(cached);
          syncUrl(cached, isDefault);
          setIsLoading(false);
          return;
        }
      }

      setIsLoading(true);
      try {
        // One request for the grand total + both splits — see
        // chatApi.getIndustrySpSplits / the backend's getSplitStats for
        // why this used to be 3 separate concurrent requests (each risking
        // its own Lambda cold start / Atlas M0 connection contention) and
        // isn't anymore. Omitting every explicit boundary lets the backend
        // compute the half/half default itself.
        const result = await chatApi.getIndustrySpSplits(
          minRunners, maxRunners, [...selectedCountries], minIsp, maxIsp, minRunnersInRange, maxRunnersInRange,
          isDefault ? undefined : fromRowA,
          isDefault ? undefined : (toRowA ?? undefined),
          isDefault ? undefined : fromRowB,
          isDefault ? undefined : (toRowB ?? undefined),
          minDate,
          maxDate,
          [...selectedCourses], [...selectedGoings], [...selectedRaceClasses], [...selectedRaceTypes],
          trainerSearch || undefined, jockeySearch || undefined,
          trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
          minModelWinProbability, onlyModelBeatsSp, minModelSpEdgePts
        );
        if (cancelled) return;
        // An explicit (non-default) split's row numbers are only meaningful
        // relative to the total they were computed against. They go stale
        // whenever some *other* filter narrows that total afterward without
        // the split being recomputed — e.g. a bookmarked URL from before
        // the date filter existed (fromRowA/fromRowB from the full ~110k
        // dataset) landing on today's 2024-scoped default. Detected here
        // (fromRowB beyond the actual total) rather than guessed at ahead
        // of time, since the true total isn't known until the fetch
        // returns. Scoped to fetchTrigger===0 (a mount/remount reading a
        // stale URL) deliberately — an Apply click also sets isDefault to
        // false, and a filter that legitimately narrows the total below
        // 1001 while the split boxes still hold the old default's numbers
        // is real user intent, not staleness; auto-correcting *that* would
        // silently override what Apply just fetched (and cost an extra,
        // unwanted request every time a filter shrinks the total).
        if (fetchTrigger === 0 && !isDefault && isStaleSplit(result.splitB.fromRow, result.totalRaces)) {
          splitsAreDefaultRef.current = true;
          setFetchTrigger(t => t + 1);
          return;
        }
        applyResult(result);
        syncUrl(result, isDefault);
        // Written under a key reflecting the *resolved* boundary values —
        // exactly what syncUrl just wrote to the URL — not the pre-fetch
        // request shape used for `cacheKey` above. An open-ended "to" (no
        // explicit upper bound sent, e.g. the default split, or a custom
        // one left at the current max) resolves to a concrete number in
        // the response; caching under the pre-fetch (open-ended) key while
        // the URL now holds that concrete value would permanently miss the
        // cache on every remount, since a remount's key is built from
        // whatever's actually in the URL.
        const writeCacheKey = buildSplitsCacheKey({
          minRunners, maxRunners, countries: [...selectedCountries], minIsp, maxIsp,
          minRunnersInRange, maxRunnersInRange, minDate, maxDate, isDefault,
          fromRowA: result.splitA.fromRow,
          toRowA: result.splitA.toRow,
          fromRowB: result.splitB.fromRow,
          toRowB: result.splitB.toRow,
          courses: [...selectedCourses], goings: [...selectedGoings],
          raceClasses: [...selectedRaceClasses], raceTypes: [...selectedRaceTypes],
          trainerSearch, jockeySearch, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
          minModelWinProbability, onlyModelBeatsSp, minModelSpEdgePts,
          isAuthenticated,
        });
        writeSplitsCache(writeCacheKey, result);
      } catch {
        if (!cancelled) setError("Failed to load industry SP");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger]);

  function renderTooltipToggle(key: string) {
    return (
      <TouchableOpacity
        testID={`industry-sp-tooltip-toggle-${key}`}
        onPress={() => setOpenTooltip(t => (t === key ? null : key))}
        hitSlop={{ top: 17, bottom: 17, left: 17, right: 17 }}
        style={styles.tooltipToggle}
      >
        <Text style={styles.tooltipToggleText}>?</Text>
      </TouchableOpacity>
    );
  }

  function renderTooltipText(key: string) {
    if (openTooltip !== key) return null;
    return (
      <Text testID={`industry-sp-tooltip-text-${key}`} style={styles.tooltipText}>
        {FILTER_TOOLTIPS[key]}
      </Text>
    );
  }

  function renderFilterRow(opts: {
    filterKey: string;
    label: string;
    labelTestId?: string;
    minValue: string;
    onMinChange: (v: string) => void;
    minTestId: string;
    maxValue: string;
    onMaxChange: (v: string) => void;
    maxTestId: string;
    keyboardType: KeyboardTypeOptions;
    maxLength: number;
    hint?: string | null;
    hintTestId?: string;
  }) {
    const {
      filterKey, label, labelTestId,
      minValue, onMinChange, minTestId,
      maxValue, onMaxChange, maxTestId,
      keyboardType, maxLength, hint, hintTestId,
    } = opts;
    return (
      <View
        key={filterKey}
        testID={`industry-sp-filter-row-${filterKey}`}
        style={[styles.filterGridRow, openTooltip === filterKey && styles.filterGridRowElevated]}
      >
        <View style={styles.filterGridLabel}>
          <Text testID={labelTestId} style={styles.filterGridLabelText}>{label}</Text>
          {renderTooltipToggle(filterKey)}
        </View>
        <RNTextInput
          testID={minTestId}
          style={styles.gridInput}
          value={minValue}
          onChangeText={onMinChange}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
        <Text style={styles.filterGridDash}>–</Text>
        <RNTextInput
          testID={maxTestId}
          style={styles.gridInput}
          value={maxValue}
          onChangeText={onMaxChange}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
        <Text testID={hintTestId} style={styles.filterGridHint}>{hint ?? ""}</Text>
        {renderTooltipText(filterKey)}
      </View>
    );
  }

  function renderTextFilterRow(opts: {
    filterKey: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    testId: string;
    placeholder?: string;
  }) {
    const { filterKey, label, value, onChange, testId, placeholder } = opts;
    return (
      <View
        key={filterKey}
        testID={`industry-sp-filter-row-${filterKey}`}
        style={[styles.filterGridRow, openTooltip === filterKey && styles.filterGridRowElevated]}
      >
        <View style={styles.filterGridLabel}>
          <Text style={styles.filterGridLabelText}>{label}</Text>
          {renderTooltipToggle(filterKey)}
        </View>
        <RNTextInput
          testID={testId}
          style={styles.textFilterInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {renderTooltipText(filterKey)}
      </View>
    );
  }

  // A single boolean toggle — draft/applied follows the same pattern as
  // every other filter here (checking the box doesn't narrow anything
  // until Apply is pressed), it just has no text-box-with-a-typed-value to
  // visually distinguish "pending" from "applied", so the checkbox itself
  // simply reflects whatever draft state it's bound to.
  function renderCheckboxFilterRow(opts: {
    filterKey: string;
    label: string;
    testId: string;
    checked: boolean;
    onToggle: () => void;
  }) {
    const { filterKey, label, testId, checked, onToggle } = opts;
    return (
      <View
        key={filterKey}
        testID={`industry-sp-filter-row-${filterKey}`}
        style={[styles.filterGridRow, openTooltip === filterKey && styles.filterGridRowElevated]}
      >
        <TouchableOpacity
          testID={testId}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          // react-native-web's accessibilityState->aria-checked mapping
          // wasn't reliably reflecting in the DOM in this RNW version — the
          // direct aria-checked prop (RNW passes aria-* props straight
          // through) is what actually shows up, so both are set: this one
          // for correctness/tests, accessibilityState for any RN-native
          // consumers of this same component tree.
          aria-checked={checked}
          style={styles.checkboxRow}
          onPress={onToggle}
        >
          <Checkbox status={checked ? "checked" : "unchecked"} onPress={onToggle} />
          <Text style={styles.filterGridLabelText}>{label}</Text>
        </TouchableOpacity>
        {renderTooltipToggle(filterKey)}
        {renderTooltipText(filterKey)}
      </View>
    );
  }

  // 3-state chip: unselected (outlined) / pending (selected in the draft
  // but not yet Applied — grayed) / applied (selected and committed —
  // solid/assertive). Mirrors how the numeric filters show a draft value
  // in the input box that only takes effect once Apply is pressed; chips
  // just need their own visual for "changed but not applied yet" since
  // there's no text box to look "unsaved" in.
  function renderChipRow(opts: {
    filterKey: string;
    testId: string;
    label: string;
    values: string[];
    draftSelected: Set<string>;
    appliedSelected: Set<string>;
    onToggle: (value: string) => void;
    loading: boolean;
  }) {
    const { filterKey, testId, label, values, draftSelected, appliedSelected, onToggle, loading } = opts;
    // Always renders the row (label + a placeholder when there's nothing
    // to show yet) rather than being entirely absent until options arrive
    // — so it appears alongside the rest of the filter bar on first paint,
    // whether that's "no fetch has happened yet" (bare load, before the
    // user has pressed Apply) or "fetch in flight".
    return (
      <View testID={`industry-sp-filter-row-${filterKey}`} style={styles.chipFilterRow}>
        <Text style={styles.chipFilterLabel}>{label}</Text>
        {values.length === 0 ? (
          <Text testID={`${testId}-loading`} style={styles.chipFilterLoadingText}>
            {loading ? "Loading…" : "Apply to load options"}
          </Text>
        ) : (
        <ScrollView
          horizontal
          testID={testId}
          style={styles.countryBar}
          contentContainerStyle={styles.countryBarContent}
          showsHorizontalScrollIndicator={false}
        >
          {values.map(value => {
            const inDraft = draftSelected.has(value);
            const applied = inDraft && appliedSelected.has(value);
            const pending = inDraft && !applied;
            const chipStyle = applied ? styles.countryChipActive : pending ? styles.countryChipPending : styles.countryChip;
            const textStyle = applied ? styles.countryChipTextActive : pending ? styles.countryChipTextPending : styles.countryChipText;
            return (
              <Chip
                key={value}
                testID={`${testId}-${value}`}
                accessibilityState={{ selected: inDraft, busy: pending }}
                compact
                mode={inDraft ? "flat" : "outlined"}
                selected={inDraft}
                onPress={() => onToggle(value)}
                style={chipStyle}
                textStyle={textStyle}
              >
                {pending ? `${value} •` : value}
              </Chip>
            );
          })}
        </ScrollView>
        )}
      </View>
    );
  }

  // Chip filters (country/course/going/raceClass/raceType) only ever touch
  // the draft set here — no fetch, no RIR re-clamp. The committed set (and
  // the actual query) only changes once Apply is pressed, in applyFilter().
  function toggleChipFilter(setDraftSelected: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setDraftSelected(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  // Builds the same non-default-only filter list loadConvergence's request
  // actually sends (mirrors the "only send what differs from
  // FILTER_DEFAULTS" convention already used for the URL query params
  // above) — so a user looking at a convergence result can see exactly what
  // narrowed it, without cross-referencing the Filters screen from memory.
  function buildConvergenceFilterSummary(): { key: string; label: string }[] {
    const summary: { key: string; label: string }[] = [];
    // Same ABSOLUTE_MIN_DATE/ABSOLUTE_MAX_DATE comparison as syncUrl above,
    // and for the same reason — FILTER_DEFAULTS.minDate/maxDate is just an
    // arbitrary convenience default, not a "no date filter applied" sentinel.
    if (minDate !== ABSOLUTE_MIN_DATE || maxDate !== ABSOLUTE_MAX_DATE) {
      summary.push({ key: "date", label: `Date: ${minDate} → ${maxDate}` });
    }
    if (minRunners !== FILTER_DEFAULTS.minRunners || maxRunners !== FILTER_DEFAULTS.maxRunners) {
      summary.push({ key: "runners", label: `Runners: ${minRunners}–${maxRunners}` });
    }
    if (minIsp !== FILTER_DEFAULTS.minIsp || maxIsp !== FILTER_DEFAULTS.maxIsp) {
      summary.push({ key: "isp", label: `ISP: ${minIsp}–${maxIsp}` });
    }
    if (minRunnersInRange !== FILTER_DEFAULTS.minInIspRange || maxRunnersInRange !== FILTER_DEFAULTS.maxInIspRange) {
      summary.push({ key: "inIspRange", label: `In-range runners: ${minRunnersInRange}–${maxRunnersInRange}` });
    }
    if (selectedCountries.size > 0) {
      summary.push({ key: "countries", label: `Countries: ${[...selectedCountries].sort().join(", ")}` });
    }
    if (selectedCourses.size > 0) {
      summary.push({ key: "courses", label: `Courses: ${[...selectedCourses].sort().join(", ")}` });
    }
    if (selectedGoings.size > 0) {
      summary.push({ key: "goings", label: `Going: ${[...selectedGoings].sort().join(", ")}` });
    }
    if (selectedRaceClasses.size > 0) {
      summary.push({ key: "raceClasses", label: `Class: ${[...selectedRaceClasses].sort().join(", ")}` });
    }
    if (selectedRaceTypes.size > 0) {
      summary.push({ key: "raceTypes", label: `Type: ${[...selectedRaceTypes].sort().join(", ")}` });
    }
    if (trainerSearch) {
      summary.push({ key: "trainer", label: `Trainer: ${trainerSearch}` });
    }
    if (jockeySearch) {
      summary.push({ key: "jockey", label: `Jockey: ${jockeySearch}` });
    }
    if (minTrainerFormRunners > 0) {
      summary.push({
        key: "trainerForm",
        label:
          trainerFormMinWinRate > 0
            ? `Trainer form: ≥${trainerFormMinWinRate}% win rate`
            : "Trainer form: has recent form",
      });
    }
    if (minModelWinProbability > 0) {
      summary.push({ key: "modelWinProbability", label: `Model win probability: ≥${minModelWinProbability}%` });
    }
    if (minModelSpEdgePts > 0) {
      summary.push({ key: "modelBeatsSp", label: `Model beats SP by ≥${minModelSpEdgePts} pts` });
    } else if (onlyModelBeatsSp) {
      summary.push({ key: "modelBeatsSp", label: "Model beats SP" });
    }
    return summary;
  }

  // Opens the P&L convergence graph for one split's own race range — reads
  // the same fromRowA/toRowA/fromRowB/toRowB state the result card itself
  // renders from, so the graph's range always matches what the card/box
  // show exactly, with no separately re-derived formula to drift out of
  // sync. Each split's graph is its own independent convergence test
  // starting fresh at its own first race, not a shared dataset-wide line.
  async function loadConvergence(id: "a" | "b") {
    setShowConvergencePanel(true);
    setConvergenceError(null);
    setConvergenceFilters(buildConvergenceFilterSummary());
    const fromRow = id === "a" ? fromRowA : fromRowB;
    const toRow = (id === "a" ? toRowA : toRowB) ?? totalRaces;
    // A split with zero races (e.g. an empty result) has nothing to
    // graph — the backend requires toRow >= 1, so skip the request
    // entirely rather than firing one that's guaranteed to fail.
    if (toRow < fromRow) {
      setConvergencePoints([]);
      return;
    }
    setConvergenceLoading(true);
    try {
      const result = await chatApi.getIndustrySpRaceConvergence(
        toRow, fromRow, minRunners, maxRunners, [...selectedCountries], minIsp, maxIsp, minRunnersInRange, maxRunnersInRange,
        minDate, maxDate, [...selectedCourses], [...selectedGoings], [...selectedRaceClasses], [...selectedRaceTypes],
        trainerSearch || undefined, jockeySearch || undefined,
        trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
        minModelWinProbability, onlyModelBeatsSp, minModelSpEdgePts
      );
      setConvergencePoints(result.data);
    } catch (err) {
      setConvergenceError(err instanceof Error ? err.message : "Failed to load convergence data.");
    } finally {
      setConvergenceLoading(false);
    }
  }

  // Fetches (up to MODEL_PERFORMANCE_RACE_LIMIT) races scored by one model
  // version, server-side filtered by whatever ModelPerformanceFilters the
  // dashboard currently has applied (date range/chips/trainer/jockey) — a
  // single unpaginated pull of the filtered set, rather than this screen's
  // own paginated row-range browsing.
  //
  // MODEL_PERFORMANCE_RACE_LIMIT caps this well under the Lambda's 6MB
  // synchronous response payload ceiling: measured against real prod data
  // (full runner subdocuments, ~7KB/race), limit=800 already 500s with no
  // CORS headers (the browser reports it as "blocked by CORS policy",
  // masking the real cause), while limit=700 (~4.9MB) succeeds. 500 keeps
  // a comfortable margin below that cliff.
  const MODEL_PERFORMANCE_RACE_LIMIT = 500;

  async function loadRacesForModelVersion(modelVersionId: string, filters: ModelPerformanceFilters = {}) {
    setModelPerformanceError(null);
    setModelPerformanceLoading(true);
    try {
      // minDate defaults to the model's own real held-out test period start
      // (runMeta.testDateMin, passed in by callers below) rather than being
      // left open — without it, fromRow=1/sort=asc returns whichever races
      // this model happened to score *earliest*, which for a model trained
      // on years of history lands back near the start of the whole dataset,
      // nowhere near any date range a filter could reach. See the
      // model-perf-filters AGENTS.md entry for the full bug writeup.
      const result = await chatApi.getIndustrySp(
        1, MODEL_PERFORMANCE_RACE_LIMIT, 1, 30, filters.countries ?? [], 1, 1000, "asc", 1, 10000, 1, undefined,
        filters.minDate, filters.maxDate, filters.courses ?? [], filters.goings ?? [], filters.raceClasses ?? [], filters.raceTypes ?? [],
        filters.trainer, filters.jockey, undefined, undefined, undefined, undefined, undefined, undefined,
        modelVersionId
      );
      setModelPerformanceRaces(result.data);
    } catch (err) {
      setModelPerformanceError(err instanceof Error ? err.message : "Failed to load model performance.");
    } finally {
      setModelPerformanceLoading(false);
    }
  }

  async function loadModelPerformance() {
    setShowModelPerformancePanel(true);
    setModelPerformanceError(null);
    setModelPerformanceLoading(true);
    try {
      const versionsResult = await chatApi.getModelVersions();
      setModelVersions(versionsResult.data);
      const latest = versionsResult.data[0] ?? null;
      if (latest) {
        setSelectedModelVersionId(latest.id);
        await loadRacesForModelVersion(latest.id, { minDate: latest.runMeta.testDateMin });
      } else {
        setModelPerformanceRaces([]);
        setModelPerformanceLoading(false);
      }
    } catch (err) {
      setModelPerformanceError(err instanceof Error ? err.message : "Failed to load model performance.");
      setModelPerformanceLoading(false);
    }
  }

  function onSelectModelVersion(id: string) {
    setSelectedModelVersionId(id);
    const version = modelVersions.find(v => v.id === id);
    loadRacesForModelVersion(id, version ? { minDate: version.runMeta.testDateMin } : {});
  }

  // Passed to ModelPerformanceDashboard as onApplyFilters — Apply, the date
  // range picker's own confirm step, and Reset all refetch through here
  // instead of re-slicing whatever's already loaded.
  function onApplyModelPerformanceFilters(filters: ModelPerformanceFilters) {
    loadRacesForModelVersion(selectedModelVersionId, filters);
  }

  function renderSplitCard(opts: {
    id: "a" | "b";
    label: string;
    fromRow: number;
    toRow: number | null;
    totalRaces: number;
    totalRunners: number;
    pnl: PnlStats;
    brier: BrierStats | undefined;
    // idle: no fetch has ever run (bare page load, Apply never pressed) —
    // nothing to show, waiting on the user. pending: a fetch is currently
    // in flight (first-ever load of a URL that already carries filters, or
    // any Apply/Reset refetch). loaded: real numbers are in.
    status: "idle" | "pending" | "loaded";
  }) {
    const { id, label, fromRow, toRow, totalRaces: splitTotalRaces, totalRunners: splitTotalRunners, pnl, brier, status } = opts;
    const effectiveTo = toRow ?? totalRaces;
    const notReady = status !== "loaded";
    return (
      <View testID={`industry-sp-split-card-${id}`} style={[styles.splitCard, isDesktop && styles.splitCardFlex, notReady && styles.splitCardPending]}>
        <Text style={styles.splitCardLabel}>
          {label} — races {fromRow}–{effectiveTo}
        </Text>
        {status === "idle" ? (
          // Shown from first paint on a bare load — no fetch has happened
          // at all, so this is neither "loading" nor "no matches", just
          // "you haven't asked for anything yet".
          <Text testID={`industry-sp-split-idle-${id}`} style={styles.splitPendingText}>
            Press Apply to see results.
          </Text>
        ) : status === "pending" ? (
          // A fetch is genuinely in flight — first load of a filtered URL,
          // or any Apply/Reset refetch.
          <View testID={`industry-sp-split-pending-${id}`} style={styles.splitPendingRow}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
            <Text style={styles.splitPendingText}>Awaiting results…</Text>
          </View>
        ) : pnl.staked > 0 ? (
          <Text testID={`industry-sp-pnl-${id}`} style={[styles.pnlHeadline, pnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]} numberOfLines={1}>
            {formatPnl(pnl.pnl)}{" "}
            <Text style={[styles.pnlPct, pnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              ({formatPct(pnl.pnl, pnl.staked)})
            </Text>
          </Text>
        ) : (
          <Text testID={`industry-sp-split-empty-${id}`} style={styles.splitEmptyText}>
            {splitTotalRunners > 0 ? "No qualifying bets in this split." : "No races match this split."}
          </Text>
        )}
        {/*
          Sits under the P&L headline rather than replacing it: over a split of
          a few hundred races the P&L is the volatile number and the Brier is
          the stable one, so seeing them together is the point — a split can be
          +8% on luck while the model is scoring worse than the market on the
          very same horses.
        */}
        {status === "loaded" && (
          <BrierScore brier={brier} tone="dark" testID={`industry-sp-brier-${id}`} />
        )}
        <View style={styles.splitButtonRow}>
          <Button
            testID={`industry-sp-split-details-button-${id}`}
            mode="outlined"
            compact
            disabled={notReady}
            onPress={() => setDetailSplit(id)}
            style={styles.splitDetailsButton}
            labelStyle={styles.splitDetailsButtonLabel}
          >
            Details
          </Button>
          <Button
            testID={`industry-sp-split-graph-button-${id}`}
            mode="outlined"
            compact
            disabled={notReady}
            onPress={() => loadConvergence(id)}
            style={styles.splitDetailsButton}
            labelStyle={styles.splitDetailsButtonLabel}
          >
            Graph
          </Button>
          <Button
            testID={`industry-sp-view-races-button-${id}`}
            mode="contained"
            compact
            disabled={notReady}
            onPress={() => onViewRaces(fromRow, toRow)}
            style={styles.splitViewButton}
            labelStyle={styles.splitViewButtonLabel}
          >
            {notReady ? "View Races →" : `View ${splitTotalRaces} Races →`}
          </Button>
        </View>
      </View>
    );
  }

  const splitCardStatus: "idle" | "pending" | "loaded" = isLoading ? "pending" : hasLoadedOnce ? "loaded" : "idle";

  return (
    <SafeAreaView testID="industry-sp-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        subtitle={!isLoading ? `${totalRunners} runners · ${totalRaces} races` : undefined}
        testIdPrefix="industry-sp"
        extraActions={wrap => (
          <>
            <Button
              testID="industry-sp-filters-toggle"
              mode="outlined"
              compact
              onPress={wrap(() => setFiltersVisible(v => !v))}
              style={styles.headerToggleButton}
              labelStyle={styles.headerToggleButtonLabel}
            >
              {filtersVisible ? "Hide filters ▾" : "Show filters ▸"}
            </Button>
          </>
        )}
        // Model Performance goes in the nav group next to Backtest rather
        // than up with "Show filters" — it's a place you go to look at model
        // results, not a control over this screen's own view.
        navActions={wrap => (
          <Button
            testID="industry-sp-model-performance-button"
            mode="outlined"
            compact
            onPress={wrap(loadModelPerformance)}
            style={styles.headerToggleButton}
            labelStyle={styles.headerToggleButtonLabel}
          >
            Model Performance
          </Button>
        )}
      />
      {/*
        Deliberately outside the ScrollView below (like the Appbar) so it's
        immediately visible without scrolling on any viewport — the whole
        point of "clearly showing" this to an anonymous visitor. Keep it
        compact: it permanently eats into the scrollable area's height on
        short viewports (see the ScrollView comment just below for why that
        matters here specifically).
      */}
      {!isAuthenticated && (
        <View testID="industry-sp-benefits-banner" style={styles.benefitsBanner}>
          <Text style={styles.benefitsBannerText}>
            Sign up free to see 100× more races per search — {AUTHENTICATED_RACE_CAP} vs 100 when browsing anonymously.
          </Text>
          <Button
            testID="industry-sp-benefits-banner-signup"
            mode="contained"
            compact
            buttonColor={colors.accent}
            onPress={onRequestAuth}
            style={{ borderRadius: radii.button }}
            labelStyle={styles.headerButtonLabel}
          >
            Sign Up
          </Button>
        </View>
      )}

      {/* accountEmail must be present — a phone-only or emailless-Google
          account has emailVerified: false by default (nothing to
          verify), and would otherwise see a permanent, un-actionable
          "verify your email" banner it can never satisfy. */}
      {isAuthenticated && !!accountEmail && emailVerified === false && (
        <View testID="industry-sp-verify-banner" style={styles.verifyBanner}>
          <Text style={styles.verifyBannerText}>
            {resendStatus === "sent"
              ? "Verification email sent — check your inbox."
              : resendStatus === "already-verified"
                ? "Your email is already verified."
                : resendStatus === "error"
                  ? "Couldn't resend right now — try again shortly."
                  : "Please verify your email address to secure your account."}
          </Text>
          <View style={styles.verifyBannerActions}>
            <Button
              testID="industry-sp-verify-resend"
              mode="outlined"
              compact
              onPress={handleResendVerification}
              disabled={resendStatus === "sending"}
              style={{ borderRadius: radii.button }}
              labelStyle={styles.headerToggleButtonLabel}
            >
              {resendStatus === "sending" ? "Sending…" : "Resend email"}
            </Button>
            <Button
              testID="industry-sp-verify-refresh"
              mode="text"
              compact
              onPress={handleRefreshVerification}
              style={{ borderRadius: radii.button }}
            >
              I've verified
            </Button>
          </View>
        </View>
      )}

      {/*
        The document/body itself can never scroll on this app (see
        index.html — html/body are locked with position:fixed +
        overflow:hidden to stop iOS Safari's pinch-zoom/bounce-scroll from
        dragging the whole page around), so any content taller than the
        viewport MUST live inside a real RN ScrollView or it's simply
        unreachable — confirmed live on iOS: the second split card was
        cut off below the fold with no way to reach it. This ScrollView is
        that fix; the Appbar header stays outside it (fixed), and the
        SplitDetailPanel overlay below also stays outside it (full-screen
        regardless of scroll position).
      */}
      <ScrollView
        testID="industry-sp-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
      <PageContainer maxWidth={860}>
      {/* Filter grid — kept as custom for tight column alignment */}
      {filtersVisible && (
      <View testID="industry-sp-filter-bar" style={[styles.filterGrid, openTooltip != null && styles.filterGridElevated]}>
        {renderFilterRow({
          filterKey: "isp",
          label: "ISP",
          minValue: draftMinIsp,
          onMinChange: setDraftMinIsp,
          minTestId: "industry-sp-min-isp",
          maxValue: draftMaxIsp,
          onMaxChange: setDraftMaxIsp,
          maxTestId: "industry-sp-max-isp",
          keyboardType: "decimal-pad",
          maxLength: 7,
          hint: filterBounds != null ? `(${filterBounds.minIsp.toFixed(1)}–${Math.ceil(filterBounds.maxIsp)})` : null,
          hintTestId: "industry-sp-sp-bound",
        })}
        {renderFilterRow({
          filterKey: "runners",
          label: "Runners",
          minValue: draftMin,
          onMinChange: setDraftMin,
          minTestId: "industry-sp-min-value",
          maxValue: draftMax,
          onMaxChange: setDraftMax,
          maxTestId: "industry-sp-max-value",
          keyboardType: "numeric",
          maxLength: 3,
          hint: filterBounds != null ? `/${filterBounds.maxRunnersPerRace}` : null,
          hintTestId: "industry-sp-max-bound",
        })}
        {renderFilterRow({
          filterKey: "inIsp",
          label: "# in ISP",
          labelTestId: "industry-sp-in-isp-label",
          minValue: draftMinRIR,
          onMinChange: setDraftMinRIR,
          minTestId: "industry-sp-min-rir-value",
          maxValue: draftMaxRIR,
          onMaxChange: setDraftMaxRIR,
          maxTestId: "industry-sp-max-rir-value",
          keyboardType: "numeric",
          maxLength: 3,
          hint: filterBounds != null ? `/${filterBounds.maxRunnersPerRace}` : null,
          hintTestId: "industry-sp-max-rir-bound",
        })}
        {renderTextFilterRow({
          filterKey: "trainerFormWinRate",
          label: "Trainer Form Win %",
          value: draftTrainerFormMinWinRate,
          onChange: setDraftTrainerFormMinWinRate,
          testId: "industry-sp-trainer-form-min-win-rate",
        })}
        {renderCheckboxFilterRow({
          filterKey: "hasTrainerForm",
          label: "Has trainer form",
          testId: "industry-sp-has-trainer-form",
          checked: draftHasTrainerForm,
          onToggle: () => setDraftHasTrainerForm(v => !v),
        })}
        {renderTextFilterRow({
          filterKey: "minModelWinProbability",
          label: "Model Win %",
          value: draftMinModelWinProbability,
          onChange: setDraftMinModelWinProbability,
          testId: "industry-sp-min-model-win-probability",
        })}
        {renderCheckboxFilterRow({
          filterKey: "onlyModelBeatsSp",
          label: "Model beats SP",
          testId: "industry-sp-only-model-beats-sp",
          checked: draftOnlyModelBeatsSp,
          onToggle: () => setDraftOnlyModelBeatsSp(v => !v),
        })}
        {renderTextFilterRow({
          filterKey: "minModelSpEdgePts",
          label: "Beats SP by (pts)",
          value: draftMinModelSpEdgePts,
          onChange: setDraftMinModelSpEdgePts,
          testId: "industry-sp-min-model-sp-edge-pts",
        })}
        <View
          testID="industry-sp-filter-row-date"
          style={[styles.filterGridRow, openTooltip === "date" && styles.filterGridRowElevated]}
        >
          <View style={styles.filterGridLabel}>
            <Text style={styles.filterGridLabelText}>Date</Text>
            {renderTooltipToggle("date")}
          </View>
          <DateRangePicker
            testID="industry-sp-date-range-picker"
            fromDate={draftMinDate}
            toDate={draftMaxDate}
            minDate={ABSOLUTE_MIN_DATE}
            maxDate={ABSOLUTE_MAX_DATE}
            onChange={(from, to) => {
              setDraftMinDate(from);
              setDraftMaxDate(to);
            }}
          />
          {renderTooltipText("date")}
        </View>
        {/*
          Trainer/jockey search is intentionally not rendered — little
          practical use as a filter (free-text prefix match over
          thousands of names). draftTrainer/trainerSearch and
          draftJockey/jockeySearch stay wired up (default empty = no
          filter) so this is a pure UI hide, not a functional removal —
          same pattern as the hidden country filter above.
        */}
        {renderFilterRow({
          filterKey: "raceA",
          label: "Split A",
          minValue: draftFromA,
          onMinChange: v => { splitAEditedRef.current = true; setDraftFromA(v); },
          minTestId: "industry-sp-from-row-a",
          maxValue: draftToA,
          onMaxChange: v => { splitAEditedRef.current = true; setDraftToA(v); },
          maxTestId: "industry-sp-to-row-a",
          keyboardType: "numeric",
          maxLength: 6,
          hint: totalRaces > 0 ? `/${totalRaces}` : null,
          hintTestId: "industry-sp-race-bound-a",
        })}
        {renderFilterRow({
          filterKey: "raceB",
          label: "Split B",
          minValue: draftFromB,
          onMinChange: v => { splitBEditedRef.current = true; setDraftFromB(v); },
          minTestId: "industry-sp-from-row-b",
          maxValue: draftToB,
          onMaxChange: v => { splitBEditedRef.current = true; setDraftToB(v); },
          maxTestId: "industry-sp-to-row-b",
          keyboardType: "numeric",
          maxLength: 6,
          hint: totalRaces > 0 ? `/${totalRaces}` : null,
          hintTestId: "industry-sp-race-bound-b",
        })}
        {/*
          Country filter is intentionally not rendered — every race in this
          dataset is GB, so a country chip bar would only ever offer one
          no-op option. selectedCountries/draftSelectedCountries stay wired
          up (default empty = no filter = same result as "GB only") so this
          is a pure UI hide, not a functional removal — trivial to re-show
          if non-UK data is ever seeded.
        */}
        {renderChipRow({
          filterKey: "course",
          testId: "industry-sp-course",
          label: "Course",
          values: availableCourses,
          draftSelected: draftSelectedCourses,
          appliedSelected: selectedCourses,
          onToggle: value => toggleChipFilter(setDraftSelectedCourses, value),
          loading: isLoading,
        })}
        {renderChipRow({
          filterKey: "going",
          testId: "industry-sp-going",
          label: "Going",
          values: availableGoings,
          draftSelected: draftSelectedGoings,
          appliedSelected: selectedGoings,
          onToggle: value => toggleChipFilter(setDraftSelectedGoings, value),
          loading: isLoading,
        })}
        {renderChipRow({
          filterKey: "race-class",
          testId: "industry-sp-race-class",
          label: "Class",
          values: availableRaceClasses,
          draftSelected: draftSelectedRaceClasses,
          appliedSelected: selectedRaceClasses,
          onToggle: value => toggleChipFilter(setDraftSelectedRaceClasses, value),
          loading: isLoading,
        })}
        {renderChipRow({
          filterKey: "race-type",
          testId: "industry-sp-race-type",
          label: "Type",
          values: availableRaceTypes,
          draftSelected: draftSelectedRaceTypes,
          appliedSelected: selectedRaceTypes,
          onToggle: value => toggleChipFilter(setDraftSelectedRaceTypes, value),
          loading: isLoading,
        })}
        <View style={styles.filterActions}>
          <Button
            testID="industry-sp-filter-apply"
            mode="contained"
            compact
            onPress={applyFilter}
            style={styles.applyBtn}
            labelStyle={styles.applyBtnLabel}
          >
            Apply
          </Button>
          <Button
            testID="industry-sp-filter-reset"
            mode="outlined"
            compact
            onPress={resetFilters}
            style={styles.resetBtn}
            labelStyle={styles.resetBtnLabel}
          >
            Reset
          </Button>
          <Button
            testID="industry-sp-filter-save"
            mode="outlined"
            compact
            onPress={handleOpenSaveDialog}
            style={styles.resetBtn}
            labelStyle={styles.resetBtnLabel}
          >
            Save Result
          </Button>
        </View>
      </View>
      )}

      {!isAuthenticated && hasLoadedOnce && totalRaces > raceCap && (
        <View testID="industry-sp-cap-banner" style={styles.capBanner}>
          <Text variant="bodyMedium" style={styles.capBannerText}>
            Showing {raceCap} of {totalRaces} races — Sign up to unlock {AUTHENTICATED_RACE_CAP}
          </Text>
          <Button
            testID="industry-sp-cap-banner-signup"
            mode="contained"
            compact
            buttonColor={colors.accent}
            onPress={onRequestAuth}
            style={{ borderRadius: radii.button }}
            labelStyle={styles.headerButtonLabel}
          >
            Sign Up
          </Button>
        </View>
      )}

      {/*
        The whole filtered set's score, above the two splits that divide it.
        Worth its own line rather than being left to the split cards: the
        splits exist to show that a P&L holds up out of sample, and the
        equivalent question for a Brier score — "does the model beat the
        market across everything this filter selects" — is answered by the
        combined number, which is neither of the two split figures.
      */}
      {hasLoadedOnce && !isLoading && (
        <View testID="industry-sp-brier-total-row" style={styles.brierTotalRow}>
          <BrierScore brier={brierTotal} testID="industry-sp-brier-total" label="Brier (all races)" />
        </View>
      )}

      <View
        testID="industry-sp-split-cards"
        style={[styles.splitCards, isDesktop && styles.splitCardsRow]}
      >
        {/*
          The split cards themselves are no longer hidden behind this —
          they render from first paint (see renderSplitCard's `status`)
          so the page never looks empty/blocked while a fetch is genuinely
          in flight. This stays purely as a small in-flight marker: present
          (and still gates other actions/tests) exactly when isLoading is
          true. On a bare load with nothing applied yet, isLoading is
          false from the start (see hadUrlParamsOnMount) and this simply
          never appears — no fetch, no banner.
        */}
        {isLoading && (
          <View testID="industry-sp-loading" style={styles.loadingBanner}>
            <ActivityIndicator size="small" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingBannerText}>
              Loading industry SP…
            </Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="industry-sp-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!error && (
          <>
            {renderSplitCard({
              id: "a",
              label: "Split A",
              fromRow: fromRowA,
              toRow: toRowA,
              totalRaces: totalRacesA,
              totalRunners: totalRunnersA,
              pnl: pnlStatsA,
              brier: brierA,
              status: splitCardStatus,
            })}
            {renderSplitCard({
              id: "b",
              label: "Split B",
              fromRow: fromRowB,
              toRow: toRowB,
              totalRaces: totalRacesB,
              totalRunners: totalRunnersB,
              pnl: pnlStatsB,
              brier: brierB,
              status: splitCardStatus,
            })}
          </>
        )}
      </View>
      </PageContainer>
      </ScrollView>

      {detailSplit != null && (
        <SplitDetailPanel
          id={detailSplit}
          label={detailSplit === "a" ? "Split A" : "Split B"}
          fromRow={detailSplit === "a" ? fromRowA : fromRowB}
          toRow={(detailSplit === "a" ? toRowA : toRowB) ?? totalRaces}
          totalRaces={detailSplit === "a" ? totalRacesA : totalRacesB}
          totalRunners={detailSplit === "a" ? totalRunnersA : totalRunnersB}
          pnl={detailSplit === "a" ? pnlStatsA : pnlStatsB}
          brier={detailSplit === "a" ? brierA : brierB}
          onClose={() => setDetailSplit(null)}
          onViewRaces={() => {
            const fromRow = detailSplit === "a" ? fromRowA : fromRowB;
            const toRow = detailSplit === "a" ? toRowA : toRowB;
            setDetailSplit(null);
            onViewRaces(fromRow, toRow);
          }}
        />
      )}

      {showConvergencePanel && (
        <PnlConvergencePanel
          points={convergencePoints}
          loading={convergenceLoading}
          error={convergenceError}
          filters={convergenceFilters}
          onClose={() => setShowConvergencePanel(false)}
        />
      )}
      {showModelPerformancePanel && (
        <ModelPerformanceDashboard
          modelVersions={modelVersions}
          selectedModelVersionId={selectedModelVersionId}
          onSelectModelVersion={onSelectModelVersion}
          races={modelPerformanceRaces}
          loading={modelPerformanceLoading}
          error={modelPerformanceError}
          onClose={() => setShowModelPerformancePanel(false)}
          onApplyFilters={onApplyModelPerformanceFilters}
          defaultMinDate={
            modelVersions.find(v => v.id === selectedModelVersionId)?.runMeta.testDateMin ?? "2000-01-01"
          }
          availableCountries={availableCountries}
          availableCourses={availableCourses}
          availableGoings={availableGoings}
          availableRaceClasses={availableRaceClasses}
          availableRaceTypes={availableRaceTypes}
        />
      )}
      <SaveResultDialog
        visible={showSaveDialog}
        autoNamePreview={buildAutoResultNamePreview(Object.fromEntries(new URLSearchParams(window.location.search)))}
        saving={savingResult || isLoading}
        error={saveError}
        onSave={handleConfirmSave}
        onCancel={() => setShowSaveDialog(false)}
      />
      {saveConfirmed && (
        <View testID="industry-sp-save-confirmed-banner" style={styles.saveConfirmedBanner}>
          <Text style={styles.saveConfirmedText}>Saved to Results</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  saveConfirmedBanner: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    backgroundColor: colors.success,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  saveConfirmedText: {
    color: colors.surface,
    fontWeight: "600",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  headerToggleButton: {
    marginHorizontal: 3,
    borderRadius: radii.button,
    borderColor: "rgba(255,255,255,0.6)",
  },
  headerToggleButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fff",
  },
  filterGrid: {
    position: "relative",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  filterGridElevated: {
    zIndex: 40,
  },
  filterGridRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterGridRowElevated: {
    zIndex: 30,
  },
  filterGridLabel: {
    width: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  filterGridLabelText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    flexShrink: 1,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  tooltipToggle: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipToggleText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  tooltipText: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 6,
    zIndex: 30,
    maxWidth: 280,
    fontSize: 12,
    lineHeight: 16,
    color: "#fff",
    backgroundColor: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  gridInput: {
    width: 84,
    height: 40,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
  filterGridDash: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  textFilterInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
  },
  chipFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingLeft: spacing.md,
  },
  chipFilterLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    width: 44,
  },
  chipFilterLoadingText: {
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: "italic",
    paddingVertical: spacing.sm,
  },
  filterGridHint: {
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: "500",
    flexShrink: 1,
  },
  filterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  applyBtn: {
    borderRadius: radii.button,
    flex: 1,
  },
  applyBtnLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  resetBtn: {
    borderRadius: radii.button,
    borderColor: colors.primary,
  },
  resetBtnLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },
  countryBar: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 38,
    ...({ overscrollBehavior: "contain" } as any),
  },
  countryBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    gap: 6,
  },
  countryChip: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  countryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  // "Pending" — selected in the draft but not yet committed by Apply.
  // Deliberately a muted gray fill (vs. the assertive primary-color fill of
  // countryChipActive) so a tapped-but-unapplied chip reads as "changed,
  // not yet in effect" rather than looking identical to an applied filter.
  countryChipPending: {
    backgroundColor: colors.textTertiary,
    borderColor: colors.textTertiary,
  },
  countryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  countryChipTextActive: {
    color: "#fff",
  },
  countryChipTextPending: {
    color: "#fff",
  },
  brierTotalRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  splitCards: {
    padding: spacing.md,
    gap: spacing.md,
  },
  splitCardsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  splitCardFlex: {
    flex: 1,
  },
  splitCard: {
    backgroundColor: colors.text,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  // Slightly dimmed vs. the normal solid card — still fully visible/laid
  // out (not a skeleton/spinner replacing it), just visually reads as "not
  // settled yet" while awaiting the first-ever fetch or an Apply/Reset
  // refetch.
  splitCardPending: {
    opacity: 0.7,
  },
  splitCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
  },
  splitCardSubLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
  },
  splitEmptyText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  splitPendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  splitPendingText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    fontStyle: "italic",
  },
  pnlHeadline: {
    fontSize: 18,
    fontWeight: "700",
  },
  pnlPct: {
    fontSize: 13,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  splitButtonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  splitDetailsButton: {
    borderRadius: radii.button,
    borderColor: "rgba(255,255,255,0.4)",
  },
  splitDetailsButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  splitViewButton: {
    borderRadius: radii.button,
    flex: 1,
  },
  splitViewButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  // Small in-flight banner above the (always-rendered) split cards —
  // replaces what used to be a full-page centered spinner that hid the
  // cards outright.
  loadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  loadingBannerText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
  capBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
    backgroundColor: "#FEF3C7",
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  capBannerText: {
    color: colors.warning,
    fontWeight: "600",
    flexShrink: 1,
  },
  benefitsBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  benefitsBannerText: {
    color: colors.primary,
    fontWeight: "600",
    flexShrink: 1,
    fontSize: 13,
  },
  verifyBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
    backgroundColor: colors.infoLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  verifyBannerText: {
    color: colors.info,
    fontWeight: "600",
    flexShrink: 1,
    fontSize: 13,
  },
  verifyBannerActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
});
