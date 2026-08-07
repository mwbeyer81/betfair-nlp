import { Collection, Db } from "mongodb";
import { RaceDoc, synthRaceId } from "./industry-sp-row-mapping";
import { EDGE_BAND_BOUNDS, buildEdgeSummary, ModelVsSpSummary } from "../service/model-vs-sp-summary";
import { BrierStats, BrierSums, EMPTY_BRIER, brierFromSums } from "../service/brier";
import { MODEL_PROB_FIELD, bookSumExpr, brierGroupAccumulators, raceBrierSumsExpr } from "./brier-expr";
import { FavPnlStats, FavSums, EMPTY_FAV_PNL, favPnlFromSums } from "../service/fav-pnl";
import { favGroupAccumulators, raceFavSumsExpr } from "./fav-expr";

export interface IspFilterBounds {
  maxRunnersPerRace: number;
  maxIsp: number;
  minIsp: number;
}

export type IspRunnerStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";

export interface IspRunner {
  id: number;
  name: string;
  num: number | null;
  draw: number | null;
  status: IspRunnerStatus;
  sortPriority: number;
  isp: number | null;
  ispFraction: string | null;
  isFavourite: boolean;
  jockey?: string;
  trainer?: string;
  // Trainer's trailing-14-day form (same race-type category — Flat vs
  // Jumps — as this race), computed as-of this race's own date using only
  // strictly earlier runs, so it never leaks future results into a
  // historical race. Precomputed in src/commands/precompute-trainer-form.ts;
  // absent (undefined) on runners whose trainer field is empty, and
  // trainerFormWinRate is null (not 0) when trainerFormRuns is 0 — that's
  // the "no sample yet" signal the frontend badge uses to omit itself.
  trainerFormRuns?: number;
  trainerFormWins?: number;
  trainerFormWinRate?: number | null;
  trainerFormStaked?: number;
  trainerFormReturns?: number;
  // XGBoost win-probability estimate (0-100, normalized so a race's runners
  // sum to 100) — precomputed in ml/train_and_predict.py, deliberately
  // trained WITHOUT isp/ispFraction/isFavourite as inputs so it's an
  // independent view, not a recalibration of the market's own price.
  // Populated for every runner (no cold-start gap like trainerForm), so
  // undefined only means the precompute hasn't been run at all yet.
  modelWinProbability?: number | null;
  // The same estimate, but produced WITHOUT sight of this race's result —
  // see MODEL_PROB_FIELD below for why every filter on this collection reads
  // this field and never modelWinProbability.
  modelWinProbabilityOos?: number | null;
  // Which training run produced modelWinProbability — set alongside it in
  // ml/train_and_predict.py's per-runner array_filters update. Only ever
  // reflects the MOST RECENT run that scored this runner (each run
  // overwrites both fields together); historical runs can't be
  // reconstructed for runners scored before this field existed.
  modelVersionId?: string | null;
}

// MODEL_PROB_FIELD — the one field every model-vs-SP filter, band, P&L and
// Brier score on this collection judges on — is defined in ./brier-expr and
// imported above, so the filters and the Brier score displayed beside them can
// never drift onto different forecasts. Read its comment there before changing
// anything here.
//
// The same field as an aggregation path, under the two variable bindings this
// file's pipelines use: `$$r` inside every $filter/$map over `runners`, and
// `$mvsRunner` after getModelVsSpRunners has unwound its filtered array.
const MODEL_PROB_R = `$$r.${MODEL_PROB_FIELD}`;
const MODEL_PROB_MVS = `$mvsRunner.${MODEL_PROB_FIELD}`;

export interface IspRace {
  raceId: number;
  meetingId: string;
  meetingName: string;
  course: string;
  countryCode: string;
  raceTime: string;
  raceName: string;
  raceType: string;
  raceClass: string | null;
  going: string | null;
  ran: number;
  runners: IspRunner[];
}

export type ModelVsSpSort = "date_desc" | "date_asc" | "edge_desc" | "edge_asc";

export interface ModelVsSpParams {
  page: number;
  limit: number;
  sort: ModelVsSpSort;
  // Both always supplied, unlike getAllRacesByRace's nullable minRaceTime /
  // maxRaceTime — see getModelVsSpRunners for why this query can never run
  // unbounded.
  minRaceTime: string;
  maxRaceTime: string;
  minModelProb: number;
  maxModelProb: number;
  minImpliedProb: number;
  maxImpliedProb: number;
  // The SIZE of the gap between the model and the market, in percentage points,
  // ignoring direction: |modelWinProbabilityOos - (100 / isp)|. A range of 10-20
  // therefore matches a runner the model rates 12 points above its SP and one it
  // rates 12 points below equally — the question this screen answers is "how far
  // apart are they", not "which way". The signed value is still carried on every
  // row (ModelVsSpRow.edge) and shown in the UI; only the filter is unsigned.
  minAbsEdge: number;
  maxAbsEdge: number;
  minIsp: number;
  maxIsp: number;
  minRunners: number;
  maxRunners: number;
  countries: string[];
  // Skips the (separate, cheaper) count query and returns total: null — a pure
  // page step already knows the total from the request that loaded page 1, so
  // re-counting on every Next would halve this endpoint's throughput for no new
  // information.
  includeTotal: boolean;
}

// One row per qualifying RUNNER, not per race — the whole point of this query,
// and why it can't reuse getAllRacesByRace's race-shaped IspRace output. Every
// runner-level field here is non-null by construction: the filter requires
// isp > 1 and a non-null out-of-sample model probability, so impliedSpProbability and edge
// are always computable.
export interface ModelVsSpRow {
  raceId: number;
  raceTime: string;
  raceDate: string;
  meetingId: string;
  meetingName: string;
  course: string;
  countryCode: string;
  raceName: string;
  raceType: string;
  raceClass: string | null;
  going: string | null;
  runnerId: number;
  runnerName: string;
  num: number | null;
  draw: number | null;
  sortPriority: number;
  status: IspRunnerStatus;
  isp: number;
  ispFraction: string | null;
  isFavourite: boolean;
  jockey: string | null;
  trainer: string | null;
  modelWinProbability: number;
  impliedSpProbability: number;
  edge: number;
  modelVersionId: string | null;
}

// Escapes regex metacharacters so a raw trainer/jockey search string can't be
// interpreted as a regex pattern (both a correctness issue — literal
// characters like "O'Brien" or "St. Leger" would otherwise misbehave — and a
// safety one, since an unescaped user-supplied pattern is a ReDoS vector).
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The per-runner "model beats SP" condition, in the `$$r`-bound $filter form
// every pipeline in this file applies it in. Previously written out inline at
// four separate call sites; shared here so a change to what "beats SP" means
// can't land in three of them and miss the fourth.
//
// minEdgePts is the minimum signed gap, in percentage POINTS, between the
// model's out-of-sample win probability (MODEL_PROB_FIELD — read its comment
// before ever pointing this at modelWinProbability again) and the one the
// runner's industry SP implies (100/isp) — the Mongo counterpart of modelSpEdge() in
// client/src/utils/ispFormat.ts, which the client-side filter and the "+5.0 pts"
// runner badges both go through. At the default 0 this stays exactly the
// strict "any positive edge" test it has always been ($gt 0, not $gte): a
// runner the model rates level with the market isn't beating it.
/**
 * "This runner is the model's top pick in its race" — the model's own
 * favourite, counterpart to `runners[].isFavourite` for the market's.
 *
 * `runnersExpr` is whichever runners array the surrounding stage has to hand:
 * `"$runners"` in buildQualifyingRaceStages, the $lookup-ed
 * `$_doc.runners` in getAllRacesByRace's pnlStats facet. Shared rather than
 * written out twice because the two MUST agree — the first drives the runner
 * COUNT and the second the P&L, and when only one of them had this condition
 * the screen reported 43,909 qualifying runners beside a P&L computed over all
 * 379,860. Every number looked plausible; only the pair was wrong.
 *
 * Two decisions embedded here:
 *
 * 1. The maximum is taken over BACKABLE runners only (isp > 1). A withdrawn or
 *    unpriced runner cannot be a top pick you could act on, and if it were
 *    allowed to hold the maximum then the whole race would silently drop out of
 *    the selection — losing the race rather than backing its best runner.
 * 2. A tie keeps BOTH runners: a genuine dead heat in the model's opinion at
 *    the 2dp these are stored to. Dropping the race loses data for no reason,
 *    and breaking the tie arbitrarily would make the answer depend on document
 *    order.
 *
 * The inner bindings are `mx`/`mr`, never `r`: this is evaluated inside a
 * `$filter` that already binds `$$r`, and reusing that name would shadow it, so
 * every runner would be compared against itself and the whole field would match.
 */
export function modelTopPickCond(runnersExpr: unknown): Record<string, unknown>[] {
  const backableRunners = {
    $filter: {
      input: runnersExpr,
      as: "mx",
      cond: { $and: [{ $ifNull: ["$$mx.isp", false] }, { $gt: ["$$mx.isp", 1] }] },
    },
  };
  return [
    { $ne: [MODEL_PROB_R, null] },
    // $max skips nulls, so an unscored runner can never hold the maximum.
    {
      $eq: [
        MODEL_PROB_R,
        { $max: { $map: { input: backableRunners, as: "mr", in: `$$mr.${MODEL_PROB_FIELD}` } } },
      ],
    },
  ];
}

export function modelBeatsSpCond(minEdgePts: number): Record<string, unknown>[] {
  const edgeExpr = { $subtract: [MODEL_PROB_R, { $divide: [100, "$$r.isp"] }] };
  return [
    { $ne: [MODEL_PROB_R, null] },
    { $ne: ["$$r.isp", null] },
    { $gt: ["$$r.isp", 0] },
    minEdgePts > 0 ? { $gte: [edgeExpr, minEdgePts] } : { $gt: [edgeExpr, 0] },
  ];
}

interface IspRaceDocument extends IspRace {
  _id: number;
}

export class IndustrySpDAO {
  private collection: Collection<IspRaceDocument>;
  private collectionName: string;

  constructor(db: Db, collectionName = "industry_starting_prices") {
    this.collection = db.collection<IspRaceDocument>(collectionName);
    this.collectionName = collectionName;
  }

