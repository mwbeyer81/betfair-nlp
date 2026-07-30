import { BetOrderDAO, BetOrderDocument, BetOrderStatus, BetOrderType } from "../dao/bet-order-dao";
import { DatabaseConnection } from "../../config/database";
import { BetfairApiClient } from "./betfair-api-client";
import { resolveMarketForRace } from "./betfair-market-resolver";
import { DailyRaceService } from "./daily-race-service";

// Hard cap on every order in this system, regardless of who's placing it
// or which orderType — independent of (and in addition to) the
// liveBettingAllowed identity gate below, so a bug in that gate still
// can't expose more than this much real money on any single bet. Changing
// this is a deliberate code change + redeploy, not a runtime config value,
// since it's meant to be inconvenient to raise.
// £2, not £1 (the originally-requested figure) — Betfair's own real
// minimum stake for UK/Irish accounts is £2 (confirmed 2026-07-29, see
// AGENTS.md's min-stake-cap entry); a cap below Betfair's own minimum
// would mean no real bet could ever succeed regardless of funds, since
// every real attempt would fail on INVALID_BET_SIZE first.
export const MAX_LIVE_STAKE_GBP = 2;

// Best-effort translation of raw Betfair API-NG error codes (see
// betfair-api-client.ts's readApingErrorCode) into plain-English notes —
// surfaced directly to the user in "My Bets", so a bare enum-like code
// isn't the only thing they see when a real placement attempt fails.
// Falls back to the raw code/message untouched for anything not
// recognized here, same "never fabricate" spirit as the rest of this file.
const BETFAIR_ERROR_MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Your Betfair account doesn't have enough funds to cover this stake.",
  INVALID_SESSION_INFORMATION: "The Betfair session has expired — a fresh login is needed before more bets can be placed.",
  MARKET_SUSPENDED: "The market was suspended right as this bet was being placed — it may reopen shortly.",
  BET_ACTION_ERROR: "Betfair rejected this bet without a specific reason — check your account and try again.",
  INVALID_BET_SIZE: "The stake was outside the size Betfair allows for this market.",
  BET_IN_PROGRESS: "Another bet was already in progress on this account — try again shortly.",
  // Below: top-level PlaceExecutionReport.errorCode values (Betfair's
  // ExecutionReportErrorCode) — see betfair-api-client.ts's placeOrders
  // comment for why these are now surfaced ahead of the per-instruction
  // codes. 2026-07-29 correction (see AGENTS.md's betfair-error-code-fix
  // entry): an EARLIER version of this map guessed that ERROR_IN_ORDER
  // meant the account's free "Delay" application key couldn't place real
  // orders — that guess was never actually verified and real research
  // (Betfair's own developer forum + docs) contradicts it: Delay keys CAN
  // place real orders, and ERROR_IN_ORDER is documented as a cascading
  // per-instruction placeholder ("the action failed because the parent
  // order failed"), not an account-permission signal by itself — the
  // REAL cause is whatever this top-level errorCode says.
  PERMISSION_DENIED: "Betfair denied this account permission to place real orders — this may need resolving directly on Betfair's site (e.g. account verification, or the application key's access level).",
  INVALID_ACCOUNT_STATE: "Betfair reports this account is not in a state that allows betting right now — check your account status on Betfair's site.",
  INVALID_WALLET_STATUS: "Betfair reports a problem with this account's wallet — check your account on Betfair's site.",
  LOSS_LIMIT_EXCEEDED: "This bet would exceed a loss limit set on the Betfair account.",
  MARKET_NOT_OPEN_FOR_BETTING: "This market isn't open for betting right now (e.g. not yet released, or already closed).",
  ERROR_IN_ORDER: "Betfair rejected this order, but without a more specific reason available — check your account on Betfair's site.",
};

