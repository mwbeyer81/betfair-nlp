import { config } from "../config";

export interface EventGroup {
  eventId: string;
  eventName: string;
  marketIds: string[];
  count: number;
  earliestMarketTime: string;
}

export interface Runner {
  id: number;
  name: string;
  status: string;
  sortPriority: number;
  bsp?: number;
}

export interface Stats {
  totalRaces: number;
  totalRunners: number;
}

export interface Race {
  marketId: string;
  marketTime: string;
  marketType: string;
  marketName: string;
  countryCode: string;
  runners: Runner[];
}

export interface RaceWithEvent extends Race {
  eventId: string;
  eventName: string;
}

export interface PnlStats {
  staked: number;
  returns: number;
  pnl: number;
  count?: number;
}

export interface RunnerFilterBounds {
  maxRunnersPerRace: number;
  maxBsp: number;
  minBsp: number;
}

export interface RunnersPage {
  success: boolean;
  data: RaceWithEvent[];
  count: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totalRunners: number;
  pnlStats: PnlStats;
}

export interface IspRunner {
  id: number;
  name: string;
  num: number | null;
  draw: number | null;
  status: "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";
  sortPriority: number;
  isp: number | null;
  ispFraction: string | null;
  isFavourite: boolean;
  jockey?: string;
  trainer?: string;
  // Trainer's trailing-14-day form (same race-type category — Flat vs
  // Jumps — as this race), computed as-of this race's own date. Undefined
  // when the runner has no trainer; trainerFormWinRate is null (not 0)
  // when trainerFormRuns is 0 — that's the "no sample yet" signal.
  trainerFormRuns?: number;
  trainerFormWins?: number;
  trainerFormWinRate?: number | null;
  trainerFormStaked?: number;
  trainerFormReturns?: number;
  // XGBoost win-probability estimate (0-100, normalized so a race's
  // runners sum to 100) — precomputed in ml/train_and_predict.py,
  // deliberately trained without isp/ispFraction/isFavourite as inputs.
  modelWinProbability?: number | null;
  // Which training run produced modelWinProbability — set alongside it in
  // ml/train_and_predict.py. Only ever reflects the MOST RECENT run that
  // scored this runner (each run overwrites both fields together);
  // historical runs can't be reconstructed for runners scored before this
  // field existed.
  modelVersionId?: string | null;
}

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

export interface IspFilterBounds {
  maxRunnersPerRace: number;
  maxIsp: number;
  minIsp: number;
}

// A runner's real outcome, once industry_starting_prices has captured it —
// null until the race has been picked up by the daily results-capture job
// (or a manual run), same "pending" meaning as the pre-race pick display.
// isp/ispFraction are the real Industry SP the runner actually went off at,
// not the model's own pre-race "fair odds" implied price. Mirrors
// DailyRaceResult in src/lib/service/daily-race-service.ts field-for-field.
export interface DailyRaceResult {
  status: "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";
  pos: string;
  isp: number | null;
  ispFraction: string | null;
}

// Mirrors the backend's POST /api/daily-races/reseed-results response
// shape (src/server/router.ts). `error: "plan_required"` is the one
// expected failure mode worth branching on in the UI — the racing-data
// provider's plan can only ever fetch "today's" results, so this is the
// routine outcome for any genuinely past date, not a bug.
export interface ReseedResultsResult {
  success: boolean;
  data?: { racesUpserted: number; runnersUpserted: number; nonGbSkipped: number };
  error?: string;
  message?: string;
}

// Mirrors src/lib/service/bet-order-service.ts's BetOrderApiResponse
// field-for-field. "placing"/"unmatched"/"error" are real, distinct states
// (not folded into "pending") — see src/lib/dao/bet-order-dao.ts's
// BetOrderStatus doc comment for why each needs its own honest label.
export type BetOrderStatus = "pending" | "unmatched" | "placing" | "triggered" | "expired" | "cancelled" | "error";

// "scheduled" watches the market until the price condition is met (today's
// original flow); "instant" places once, synchronously, at whatever price
// Betfair currently offers.
export type BetOrderType = "instant" | "scheduled";

export interface BetOrder {
  id: string;
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  // The race's scheduled off (ISO, with offset). Absent on bet orders
  // returned by older API builds — always fall back to createdAt rather
  // than dropping the bet from a date filter (see betRaceDate).
  offDt?: string;
  raceId: string;
  eventId: string;
  targetProfit: number;
  maxStake: number;
  minQualifyingPrice: number;
  status: BetOrderStatus;
  orderType: BetOrderType;
  createdAt: string;
  matchedPrice?: number;
  dryRun?: boolean;
  note?: string;
  // The real, settled result — only ever populated for a real (dryRun:
  // false) triggered bet once Betfair itself confirms the race settled.
  // Absent means "not settled yet", never inferred client-side.
  betOutcome?: "WON" | "LOST" | "VOID" | string;
  settledProfit?: number;
  settledAt?: string;
  // User-controlled — when true, this bet always simulates (never places
  // real money) regardless of any other setting, and its result/PnL is
  // settled against this app's own real race-result data rather than a
  // real Betfair settlement. See PlaceBetDialog's sandbox toggle.
  sandbox?: boolean;
}

export interface CreateBetOrderInput {
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  offDt: string;
  raceId: string;
  eventId: string;
  targetProfit: number;
  maxStake: number;
  orderType: BetOrderType;
  sandbox?: boolean;
}

// Mirrors src/lib/service/live-price-service.ts's LivePriceResult.
// price is null whenever a real live price can't be shown right now (no
// credentials configured, market unresolved, race in-play, etc.) — never a
// fabricated number — with `note` explaining why.
export interface LivePrice {
  price: number | null;
  note?: string;
}

export interface LivePriceRequestPick {
  runnerId: string;
  horse: string;
  course: string;
  offDt: string;
}

