import { BetOrderDAO, BetOrderDocument, BetOrderStatus } from "../dao/bet-order-dao";
import { DatabaseConnection } from "../../config/database";
import { BetfairApiClient } from "./betfair-api-client";
import { resolveMarketForRace } from "./betfair-market-resolver";

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
}

export interface BetOrderApiResponse {
  id: string;
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  raceId: string;
  eventId: string;
  targetProfit: number;
  maxStake: number;
  minQualifyingPrice: number;
  status: BetOrderStatus;
  createdAt: string;
  matchedPrice?: number;
  dryRun?: boolean;
  note?: string;
}

function toApiResponse(doc: BetOrderDocument): BetOrderApiResponse {
  return {
    id: doc._id!.toString(),
    runnerId: doc.runnerId,
    horse: doc.horse,
    course: doc.course,
    offTime: doc.offTime,
    raceId: doc.raceId,
    eventId: doc.eventId,
    targetProfit: doc.targetProfit,
    maxStake: doc.maxStake,
    minQualifyingPrice: doc.minQualifyingPrice,
    status: doc.status,
    createdAt: doc.createdAt,
    matchedPrice: doc.matchedPrice,
    dryRun: doc.dryRun,
    note: doc.note,
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

  constructor(dao?: BetOrderDAO, client?: BetfairApiClient) {
    if (dao) {
      this.dao = dao;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.dao = new BetOrderDAO(db);
    }
    this.client = client ?? new BetfairApiClient();
  }

  public async createIndexes(): Promise<void> {
    await this.dao.createIndexes();
  }

  public async createForUser(userId: string, input: CreateBetOrderInput): Promise<BetOrderApiResponse> {
    if (!Number.isFinite(input.targetProfit) || input.targetProfit <= 0) {
      throw new Error("targetProfit must be a positive number");
    }
    if (!Number.isFinite(input.maxStake) || input.maxStake <= 0) {
      throw new Error("maxStake must be a positive number");
    }
    const now = new Date().toISOString();
    const doc = await this.dao.create({
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
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return toApiResponse(doc);
  }

  public async listForUser(userId: string): Promise<BetOrderApiResponse[]> {
    const docs = await this.dao.listByUser(userId);
    return docs.map(toApiResponse);
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
        await this.dao.updateFields(order._id!, {
          status: "error",
          note: error instanceof Error ? error.message : String(error),
        });
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

    const result = await this.client.placeOrders(marketId, selectionId, bestBackPrice, order.maxStake);
    if (result.outcome === "FAILURE") {
      // Deliberately terminal, not auto-retried on the next tick — see
      // BetOrderDAO.listAllOpen's doc comment. Whether the failure was a
      // clean rejection or an ambiguous timeout can't always be told apart
      // here, so a human must look at "error" orders rather than risk a
      // blind duplicate real bet.
      await this.dao.updateFields(order._id!, { status: "error", note: result.error });
      summary.errors++;
      return;
    }
    await this.dao.updateFields(order._id!, {
      status: "triggered",
      matchedPrice: result.outcome === "SUCCESS" ? result.matchedPrice : result.simulatedPrice,
      betfairBetId: result.outcome === "SUCCESS" ? result.betId : undefined,
      dryRun: result.outcome === "DRY_RUN",
      note: result.outcome === "DRY_RUN" ? "Dry run — no real bet was placed." : undefined,
    });
    summary.triggered++;
  }
}