function humanizeBetfairError(rawError: string): string {
  return BETFAIR_ERROR_MESSAGES[rawError] ?? rawError;
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
  // User-controlled — see BetOrderDocument.sandbox's doc comment. Only
  // meaningful for orderType "instant" today (the only path with a UI
  // toggle for it); harmless if ever set on a scheduled order too, since
  // the same forced-simulation logic applies wherever it's read.
  sandbox?: boolean;
}

export interface BetOrderApiResponse {
  id: string;
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  // The race's own scheduled off (ISO, with offset) — the date a punter
  // thinks of a bet as belonging to, as opposed to createdAt (when the
  // order was placed, which can be a different day for a scheduled bet).
  // Exposed so the My Bets screen can filter by race date.
  offDt: string;
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
  // The real, settled result — see BetOrderService.refreshSettledResults.
  // Absent means "not settled yet" (or this was never a real bet), never
  // inferred client-side.
  betOutcome?: "WON" | "LOST" | "VOID" | string;
  settledProfit?: number;
  settledAt?: string;
  sandbox?: boolean;
}

function toApiResponse(doc: BetOrderDocument): BetOrderApiResponse {
  return {
    id: doc._id!.toString(),
    runnerId: doc.runnerId,
    horse: doc.horse,
    course: doc.course,
    offTime: doc.offTime,
    offDt: doc.offDt,
    raceId: doc.raceId,
    eventId: doc.eventId,
    targetProfit: doc.targetProfit,
    maxStake: doc.maxStake,
    minQualifyingPrice: doc.minQualifyingPrice,
    status: doc.status,
    // Docs created before this field existed have no orderType at all —
    // they were always the original (only) flow, i.e. "scheduled".
    orderType: doc.orderType ?? "scheduled",
    createdAt: doc.createdAt,
    matchedPrice: doc.matchedPrice,
    dryRun: doc.dryRun,
    note: doc.note,
    betOutcome: doc.betOutcome,
    settledProfit: doc.settledProfit,
    settledAt: doc.settledAt,
    // Absent on pre-sandbox-feature docs — always false, same direction as
    // the underlying document field.
    sandbox: doc.sandbox === true,
  };
}

export interface EvaluateSummary {
  evaluated: number;
  resolved: number;
  unmatched: number;
  triggered: number;
  expired: number;
  errors: number;
}

// How long past a race's own advertised off time an order keeps waiting for
// a qualifying price before being marked expired — races can go off a few
// minutes late, but a market long since in-play/closed has no realistic
// path to still filling a pre-off back order.
const EXPIRE_GRACE_MINUTES = 15;

export class BetOrderService {
  private dao: BetOrderDAO;
  private client: BetfairApiClient;
  private dailyRaceService: DailyRaceService;

  constructor(dao?: BetOrderDAO, client?: BetfairApiClient, dailyRaceService?: DailyRaceService) {
    if (dao) {
      this.dao = dao;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.dao = new BetOrderDAO(db);
    }
    this.client = client ?? new BetfairApiClient();
    this.dailyRaceService = dailyRaceService ?? new DailyRaceService();
  }

  public async createIndexes(): Promise<void> {
    await this.dao.createIndexes();
  }