// RacingAPI-backed "Daily Races" feature — a different domain from the ISP
// types above, now also carrying a model win-probability view. See
// src/lib/dao/daily-race-dao.ts for the backend document shape this
// mirrors field-for-field.
export interface DailyRaceRunner {
  runnerId: string;
  horse: string;
  age: string | null;
  sex: string | null;
  sexCode: string | null;
  colour: string | null;
  region: string | null;
  dam: string | null;
  damId: string | null;
  sire: string | null;
  sireId: string | null;
  damsire: string | null;
  damsireId: string | null;
  trainer: string | null;
  trainerId: string | null;
  owner: string | null;
  ownerId: string | null;
  number: string | null;
  draw: string | null;
  headgear: string | null;
  lbs: string | null;
  officialRating: string | null;
  jockey: string | null;
  jockeyId: string | null;
  lastRun: string | null;
  form: string | null;
  // Basic-plan-only fields (null on Free-tier ingests). Display-only — see
  // daily-race-dao.ts's DailyRaceRunnerDoc comment: rpr/ts here are the
  // horse's CURRENT published rating, not a trailing average, so they're
  // never what modelWinProbability below is computed from.
  rpr: string | null;
  ts: string | null;
  spotlight: string | null;
  comment: string | null;
  trainer14Days: { runs: string; wins: string; percent: string } | null;
  trainerRtf: string | null;
  // Computed trailing form (daily-race-feature-service.ts), read-only
  // against real historical data — same field names/semantics as the ISP
  // domain's equivalents.
  trainerFormRuns: number | null;
  trainerFormWins: number | null;
  trainerFormWinRate: number | null;
  trainerFormStaked: number | null;
  trainerFormReturns: number | null;
  jockeyFormRuns: number | null;
  jockeyFormWins: number | null;
  jockeyFormWinRate: number | null;
  jockeyFormStaked: number | null;
  jockeyFormReturns: number | null;
  daysSinceLastRun: number | null;
  horseCareerRuns: number | null;
  horseCareerWinRate: number | null;
  horseAvgRPR: number | null;
  horseAvgTS: number | null;
  horseAvgBeatenDistance: number | null;
  horseAvgExcuseScore: number | null;
  horseTroubleInRunningRate: number | null;
  horseTravelledWellRate: number | null;
  featuresComputedAt: string | null;
  // Written by ml/predict_daily_races.py.
  modelWinProbability: number | null;
  modelVersionId: string | null;
  // Top 3 plain-language "why this %" factors, from apps/ml-api/handler.py's
  // topFactors. See ml/train_and_predict.py's FEATURE_EXPLANATIONS.
  modelTopFactors: { label: string; direction: "positive" | "negative" }[] | null;
  result: DailyRaceResult | null;
}

export interface DailyRace {
  raceId: string;
  eventId: string;
  course: string;
  date: string;
  offTime: string;
  offDt: string;
  raceName: string;
  distanceF: string | null;
  region: string | null;
  raceClass: string | null;
  type: string | null;
  ageBand: string | null;
  prize: string | null;
  fieldSize: string | null;
  going: string | null;
  surface: string | null;
  runners: DailyRaceRunner[];
}

export type TrainerFormCategory = "Flat" | "Jumps";

export interface TrainerFormRunDoc {
  raceId: number;
  runnerId: number;
  horseName: string;
  raceDate: string;
  course: string;
  status: "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";
  pos: string;
  isp: number | null;
}

export interface TrainerFormDoc {
  trainer: string;
  formCategory: TrainerFormCategory;
  runs: TrainerFormRunDoc[];
  totalRuns: number;
  totalWins: number;
  lastUpdated: string;
}

export interface IspPage {
  success: boolean;
  data: IspRace[];
  count: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totalRunners: number;
  pnlStats: PnlStats;
}

export type ModelVsSpSort = "date_desc" | "date_asc" | "edge_desc" | "edge_asc";

// One row per RUNNER, not per race — the Model vs SP screen's unit. Mirrors the
// backend's ModelVsSpRow field-for-field. Every one of the three comparison
// numbers is non-optional here (unlike IspRunner.modelWinProbability above),
// because the endpoint only ever returns runners that have all of them.
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
  status: "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";
  isp: number;
  ispFraction: string | null;
  isFavourite: boolean;
  jockey: string | null;
  trainer: string | null;
  modelWinProbability: number;
  impliedSpProbability: number;
  // Signed percentage points: modelWinProbability - impliedSpProbability.
  edge: number;
  modelVersionId: string | null;
}

// One magnitude band of |model% - implied SP%|, for the distribution summary.
export interface ModelVsSpBand {
  minAbs: number;
  maxAbs: number | null;
  label: string;
  count: number;
  percent: number;
  // null on the open-ended final band, where it would always be 100.
  cumulativePercent: number | null;
}

export interface ModelVsSpSummary {
  // Every runner matching the current filters EXCEPT the difference range — the
  // bands' denominator, deliberately fixed so narrowing that filter doesn't move
  // its own baseline.
  allRunners: number;
  matchedRunners: number;
  matchedPercent: number;
  meanAbsEdge: number;
  bands: ModelVsSpBand[];
}

export interface ModelVsSpQuery {
  page?: number;
  limit?: number;
  sort?: ModelVsSpSort;
  minDate?: string;
  maxDate?: string;
  minModelProb?: number;
  maxModelProb?: number;
  minImpliedProb?: number;
  maxImpliedProb?: number;
  // The SIZE of the model-vs-market gap in percentage points, ignoring direction
  // — 10-20 matches a runner rated 12 points above its SP and one rated 12 below
  // alike. Always 0-100, never negative.
  minAbsEdge?: number;
  maxAbsEdge?: number;
  minIsp?: number;
  maxIsp?: number;
  minRunners?: number;
  maxRunners?: number;
  countries?: string[];
  includeTotal?: boolean;
}

export interface ModelVsSpPage {
  success: boolean;
  data: ModelVsSpRow[];
  count: number;
  // null (not 0) when the request opted out of the count with
  // includeTotal: false — "not counted" is a different state from "none found",
  // and the screen keeps displaying the total it already had.
  total: number | null;
  page: number;
  limit: number;
  totalPages: number | null;
  sort: ModelVsSpSort;
  // The window actually queried, which may be a clamped or defaulted version of
  // what was asked for (the server caps the span at 366 days).
  minDate: string;
  maxDate: string;
  // null alongside total when the request opted out of the count.
  summary: ModelVsSpSummary | null;
}

export interface ModelTrainingParams {
  nEstimators: number;
  learningRate: number;
  maxDepth: number;
  subsample: number;
  colsampleBytree: number;
  minChildWeight: number;
  randomState: number;
  earlyStoppingRounds: number;
}

export interface ModelRunMeta {
  featureCols: string[];
  trainRows: number;
  testRows: number;
  trainDateMax: string;
  testDateMin: string;
  bestIteration: number;
}

export interface CalibrationBucket {
  meanPredicted: number;
  actualWinRate: number;
  n: number;
}

export interface ModelPerformanceMetrics {
  aucRoc: number;
  logLoss: number;
  brierScore: number;
  calibrationTable: CalibrationBucket[];
}

export interface ModelVersion {
  id: string;
  runLabel: string;
  runAt: string;
  trainingParams: ModelTrainingParams;
  runMeta: ModelRunMeta;
  performanceMetrics: ModelPerformanceMetrics;
}

export interface ModelVersionsResponse {
  success: boolean;
  data: ModelVersion[];
  count: number;
}

export interface SavedFilterSetPnlStats {
  staked: number;
  returns: number;
  pnl: number;
  count: number;
}