  /**
   * Builds the race-matching + per-race qualifying-count stages shared by
   * getAllRacesByRace and getRaceConvergenceSeries — extracted so the two
   * can never drift apart on what counts as "a matching race" /
   * "a qualifying runner". Returns the $match (scalar filters + isp-range
   * runner count) + $addFields (qualifying-count expressions) + $match
   * (threshold expr) trio; callers add their own leading date/sort stages
   * and trailing $project.
   */
  private buildQualifyingRaceStages(p: {
    countries: string[];
    minRunners: number;
    maxRunners: number;
    minIsp: number;
    maxIsp: number;
    minInIspRange: number;
    maxInIspRange: number;
    courses: string[];
    goings: string[];
    raceClasses: string[];
    raceTypes: string[];
    trainerSearch: string | null;
    jockeySearch: string | null;
    runnerName: string | null;
    trainerFormMinWinRate: number;
    minTrainerFormRunners: number;
    maxTrainerFormRunners: number;
    minModelWinProbability: number;
    onlyModelBeatsSp: boolean;
    // Minimum model-vs-SP edge in percentage points. > 0 activates the
    // model-beats-SP filter on its own, without onlyModelBeatsSp also being
    // set — unlike the trainerFormMinWinRate/minTrainerFormRunners pair above,
    // where the checkbox tests a different thing (does form exist at all) from
    // the number. Here the two are the same dimension, so a threshold with the
    // checkbox left off would otherwise silently do nothing.
    minModelSpEdgePts: number;
    // Keeps only the single runner the model rates highest in each race — the
    // model's own favourite, counterpart to `runners[].isFavourite` for the
    // market's.
    //
    // Deliberately NOT expressible through minModelWinProbability, which is an
    // absolute threshold: the top pick in a 5-runner race might be 40% and in a
    // 16-runner handicap 12%, so any single threshold takes several runners
    // from small fields and none at all from big ones. It selects on
    // confidence, not on rank — the same absolute-vs-relative confusion the
    // model itself had before the within-race features were added.
    onlyModelTopPick: boolean;
    modelVersionId: string | null;
    // Adds the two per-race Brier accumulator fields (`_bookSum`, `_brier`)
    // to the emitted $addFields. Opt-in rather than always-on because each is
    // an extra pass over every matched race's runners array, and the
    // convergence-graph query — the one caller that reads none of it — runs
    // over the same ~109k-race scale as the rest.
    includeBrier?: boolean;
    // Adds the per-race favourite-backed baseline field (`_fav`) to the emitted
    // $addFields. Opt-in on the same terms as includeBrier: two more passes over
    // every matched race's runners array, which the convergence-graph caller has
    // no use for.
    //
    // Deliberately NOT given the qualifying-runner condition every field beside
    // it is built from — see src/lib/service/fav-pnl.ts for why a baseline
    // narrowed by the filters it benchmarks would stop being a baseline.
    includeFav?: boolean;
  }): Record<string, unknown>[] {
    const countryMatch = p.countries.length > 0 ? { countryCode: { $in: p.countries } } : {};
    const courseMatch = p.courses.length > 0 ? { course: { $in: p.courses } } : {};
    const goingMatch = p.goings.length > 0 ? { going: { $in: p.goings } } : {};
    const raceClassMatch = p.raceClasses.length > 0 ? { raceClass: { $in: p.raceClasses } } : {};
    const raceTypeMatch = p.raceTypes.length > 0 ? { raceType: { $in: p.raceTypes } } : {};

    const runnerTextMatches: Record<string, unknown>[] = [];
    if (p.trainerSearch) {
      runnerTextMatches.push({
        runners: { $elemMatch: { trainer: { $regex: `^${escapeRegex(p.trainerSearch)}`, $options: "i" } } },
      });
    }
    if (p.jockeySearch) {
      runnerTextMatches.push({
        runners: { $elemMatch: { jockey: { $regex: `^${escapeRegex(p.jockeySearch)}`, $options: "i" } } },
      });
    }
    if (p.runnerName) {
      runnerTextMatches.push({
        runners: { $elemMatch: { name: { $regex: `^${escapeRegex(p.runnerName)}$`, $options: "i" } } },
      });
    }
    const runnerTextMatch = runnerTextMatches.length > 0 ? { $and: runnerTextMatches } : {};

    const runnersInRangeFilter = {
      $filter: {
        input: "$runners",
        as: "r",
        cond: {
          $and: [
            { $ifNull: ["$$r.isp", false] },
            { $gt: ["$$r.isp", 1] },
            { $gte: ["$$r.isp", p.minIsp] },
            { $lte: ["$$r.isp", p.maxIsp] },
          ],
        },
      },
    };

    const ispRangeCoversAllRealValues = p.minIsp <= 1 && p.maxIsp >= 1000;
    const inRangeRunnersCountExpr = ispRangeCoversAllRealValues
      ? "$runnersWithIspCount"
      : { $size: runnersInRangeFilter };

    const trainerFormFilterActive = p.minTrainerFormRunners > 0 || p.maxTrainerFormRunners < 100;
    const trainerFormCond = [
      { $ne: ["$$r.trainerFormWinRate", null] },
      { $gte: ["$$r.trainerFormWinRate", p.trainerFormMinWinRate] },
    ];
    const trainerFormQualifyingCountExpr = trainerFormFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: trainerFormCond } } } }
      : 0;

    const modelFilterActive = p.minModelWinProbability > 0;
    const modelCond = [
      { $ne: [MODEL_PROB_R, null] },
      { $gte: [MODEL_PROB_R, p.minModelWinProbability] },
    ];
    const modelQualifyingCountExpr = modelFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: modelCond } } } }
      : 0;

    const modelBeatsSpFilterActive = p.onlyModelBeatsSp || p.minModelSpEdgePts > 0;
    const beatsSpCond = modelBeatsSpCond(p.minModelSpEdgePts);
    const modelBeatsSpQualifyingCountExpr = modelBeatsSpFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: beatsSpCond } } } }
      : 0;

    const topPickFilterActive = p.onlyModelTopPick;
    const topPickCond = modelTopPickCond("$runners");
    const topPickQualifyingCountExpr = topPickFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: topPickCond } } } }
      : 0;

    // Which training run scored a runner — set alongside modelWinProbability
    // in ml/train_and_predict.py, so only ever reflects the most recent run
    // (see the modelVersionId comment on IspRunner). Filtering by it lets the
    // dashboard scope a version's own P&L to runners it actually scored,
    // rather than every runner regardless of which run touched them last.
    const modelVersionFilterActive = p.modelVersionId != null;
    const modelVersionCond = [{ $eq: ["$$r.modelVersionId", p.modelVersionId] }];
    const modelVersionQualifyingCountExpr = modelVersionFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: modelVersionCond } } } }
      : 0;

    // Combined per-runner qualifying count: isp-in-range AND every currently
    // active runner-level filter, jointly (not independently) — mirrors
    // IspRacesScreen.tsx's client-side qualifyingRunners() exactly, unlike
    // the three counts above (each only proves "at least one runner
    // satisfies THIS filter", not that a single runner satisfies all of them
    // at once). Backs the totalRunners stat. Fast path: identical to
    // inRangeRunnersCount when none of the three optional filters are active.
    const qualifyingRunnersFilterActive =
      trainerFormFilterActive || modelFilterActive || modelBeatsSpFilterActive ||
      modelVersionFilterActive || topPickFilterActive;
    // The single definition of "this runner is in the filtered set", in the
    // $$r-bound form. Previously written out inline for the count below; now
    // also handed to raceBrierSumsExpr, so the Brier score can never end up
    // describing a different set of horses from the one the P&L and the
    // "Runners" count describe.
    const qualifyingRunnerCond = {
      $and: [
        { $ifNull: ["$$r.isp", false] },
        { $gt: ["$$r.isp", 1] },
        { $gte: ["$$r.isp", p.minIsp] },
        { $lte: ["$$r.isp", p.maxIsp] },
        ...(trainerFormFilterActive ? trainerFormCond : []),
        ...(modelFilterActive ? modelCond : []),
        ...(modelBeatsSpFilterActive ? beatsSpCond : []),
        ...(modelVersionFilterActive ? modelVersionCond : []),
        ...(topPickFilterActive ? topPickCond : []),
      ],
    };
    const qualifyingRunnersCountExpr = qualifyingRunnersFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: qualifyingRunnerCond } } }
      : inRangeRunnersCountExpr;

    // Its own stage, ahead of the one below, because $addFields cannot
    // reference a field it is defining in the same stage and a fair (overround-
    // normalised) probability is undefined until the race's book total is
    // known. Inlining the book sum into _brier instead would recompute it once
    // per runner — O(runners^2) per race, for a number that is constant across
    // the race.
    const bookSumStage: Record<string, unknown>[] = p.includeBrier
      ? [{ $addFields: { _bookSum: bookSumExpr("$runners", "isp") } }]
      : [];

    return [
      {
        $match: {
          ...countryMatch,
          ...courseMatch,
          ...goingMatch,
          ...raceClassMatch,
          ...raceTypeMatch,
          ...runnerTextMatch,
          runnersWithIspCount: { $gte: p.minRunners, $lte: p.maxRunners },
        },
      },
      ...bookSumStage,
      {
        $addFields: {
          allRunnersCount: "$runnersWithIspCount",
          inRangeRunnersCount: inRangeRunnersCountExpr,
          trainerFormQualifyingCount: trainerFormQualifyingCountExpr,
          modelQualifyingCount: modelQualifyingCountExpr,
          modelBeatsSpQualifyingCount: modelBeatsSpQualifyingCountExpr,
          modelVersionQualifyingCount: modelVersionQualifyingCountExpr,
          qualifyingRunnersCount: qualifyingRunnersCountExpr,
          ...(p.includeBrier
            ? {
                _brier: raceBrierSumsExpr({
                  runnersPath: "$runners",
                  priceField: "isp",
                  modelProbField: MODEL_PROB_FIELD,
                  qualifyingCondExpr: qualifyingRunnerCond,
                  bookSumPath: "$_bookSum",
                }),
              }
            : {}),
          ...(p.includeFav ? { _fav: raceFavSumsExpr({ runnersPath: "$runners", priceField: "isp" }) } : {}),
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$inRangeRunnersCount", p.minInIspRange] },
              { $lte: ["$inRangeRunnersCount", p.maxInIspRange] },
              { $gte: ["$trainerFormQualifyingCount", p.minTrainerFormRunners] },
              { $lte: ["$trainerFormQualifyingCount", p.maxTrainerFormRunners] },
              { $gte: ["$modelQualifyingCount", modelFilterActive ? 1 : 0] },
              { $gte: ["$modelBeatsSpQualifyingCount", modelBeatsSpFilterActive ? 1 : 0] },
              { $gte: ["$modelVersionQualifyingCount", modelVersionFilterActive ? 1 : 0] },
            ],
          },
        },
      },
    ];
  }

  /**
   * Return all races grouped by meeting, sorted chronologically.
   * Runners with no parseable ISP (isp === null) are excluded, mirroring how
   * REMOVED/missing-bsp runners are excluded on the Betfair-SP equivalent.
   */
  public async getAllRacesByRace(
    page = 1,
    limit = 20,
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    sortOrder: "asc" | "desc" = "asc",
    minInIspRange = 1,
    maxInIspRange = 1000,
    fromRowRaw = 1,
    toRow: number | null = null,
    minRaceTime: string | null = null,
    maxRaceTime: string | null = null,
    courses: string[] = [],
    goings: string[] = [],
    raceClasses: string[] = [],
    raceTypes: string[] = [],
    trainerSearch: string | null = null,
    jockeySearch: string | null = null,
    trainerFormMinWinRate = 0,
    minTrainerFormRunners = 0,
    maxTrainerFormRunners = 100,
    runnerName: string | null = null,
    minModelWinProbability = 0,
    onlyModelBeatsSp = false,
    modelVersionId: string | null = null,
    // Applied AFTER fromRow/toRow's row-range window (below), unlike
    // minRaceTime/maxRaceTime above which applies BEFORE it (and so
    // participates in defining what "row N" even means). Lets a caller ask
    // "just the races in this calendar year, within this already-fixed
    // row range" as a normal small paginated query — see IspRacesScreen's
    // per-year loading, which calls this once per expanded year instead of
    // walking the whole row range forward from page 1 to "discover" a
    // distant year (the isp-year-walk-error/isp-year-direct-load history).
    subMinRaceTime: string | null = null,
    subMaxRaceTime: string | null = null,
    minModelSpEdgePts = 0,
    onlyModelTopPick = false,
    // Adds level-stakes sums (£1 flat per runner) alongside the to-win-£1 ones
    // this file computes everywhere else. Opt-in, because it forces the
    // $unwind path: the fast path reads the precomputed raceStaked/raceReturns
    // fields and there is no precomputed level-stakes counterpart to read.
    includeLevelStakes = false
  ): Promise<{
    data: IspRace[];
    total: number;
    totalRunners: number;
    pnlStats: { staked: number; returns: number; pnl: number; count: number };
    // Present only when includeLevelStakes was asked for. £1 flat on every
    // qualifying runner, returning `isp` on a winner.
    //
    // Why this is not merely a display preference: to-win-£1 stakes 1/(isp-1),
    // which puts ~20% of the money on the under-2.0 band and ~4% on the 20.0+
    // band, where level stakes puts 2% and 28%. Since the overround is far
    // worse on longshots, the two report very different aggregate ROIs for the
    // SAME bets (-11.69% vs -22.94% for backing every runner) while agreeing
    // closely WITHIN each price band. That gap is bet sizing, not selection
    // quality — which is why a slice profitable under only one of them is
    // noise, and why both need to be visible to tell the difference.
    levelPnl?: { staked: number; returns: number; pnl: number };
    brier: BrierStats;
    // Always present, unlike levelPnl — it needs no opt-in because it is a
    // $group over five scalars the pipeline already carries, and every surface
    // that shows a filtered P&L wants the baseline beside it. `count: 0` is the
    // "no answer" signal (see favPnlFromSums), never "broke even".
    favPnl: FavPnlStats;
  }> {
    // fromRow < 1 would make rowSkip negative below — another shape
    // MongoDB's $skip rejects outright, same class of bug as the inverted
    // range guard just below. Clamping here (rather than trusting every
    // caller to have already validated it) is defense in depth: this
    // method's fromRow/toRow can originate from raw, unvalidated query
    // params (see the router) or a stale/hand-edited URL.
    const fromRow = Math.max(1, fromRowRaw);

    // An inverted range (toRow < fromRow) has no matching rows by
    // definition — short-circuit to an empty result instead of letting
    // rowLimit go negative below. A negative $limit isn't just "wrong",
    // it's a hard MongoDB error (code 5107201, "invalid argument to
    // $limit stage"), which surfaced live as a 500 / "Failed to load
    // industry SP" whenever a stale or hand-edited fromRow/toRow (or
    // fromRowA/toRowA — see getSplitStats, which calls this) reached here.
    if (toRow !== null && toRow < fromRow) {
      return { data: [], total: 0, totalRunners: 0, pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 }, brier: EMPTY_BRIER, favPnl: EMPTY_FAV_PNL };
    }

    const raceTimeSortDir = sortOrder === "desc" ? -1 : 1;

    // Narrows the matched set by calendar date *before* anything else in
    // the pipeline (including the row-range $sort below) — raceTime is a
    // plain ISO string, so lexicographic $gte/$lte comparison matches
    // chronological order. Leading with this on the same field the
    // row-range $sort also uses lets MongoDB serve both from one bounded
    // walk of the {raceTime:1} index (the same shape as
    // find({raceTime:{$gte,$lte}}).sort({raceTime:1})) instead of two
    // separate operations — so this doesn't reintroduce the blocking-sort
    // risk the leading-$sort-must-be-first fix above was written to avoid.
    const dateMatchStage: Record<string, unknown>[] =
      minRaceTime != null || maxRaceTime != null
        ? [
            {
              $match: {
                raceTime: {
                  ...(minRaceTime != null ? { $gte: minRaceTime } : {}),
                  ...(maxRaceTime != null ? { $lte: maxRaceTime } : {}),
                },
              },
            },
          ]
        : [];

    const rowSkip = fromRow - 1;
    const rowLimit = toRow !== null ? toRow - fromRow + 1 : null;
    // A row range means "row N of the current sort order", so applying it
    // requires a $sort. With no fromRow/toRow narrowing (the common case),
    // no extra sort stage is added here at all — the no-range case is
    // handled entirely by dataPageStages below.
    //
    // When a range IS active, `raceTime` is indexed ({raceTime: 1}, see
    // createIndexes below), but only if the $sort is the *first* stage in
    // the pipeline — MongoDB can then walk the index directly instead of
    // buffering an in-memory sort, so $match/$addFields/$skip/$limit
    // afterwards cost O(1) memory regardless of collection size. Putting
    // the $sort anywhere after basePipeline's $match/$addFields (as this
    // used to) forces a blocking in-memory sort instead — confirmed live:
    // that blocking sort works up to ~40k matching docs but exceeds Atlas
    // M0's 32MB in-memory sort limit above ~45k, well under this
    // collection's real size (~109k) — and `allowDiskUse` can't rescue it,
    // since Atlas M0/M2/M5 silently ignore that option. Leading with the
    // indexed $sort avoids the blocking sort altogether, at any range size.
    const rowRangeActive = rowSkip > 0 || rowLimit !== null;
    const leadingSortStage: Record<string, unknown>[] = rowRangeActive
      ? [{ $sort: { raceTime: raceTimeSortDir } }]
      : [];
    const rowRangeStages: Record<string, unknown>[] = [];
    if (rowSkip > 0) rowRangeStages.push({ $skip: rowSkip });
    if (rowLimit !== null) rowRangeStages.push({ $limit: rowLimit });

    // Restricts the already row-ranged window down to a calendar
    // sub-range — e.g. "just 2025's races within Split B's rows
    // 4925-9848". Placed after rowRangeStages (so it can't change what
    // "row N" means) and before $facet (so total/totalRunners/pnlStats
    // below all reflect this sub-range too, not just the "data" page —
    // the whole point is that a caller can page through *this year alone*
    // the same way it would page through the unscoped row range).
    const subDateMatchStage: Record<string, unknown>[] =
      subMinRaceTime != null || subMaxRaceTime != null
        ? [
            {
              $match: {
                raceTime: {
                  ...(subMinRaceTime != null ? { $gte: subMinRaceTime } : {}),
                  ...(subMaxRaceTime != null ? { $lte: subMaxRaceTime } : {}),
                },
              },
            },
          ]
        : [];

    // Once rowRangeStages has already sorted+skipped+limited the input
    // ahead of $facet, the "data" branch only needs to page within that
    // already-ordered subset — page skip/limit alone, no re-sort.
    const dataPageStages: Record<string, unknown>[] = rowRangeActive
      ? [{ $skip: (page - 1) * limit }, { $limit: limit }]
      : [
          { $sort: { raceTime: raceTimeSortDir } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ];

    // Still needed locally for the pnlStats fast-path decision below
    // (buildQualifyingRaceStages uses the same expression internally for
    // inRangeRunnersCount, but doesn't expose it — trivial to recompute).
    const ispRangeCoversAllRealValues = minIsp <= 1 && maxIsp >= 1000;

    // Same "any of the three optional runner-level filters active" check
    // buildQualifyingRaceStages makes internally for qualifyingRunnersCount
    // (also not exposed — recomputed here). Needed so pnlStats' own fast
    // path only fires when NOTHING narrows the runner set below "every isp
    // in range" — trainer-form/model/model-beats-SP being active must also
    // force the $unwind fallback, same as a narrowed isp range does, or the
    // precomputed raceStaked/raceReturns fields (which don't know about
    // those filters at all) would silently include disqualified runners.
    const trainerFormFilterActive = minTrainerFormRunners > 0 || maxTrainerFormRunners < 100;
    const modelFilterActive = minModelWinProbability > 0;
    const modelBeatsSpFilterActive = onlyModelBeatsSp || minModelSpEdgePts > 0;
    const modelVersionFilterActive = modelVersionId != null;
    const qualifyingRunnersFilterActive =
      trainerFormFilterActive || modelFilterActive || modelBeatsSpFilterActive ||
      modelVersionFilterActive || onlyModelTopPick;

    // Only a per-race id + sort key + the qualifying counts survive into
    // the $facet — every other field (course, meetingName, runners, ...) is
    // re-fetched via $lookup after sorting/paginating down to a handful of
    // docs, never before. This keeps every $sort in this pipeline operating
    // on a ~40-byte doc regardless of collection size. The leading $match
    // (inside buildQualifyingRaceStages) filters on the plain, indexed
    // runnersWithIspCount field directly (not $expr) so it can use the
    // index — this replaces what used to be a $filter/$size scan over
    // every race's embedded runners array on every single request.
    const basePipeline = [
      ...dateMatchStage,
      ...leadingSortStage,
      ...this.buildQualifyingRaceStages({
        countries, minRunners, maxRunners, minIsp, maxIsp, minInIspRange, maxInIspRange,
        courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch, runnerName,
        trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
        minModelWinProbability, onlyModelBeatsSp, minModelSpEdgePts, onlyModelTopPick, modelVersionId,
        includeBrier: true,
        includeFav: true,
      }),
      {
        $project: {
          _id: 1,
          raceTime: 1,
          allRunnersCount: 1,
          inRangeRunnersCount: 1,
          qualifyingRunnersCount: 1,
          raceStaked: 1,
          raceReturns: 1,
          // Five more per-race scalars, on exactly the same terms as `_brier`
          // below — reduced from the runners array before this $project, so the
          // favPnl branch is a $group over numbers already in hand rather than
          // another $lookup back to the full document.
          _fav: 1,
          // Four scalars per race, already reduced from the runners array
          // above — carrying these through the sort costs the same order of
          // bytes as raceStaked/raceReturns beside them, and saves the Brier
          // branch below from needing its own $lookup back to the full doc.
          _brier: 1,
        },
      },
    ];

    const reattachFullDoc = [
      { $lookup: { from: this.collectionName, localField: "_id", foreignField: "_id", as: "_docs" } },
      { $addFields: { _doc: { $arrayElemAt: ["$_docs", 0] } } },
      {
        $addFields: {
          raceId: "$_doc.raceId",
          meetingId: "$_doc.meetingId",
          meetingName: "$_doc.meetingName",
          course: "$_doc.course",
          countryCode: "$_doc.countryCode",
          raceName: "$_doc.raceName",
          raceType: "$_doc.raceType",
          raceClass: "$_doc.raceClass",
          going: "$_doc.going",
          ran: "$_doc.ran",
          runners: {
            $sortArray: {
              input: {
                $filter: {
                  input: { $ifNull: ["$_doc.runners", []] },
                  as: "r",
                  cond: {
                    $and: [
                      { $ifNull: ["$$r.isp", false] },
                      { $gt: ["$$r.isp", 1] },
                      { $gte: ["$$r.isp", minIsp] },
                      { $lte: ["$$r.isp", maxIsp] },
                    ],
                  },
                },
              },
              sortBy: { sortPriority: 1 },
            },
          },
        },
      },
    ];

    const [result] = await this.collection
      .aggregate<{
        data: IspRace[];
        total: [{ count: number }];
        totalRunners: [{ count: number }];
        pnlStats: [{ staked: number; returns: number; count: number; levelStaked?: number; levelReturns?: number }];
        brier: [BrierSums];
        favPnl: [FavSums];
      }>([
        ...basePipeline,
        // Applied once, ahead of $facet, when a row range is active — see
        // the rowRangeStages comment above for why this can't live inside
        // the facet branches below (that would re-run the sort per branch).
        ...rowRangeStages,
        ...subDateMatchStage,
        {
          $facet: {
            data: [
              ...dataPageStages,
              ...reattachFullDoc,
              {
                $project: {
                  _id: 0,
                  raceId: 1,
                  meetingId: 1,
                  meetingName: 1,
                  course: 1,
                  countryCode: 1,
                  raceTime: 1,
                  raceName: 1,
                  raceType: 1,
                  raceClass: 1,
                  going: 1,
                  ran: 1,
                  runners: 1,
                },
              },
            ],
            total: [{ $count: "count" }],
            // Sums qualifyingRunnersCount (isp-in-range AND every currently
            // active runner-level filter, jointly) rather than
            // inRangeRunnersCount — so this reflects the same runner set
            // IspRacesScreen.tsx's client-side qualifyingRunners() actually
            // displays, not just the isp-range filter. Identical to the old
            // sum whenever none of the trainer-form/model/model-beats-SP
            // filters are active (see buildQualifyingRaceStages' fast path).
            totalRunners: [{ $group: { _id: null, count: { $sum: "$qualifyingRunnersCount" } } }],
            // Fast path: raceStaked/raceReturns are precomputed at import time
            // over the same static isp>1 runner set as runnersWithIspCount, so
            // whenever NOTHING narrows the runner set below "every isp in
            // range" — neither the isp range itself nor any of the trainer-
            // form/model/model-beats-SP filters, none of which those
            // precomputed fields know about — this is a plain $sum over
            // already-matched docs. No $lookup, no $unwind over every runner
            // in every matched race (that $lookup was previously the single
            // largest cost in this whole query, since it re-fetched all
            // ~109k matched races' full runners arrays on every request).
            // Regression: reported live — pnlStats.count came out roughly
            // double totalRunners (2992 vs 1589) with "Model beats SP"
            // checked and an isp range that still covered every real value,
            // because this condition only ever checked the isp range,
            // silently taking the fast path (and its filter-blind
            // precomputed fields) even though model-beats-SP was actively
            // narrowing the runner set everywhere else.
            // `includeLevelStakes` joins the list of things that disqualify the
            // fast path, for the same reason the filters do: the precomputed
            // raceStaked/raceReturns are to-win-£1 only, and there is no
            // precomputed level-stakes counterpart to sum.
            pnlStats: ispRangeCoversAllRealValues && !qualifyingRunnersFilterActive && !includeLevelStakes
              ? [
                  {
                    $group: {
                      _id: null,
                      staked: { $sum: "$raceStaked" },
                      returns: { $sum: "$raceReturns" },
                      count: { $sum: "$inRangeRunnersCount" },
                    },
                  },
                ]
              : [
                  // Deliberately its own $lookup + qualifying-runner $filter
                  // rather than reusing reattachFullDoc's runners field —
                  // that field is isp-range-filtered only (intentionally: it
                  // also backs the `data` branch above, which must keep
                  // showing every isp-in-range runner on /isp/races, not
                  // just the narrower qualifying subset). pnlStats needs the
                  // *qualifying* set specifically, to reconcile with
                  // totalRunners' own qualifyingRunnersCount above — same
                  // condition as buildQualifyingRaceStages' internal
                  // qualifyingRunnersCountExpr, duplicated for the same
                  // reason getRaceConvergenceSeries duplicates it (that
                  // method's fast path skips $filter entirely, so it has
                  // nothing to share here).
                  { $lookup: { from: this.collectionName, localField: "_id", foreignField: "_id", as: "_docs" } },
                  { $addFields: { _doc: { $arrayElemAt: ["$_docs", 0] } } },
                  {
                    $addFields: {
                      qualifyingRunners: {
                        $filter: {
                          input: { $ifNull: ["$_doc.runners", []] },
                          as: "r",
                          cond: {
                            $and: [
                              { $ifNull: ["$$r.isp", false] },
                              { $gt: ["$$r.isp", 1] },
                              { $gte: ["$$r.isp", minIsp] },
                              { $lte: ["$$r.isp", maxIsp] },
                              ...(trainerFormFilterActive
                                ? [
                                    { $ne: ["$$r.trainerFormWinRate", null] },
                                    { $gte: ["$$r.trainerFormWinRate", trainerFormMinWinRate] },
                                  ]
                                : []),
                              ...(modelFilterActive
                                ? [
                                    { $ne: [MODEL_PROB_R, null] },
                                    { $gte: [MODEL_PROB_R, minModelWinProbability] },
                                  ]
                                : []),
                              ...(modelBeatsSpFilterActive ? modelBeatsSpCond(minModelSpEdgePts) : []),
                              ...(modelVersionFilterActive ? [{ $eq: ["$$r.modelVersionId", modelVersionId] }] : []),
                              // Over $_doc.runners, the $lookup-ed full array —
                              // NOT the isp-range-filtered one this $filter is
                              // walking, or the "top pick" would mean "top pick
                              // among runners in the price range".
                              ...(onlyModelTopPick
                                ? modelTopPickCond({ $ifNull: ["$_doc.runners", []] })
                                : []),
                            ],
                          },
                        },
                      },
                    },
                  },
                  { $unwind: "$qualifyingRunners" },
                  {
                    $group: {
                      _id: null,
                      staked: { $sum: { $divide: [1, { $subtract: ["$qualifyingRunners.isp", 1] }] } },
                      returns: {
                        $sum: {
                          $cond: [
                            { $eq: ["$qualifyingRunners.status", "WINNER"] },
                            { $add: [{ $divide: [1, { $subtract: ["$qualifyingRunners.isp", 1] }] }, 1] },
                            0,
                          ],
                        },
                      },
                      // £1 flat per runner, returning the price on a winner.
                      // Always accumulated on this path — it is two more $sums
                      // over rows already unwound, so gating it would cost more
                      // in branching than it saves.
                      levelStaked: { $sum: 1 },
                      levelReturns: {
                        $sum: {
                          $cond: [
                            { $eq: ["$qualifyingRunners.status", "WINNER"] },
                            "$qualifyingRunners.isp",
                            0,
                          ],
                        },
                      },
                      count: { $sum: 1 },
                    },
                  },
                ],
            // Its own branch rather than extra accumulators on pnlStats above,
            // for two independent reasons. First, pnlStats has two shapes and
            // the slow one $unwinds — the per-race _brier scalars would be
            // duplicated once per qualifying runner and silently multiplied.
            // Second, this branch is identical either way, so the Brier score
            // cannot drift depending on which P&L path a given filter
            // combination happens to take. $facet feeds every branch the same
            // (already row-ranged, already sub-date-filtered) documents, so
            // this covers exactly the runner set pnlStats does.
            brier: [{ $group: { _id: null, ...brierGroupAccumulators("_brier") } }],
            // The market baseline: back each of THESE races' favourite, ignore
            // the filters. Its own branch for the same two reasons brier has
            // one — pnlStats' slow path $unwinds, which would multiply these
            // per-race scalars once per qualifying runner, and a baseline that
            // silently changed shape depending on which P&L path a filter
            // combination happened to take would be unusable as a baseline.
            favPnl: [{ $group: { _id: null, ...favGroupAccumulators("_fav") } }],
          },
        },
      ], { allowDiskUse: true })
      .toArray();

    const staked = result?.pnlStats?.[0]?.staked ?? 0;
    const returns = result?.pnlStats?.[0]?.returns ?? 0;
    const count = result?.pnlStats?.[0]?.count ?? 0;
    // Only present on the $unwind path, which includeLevelStakes forces — so
    // an absent value here means "not asked for", never "zero". Defaulting it
    // to 0 would render as a break-even level-stakes book rather than as no
    // answer, which is the same null-vs-zero trap brier already documents.
    const levelStaked = result?.pnlStats?.[0]?.levelStaked;
    const levelReturns = result?.pnlStats?.[0]?.levelReturns;

    return {
      data: result?.data ?? [],
      total: result?.total?.[0]?.count ?? 0,
      totalRunners: result?.totalRunners?.[0]?.count ?? 0,
      pnlStats: { staked, returns, pnl: returns - staked, count },
      ...(includeLevelStakes && typeof levelStaked === "number" && typeof levelReturns === "number"
        ? { levelPnl: { staked: levelStaked, returns: levelReturns, pnl: levelReturns - levelStaked } }
        : {}),
      brier: brierFromSums(result?.brier?.[0]),
      favPnl: favPnlFromSums(result?.favPnl?.[0]),
    };
  }

  /**
   * Qualifying-runner P&L for a single date, grouped by race (not meeting)
   * — the live counterpart to getAllRacesByRace's pnlStats, used by
   * LiveFilterResultService to turn one day's just-captured RacingAPI
   * results into a per-race rollup for a saved filter set. Per-race (not
   * pre-aggregated per-meeting) so the frontend can build the same
   * Meeting → Race tap-through hierarchy IspRacesScreen.tsx's Races view
   * already has, via the same client-side buildHierarchy grouping — meeting/
   * day/month/year rollups are a derived sum over these race rows, not
   * computed here. Scoped to one date at a time (called once/day per filter
   * set from the results-capture cron), so unlike getAllRacesByRace this has
   * no pagination/row-range concerns — every matching race for the date is
   * small enough (a UK racing day is on the order of tens of races) to
   * filter+group in one pass, no $facet/$lookup-back-to-full-doc
   * optimization needed.
   *
   * Matches on `raceTime` (not `raceDate`) to reuse the existing
   * `{raceTime: 1}` index — `raceDate` itself has no index of its own, and
   * raceTime's "YYYY-MM-DDTHH:mm:ss" prefix makes a same-day range query
   * exactly equivalent to a raceDate equality match.
   */
  public async getQualifyingRacesForDate(p: {
    raceDate: string;
    countries: string[];
    minRunners: number;
    maxRunners: number;
    minIsp: number;
    maxIsp: number;
    minInIspRange: number;
    maxInIspRange: number;
    courses: string[];
    goings: string[];
    raceClasses: string[];
    raceTypes: string[];
    trainerSearch: string | null;
    jockeySearch: string | null;
    trainerFormMinWinRate: number;
    minTrainerFormRunners: number;
    maxTrainerFormRunners: number;
    minModelWinProbability: number;
    onlyModelBeatsSp: boolean;
    minModelSpEdgePts?: number;
  }): Promise<
    {
      raceId: number;
      raceTime: string;
      raceName: string;
      meetingId: string;
      meetingName: string;
      raceDate: string;
      modelVersionId: string | null;
      pnlStats: { staked: number; returns: number; pnl: number; count: number };
      // Raw sums, not a scored BrierStats, precisely because this is per-race:
      // the Live Performance rollup adds these up across every captured day
      // before dividing once (see sumBrierSums). Storing per-race means and
      // averaging them would weight a 5-runner race like a 16-runner one.
      brierSums: BrierSums;
    }[]
  > {
    const trainerFormFilterActive = p.minTrainerFormRunners > 0 || p.maxTrainerFormRunners < 100;
    const modelFilterActive = p.minModelWinProbability > 0;
    const minModelSpEdgePts = p.minModelSpEdgePts ?? 0;
    const modelBeatsSpFilterActive = p.onlyModelBeatsSp || minModelSpEdgePts > 0;

    const pipeline: Record<string, unknown>[] = [
      { $match: { raceTime: { $gte: `${p.raceDate}T00:00:00`, $lte: `${p.raceDate}T23:59:59` } } },
      ...this.buildQualifyingRaceStages({
        countries: p.countries,
        minRunners: p.minRunners,
        maxRunners: p.maxRunners,
        minIsp: p.minIsp,
        maxIsp: p.maxIsp,
        minInIspRange: p.minInIspRange,
        maxInIspRange: p.maxInIspRange,
        courses: p.courses,
        goings: p.goings,
        raceClasses: p.raceClasses,
        raceTypes: p.raceTypes,
        trainerSearch: p.trainerSearch,
        jockeySearch: p.jockeySearch,
        runnerName: null,
        trainerFormMinWinRate: p.trainerFormMinWinRate,
        minTrainerFormRunners: p.minTrainerFormRunners,
        maxTrainerFormRunners: p.maxTrainerFormRunners,
        minModelWinProbability: p.minModelWinProbability,
        onlyModelBeatsSp: p.onlyModelBeatsSp,
        minModelSpEdgePts,
        onlyModelTopPick: false,
        modelVersionId: null,
        includeBrier: true,
      }),
      // Same qualifying-runner condition as getAllRacesByRace's pnlStats slow
      // path (see the comment there) — duplicated for the same reason: this
      // method scopes to the *qualifying* runner set, distinct from any
      // isp-range-only runners field a caller elsewhere might reuse.
      {
        $addFields: {
          qualifyingRunners: {
            $filter: {
              input: "$runners",
              as: "r",
              cond: {
                $and: [
                  { $ifNull: ["$$r.isp", false] },
                  { $gt: ["$$r.isp", 1] },
                  { $gte: ["$$r.isp", p.minIsp] },
                  { $lte: ["$$r.isp", p.maxIsp] },
                  ...(trainerFormFilterActive
                    ? [
                        { $ne: ["$$r.trainerFormWinRate", null] },
                        { $gte: ["$$r.trainerFormWinRate", p.trainerFormMinWinRate] },
                      ]
                    : []),
                  ...(modelFilterActive
                    ? [
                        { $ne: [MODEL_PROB_R, null] },
                        { $gte: [MODEL_PROB_R, p.minModelWinProbability] },
                      ]
                    : []),
                  ...(modelBeatsSpFilterActive ? modelBeatsSpCond(minModelSpEdgePts) : []),
                ],
              },
            },
          },
        },
      },
      { $unwind: "$qualifyingRunners" },
      {
        $group: {
          _id: "$_id",
          raceId: { $first: "$raceId" },
          raceTime: { $first: "$raceTime" },
          raceName: { $first: "$raceName" },
          meetingId: { $first: "$meetingId" },
          meetingName: { $first: "$meetingName" },
          raceDate: { $first: "$raceDate" },
          modelVersionId: { $first: "$qualifyingRunners.modelVersionId" },
          staked: { $sum: { $divide: [1, { $subtract: ["$qualifyingRunners.isp", 1] }] } },
          returns: {
            $sum: {
              $cond: [
                { $eq: ["$qualifyingRunners.status", "WINNER"] },
                { $add: [{ $divide: [1, { $subtract: ["$qualifyingRunners.isp", 1] }] }, 1] },
                0,
              ],
            },
          },
          count: { $sum: 1 },
          // $first, not $sum: _brier is a per-RACE total computed before the
          // $unwind above, so it arrives already duplicated onto each of that
          // race's qualifying runners. Summing it would multiply every race's
          // Brier contribution by its own runner count.
          brierScored: { $first: "$_brier.scored" },
          brierPriced: { $first: "$_brier.priced" },
          brierModelSqErrSum: { $first: "$_brier.modelSqErrSum" },
          brierMarketSqErrSum: { $first: "$_brier.marketSqErrSum" },
        },
      },
    ];

    const results = await this.collection
      .aggregate<{
        raceId: number;
        raceTime: string;
        raceName: string;
        meetingId: string;
        meetingName: string;
        raceDate: string;
        modelVersionId: string | null;
        staked: number;
        returns: number;
        count: number;
        brierScored: number | null;
        brierPriced: number | null;
        brierModelSqErrSum: number | null;
        brierMarketSqErrSum: number | null;
      }>(pipeline, { allowDiskUse: true })
      .toArray();

    return results.map(r => ({
      raceId: r.raceId,
      raceTime: r.raceTime,
      raceName: r.raceName,
      meetingId: r.meetingId,
      meetingName: r.meetingName,
      raceDate: r.raceDate,
      modelVersionId: r.modelVersionId ?? null,
      pnlStats: { staked: r.staked, returns: r.returns, pnl: r.returns - r.staked, count: r.count },
      brierSums: {
        scored: r.brierScored ?? 0,
        priced: r.brierPriced ?? 0,
        modelSqErrSum: r.brierModelSqErrSum ?? 0,
        marketSqErrSum: r.brierMarketSqErrSum ?? 0,
      },
    }));
  }

  /**
   * Cumulative P&L convergence series, one point per race in [fromRow, toRow]
   * (same 1-based "row N of the current sort order" meaning as
   * getAllRacesByRace's fromRow/toRow). Demonstrates how the running ROI% is
   * volatile over a small sample and settles down as more races are
   * included — shown alongside the split cards as the "P&L Convergence"
   * graph.
   *
   * Unlike a runner-ordinal series, no boundary-resolution pass is needed
   * here: buildQualifyingRaceStages already emits one document per race, so
   * [fromRow, toRow] can be selected with a plain $skip/$limit right after
   * the leading $sort, same as getAllRacesByRace's own row-range handling.
   * The runners array is still present on each doc at this point in the
   * pipeline (no $project has stripped it yet), so the slow path below can
   * filter it directly with no $lookup back to the full document.
   */
  public async getRaceConvergenceSeries(
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    minInIspRange = 1,
    maxInIspRange = 1000,
    minRaceTime: string | null = null,
    maxRaceTime: string | null = null,
    courses: string[] = [],
    goings: string[] = [],
    raceClasses: string[] = [],
    raceTypes: string[] = [],
    trainerSearch: string | null = null,
    jockeySearch: string | null = null,
    trainerFormMinWinRate = 0,
    minTrainerFormRunners = 0,
    maxTrainerFormRunners = 100,
    minModelWinProbability = 0,
    onlyModelBeatsSp = false,
    fromRowRaw = 1,
    toRow: number,
    minModelSpEdgePts = 0,
    onlyModelTopPick = false
  ): Promise<{ raceRowNumber: number; cumulativeStaked: number; cumulativeReturns: number }[]> {
    const fromRow = Math.max(1, fromRowRaw);
    if (toRow < fromRow) return [];

    const dateMatchStage: Record<string, unknown>[] =
      minRaceTime != null || maxRaceTime != null
        ? [
            {
              $match: {
                raceTime: {
                  ...(minRaceTime != null ? { $gte: minRaceTime } : {}),
                  ...(maxRaceTime != null ? { $lte: maxRaceTime } : {}),
                },
              },
            },
          ]
        : [];

    // Same qualifying-runner condition as getAllRacesByRace's pnlStats slow
    // path — duplicated rather than shared, because buildQualifyingRaceStages'
    // fast path only exposes a scalar count, not the matching runner
    // subdocuments (isp/status) this needs.
    const trainerFormFilterActive = minTrainerFormRunners > 0 || maxTrainerFormRunners < 100;
    const trainerFormCond = [
      { $ne: ["$$r.trainerFormWinRate", null] },
      { $gte: ["$$r.trainerFormWinRate", trainerFormMinWinRate] },
    ];
    const modelFilterActive = minModelWinProbability > 0;
    const modelCond = [
      { $ne: [MODEL_PROB_R, null] },
      { $gte: [MODEL_PROB_R, minModelWinProbability] },
    ];
    const modelBeatsSpFilterActive = onlyModelBeatsSp || minModelSpEdgePts > 0;
    const beatsSpCond = modelBeatsSpCond(minModelSpEdgePts);
    const qualifyingRunnersFilterActive =
      trainerFormFilterActive || modelFilterActive || modelBeatsSpFilterActive || onlyModelTopPick;
    const qualifyingRunnersArrayExpr = {
      $filter: {
        input: "$runners",
        as: "r",
        cond: {
          $and: [
            { $ifNull: ["$$r.isp", false] },
            { $gt: ["$$r.isp", 1] },
            { $gte: ["$$r.isp", minIsp] },
            { $lte: ["$$r.isp", maxIsp] },
            ...(trainerFormFilterActive ? trainerFormCond : []),
            ...(modelFilterActive ? modelCond : []),
            ...(modelBeatsSpFilterActive ? beatsSpCond : []),
            // Over the race's own runners array, which is what this $filter is
            // walking — so the maximum is the race's, not the window's.
            ...(onlyModelTopPick ? modelTopPickCond("$runners") : []),
          ],
        },
      },
    };

    // Fast path (no runner-level filter active): raceStaked/raceReturns are
    // precomputed at import time over the same static isp>1 runner set, so
    // this is a plain field reference. Slow path re-derives per-race
    // staked/returns from the qualifying runners array via $reduce rather
    // than $unwind, since this needs exactly one output document per race
    // (no fan-out) to keep the cumulative-sum window function below a
    // single race-ordered pass.
    const stakedFieldExpr = qualifyingRunnersFilterActive
      ? {
          $reduce: {
            input: qualifyingRunnersArrayExpr,
            initialValue: 0,
            in: { $add: ["$$value", { $divide: [1, { $subtract: ["$$this.isp", 1] }] }] },
          },
        }
      : "$raceStaked";
    const returnsFieldExpr = qualifyingRunnersFilterActive
      ? {
          $reduce: {
            input: qualifyingRunnersArrayExpr,
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                {
                  $cond: [
                    { $eq: ["$$this.status", "WINNER"] },
                    { $add: [{ $divide: [1, { $subtract: ["$$this.isp", 1] }] }, 1] },
                    0,
                  ],
                },
              ],
            },
          },
        }
      : "$raceReturns";

    const rowSkip = fromRow - 1;
    const rowLimit = toRow - fromRow + 1;

    // Regression: reported live via screenshot — Split B's Graph button
    // 500'd once the authenticated race cap was raised (a split can now
    // span the entire ~9,839-race qualifying set). Two failed fix attempts
    // before this one, both chasing the wrong stage:
    //
    // 1. Assumed the leading $sort was the culprit and moved
    //    buildQualifyingRaceStages ahead of it to slim the projection first
    //    — made things worse (identical error): that breaks the
    //    index-provided-order optimization getAllRacesByRace's own comment
    //    warns about ("Putting the $sort anywhere after basePipeline's
    //    $match/$addFields forces a blocking in-memory sort instead").
    // 2. Restored the leading $sort to its correct position (second stage,
    //    right after dateMatchStage) and deferred reattaching each race's
    //    full document (via $lookup) until after $skip/$limit had already
    //    narrowed things down — still the identical error. Confirmed live
    //    that getAllRacesByRace itself (same leading dateMatch+$sort, same
    //    ~9,839-row window, same filters) succeeds at this exact scale, so
    //    the leading $sort was never actually the problem.
    //
    // The real culprit: $setWindowFields' own `sortBy` requires its input
    // provably sorted, and by the time execution reached it (after the
    // $lookup in attempt 2 rehydrated each windowed document with its full
    // `runners` array), MongoDB could no longer prove that — it fell back
    // to its own internal blocking sort, this time over ~9,839 *full*
    // documents, hitting the identical 32MB ceiling one stage later than
    // before. Fixed by computing each race's staked/returns scalars via
    // $addFields right after buildQualifyingRaceStages (while `runners` is
    // still present) and projecting `runners` away *before* $skip/$limit —
    // no $lookup rehydration needed at all, so every document reaching
    // $skip/$limit/$setWindowFields is a small, fixed-size
    // {_id, raceTime, staked, returns} shape regardless of row-range size.
    const points = await this.collection
      .aggregate<{ raceRowNumber: number; cumulativeStaked: number; cumulativeReturns: number }>(
        [
          ...dateMatchStage,
          { $sort: { raceTime: 1 } },
          ...this.buildQualifyingRaceStages({
            countries, minRunners, maxRunners, minIsp, maxIsp, minInIspRange, maxInIspRange,
            courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch, runnerName: null,
            trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
            minModelWinProbability, onlyModelBeatsSp, minModelSpEdgePts, onlyModelTopPick: false, modelVersionId: null,
          }),
          { $addFields: { _staked: stakedFieldExpr, _returns: returnsFieldExpr } },
          { $project: { _id: 1, raceTime: 1, _staked: 1, _returns: 1 } },
          { $skip: rowSkip },
          { $limit: rowLimit },
          {
            $setWindowFields: {
              sortBy: { raceTime: 1 },
              output: {
                relRowNumber: { $sum: 1, window: { documents: ["unbounded", "current"] } },
                cumulativeStaked: { $sum: "$_staked", window: { documents: ["unbounded", "current"] } },
                cumulativeReturns: { $sum: "$_returns", window: { documents: ["unbounded", "current"] } },
              },
            },
          },
          { $addFields: { raceRowNumber: { $add: ["$relRowNumber", rowSkip] } } },
          { $project: { _id: 0, raceRowNumber: 1, cumulativeStaked: 1, cumulativeReturns: 1 } },
        ],
        { allowDiskUse: true }
      )
      .toArray();

    return points;
  }

  /**
   * All races for one meeting (course + date), sorted by raceTime. A
   * meeting only ever has a handful of races, so no pagination or 32MB
   * sort-limit concerns here — this is a plain $match + $sort.
   */
  public async getRacesByMeetingId(meetingId: string): Promise<IspRace[]> {
    const races = await this.collection
      .aggregate<IspRace>([
        { $match: { meetingId } },
        {
          $addFields: {
            runners: {
              $sortArray: {
                input: {
                  $filter: {
                    input: "$runners",
                    as: "r",
                    cond: { $and: [{ $ifNull: ["$$r.isp", false] }, { $gt: ["$$r.isp", 1] }] },
                  },
                },
                sortBy: { sortPriority: 1 },
              },
            },
          },
        },
        { $sort: { raceTime: 1 } },
        {
          $project: {
            _id: 0,
            raceId: 1,
            meetingId: 1,
            meetingName: 1,
            course: 1,
            countryCode: 1,
            raceTime: 1,
            raceName: 1,
            raceType: 1,
            raceClass: 1,
            going: 1,
            ran: 1,
            runners: 1,
          },
        },
      ])
      .toArray();
    return races;
  }

  /** A single race by its raceId, or null if not found. */
  public async getRaceById(raceId: number): Promise<IspRace | null> {
    const [race] = await this.collection
      .aggregate<IspRace>([
        { $match: { _id: raceId } },
        {
          $addFields: {
            runners: {
              $sortArray: {
                input: {
                  $filter: {
                    input: "$runners",
                    as: "r",
                    cond: { $and: [{ $ifNull: ["$$r.isp", false] }, { $gt: ["$$r.isp", 1] }] },
                  },
                },
                sortBy: { sortPriority: 1 },
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            raceId: 1,
            meetingId: 1,
            meetingName: 1,
            course: 1,
            countryCode: 1,
            raceTime: 1,
            raceName: 1,
            raceType: 1,
            raceClass: 1,
            going: 1,
            ran: 1,
            runners: 1,
          },
        },
      ])
      .toArray();
    return race ?? null;
  }

  /** Batch-fetches full result docs for a set of Daily Races raceIds (raw
   * RacingAPI race_id strings, e.g. daily_racecards.raceId) — lets
   * DailyRaceService show a finished race's real outcome on Today's Picks
   * once this collection has captured it. A race only ever appears here
   * once RacingAPI's results feed reports it finished (see
   * IndustrySpResultsCaptureService) — there's no separate "is complete"
   * flag to check, presence is the signal. Returns every runner unfiltered
   * (unlike getRaceById above, which drops any runner with isp <= 1) — the
   * picked runner must always be present here regardless of its own SP
   * validity, so the caller can tell "not run yet" apart from "ran, but no
   * valid SP". Keyed by the caller's own raw raceId — this collection's
   * numeric _id is a one-way hash (synthRaceId), so it can't be recovered
   * from the doc alone; the caller-supplied ids are zipped back in instead. */
  public async getResultsForRaceIds(rawRaceIds: string[]): Promise<Map<string, RaceDoc>> {
    if (rawRaceIds.length === 0) return new Map();
    const hashedToRaw = new Map<number, string>();
    for (const rawId of rawRaceIds) hashedToRaw.set(synthRaceId(rawId), rawId);

    const docs = await this.collection.find({ _id: { $in: Array.from(hashedToRaw.keys()) } }).toArray();
    const byRawId = new Map<string, RaceDoc>();
    for (const doc of docs) {
      const rawId = hashedToRaw.get(doc._id);
      if (rawId) byRawId.set(rawId, doc as unknown as RaceDoc);
    }
    return byRawId;
  }

  /**
   * The per-runner condition shared by getModelVsSpRunners' data and count
   * pipelines — extracted for the same reason buildQualifyingRaceStages is, so
   * "which runners does this screen show" and "how many rows does it claim
   * there are" can never drift apart.
   *
   * `isp > 1` isn't only the usual "has a real SP" guard here: it's what makes
   * the $divide safe. `modelWinProbabilityOos != null` excludes both an explicit
   * null and an absent field in one check (a missing path compares equal to
   * null in an aggregation expression), which is what drops the CSV-imported
   * historical runners that were never model-scored — a model-vs-SP gap is
   * undefined without both sides, so those rows are excluded server-side rather
   * than rendered with a blank column.
   *
   * The TypeScript counterpart of the edge expression is `modelSpEdge` in
   * client/src/utils/ispFormat.ts. The two can't share code (one is a Mongo
   * expression tree, one is plain arithmetic), so the integration test pins both
   * to the same hand-derived numbers.
   */
  private buildModelVsSpRunnerCond(
    p: ModelVsSpParams,
    // The summary's band tallies describe the whole population being looked at,
    // so they're computed over the same runners MINUS the difference filter —
    // otherwise narrowing the difference range would move its own denominator
    // and every percentage would read 100%.
    opts: { applyAbsEdge: boolean } = { applyAbsEdge: true }
  ): Record<string, unknown> {
    const impliedExpr = { $divide: [100, "$$r.isp"] };
    const absEdgeExpr = { $abs: { $subtract: [MODEL_PROB_R, impliedExpr] } };
    return {
      $and: [
        { $ifNull: ["$$r.isp", false] },
        { $gt: ["$$r.isp", 1] },
        { $gte: ["$$r.isp", p.minIsp] },
        { $lte: ["$$r.isp", p.maxIsp] },
        { $ne: [MODEL_PROB_R, null] },
        { $gte: [MODEL_PROB_R, p.minModelProb] },
        { $lte: [MODEL_PROB_R, p.maxModelProb] },
        { $gte: [impliedExpr, p.minImpliedProb] },
        { $lte: [impliedExpr, p.maxImpliedProb] },
        ...(opts.applyAbsEdge
          ? [
              { $gte: [absEdgeExpr, p.minAbsEdge] },
              { $lte: [absEdgeExpr, p.maxAbsEdge] },
            ]
          : []),
      ],
    };
  }

  /** The race-level prelude both getModelVsSpRunners pipelines share. */
  private buildModelVsSpRaceStages(p: ModelVsSpParams): Record<string, unknown>[] {
    return this.buildQualifyingRaceStages({
      countries: p.countries,
      minRunners: p.minRunners,
      maxRunners: p.maxRunners,
      minIsp: p.minIsp,
      maxIsp: p.maxIsp,
      minInIspRange: 1,
      maxInIspRange: 10000,
      courses: [],
      goings: [],
      raceClasses: [],
      raceTypes: [],
      trainerSearch: null,
      jockeySearch: null,
      runnerName: null,
      trainerFormMinWinRate: 0,
      minTrainerFormRunners: 0,
      maxTrainerFormRunners: 100,
      // A valid necessary condition, and a cheap race-level pre-filter: no race
      // can contribute a row unless at least one of its runners clears
      // minModelProb. The joint per-runner condition still runs below — this
      // only discards races that can't possibly match.
      minModelWinProbability: p.minModelProb,
      // Subsumed by the edge range (minEdge >= 0 IS "model beats SP"), so
      // applying it again would be redundant work.
      onlyModelBeatsSp: false,
      minModelSpEdgePts: 0,
      // Model vs SP lists individual runners with their gap to the market; it
      // is not a per-race selection, so the top-pick filter has no meaning here.
      onlyModelTopPick: false,
      modelVersionId: null,
    });
  }

  /**
   * One row per runner (not per race), carrying the model's own win probability
   * alongside the probability that runner's industry SP implies (100/isp) and
   * the signed percentage-point gap between them — the "Model vs SP" screen.
   *
   * Runner-level pagination is new to this DAO; every other paginated query here
   * pages by race. Three deliberate departures, each with a reason:
   *
   * 1. **A params object, not positional args.** getAllRacesByRace has 29
   *    positional parameters, which is why chatApi.getIndustrySp has 29 too, and
   *    why scripts/verify-isp-year-walk-fix-2026-07-28.ts has to hand-spread an
   *    object back into positional order. getQualifyingRacesForDate already set
   *    the better precedent; this follows that one.
   *
   * 2. **Two queries, not one $facet.** The count needs neither ordering nor an
   *    $unwind — it's a single streaming $group over $size of a $filter, far
   *    cheaper than the data query. Putting it in a $facet would force it to
   *    consume the unwound stream, and would drag the 16MB single-BSON-doc
   *    ceiling (the reason /api/industry-sp caps limit at 2000) into a query
   *    that otherwise has no reason to care about it. The two run sequentially,
   *    not via Promise.all — M0's ceiling is concurrent throughput, not
   *    per-query cost (see getSplitStats in industry-sp-service.ts).
   *
   * 3. **The date window is mandatory.** The edge sort is a blocking sort that NO
   *    index can serve — its key is arithmetic over two fields of an array
   *    subdocument. It does NOT, however, hit the 32MB blocking-sort limit that
   *    Atlas M0 can't spill around: the $sort is immediately followed by
   *    $skip/$limit, so MongoDB uses a bounded top-k sort (memory scales with
   *    skip+limit, not with the input), over documents already projected down to
   *    ~44 bytes. Verified against production, not assumed —
   *    scripts/verify-model-vs-sp-pagination-2026-07-30.ts sorted the entire
   *    ~970k-runner collection without error. What scales linearly is TIME:
   *    ~106ms for a month, ~1.1s for a year, ~11.5s for everything. The router
   *    clamps the span to MODEL_VS_SP_MAX_SPAN_DAYS to keep a cold load near a
   *    second; see that constant for the full measurement table.
   *
   *    createIndexes() is deliberately left untouched. A multikey index on
   *    runners.modelWinProbabilityOos wouldn't help: the race-level pre-filter is an
   *    $expr over a computed count, which can't use an index, so it would cost
   *    ~1M index entries against M0's tight storage quota and never be read.
   *
   * The date sort, by contrast, has zero blocking-sort exposure at any scale:
   * its leading $match and $sort are on the same indexed raceTime field (one
   * bounded index walk serves both — the same idiom as getAllRacesByRace), and
   * every stage after it ($unwind/$addFields/$match/$project/$skip/$limit) is
   * streaming and order-preserving, so sort memory stays O(1) however deep the
   * requested page is.
   */
  public async getModelVsSpRunners(
    p: ModelVsSpParams
  ): Promise<{ rows: ModelVsSpRow[]; total: number | null; summary: ModelVsSpSummary | null }> {
    const runnerCond = this.buildModelVsSpRunnerCond(p);
    const dateMatch = { $match: { raceTime: { $gte: p.minRaceTime, $lte: p.maxRaceTime } } };
    const skip = (Math.max(1, p.page) - 1) * p.limit;
    const isEdgeSort = p.sort === "edge_desc" || p.sort === "edge_asc";

    // Recomputed from the runner's own fields rather than threaded through every
    // stage — cheap, and it keeps the emitted numbers provably consistent with
    // the filter condition above.
    const impliedFromRunner = { $divide: [100, "$mvsRunner.isp"] };
    const rowFields: Record<string, unknown> = {
      _id: 0,
      raceId: 1,
      raceTime: 1,
      raceDate: 1,
      meetingId: 1,
      meetingName: 1,
      course: 1,
      countryCode: 1,
      raceName: 1,
      raceType: 1,
      raceClass: { $ifNull: ["$raceClass", null] },
      going: { $ifNull: ["$going", null] },
      runnerId: "$mvsRunner.id",
      runnerName: "$mvsRunner.name",
      num: { $ifNull: ["$mvsRunner.num", null] },
      draw: { $ifNull: ["$mvsRunner.draw", null] },
      sortPriority: "$mvsRunner.sortPriority",
      status: "$mvsRunner.status",
      isp: "$mvsRunner.isp",
      ispFraction: { $ifNull: ["$mvsRunner.ispFraction", null] },
      isFavourite: { $ifNull: ["$mvsRunner.isFavourite", false] },
      jockey: { $ifNull: ["$mvsRunner.jockey", null] },
      trainer: { $ifNull: ["$mvsRunner.trainer", null] },
      modelWinProbability: MODEL_PROB_MVS,
      impliedSpProbability: impliedFromRunner,
      modelVersionId: { $ifNull: ["$mvsRunner.modelVersionId", null] },
    };

    const dataPipeline: Record<string, unknown>[] = isEdgeSort
      ? [
          dateMatch,
          ...this.buildModelVsSpRaceStages(p),
          { $addFields: { mvsRunners: { $filter: { input: "$runners", as: "r", cond: runnerCond } } } },
          { $match: { mvsRunners: { $ne: [] } } },
          // Slim each doc down to (race id, sort keys) *before* the $sort — the
          // same optimization getAllRacesByRace documents for its own leading
          // sort, and the only thing keeping this blocking sort's buffer to tens
          // of bytes per runner rather than a whole race document.
          {
            $project: {
              _id: 1,
              raceTime: 1,
              mvsRunners: {
                $map: {
                  input: "$mvsRunners",
                  as: "r",
                  in: {
                    id: "$$r.id",
                    edge: { $subtract: [MODEL_PROB_R, { $divide: [100, "$$r.isp"] }] },
                  },
                },
              },
            },
          },
          { $unwind: "$mvsRunners" },
          { $project: { _id: 1, raceTime: 1, runnerId: "$mvsRunners.id", edge: "$mvsRunners.edge" } },
          // raceTime + runnerId aren't cosmetic tiebreaks: without a total
          // order, two runners with an identical edge can swap places between
          // the page-2 and page-3 queries, so one row gets shown twice and
          // another never at all.
          { $sort: { edge: p.sort === "edge_desc" ? -1 : 1, raceTime: 1, runnerId: 1 } },
          { $skip: skip },
          { $limit: p.limit },
          // Rehydrate only the <=limit survivors. Safe here (unlike ahead of a
          // $setWindowFields — see getRaceConvergenceSeries) because nothing
          // downstream depends on the pipeline's sort being index-provable.
          { $lookup: { from: this.collectionName, localField: "_id", foreignField: "_id", as: "_docs" } },
          { $addFields: { _doc: { $arrayElemAt: ["$_docs", 0] } } },
          {
            $addFields: {
              raceId: "$_doc.raceId",
              raceDate: "$_doc.raceDate",
              meetingId: "$_doc.meetingId",
              meetingName: "$_doc.meetingName",
              course: "$_doc.course",
              countryCode: "$_doc.countryCode",
              raceName: "$_doc.raceName",
              raceType: "$_doc.raceType",
              raceClass: "$_doc.raceClass",
              going: "$_doc.going",
              mvsRunner: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: { $ifNull: ["$_doc.runners", []] },
                      as: "r",
                      cond: { $eq: ["$$r.id", "$runnerId"] },
                    },
                  },
                  0,
                ],
              },
            },
          },
          // `edge` is carried through from the slim doc rather than recomputed
          // from $mvsRunner, so the number displayed is provably the number that
          // was sorted on. Runner ids are synthNumericId hashes, assumed unique
          // within a race; were one ever to collide, this ordering means the row
          // shows a correct edge against a possibly-wrong name, not a wrong edge.
          { $project: { ...rowFields, edge: 1 } },
        ]
      : [
          dateMatch,
          // Must be the pipeline's second stage, on the same field the $match
          // above bounds — that's what lets one bounded {raceTime:1} index walk
          // serve both instead of a blocking sort. Moving the race-filter stages
          // ahead of it reintroduces exactly that (documented as failed fix #1
          // in getRaceConvergenceSeries).
          { $sort: { raceTime: p.sort === "date_desc" ? -1 : 1 } },
          ...this.buildModelVsSpRaceStages(p),
          {
            $addFields: {
              mvsRunners: {
                $sortArray: {
                  input: { $filter: { input: "$runners", as: "r", cond: runnerCond } },
                  // A per-document sort of ~9 elements, not a pipeline sort —
                  // gives runners within a race the same racecard order the rest
                  // of the app shows them in.
                  sortBy: { sortPriority: 1 },
                },
              },
            },
          },
          { $match: { mvsRunners: { $ne: [] } } },
          // Drop the full runners array before the $unwind, so the fan-out
          // carries only the qualifying subset rather than every race document
          // multiplied by its field size.
          {
            $project: {
              _id: 0,
              raceId: 1,
              raceTime: 1,
              raceDate: 1,
              meetingId: 1,
              meetingName: 1,
              course: 1,
              countryCode: 1,
              raceName: 1,
              raceType: 1,
              raceClass: 1,
              going: 1,
              mvsRunners: 1,
            },
          },
          { $unwind: "$mvsRunners" },
          { $skip: skip },
          { $limit: p.limit },
          { $addFields: { mvsRunner: "$mvsRunners" } },
          { $project: { ...rowFields, edge: { $subtract: [MODEL_PROB_MVS, impliedFromRunner] } } },
        ];

    const rows = await this.collection.aggregate<ModelVsSpRow>(dataPipeline, { allowDiskUse: true }).toArray();

    if (!p.includeTotal) return { rows, total: null, summary: null };

    // The count and the distribution summary come from ONE streaming pass — no
    // $sort, no $unwind, O(1) memory at any dataset size. Both are needed
    // together (the summary's matchedRunners IS the total), and computing them
    // separately would double this endpoint's cost on a tier where concurrency is
    // the ceiling.
    //
    // Two runner sets are built, differing only in whether the difference filter
    // applies: `mvsAll` is the denominator the bands describe, `matchedRunners`
    // the numerator. `matchedRunners` is deliberately not named `total`/`count` —
    // the shared aggregate mock in src/server/__tests__/app.test.ts already holds
    // a $facet-shaped array under `total` and a number under `count`.
    const condWithoutAbsEdge = this.buildModelVsSpRunnerCond(p, { applyAbsEdge: false });
    const bandBounds = EDGE_BAND_BOUNDS;

    // One tally per band, in EDGE_BAND_BOUNDS order, plus the open-ended final
    // band. Each counts the absolute edges falling in [lower, upper).
    const bandAccumulators: Record<string, unknown> = {};
    bandBounds.forEach((upper, i) => {
      const lower = i === 0 ? 0 : bandBounds[i - 1];
      bandAccumulators[`band${i}`] = {
        $sum: {
          $size: {
            $filter: {
              input: "$mvsAbsEdges",
              as: "e",
              cond: { $and: [{ $gte: ["$$e", lower] }, { $lt: ["$$e", upper] }] },
            },
          },
        },
      };
    });
    bandAccumulators[`band${bandBounds.length}`] = {
      $sum: {
        $size: {
          $filter: {
            input: "$mvsAbsEdges",
            as: "e",
            cond: { $gte: ["$$e", bandBounds[bandBounds.length - 1]] },
          },
        },
      },
    };

    const [summaryResult] = await this.collection
      .aggregate<{
        allRunners: number;
        matchedRunners: number;
        sumAbsEdge: number;
        brierScored: number;
        brierPriced: number;
        brierModelSqErrSum: number;
        brierMarketSqErrSum: number;
        [band: string]: number;
      }>(
        [
          dateMatch,
          ...this.buildModelVsSpRaceStages(p),
          // Its own stage for the same reason buildQualifyingRaceStages splits
          // one out: a fair probability needs the race's book total, and
          // $addFields cannot read a field it is defining.
          { $addFields: { _bookSum: bookSumExpr("$runners", "isp") } },
          { $addFields: { mvsAll: { $filter: { input: "$runners", as: "r", cond: condWithoutAbsEdge } } } },
          { $match: { mvsAll: { $ne: [] } } },
          {
            $addFields: {
              mvsMatchedCount: { $size: { $filter: { input: "$mvsAll", as: "r", cond: runnerCond } } },
              mvsAbsEdges: {
                $map: {
                  input: "$mvsAll",
                  as: "r",
                  in: { $abs: { $subtract: [MODEL_PROB_R, { $divide: [100, "$$r.isp"] }] } },
                },
              },
              // Scored over `runnerCond` — the MATCHED runners, the ones the
              // list below the summary is showing — not the wider
              // condWithoutAbsEdge population the bands describe. See the
              // `brier` comment on ModelVsSpSummary.
              _brier: raceBrierSumsExpr({
                runnersPath: "$runners",
                priceField: "isp",
                modelProbField: MODEL_PROB_FIELD,
                qualifyingCondExpr: runnerCond,
                bookSumPath: "$_bookSum",
              }),
            },
          },
          {
            $group: {
              _id: null,
              allRunners: { $sum: { $size: "$mvsAll" } },
              matchedRunners: { $sum: "$mvsMatchedCount" },
              sumAbsEdge: { $sum: { $sum: "$mvsAbsEdges" } },
              ...bandAccumulators,
              // Flattened to four scalars rather than nested under one field,
              // to stay inside this result type's `[band: string]: number`
              // index signature — the band tallies use the same trick.
              brierScored: { $sum: "$_brier.scored" },
              brierPriced: { $sum: "$_brier.priced" },
              brierModelSqErrSum: { $sum: "$_brier.modelSqErrSum" },
              brierMarketSqErrSum: { $sum: "$_brier.marketSqErrSum" },
            },
          },
        ],
        { allowDiskUse: true }
      )
      .toArray();

    const summary = buildEdgeSummary({
      allRunners: summaryResult?.allRunners ?? 0,
      matchedRunners: summaryResult?.matchedRunners ?? 0,
      sumAbsEdge: summaryResult?.sumAbsEdge ?? 0,
      bandCounts: Array.from(
        { length: bandBounds.length + 1 },
        (_, i) => (summaryResult?.[`band${i}`] as number) ?? 0
      ),
      brierSums: {
        scored: summaryResult?.brierScored ?? 0,
        priced: summaryResult?.brierPriced ?? 0,
        modelSqErrSum: summaryResult?.brierModelSqErrSum ?? 0,
        marketSqErrSum: summaryResult?.brierMarketSqErrSum ?? 0,
      },
    });

    return { rows, total: summary.matchedRunners, summary };
  }

  public async getPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    const [result] = await this.collection
      .aggregate<{ staked: number; returns: number }>([
        { $unwind: "$runners" },
        { $match: { "runners.isp": { $exists: true, $gt: 1 } } },
        {
          $group: {
            _id: null,
            staked: { $sum: { $divide: [1, { $subtract: ["$runners.isp", 1] }] } },
            returns: {
              $sum: {
                $cond: [
                  { $eq: ["$runners.status", "WINNER"] },
                  { $add: [{ $divide: [1, { $subtract: ["$runners.isp", 1] }] }, 1] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    const staked = result?.staked ?? 0;
    const returns = result?.returns ?? 0;
    return { staked, returns, pnl: returns - staked };
  }

  public async getDistinctCountryCodes(): Promise<string[]> {
    const codes = await this.collection.distinct("countryCode", { countryCode: { $exists: true, $ne: "" } });
    return (codes as string[]).filter(Boolean).sort();
  }

  public async getDistinctCourses(): Promise<string[]> {
    const values = await this.collection.distinct("course", { course: { $exists: true, $ne: "" } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getDistinctGoings(): Promise<string[]> {
    const values = await this.collection.distinct("going", { going: { $exists: true, $ne: null } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getDistinctRaceClasses(): Promise<string[]> {
    const values = await this.collection.distinct("raceClass", { raceClass: { $exists: true, $ne: null } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getDistinctRaceTypes(): Promise<string[]> {
    const values = await this.collection.distinct("raceType", { raceType: { $exists: true, $ne: "" } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getFilterBounds(): Promise<IspFilterBounds> {
    // Used to $unwind every race's runners array (~9 runners/race, so
    // ~109k races became ~1M documents flowing through the rest of the
    // pipeline) with no filtering beforehand — a full, unindexed
    // collection scan blown up ~9x before any $group even started. That
    // made this the single slowest request on the home page (~4s live),
    // well past every other query on this screen.
    //
    // maxRunners reuses `runnersWithIspCount`, precomputed + indexed at
    // import time (see the comment on that field above) — no unwind
    // needed, just a $group over the already-matched doc count. minIsp/
    // maxIsp still need every race's runner ISPs, but computing them with
    // $filter + $min/$max *expressions* over each doc's own runners array
    // keeps the pipeline at the raw ~109k-document scale instead of
    // exploding it — no per-runner documents, no $unwind.
    const [result] = await this.collection
      .aggregate<{
        runnerCounts: [{ maxRunners: number }];
        ispBounds: [{ maxIsp: number; minIsp: number }];
      }>([
        {
          $facet: {
            runnerCounts: [{ $group: { _id: null, maxRunners: { $max: "$runnersWithIspCount" } } }],
            ispBounds: [
              {
                $addFields: {
                  validIsps: {
                    $filter: {
                      input: "$runners.isp",
                      as: "isp",
                      cond: { $and: [{ $ne: ["$$isp", null] }, { $gt: ["$$isp", 1] }] },
                    },
                  },
                },
              },
              { $match: { validIsps: { $ne: [] } } },
              {
                $group: {
                  _id: null,
                  maxIsp: { $max: { $max: "$validIsps" } },
                  minIsp: { $min: { $min: "$validIsps" } },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    return {
      maxRunnersPerRace: result?.runnerCounts?.[0]?.maxRunners ?? 30,
      maxIsp: result?.ispBounds?.[0]?.maxIsp ?? 1000,
      minIsp: result?.ispBounds?.[0]?.minIsp ?? 1,
    };
  }

  public async createIndexes(): Promise<void> {
    const specs: [Record<string, unknown>, Record<string, unknown>?][] = [
      [{ raceTime: 1 }],
      [{ countryCode: 1 }],
      [{ runnersWithIspCount: 1 }],
      [{ course: 1 }],
      [{ going: 1 }],
      [{ raceClass: 1 }],
      [{ raceType: 1 }],
      [{ "runners.trainer": 1 }],
      [{ "runners.jockey": 1 }],
      [{ "runners.name": 1 }],
    ];
    for (const [keys, opts] of specs) {
      try {
        await this.collection.createIndex(keys as any, opts as any);
      } catch (err) {
        console.warn(`createIndex failed for ${JSON.stringify(keys)} (non-fatal):`, err);
      }
    }
    console.log("Industry SP indexes ensured");
  }
}