  // requestingUserEmail comes from a server-side lookup (router.ts calls
  // authService.getMe(userId)) — NEVER trust an email supplied directly by
  // the client for this, since it's the sole input to the identity check
  // below and spoofing it would defeat the allow-list entirely.
  public async createForUser(
    userId: string,
    input: CreateBetOrderInput,
    requestingUserEmail: string | null
  ): Promise<BetOrderApiResponse> {
    if (!Number.isFinite(input.targetProfit) || input.targetProfit <= 0) {
      throw new Error("targetProfit must be a positive number");
    }
    if (!Number.isFinite(input.maxStake) || input.maxStake <= 0) {
      throw new Error("maxStake must be a positive number");
    }
    const allowedEmail = this.client.getLiveBettingAllowedEmail();
    const liveBettingAllowed = Boolean(allowedEmail) && requestingUserEmail?.toLowerCase() === allowedEmail;
    const sandbox = input.sandbox === true;
    // The cap only applies to requests that could ever actually go real —
    // everyone else's placeOrders call is always forced to simulate (see
    // forceDryRun below), so a large maxStake from them poses no real
    // financial risk and shouldn't be blocked. Sandbox orders are exempt
    // for the same reason: sandbox unconditionally forces a simulated
    // placement (see placeInstant), so they can never spend real money no
    // matter who's placing them — letting a sandbox stake exceed the real
    // cap is what makes it useful for realistically testing PnL tracking.
    // Checked here rather than only inside BetfairApiClient because a
    // scheduled order's liveBettingAllowed is fixed at creation time but
    // its real/simulated outcome isn't decided until the cron evaluates it
    // later — this cap must hold regardless of what the global dryRun
    // switch is at that later point.
    if (liveBettingAllowed && !sandbox && input.maxStake > MAX_LIVE_STAKE_GBP) {
      throw new Error(`maxStake cannot exceed £${MAX_LIVE_STAKE_GBP} while live-betting safety limits are in effect`);
    }

    const now = new Date().toISOString();
    const base = {
      userId,
      runnerId: input.runnerId,
      horse: input.horse,
      course: input.course,
      offTime: input.offTime,
      offDt: input.offDt,
      raceId: input.raceId,
      eventId: input.eventId,
      targetProfit: input.targetProfit,
      maxStake: input.maxStake,
      minQualifyingPrice: 1 + input.targetProfit / input.maxStake,
      orderType: input.orderType,
      liveBettingAllowed,
      sandbox,
      createdAt: now,
      updatedAt: now,
    };

    if (input.orderType === "scheduled") {
      return toApiResponse(await this.dao.create({ ...base, status: "pending" }));
    }
    return toApiResponse(await this.placeInstant(base));
  }

  // A real (or attempted-real) placeOrders call succeeded/failed, but the
  // Mongo write recording it then threw — the single most dangerous error
  // shape in this file once liveBettingAllowed can be true, since a real
  // bet may already sit on the account with no local record of it. Logs
  // everything needed to manually reconcile against the real Betfair
  // account (marketId/selectionId/betId/price/size), loudly, rather than
  // letting it disappear into a generic 500.
  private logPossiblePhantomRealBet(
    context: string,
    details: Record<string, unknown>,
    persistError: unknown
  ): void {
    console.error(
      `PHANTOM REAL BET RISK — ${context}: a Betfair placeOrders call completed but the result could not be saved. ` +
        `Manual reconciliation against the real Betfair account may be required. Details: ${JSON.stringify(details)}`,
      persistError
    );
  }