export interface SavedFilterSetGraphPoint {
  raceRowNumber: number;
  cumulativeStaked: number;
  cumulativeReturns: number;
  cumulativePnl: number;
  roiPercent: number;
}

// One split's resolved snapshot, computed at save time via the same
// getSplitStats/getRaceConvergenceSeries the live Filters screen's own
// Split A/B cards use — fromRow/toRow are the true resolved race range
// (explicit if the user had edited the split boxes, the default half/half
// divide otherwise), never re-derived on the client.
export interface SavedFilterSetSplit {
  fromRow: number;
  toRow: number | null;
  total: number;
  totalRunners: number;
  pnlStats: SavedFilterSetPnlStats;
  graphPoints: SavedFilterSetGraphPoint[];
}

// filters is the raw ISP_FILTER_PARAM_NAMES string map — the exact query
// params IndustrySpScreen's own syncUrl() writes (see
// client/src/utils/ispUrlParams.ts) — so restoring is just navigating to
// /isp with these as the query string, no parsing needed.
//
// splitA/splitB are optional (not just "always present since this app
// version") — a real, reported bug: any saved_filter_sets document
// created before the Split A/B schema change has neither field at all
// (the old shape stored a single flat pnlStats/graphPoints instead), and
// nothing migrates old documents on deploy. Reading result.splitA.pnlStats
// on such a doc threw mid-render with no error boundary anywhere in the
// app to catch it, blanking the whole screen — see
// SavedResultsListScreen's isLegacyResult()/SavedResultDetailScreen's
// equivalent guard, both of which exist specifically because this can and
// does happen for real.
export interface SavedFilterSet {
  id: string;
  name: string;
  filters: Record<string, string>;
  splitA?: SavedFilterSetSplit;
  splitB?: SavedFilterSetSplit;
  createdAt: string;
  createdBy: "user" | "agent";
  modelVersionId?: string;
}

export interface SavedFilterSetResponse {
  success: boolean;
  data: SavedFilterSet;
}

export interface SavedFilterSetsResponse {
  success: boolean;
  data: SavedFilterSet[];
  count: number;
}

// One real qualifying race's P&L, for this filter set — the live,
// actual-results counterpart to the one-time splitA/splitB backtest
// snapshot above. Per-race (not pre-aggregated per meeting) so the Live
// Performance section can build the same Meeting → Race tap-through
// hierarchy the historical Races view already has. Written by the daily
// results-capture cron once a day's RacingAPI results are in; absent
// entirely until the first day after this filter set was saved has been
// captured.
export interface LiveFilterResult {
  raceDate: string;
  raceId: number;
  raceTime: string;
  raceName: string;
  meetingId: string;
  meetingName: string;
  modelVersionId: string | null;
  pnlStats: { staked: number; returns: number; pnl: number; count: number };
}

export interface LiveFilterResultsResponse {
  success: boolean;
  data: LiveFilterResult[];
  count: number;
}

export interface AuthResult {
  token: string;
  // Deliberately not derived from the JWT itself — verification status can
  // change after the token was issued, so it rides along in the login/
  // signup response body instead (and is re-fetched via getMe() on
  // session restore, since a stored token alone doesn't carry it).
  emailVerified: boolean;
}

export interface IspSplitResult {
  fromRow: number;
  toRow: number | null;
  total: number;
  totalRunners: number;
  pnlStats: PnlStats;
}

export interface RaceConvergencePoint {
  raceRowNumber: number;
  cumulativeStaked: number;
  cumulativeReturns: number;
  cumulativePnl: number;
  roiPercent: number;
}

export interface IspSplitsResponse {
  success: boolean;
  totalRaces: number;
  totalRunners: number;
  // 100 for an anonymous caller, 1000 for a logged-in one — see
  // IndustrySpService.getSplitStats. Lets the frontend show "capped" UI
  // without hardcoding the two tier numbers itself.
  raceCap: number;
  filterBounds: IspFilterBounds;
  countries: string[];
  courses: string[];
  goings: string[];
  raceClasses: string[];
  raceTypes: string[];
  splitA: IspSplitResult;
  splitB: IspSplitResult;
}

export interface MarketDefinitionDoc {
  _id: string;
  changeId: string;
  marketId: string;
  eventId: string;
  eventName: string;
  status: string;
  marketType: string;
  marketTime: string;
  numberOfActiveRunners: number;
  timestamp: string;
  runners: Array<{ id: number; name: string; status: string; sortPriority: number }>;
}

interface ChatResponse {
  reply: string;
  success?: boolean;
  data?: any;
  error?: string;
}

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