  // Synchronous, single-shot counterpart to evaluateOne below: resolves the
  // market and checks the price condition once, right now, instead of
  // persisting "pending" for the cron evaluator to watch over time. No
  // tryTransition CAS here — unlike evaluateOne (which guards against two
  // overlapping/retried scheduled-evaluator invocations racing the same
  // already-persisted order), nothing else can race a single request's own
  // not-yet-persisted instant placement, so there's no double-bet risk to
  // guard against. A pre-flight rejection (bad market match, price not
  // qualifying) throws and is never persisted at all — the router maps
  // that to a 400, since nothing was placed and there's nothing to show
  // the user in "My Bets".
  private async placeInstant(base: Omit<BetOrderDocument, "_id" | "status">): Promise<BetOrderDocument> {
    const resolution = await resolveMarketForRace(this.client, { course: base.course, offDt: base.offDt }, base.horse);
    if (!resolution.ok) {
      throw new Error(`INSTANT_BET_REJECTED: ${resolution.failure.detail}`);
    }
    const { marketId, selectionId } = resolution.resolved;

    const books = await this.client.listMarketBook([marketId]);
    const book = books[0];
    const runner = book?.runners.find(r => r.selectionId === selectionId);
    const bestBackPrice = runner?.ex?.availableToBack?.[0]?.price;

    if (!book || book.inplay || runner?.status !== "ACTIVE" || book.status === "CLOSED") {
      throw new Error("INSTANT_BET_REJECTED: Market is in-play, closed, or the runner is no longer active.");
    }
    if (bestBackPrice == null || bestBackPrice < base.minQualifyingPrice) {
      throw new Error(
        `INSTANT_BET_REJECTED: current best back price (${bestBackPrice ?? "unavailable"}) is below ` +
          `your minimum qualifying price (${base.minQualifyingPrice.toFixed(2)}) — nothing was placed.`
      );
    }

    // Sandbox unconditionally forces simulation, on top of (not instead
    // of) the identity gate — a bet the user explicitly marked "sandbox"
    // must never place real money even if liveBettingAllowed is somehow
    // true, so this can't be expressed as "only check one or the other".
    const result = await this.client.placeOrders(marketId, selectionId, bestBackPrice, base.maxStake, {
      forceDryRun: !base.liveBettingAllowed || base.sandbox === true,
    });
    // Real money only actually moved if this specific request was
    // allowed, NOT marked sandbox, AND the account-wide dryRun switch was
    // off — result.outcome alone can't distinguish "forced dry run" from
    // "the master switch was already off", so this is the one place that
    // knows for sure.
    const wasRealAttempt = base.liveBettingAllowed === true && base.sandbox !== true && !this.client.isDryRun();

    if (result.outcome === "FAILURE") {
      // A real attempt was made against the live API and rejected —
      // persisted as "error" (not thrown) so the user has a durable record
      // of it, mirroring evaluateOne's FAILURE handling below.
      try {
        return await this.dao.create({
          ...base,
          status: "error",
          betfairMarketId: marketId,
          betfairSelectionId: selectionId,
          note: humanizeBetfairError(result.error),
        });
      } catch (persistError) {
        this.logPossiblePhantomRealBet(
          "instant bet FAILURE result could not be persisted",
          { wasRealAttempt, marketId, selectionId, error: result.error, userId: base.userId },
          persistError
        );
        throw new Error(
          "INSTANT_BET_PERSISTENCE_FAILED: The bet attempt failed and the failure itself couldn't be saved — " +
            "please check My Bets and try again."
        );
      }
    }
    try {
      return await this.dao.create({
        ...base,
        status: "triggered",
        betfairMarketId: marketId,
        betfairSelectionId: selectionId,
        matchedPrice: result.outcome === "SUCCESS" ? result.matchedPrice : result.simulatedPrice,
        betfairBetId: result.outcome === "SUCCESS" ? result.betId : undefined,
        dryRun: result.outcome === "DRY_RUN",
        note: result.outcome === "DRY_RUN" ? "Dry run — no real bet was placed." : undefined,
      });
    } catch (persistError) {
      this.logPossiblePhantomRealBet(
        "instant bet SUCCESS/DRY_RUN result could not be persisted",
        {
          wasRealAttempt,
          marketId,
          selectionId,
          betId: result.outcome === "SUCCESS" ? result.betId : undefined,
          matchedPrice: result.outcome === "SUCCESS" ? result.matchedPrice : result.simulatedPrice,
          userId: base.userId,
        },
        persistError
      );
      throw new Error(
        wasRealAttempt
          ? "INSTANT_BET_PERSISTENCE_FAILED: A real bet may have just been placed on your Betfair account, but " +
            "the record of it could not be saved here — check your real Betfair account directly before placing " +
            "another bet, and contact support with this timestamp."
          : "INSTANT_BET_PERSISTENCE_FAILED: The bet result could not be saved — please check My Bets before retrying."
      );
    }
  }

  public async listForUser(userId: string): Promise<BetOrderApiResponse[]> {
    // Best-effort — a Betfair/daily-race hiccup here must never break the
    // list itself, since the user still needs to see their orders even if
    // we can't confirm a settled result on this particular request.
    try {
      await this.refreshSettledResults(userId);
    } catch (error) {
      console.error("refreshSettledResults failed (non-fatal, list still returned):", error);
    }
    try {
      await this.refreshSandboxResults(userId);
    } catch (error) {
      console.error("refreshSandboxResults failed (non-fatal, list still returned):", error);
    }
    const docs = await this.dao.listByUser(userId);
    return docs.map(toApiResponse);
  }

  // Pulls the real, settled result for any of this user's real bets that
  // are triggered, actually placed on Betfair (have a betfairBetId), and
  // not yet known to be settled. A no-op (no network call) whenever there
  // are none — the common case, since only the allow-listed user's bets
  // ever have a real betfairBetId at all. Betfair's own listClearedOrders
  // simply omits a betId from the response until that specific order has
  // actually settled — an order not coming back in the response means
  // "still not settled", not an error, and is silently left alone to be
  // checked again on the next call.
  private async refreshSettledResults(userId: string): Promise<void> {
    const docs = await this.dao.listByUser(userId);
    const unsettled = docs.filter(
      d => d.dryRun === false && d.status === "triggered" && d.betfairBetId && d.betOutcome === undefined
    );
    if (unsettled.length === 0) return;

    const betIds = unsettled.map(d => d.betfairBetId!);
    const cleared = await this.client.listClearedOrders(betIds);
    const clearedByBetId = new Map(cleared.map(c => [c.betId, c]));

    for (const doc of unsettled) {
      const result = clearedByBetId.get(doc.betfairBetId!);
      if (!result) continue; // not settled yet — check again next time
      await this.dao.updateFields(doc._id!, {
        betOutcome: result.betOutcome,
        settledProfit: result.profit,
        settledAt: result.settledDate,
        // Betfair's settled record is the authoritative matched price —
        // the one captured at placement time is only ever provisional,
        // since an order can fill after placeOrders has already returned
        // (see betfair-api-client.ts's matched-price-zero comment) or fill
        // better than requested (confirmed live: bet 436580966910 was
        // requested at 3.4 and matched at 3.8). Only overwrite when
        // Betfair actually reports a positive price, so a settled order
        // without one (e.g. a VOID) never clobbers a good stored value
        // with 0/undefined.
        ...(typeof result.priceMatched === "number" && result.priceMatched > 0
          ? { matchedPrice: result.priceMatched }
          : {}),
      });
    }
  }

  // Sandbox counterpart to refreshSettledResults above — a sandbox order
  // never reaches Betfair for real (see placeInstant's forceDryRun), so
  // there's no real betfairBetId to check listClearedOrders against.
  // Instead, settles against this app's own real race-result data (the
  // same DailyRaceService.getDailyRaceById(...).runners[].result the
  // Industry SP / Saved Results PnL screens already use), reusing a real
  // market price (matchedPrice, captured at placement time from the same
  // real order book an allowed user's bet would have used) — so sandbox
  // PnL reflects what would genuinely have happened, not a fabricated
  // number. A no-op (no DB lookups beyond the initial list) whenever
  // there's nothing sandboxed and unsettled — the common case for most
  // users, who have never touched the sandbox toggle at all.
  private async refreshSandboxResults(userId: string): Promise<void> {
    const docs = await this.dao.listByUser(userId);
    const unsettled = docs.filter(
      d => d.sandbox === true && d.status === "triggered" && d.matchedPrice != null && d.betOutcome === undefined
    );
    if (unsettled.length === 0) return;

    // One getDailyRaceById call per distinct race, not per order — several
    // sandbox orders can share the same race (e.g. testing multiple
    // runners), and this mirrors refreshSettledResults' own "batch, don't
    // n+1" shape even though the underlying call here is per-race rather
    // than a single multi-id batch endpoint (DailyRaceService has no
    // batch-by-raceId-list method exposed at this granularity — see
    // AGENTS.md's sandbox-bets entry for why per-race was chosen over
    // building one).
    const raceIds = Array.from(new Set(unsettled.map(d => d.raceId)));
    const raceById = new Map(
      await Promise.all(raceIds.map(async raceId => [raceId, await this.dailyRaceService.getDailyRaceById(raceId)] as const))
    );

    for (const doc of unsettled) {
      const race = raceById.get(doc.raceId);
      const runner = race?.runners.find(r => r.runnerId === doc.runnerId);
      if (!runner?.result) continue; // race not run yet, or not yet captured — check again next time
      // WIN-market betting only, same simplification the existing Industry
      // SP PnL screens already make (computeRangePnl in ispFormat.ts):
      // only "WINNER" pays out; PLACED/LOSER/NON_FINISHER are all a full
      // loss of stake for a straight back bet, no each-way handling.
      const won = runner.result.status === "WINNER";
      await this.dao.updateFields(doc._id!, {
        betOutcome: won ? "WON" : "LOST",
        settledProfit: won ? (doc.matchedPrice! - 1) * doc.maxStake : -doc.maxStake,
        settledAt: new Date().toISOString(),
      });
    }
  }