class ChatApi {
  private baseUrl = config.baseUrl;
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  // Returns {} (no header at all) when there's no token, rather than a
  // literal "Bearer null"/"Bearer undefined" string — the industry-sp
  // endpoints are public and treat a missing header as anonymous, but an
  // actually-malformed header is the wrong way to signal that.
  private authHeader(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Invalid credentials");
    }
    const result = await response.json();
    return { token: result.token as string, emailVerified: result.emailVerified === true };
  }

  async signup(email: string, password: string): Promise<AuthResult> {
    const response = await fetch(`${this.baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Sign up failed");
    }
    const result = await response.json();
    return { token: result.token as string, emailVerified: result.emailVerified === true };
  }

  async getMe(): Promise<{ email: string | null; phone: string | null; emailVerified: boolean } | null> {
    const response = await fetch(`${this.baseUrl}/api/auth/me`, {
      headers: this.authHeader(),
    });
    if (!response.ok) return null;
    const result = await response.json();
    return { email: result.email ?? null, phone: result.phone ?? null, emailVerified: result.emailVerified === true };
  }

  async signInWithGoogle(idToken: string): Promise<AuthResult> {
    const response = await fetch(`${this.baseUrl}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Google sign-in failed");
    }
    const result = await response.json();
    return { token: result.token as string, emailVerified: result.emailVerified === true };
  }

  async sendSmsCode(phone: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/auth/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Failed to send verification code");
    }
  }

  async verifySmsCode(phone: string, code: string): Promise<AuthResult> {
    const response = await fetch(`${this.baseUrl}/api/auth/sms/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Invalid or expired verification code");
    }
    const result = await response.json();
    return { token: result.token as string, emailVerified: result.emailVerified === true };
  }

  async resendVerification(): Promise<{ alreadyVerified: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/auth/resend-verification`, {
      method: "POST",
      headers: this.authHeader(),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Failed to resend verification email");
    }
    const result = await response.json();
    return { alreadyVerified: result.alreadyVerified === true };
  }

  async getEventDefinitions(eventId: string): Promise<MarketDefinitionDoc[]> {
    const response = await fetch(
      `${this.baseUrl}/api/events/${encodeURIComponent(eventId)}/definitions`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch event definitions");
    const result = await response.json();
    return result.data;
  }

  async getEventRunners(eventId: string): Promise<Race[]> {
    const response = await fetch(
      `${this.baseUrl}/api/events/${encodeURIComponent(eventId)}/runners`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch runners");
    const result = await response.json();
    return result.data;
  }

  async getRunnerFilterBounds(): Promise<RunnerFilterBounds> {
    const response = await fetch(`${this.baseUrl}/api/runners/filter-bounds`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch filter bounds");
    const result = await response.json();
    return result.data;
  }

  async getRunnerCountries(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/runners/countries`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch countries");
    const result = await response.json();
    return result.data;
  }

  async getAllRunners(page = 1, limit = 20, minRunners = 1, maxRunners = 30, countries: string[] = [], minBsp = 1, maxBsp = 1000, sortOrder: "asc" | "desc" = "asc", minInSp = 1, maxInSp = 10000, fromRow = 1, toRow?: number): Promise<RunnersPage> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      minRunners: String(minRunners),
      maxRunners: String(maxRunners),
      minBsp: String(minBsp),
      maxBsp: String(maxBsp),
      sort: sortOrder,
      minInSp: String(minInSp),
      maxInSp: String(maxInSp),
      fromRow: String(fromRow),
    });
    if (countries.length > 0) params.set("countries", countries.join(","));
    if (toRow != null) params.set("toRow", String(toRow));
    const response = await fetch(
      `${this.baseUrl}/api/runners?${params}`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch all runners");
    return response.json();
  }

  async getRunnersPnlStats(): Promise<PnlStats> {
    const response = await fetch(`${this.baseUrl}/api/runners/pnl-stats`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch runners P&L stats");
    const result = await response.json();
    return result.data;
  }

  async getIspFilterBounds(): Promise<IspFilterBounds> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/filter-bounds`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP filter bounds");
    const result = await response.json();
    return result.data;
  }

  async getIspCountries(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/countries`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP countries");
    const result = await response.json();
    return result.data;
  }

  async getIspCourses(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/courses`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP courses");
    const result = await response.json();
    return result.data;
  }

  async getIspGoings(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/goings`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP goings");
    const result = await response.json();
    return result.data;
  }

  async getIspRaceClasses(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/race-classes`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP race classes");
    const result = await response.json();
    return result.data;
  }

  async getIspRaceTypes(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/race-types`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP race types");
    const result = await response.json();
    return result.data;
  }

  async getIndustrySp(page = 1, limit = 20, minRunners = 1, maxRunners = 30, countries: string[] = [], minIsp = 1, maxIsp = 1000, sortOrder: "asc" | "desc" = "asc", minInIspRange = 1, maxInIspRange = 10000, fromRow = 1, toRow?: number, minDate?: string, maxDate?: string, courses: string[] = [], goings: string[] = [], raceClasses: string[] = [], raceTypes: string[] = [], trainer?: string, jockey?: string, trainerFormMinWinRate?: number, minTrainerFormRunners?: number, maxTrainerFormRunners?: number, runnerName?: string, minModelWinProbability?: number, onlyModelBeatsSp?: boolean, modelVersionId?: string, subMinDate?: string, subMaxDate?: string): Promise<IspPage> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      minRunners: String(minRunners),
      maxRunners: String(maxRunners),
      minIsp: String(minIsp),
      maxIsp: String(maxIsp),
      sort: sortOrder,
      minInIspRange: String(minInIspRange),
      maxInIspRange: String(maxInIspRange),
      fromRow: String(fromRow),
    });
    if (countries.length > 0) params.set("countries", countries.join(","));
    if (toRow != null) params.set("toRow", String(toRow));
    if (minDate) params.set("minDate", minDate);
    if (maxDate) params.set("maxDate", maxDate);
    if (courses.length > 0) params.set("courses", courses.join(","));
    if (goings.length > 0) params.set("goings", goings.join(","));
    if (raceClasses.length > 0) params.set("raceClasses", raceClasses.join(","));
    if (raceTypes.length > 0) params.set("raceTypes", raceTypes.join(","));
    if (trainer) params.set("trainer", trainer);
    if (jockey) params.set("jockey", jockey);
    if (trainerFormMinWinRate != null) params.set("trainerFormMinWinRate", String(trainerFormMinWinRate));
    if (minTrainerFormRunners != null) params.set("minTrainerFormRunners", String(minTrainerFormRunners));
    if (maxTrainerFormRunners != null) params.set("maxTrainerFormRunners", String(maxTrainerFormRunners));
    if (runnerName) params.set("runnerName", runnerName);
    if (minModelWinProbability != null) params.set("minModelWinProbability", String(minModelWinProbability));
    if (onlyModelBeatsSp) params.set("onlyModelBeatsSp", "true");
    if (modelVersionId) params.set("modelVersionId", modelVersionId);
    // Restricts an already row-ranged (fromRow/toRow) window to a calendar
    // sub-range without changing what "row N" means — see the DAO's own
    // comment on subMinRaceTime/subMaxRaceTime. Distinct from minDate/
    // maxDate above, which participate in defining the row range itself.
    if (subMinDate) params.set("subMinDate", subMinDate);
    if (subMaxDate) params.set("subMaxDate", subMaxDate);
    const response = await fetch(
      `${this.baseUrl}/api/industry-sp?${params}`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch industry SP");
    return response.json();
  }

  // Runner-level rows for the Model vs SP screen.
  //
  // A params OBJECT, deliberately unlike getIndustrySp above — that method has
  // 29 positional arguments, and adding a 30th through 40th here would make the
  // smell terminal. Matches the shape the backend DAO/service already take
  // (getModelVsSpRunners).
  //
  // Every numeric is serialised with `!= null`, never a truthiness check: 0 is a
  // legitimate value for the difference bounds (maxAbsEdge=0 means "only runners
  // whose gap is exactly zero"), and `if (q.maxAbsEdge)` would drop it and let
  // the server's own 100 default silently win.
  async getModelVsSp(q: ModelVsSpQuery = {}): Promise<ModelVsSpPage> {
    const params = new URLSearchParams();
    const numericKeys: (keyof ModelVsSpQuery)[] = [
      "page",
      "limit",
      "minModelProb",
      "maxModelProb",
      "minImpliedProb",
      "maxImpliedProb",
      "minAbsEdge",
      "maxAbsEdge",
      "minIsp",
      "maxIsp",
      "minRunners",
      "maxRunners",
    ];
    for (const key of numericKeys) {
      const value = q[key];
      if (value != null) params.set(key, String(value));
    }
    if (q.sort) params.set("sort", q.sort);
    if (q.minDate) params.set("minDate", q.minDate);
    if (q.maxDate) params.set("maxDate", q.maxDate);
    if (q.countries?.length) params.set("countries", q.countries.join(","));
    // Only ever written when explicitly false — the server defaults it to true,
    // so an absent param and `includeTotal=true` mean the same thing.
    if (q.includeTotal === false) params.set("includeTotal", "false");

    const response = await fetch(`${this.baseUrl}/api/model-vs-sp?${params}`, { headers: this.authHeader() });
    if (!response.ok) throw new Error("Failed to fetch model vs SP");
    return response.json();
  }

  // Every model version (training params + performance metrics), newest
  // first — backs the Model Performance Dashboard's version table.
  async getModelVersions(): Promise<ModelVersionsResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/model-versions`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch model versions");
    return response.json();
  }

  // Persists the current Industry SP filter set as a named "Result" — a
  // static PnL + graph snapshot computed once on the backend at save time,
  // never recomputed on view. `filters` should be exactly
  // window.location.search's params (Object.fromEntries(new
  // URLSearchParams(...))) right after Apply, so the saved snapshot always
  // matches what the Filters screen actually showed.
  async saveFilterSet(filters: Record<string, string>, name?: string): Promise<SavedFilterSetResponse> {
    const response = await fetch(`${this.baseUrl}/api/saved-filter-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader() },
      body: JSON.stringify({ name, filters }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Failed to save result");
    }
    return response.json();
  }

  async getSavedFilterSets(): Promise<SavedFilterSetsResponse> {
    const response = await fetch(`${this.baseUrl}/api/saved-filter-sets`, { headers: this.authHeader() });
    if (!response.ok) throw new Error("Failed to fetch saved results");
    return response.json();
  }

  async getSavedFilterSet(id: string): Promise<SavedFilterSetResponse> {
    const response = await fetch(`${this.baseUrl}/api/saved-filter-sets/${id}`, { headers: this.authHeader() });
    if (!response.ok) throw new Error("Failed to fetch saved result");
    return response.json();
  }

  async deleteSavedFilterSet(id: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/saved-filter-sets/${id}`, {
      method: "DELETE",
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to delete saved result");
    return response.json();
  }

  async getLiveFilterPerformance(id: string): Promise<LiveFilterResultsResponse> {
    const response = await fetch(`${this.baseUrl}/api/saved-filter-sets/${id}/live-performance`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch live performance");
    return response.json();
  }

  // Combines every request the /isp home page needs on first load — grand
  // total, Race A + Race B splits, filter bounds, country list — into one
  // round trip. See getSplitStats on the backend for why: up to 5 separate
  // concurrent requests each risked their own Lambda cold start, and worse,
  // all hammered Atlas M0's limited concurrent-connection throughput at
  // once (confirmed via CloudWatch: individual invocations spiking to
  // 20-30s, some hitting the hard 30s timeout, specifically under
  // concurrent load). Collapsing to one invocation also means the browser
  // no longer waits a full round trip to learn the grand total before it
  // even knows what split boundaries to ask for.
  //
  // fromRowA/toRowA/fromRowB/toRowB are all optional — omit all four to
  // let the backend compute an even first-half/second-half default split
  // from the grand total.
  async getIndustrySpSplits(
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    minInIspRange = 1,
    maxInIspRange = 10000,
    fromRowA?: number,
    toRowA?: number,
    fromRowB?: number,
    toRowB?: number,
    minDate?: string,
    maxDate?: string,
    courses: string[] = [],
    goings: string[] = [],
    raceClasses: string[] = [],
    raceTypes: string[] = [],
    trainer?: string,
    jockey?: string,
    trainerFormMinWinRate?: number,
    minTrainerFormRunners?: number,
    maxTrainerFormRunners?: number,
    minModelWinProbability?: number,
    onlyModelBeatsSp?: boolean
  ): Promise<IspSplitsResponse> {
    const params = new URLSearchParams({
      minRunners: String(minRunners),
      maxRunners: String(maxRunners),
      minIsp: String(minIsp),
      maxIsp: String(maxIsp),
      minInIspRange: String(minInIspRange),
      maxInIspRange: String(maxInIspRange),
    });
    if (countries.length > 0) params.set("countries", countries.join(","));
    if (fromRowA != null) params.set("fromRowA", String(fromRowA));
    if (toRowA != null) params.set("toRowA", String(toRowA));
    if (fromRowB != null) params.set("fromRowB", String(fromRowB));
    if (toRowB != null) params.set("toRowB", String(toRowB));
    if (minDate) params.set("minDate", minDate);
    if (maxDate) params.set("maxDate", maxDate);
    if (courses.length > 0) params.set("courses", courses.join(","));
    if (goings.length > 0) params.set("goings", goings.join(","));
    if (raceClasses.length > 0) params.set("raceClasses", raceClasses.join(","));
    if (raceTypes.length > 0) params.set("raceTypes", raceTypes.join(","));
    if (trainer) params.set("trainer", trainer);
    if (jockey) params.set("jockey", jockey);
    if (trainerFormMinWinRate != null) params.set("trainerFormMinWinRate", String(trainerFormMinWinRate));
    if (minTrainerFormRunners != null) params.set("minTrainerFormRunners", String(minTrainerFormRunners));
    if (maxTrainerFormRunners != null) params.set("maxTrainerFormRunners", String(maxTrainerFormRunners));
    if (minModelWinProbability != null) params.set("minModelWinProbability", String(minModelWinProbability));
    if (onlyModelBeatsSp) params.set("onlyModelBeatsSp", "true");
    const response = await fetch(
      `${this.baseUrl}/api/industry-sp/splits?${params}`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch industry SP splits");
    return response.json();
  }

  // Cumulative ROI% convergence series for the "P&L graph" — one point per
  // race from row 1 up to toRow (the upper limit of Split B), showing how
  // the running profit % is volatile over a small sample and settles down
  // as more races are included.
  async getIndustrySpRaceConvergence(
    toRow: number,
    fromRow = 1,
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    minInIspRange = 1,
    maxInIspRange = 10000,
    minDate?: string,
    maxDate?: string,
    courses: string[] = [],
    goings: string[] = [],
    raceClasses: string[] = [],
    raceTypes: string[] = [],
    trainer?: string,
    jockey?: string,
    trainerFormMinWinRate?: number,
    minTrainerFormRunners?: number,
    maxTrainerFormRunners?: number,
    minModelWinProbability?: number,
    onlyModelBeatsSp?: boolean
  ): Promise<{ success: boolean; data: RaceConvergencePoint[]; count: number }> {
    const params = new URLSearchParams({
      toRow: String(toRow),
      fromRow: String(fromRow),
      minRunners: String(minRunners),
      maxRunners: String(maxRunners),
      minIsp: String(minIsp),
      maxIsp: String(maxIsp),
      minInIspRange: String(minInIspRange),
      maxInIspRange: String(maxInIspRange),
    });
    if (countries.length > 0) params.set("countries", countries.join(","));
    if (minDate) params.set("minDate", minDate);
    if (maxDate) params.set("maxDate", maxDate);
    if (courses.length > 0) params.set("courses", courses.join(","));
    if (goings.length > 0) params.set("goings", goings.join(","));
    if (raceClasses.length > 0) params.set("raceClasses", raceClasses.join(","));
    if (raceTypes.length > 0) params.set("raceTypes", raceTypes.join(","));
    if (trainer) params.set("trainer", trainer);
    if (jockey) params.set("jockey", jockey);
    if (trainerFormMinWinRate != null) params.set("trainerFormMinWinRate", String(trainerFormMinWinRate));
    if (minTrainerFormRunners != null) params.set("minTrainerFormRunners", String(minTrainerFormRunners));
    if (maxTrainerFormRunners != null) params.set("maxTrainerFormRunners", String(maxTrainerFormRunners));
    if (minModelWinProbability != null) params.set("minModelWinProbability", String(minModelWinProbability));
    if (onlyModelBeatsSp) params.set("onlyModelBeatsSp", "true");
    const response = await fetch(
      `${this.baseUrl}/api/industry-sp/race-convergence?${params}`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch race convergence series");
    return response.json();
  }

  async getIspPnlStats(): Promise<PnlStats> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/pnl-stats`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch ISP P&L stats");
    const result = await response.json();
    return result.data;
  }

  async getIspMeeting(meetingId: string): Promise<IspRace[]> {
    const response = await fetch(
      `${this.baseUrl}/api/industry-sp/meeting/${encodeURIComponent(meetingId)}`,
      { headers: this.authHeader() }
    );
    if (!response.ok) throw new Error("Failed to fetch meeting");
    const result = await response.json();
    return result.data;
  }

  async getIspRace(raceId: number): Promise<IspRace> {
    const response = await fetch(`${this.baseUrl}/api/industry-sp/race/${raceId}`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch race");
    const result = await response.json();
    return result.data;
  }

  async getDailyRaces(date?: string): Promise<DailyRace[]> {
    const params = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await fetch(`${this.baseUrl}/api/daily-races${params}`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch daily races");
    const result = await response.json();
    return result.data;
  }

  async getDailyRacesByEvent(eventId: string): Promise<DailyRace[]> {
    const response = await fetch(`${this.baseUrl}/api/daily-races/event/${encodeURIComponent(eventId)}`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch daily races event");
    const result = await response.json();
    return result.data;
  }

  async getDailyRace(raceId: string): Promise<DailyRace> {
    const response = await fetch(`${this.baseUrl}/api/daily-races/race/${encodeURIComponent(raceId)}`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch daily race");
    const result = await response.json();
    return result.data;
  }

  // Manual "try to fetch results now" for a given date — see
  // DailyRacesScreen.tsx's missing-results prompt. Deliberately never
  // throws on a non-2xx from the endpoint itself: a "plan_required"
  // outcome (the racing-data provider only allows fetching today's
  // results on the current plan) is an expected, plain-language result
  // the caller renders inline, not an exception.
  async reseedDailyRaceResults(date: string): Promise<ReseedResultsResult> {
    const response = await fetch(`${this.baseUrl}/api/daily-races/reseed-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader() },
      body: JSON.stringify({ date }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: "request_failed", message: "Something went wrong — please try again later." };
    }
    return result;
  }

  // Creates a real bet order — see AGENTS.md's daily-races-bet-button and
  // instant-bet-orders entries. For orderType "scheduled" (the original
  // flow), this call never itself bets real money: the order is only
  // watched (and, once real credentials + dryRun:false are both configured
  // on the backend, potentially acted on) by a scheduled evaluator, not
  // this call. For orderType "instant", this call places (or, while
  // dryRun stays at its default true, simulates placing) the bet
  // synchronously, right now.
  async createBetOrder(input: CreateBetOrderInput): Promise<BetOrder> {
    const response = await fetch(`${this.baseUrl}/api/bet-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader() },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Failed to schedule bet");
    }
    const result = await response.json();
    return result.data;
  }

  async getBetOrders(): Promise<BetOrder[]> {
    const response = await fetch(`${this.baseUrl}/api/bet-orders`, { headers: this.authHeader() });
    if (!response.ok) throw new Error("Failed to fetch scheduled bets");
    const result = await response.json();
    return result.data;
  }

  async cancelBetOrder(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/bet-orders/${id}`, {
      method: "DELETE",
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to cancel bet");
  }

  // Never throws on a per-pick failure — the backend always returns
  // {price: null, note} for a pick it can't get a live price for (no
  // credentials configured, market unresolved, etc.), so a partial/empty
  // result is a normal, expected response here, not an error.
  async getLivePrices(picks: LivePriceRequestPick[]): Promise<Record<string, LivePrice>> {
    if (picks.length === 0) return {};
    const response = await fetch(`${this.baseUrl}/api/daily-races/live-prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader() },
      body: JSON.stringify({ picks }),
    });
    if (!response.ok) throw new Error("Failed to fetch live prices");
    const result = await response.json();
    return result.data;
  }

  async getTrainerForm(trainer: string, formCategory: TrainerFormCategory): Promise<TrainerFormDoc | null> {
    const params = new URLSearchParams({ trainer, formCategory });
    const response = await fetch(`${this.baseUrl}/api/trainer-form?${params}`, {
      headers: this.authHeader(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to fetch trainer form");
    const result = await response.json();
    return result.data;
  }

  async getStats(): Promise<Stats> {
    const response = await fetch(`${this.baseUrl}/api/stats`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch stats");
    const result = await response.json();
    return result.data;
  }

  async getEventGroups(
    page: number = 1,
    limit: number = 20,
    sort: "asc" | "desc" = "asc"
  ): Promise<{ data: EventGroup[]; total: number; totalPages: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
    const response = await fetch(`${this.baseUrl}/api/events/grouped?${params}`, {
      headers: this.authHeader(),
    });
    if (!response.ok) throw new Error("Failed to fetch event groups");
    const result = await response.json();
    return { data: result.data, total: result.total, totalPages: result.totalPages };
  }

  async sendMessage(message: string, history: ChatHistoryTurn[] = []): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeader(),
        },
        body: JSON.stringify({ query: message, history }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return {
          reply: `Error: ${result.error || "Failed to process query"}`,
          success: false,
          error: result.error,
        };
      }

      return {
        reply: result.reply,
        success: true,
      };
    } catch (error) {
      console.error("Error calling chat API:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      return {
        reply: `Connection error: Unable to reach the server. Please make sure the server is running on ${this.baseUrl}. Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }


  // Removed hardcoded formatting methods - now using AI formatting
  /*
  private formatPriceUpdates(results: any[], query?: string): string {
    let formatted = "";

    // Debug: Log the structure of the first result
    if (results.length > 0) {
      console.log("🔍 Price update result structure:", {
        keys: Object.keys(results[0]),
        sample: results[0],
        isSingleFieldDisplay:
          results[0]._id === undefined && Object.keys(results[0]).length === 1,
        fieldName: Object.keys(results[0])[0],
      });
    }

    // Check if this is a simplified single-field display
    // When projection is used, only the specified fields exist and _id is excluded
    const isSingleFieldDisplay =
      results.length > 0 &&
      results[0]._id === undefined && // _id should be excluded in projection
      Object.keys(results[0]).length === 1; // Only one field exists

    // Get the field name for display
    const fieldName = isSingleFieldDisplay ? Object.keys(results[0])[0] : null;

    // Check if this is a price analysis query that should use enhanced formatting
    const isPriceAnalysisQuery =
      query &&
      (query.toLowerCase().includes("price movement analysis") ||
        query.toLowerCase().includes("price trend analysis") ||
        query.toLowerCase().includes("price volatility analysis") ||
        query.toLowerCase().includes("volatility analysis") ||
        query.toLowerCase().includes("trend analysis") ||
        query.toLowerCase().includes("price analysis") ||
        query.toLowerCase().includes("analyze price") ||
        query.toLowerCase().includes("show me price movement") ||
        query.toLowerCase().includes("analyze price volatility") ||
        query.toLowerCase().includes("largest volatility") ||
        query.toLowerCase().includes("most volatile horses") ||
        query.toLowerCase().includes("biggest price swings") ||
        query.toLowerCase().includes("compare volatility across") ||
        query.toLowerCase().includes("volatility across all horses") ||
        query.toLowerCase().includes("horses with largest volatility") ||
        query.toLowerCase().includes("horses largest volatility") ||
        (query.toLowerCase().includes("show me horses") &&
          query.toLowerCase().includes("volatility")) ||
        query.toLowerCase().includes("find most volatile") ||
        query.toLowerCase().includes("volatility ranking") ||
        query.toLowerCase().includes("volatility leaderboard")) &&
      results.length > 0 &&
      results[0].lastTradedPrice !== undefined &&
      results[0].timestamp !== undefined;

    // Fallback: Check if user specifically requested prices only
    const userWantsPricesOnly =
      query &&
      (query.toLowerCase().includes("prices only") ||
        query.toLowerCase().includes("just the prices") ||
        query.toLowerCase().includes("simple list") ||
        query.toLowerCase().includes("numbers only") ||
        query.toLowerCase().includes("i want to see prices only"));

    if (isPriceAnalysisQuery) {
      console.log("📊 Detected price analysis query, showing enhanced format");
      return this.formatPriceAnalysis(results, query);
    } else if (isSingleFieldDisplay || userWantsPricesOnly) {
      if (fieldName) {
        console.log(`✅ Detected single-field display for: ${fieldName}`);
        // Simple single-field list format
        results.forEach((update, index) => {
          formatted += `${update[fieldName]}\n`;
        });
      } else {
        console.log("❌ Field name not detected, falling back to full format");
        // Fallback to full format if field name detection fails
        results.forEach((update, index) => {
          formatted += `${index + 1}. **${update.runnerName}**\n`;
          formatted += `   - Market: ${update.marketId}\n`;
          formatted += `   - Last Traded Price: ${update.lastTradedPrice}\n`;
          formatted += `   - Event: ${update.eventName}\n`;
          formatted += `   - Timestamp: ${new Date(update.timestamp).toLocaleString()}\n\n`;
        });
      }
    } else {
      console.log("📋 Showing full details format");
      // Full details format
      results.forEach((update, index) => {
        formatted += `${index + 1}. **${update.runnerName}**\n`;
        formatted += `   - Market: ${update.marketId}\n`;
        formatted += `   - Last Traded Price: ${update.lastTradedPrice}\n`;
        formatted += `   - Event: ${update.eventName}\n`;
        formatted += `   - Timestamp: ${new Date(update.timestamp).toLocaleString()}\n\n`;
      });
    }

    return formatted;
  }

  private formatPriceAnalysis(results: any[], query: string): string {
    let formatted = "";

    // Check if this is a cross-market volatility analysis query
    const isCrossMarketVolatilityQuery =
      query &&
      (query.toLowerCase().includes("largest volatility") ||
        query.toLowerCase().includes("most volatile horses") ||
        query.toLowerCase().includes("biggest price swings") ||
        query.toLowerCase().includes("compare volatility across") ||
        query.toLowerCase().includes("volatility across all horses") ||
        query.toLowerCase().includes("horses with largest volatility") ||
        query.toLowerCase().includes("horses largest volatility") ||
        (query.toLowerCase().includes("show me horses") &&
          query.toLowerCase().includes("volatility")) ||
        query.toLowerCase().includes("find most volatile") ||
        query.toLowerCase().includes("volatility ranking") ||
        query.toLowerCase().includes("volatility leaderboard"));

    console.log("🔍 Cross-market volatility detection:", {
      query: query,
      queryLower: query?.toLowerCase(),
      isCrossMarketVolatilityQuery: isCrossMarketVolatilityQuery,
      includesLargestVolatility: query
        ?.toLowerCase()
        .includes("largest volatility"),
      includesHorsesLargestVolatility: query
        ?.toLowerCase()
        .includes("horses largest volatility"),
      includesShowMeHorses: query?.toLowerCase().includes("show me horses"),
      includesVolatility: query?.toLowerCase().includes("volatility"),
      showMeHorsesAndVolatility:
        query?.toLowerCase().includes("show me horses") &&
        query?.toLowerCase().includes("volatility"),
    });

    // Group results by runner if multiple runners exist
    const runners = new Map<string, any[]>();

    results.forEach(update => {
      const runnerName = update.runnerName || "Unknown Runner";
      if (!runners.has(runnerName)) {
        runners.set(runnerName, []);
      }
      runners.get(runnerName)!.push(update);
    });

    if (isCrossMarketVolatilityQuery) {
      console.log(
        "🌍 Detected cross-market volatility query, showing leaderboard"
      );
      return this.formatVolatilityLeaderboard(runners);
    }

    // Format each runner's price analysis
    runners.forEach((updates, runnerName) => {
      // Sort updates by timestamp (most recent first)
      updates.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      formatted += `**${runnerName}** - Price Movement Analysis:\n`;

      // Calculate volatility metrics
      const prices = updates.map(u => u.lastTradedPrice);
      const volatility = this.calculateVolatility(prices);

      // Show recent price changes with trend arrows and percentages
      const recentUpdates = updates.slice(0, 10); // Show last 10 updates

      recentUpdates.forEach((update, index) => {
        const timestamp = new Date(update.timestamp).toLocaleTimeString(
          "en-GB",
          {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }
        );

        let trendInfo = "";
        if (index < recentUpdates.length - 1) {
          const currentPrice = update.lastTradedPrice;
          const previousPrice = recentUpdates[index + 1].lastTradedPrice;
          const change = currentPrice - previousPrice;
          const percentageChange = ((change / previousPrice) * 100).toFixed(1);

          if (change > 0) {
            trendInfo = ` ⬆️ +${percentageChange}%`;
          } else if (change < 0) {
            trendInfo = ` ⬇️ ${percentageChange}%`;
          } else {
            trendInfo = ` ➡️ 0%`;
          }
        }

        formatted += `${timestamp} → ${update.lastTradedPrice}${trendInfo}\n`;
      });

      // Add volatility assessment
      formatted += `\n**Volatility Assessment:** ${volatility.rating} (${volatility.description})\n`;
      formatted += `- Price Range: ${volatility.minPrice} - ${volatility.maxPrice}\n`;
      formatted += `- Average Price: ${volatility.averagePrice.toFixed(1)}\n`;
      formatted += `- Total Changes: ${updates.length}\n\n`;
    });

    return formatted;
  }

  private formatVolatilityLeaderboard(runners: Map<string, any[]>): string {
    let formatted = "🏆 **Volatility Leaderboard - All Horses**\n\n";

    // Calculate volatility for each runner
    const volatilityScores: Array<{
      runnerName: string;
      volatility: any;
      updates: any[];
    }> = [];

    runners.forEach((updates, runnerName) => {
      const prices = updates.map(u => u.lastTradedPrice);
      const volatility = this.calculateVolatility(prices);
      volatilityScores.push({ runnerName, volatility, updates });
    });

    // Sort by volatility (highest first)
    volatilityScores.sort((a, b) => {
      const aScore = this.getVolatilityScore(a.volatility.rating);
      const bScore = this.getVolatilityScore(b.volatility.rating);
      if (aScore !== bScore) {
        return bScore - aScore; // Higher score first
      }
      // If same rating, sort by price range percentage
      return (
        b.volatility.averagePricePercent - a.volatility.averagePricePercent
      );
    });

    // Show top 10 most volatile horses
    const topVolatile = volatilityScores.slice(0, 10);

    formatted += `**Top ${topVolatile.length} Most Volatile Horses:**\n\n`;

    topVolatile.forEach((score, index) => {
      const medal =
        index === 0
          ? "🥇"
          : index === 1
            ? "🥈"
            : index === 2
              ? "🥉"
              : `${index + 1}.`;
      formatted += `${medal} **${score.runnerName}**\n`;
      formatted += `   - Volatility: ${score.volatility.rating} (${score.volatility.description})\n`;
      formatted += `   - Price Range: ${score.volatility.minPrice} - ${score.volatility.maxPrice}\n`;
      formatted += `   - Average Price: ${score.volatility.averagePrice.toFixed(1)}\n`;
      formatted += `   - Price Swing: ${(((score.volatility.maxPrice - score.volatility.minPrice) / score.volatility.averagePrice) * 100).toFixed(1)}%\n`;
      formatted += `   - Total Changes: ${score.updates.length}\n\n`;
    });

    // Add summary statistics
    const totalHorses = volatilityScores.length;
    const extremeCount = volatilityScores.filter(
      s => s.volatility.rating === "Extreme"
    ).length;
    const highCount = volatilityScores.filter(
      s => s.volatility.rating === "High"
    ).length;
    const mediumCount = volatilityScores.filter(
      s => s.volatility.rating === "Medium"
    ).length;
    const lowCount = volatilityScores.filter(
      s => s.volatility.rating === "Low" || s.volatility.rating === "Very Low"
    ).length;

    formatted += `**📊 Market Volatility Summary:**\n`;
    formatted += `- Total Horses Analyzed: ${totalHorses}\n`;
    formatted += `- Extreme Volatility: ${extremeCount} (${((extremeCount / totalHorses) * 100).toFixed(1)}%)\n`;
    formatted += `- High Volatility: ${highCount} (${((highCount / totalHorses) * 100).toFixed(1)}%)\n`;
    formatted += `- Medium Volatility: ${mediumCount} (${((mediumCount / totalHorses) * 100).toFixed(1)}%)\n`;
    formatted += `- Low/Very Low Volatility: ${lowCount} (${((lowCount / totalHorses) * 100).toFixed(1)}%)\n\n`;

    return formatted;
  }

  private getVolatilityScore(rating: string): number {
    switch (rating) {
      case "Extreme":
        return 5;
      case "High":
        return 4;
      case "Medium":
        return 3;
      case "Low":
        return 2;
      case "Very Low":
        return 1;
      default:
        return 0;
    }
  }

  private calculateVolatility(prices: number[]): {
    rating: string;
    description: string;
    minPrice: number;
    maxPrice: number;
    averagePrice: number;
    averagePricePercent: number;
  } {
    if (prices.length < 2) {
      return {
        rating: "Low",
        description: "Insufficient data for volatility analysis",
        minPrice: prices[0] || 0,
        maxPrice: prices[0] || 0,
        averagePrice: prices[0] || 0,
        averagePricePercent: 0,
      };
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const averagePrice =
      prices.reduce((sum, price) => sum + price, 0) / prices.length;

    // Calculate price swings
    const priceRange = maxPrice - minPrice;
    const averagePricePercent = (priceRange / averagePrice) * 100;

    let rating: string;
    let description: string;

    if (averagePricePercent > 100) {
      rating = "Extreme";
      description = "Massive price swings with high volatility";
    } else if (averagePricePercent > 50) {
      rating = "High";
      description = "Significant price movements and volatility";
    } else if (averagePricePercent > 20) {
      rating = "Medium";
      description = "Moderate price changes with some volatility";
    } else if (averagePricePercent > 10) {
      rating = "Low";
      description = "Relatively stable prices with low volatility";
    } else {
      rating = "Very Low";
      description = "Very stable prices with minimal volatility";
    }

    return {
      rating,
      description,
      minPrice,
      maxPrice,
      averagePrice,
      averagePricePercent,
    };
  }

  private formatMarketStatuses(results: any[]): string {
    let formatted = "";
    results.forEach((status, index) => {
      formatted += `${index + 1}. **${status.eventName}**\n`;
      formatted += `   - Market ID: ${status.marketId}\n`;
      formatted += `   - Status: ${status.status}\n`;
      formatted += `   - Active Runners: ${status.numberOfActiveRunners}\n`;
      formatted += `   - Timestamp: ${new Date(status.timestamp).toLocaleString()}\n\n`;
    });
    return formatted;
  }
  */
}

export const chatApi = new ChatApi();