  public async cancelForUser(id: string, userId: string): Promise<boolean> {
    return this.dao.cancelByIdForUser(id, userId);
  }

  // The scheduled evaluator's core loop — see apps/lambda/src/handler.ts's
  // "evaluate-bet-orders" action. Every order is handled independently and
  // wrapped in its own try/catch: one order's failure (a bad market match,
  // a Betfair timeout) must never stop the rest of the batch from being
  // evaluated — same per-item isolation principle
  // DailyRaceService.ingestFromRacingApi's per-race try/catch already uses.
  public async evaluatePendingOrders(): Promise<EvaluateSummary> {
    const summary: EvaluateSummary = { evaluated: 0, resolved: 0, unmatched: 0, triggered: 0, expired: 0, errors: 0 };
    const orders = await this.dao.listAllOpen();
    for (const order of orders) {
      summary.evaluated++;
      try {
        await this.evaluateOne(order, summary);
      } catch (error) {
        summary.errors++;
        try {
          await this.dao.updateFields(order._id!, {
            status: "error",
            note: error instanceof Error ? error.message : String(error),
          });
        } catch (persistError) {
          // If even this write fails (e.g. a Mongo hiccup), don't let it
          // propagate — that would abort the whole loop and silently skip
          // evaluating every remaining order in this batch, defeating the
          // per-order isolation this method exists for. Logged loudly so
          // it's not silently lost; this order's true status is just
          // unknown until the next scheduled run picks it up again.
          console.error(`Failed to record error status for bet order ${order._id?.toString()} after evaluation failure:`, persistError);
        }
      }
    }
    return summary;
  }

  private async evaluateOne(order: BetOrderDocument, summary: EvaluateSummary): Promise<void> {
    const offTimeMs = new Date(order.offDt).getTime();
    const pastGrace = Number.isFinite(offTimeMs) && Date.now() > offTimeMs + EXPIRE_GRACE_MINUTES * 60_000;

    let marketId = order.betfairMarketId;
    let selectionId = order.betfairSelectionId;

    if (!marketId || selectionId == null) {
      const resolution = await resolveMarketForRace(this.client, { course: order.course, offDt: order.offDt }, order.horse);
      if (!resolution.ok) {
        if (pastGrace) {
          await this.dao.updateFields(order._id!, { status: "expired", note: resolution.failure.detail });
          summary.expired++;
        } else {
          await this.dao.updateFields(order._id!, { status: "unmatched", note: resolution.failure.detail });
          summary.unmatched++;
        }
        return;
      }
      marketId = resolution.resolved.marketId;
      selectionId = resolution.resolved.selectionId;
      summary.resolved++;
      await this.dao.updateFields(order._id!, {
        status: "pending",
        betfairMarketId: marketId,
        betfairSelectionId: selectionId,
        note: undefined,
      });
    }

    const books = await this.client.listMarketBook([marketId]);
    const book = books[0];
    if (!book) {
      if (pastGrace) {
        await this.dao.updateFields(order._id!, { status: "expired", note: "Market no longer available" });
        summary.expired++;
      }
      return;
    }
    const runner = book.runners.find(r => r.selectionId === selectionId);
    const bestBackPrice = runner?.ex?.availableToBack?.[0]?.price;

    if (book.inplay || runner?.status !== "ACTIVE" || book.status === "CLOSED") {
      if (pastGrace || book.status === "CLOSED") {
        await this.dao.updateFields(order._id!, {
          status: "expired",
          note: "Race went in-play/closed before the price condition was met",
        });
        summary.expired++;
      }
      return;
    }

    if (bestBackPrice == null || bestBackPrice < order.minQualifyingPrice) {
      if (pastGrace) {
        await this.dao.updateFields(order._id!, { status: "expired", note: "Off time passed without the price condition being met" });
        summary.expired++;
      }
      return;
    }

    // Price condition met — compare-and-swap into "placing" before ever
    // calling Betfair's real placeOrders, so a second concurrent evaluator
    // pass (an overlapping invocation, or a retry after a slow/timed-out
    // Lambda) can never also place the same bet. Only the caller that wins
    // this swap proceeds; everyone else backs off. Hardcoded "pending"
    // (not the possibly-stale in-memory `order.status`, which can still
    // read "unmatched" here if this same call just resolved the market a
    // few lines up) — by this point the DB-side status is always "pending"
    // regardless of what it was when this order was first loaded.
    const won = await this.dao.tryTransition(order._id!, "pending", "placing");
    if (!won) return;

    const result = await this.client.placeOrders(marketId, selectionId, bestBackPrice, order.maxStake, {
      forceDryRun: !order.liveBettingAllowed,
    });
    const wasRealAttempt = order.liveBettingAllowed === true && !this.client.isDryRun();

    if (result.outcome === "FAILURE") {
      // Deliberately terminal, not auto-retried on the next tick — see
      // BetOrderDAO.listAllOpen's doc comment. Whether the failure was a
      // clean rejection or an ambiguous timeout can't always be told apart
      // here, so a human must look at "error" orders rather than risk a
      // blind duplicate real bet.
      try {
        await this.dao.updateFields(order._id!, { status: "error", note: humanizeBetfairError(result.error) });
      } catch (persistError) {
        // Swallow rather than rethrow — evaluatePendingOrders' own catch
        // would otherwise attempt a second, likely-also-failing
        // updateFields on the same order. Logging loudly is the important
        // part; a human reconciling "error" statuses already can't fully
        // trust a FAILURE note anyway (see the comment above).
        this.logPossiblePhantomRealBet(
          "scheduled bet FAILURE result could not be persisted",
          { wasRealAttempt, orderId: order._id?.toString(), marketId, selectionId, error: result.error },
          persistError
        );
      }
      summary.errors++;
      return;
    }
    try {
      await this.dao.updateFields(order._id!, {
        status: "triggered",
        matchedPrice: result.outcome === "SUCCESS" ? result.matchedPrice : result.simulatedPrice,
        betfairBetId: result.outcome === "SUCCESS" ? result.betId : undefined,
        dryRun: result.outcome === "DRY_RUN",
        note: result.outcome === "DRY_RUN" ? "Dry run — no real bet was placed." : undefined,
      });
    } catch (persistError) {
      this.logPossiblePhantomRealBet(
        "scheduled bet SUCCESS/DRY_RUN result could not be persisted",
        {
          wasRealAttempt,
          orderId: order._id?.toString(),
          marketId,
          selectionId,
          betId: result.outcome === "SUCCESS" ? result.betId : undefined,
          matchedPrice: result.outcome === "SUCCESS" ? result.matchedPrice : result.simulatedPrice,
        },
        persistError
      );
    }
    summary.triggered++;
  }
}
