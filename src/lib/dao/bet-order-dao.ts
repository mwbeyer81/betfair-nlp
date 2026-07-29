import { Collection, Db, ObjectId } from "mongodb";

// Kept in lockstep with client/src/utils/betOrderFormat.ts's BetOrderStatus
// — this is a full backend/frontend status vocabulary, not collapsed down
// to a UI-only subset, so "we couldn't safely identify the Betfair market"
// (unmatched) and "the real placeOrders call itself failed" (error) are
// never silently presented to the user as just "still pending".
// "placing" is a brief transient state (see BetOrderDAO.tryTransition) held
// only for the duration of a single evaluatePendingOrders -> Betfair
// placeOrders round trip — real API latency means a GET could theoretically
// observe it, so it gets its own honest status/label rather than being
// hidden inside "pending".
export type BetOrderStatus = "pending" | "unmatched" | "placing" | "triggered" | "expired" | "cancelled" | "error";

// "scheduled" is today's original conditional flow (watched by the cron
// evaluator until the price condition is met or the race expires).
// "instant" is placed synchronously, once, at whatever price Betfair
// offers right now — it only ever lands on "triggered"/"error" (see
// bet-order-service.ts's placeInstant), never "pending"/"unmatched"/
// "placing", so it never interacts with listAllOpen/tryTransition below.
export type BetOrderType = "instant" | "scheduled";

// First user-owned MongoDB resource added after saved_filter_sets — same
// ownership convention: every per-user method takes and filters by userId,
// no "get any doc by id" method exists, so a route can never leak another
// user's bet order even if it forgets an explicit ownership check.
export interface BetOrderDocument {
  _id?: ObjectId;
  userId: string;
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  offDt: string;
  raceId: string;
  eventId: string;
  targetProfit: number;
  maxStake: number;
  minQualifyingPrice: number;
  status: BetOrderStatus;
  // Absent on documents created before this field existed — always treat
  // that absence as "scheduled" at the read boundary (toApiResponse), not
  // by backfilling old docs.
  orderType: BetOrderType;
  // Computed once at creation from the creating user's email vs.
  // BetfairApiClient.getLiveBettingAllowedEmail(), and never recomputed —
  // a permanent, auditable record of whether this specific order was ever
  // eligible for a real placement. Passed as `forceDryRun: !liveBettingAllowed`
  // into every client.placeOrders call this order ever goes through (both
  // placeInstant and evaluateOne), so the identity check happens once, at
  // creation, rather than being re-derived (and potentially inconsistent)
  // at every later evaluation. Absent on documents created before this
  // field existed — always treat that absence as `false` (never allowed),
  // not `true`, at every read site — same fail-safe direction as dryRun.
  liveBettingAllowed?: boolean;
  createdAt: string;
  updatedAt: string;
  // Populated once resolveMarketForRace succeeds — absent while status is
  // still "pending" and unresolved, or "unmatched".
  betfairMarketId?: string;
  betfairSelectionId?: number;
  // Set once evaluatePendingOrders actually acts on this order (dry-run or
  // real) — matchedPrice/betId are absent for a dry-run "trigger" (see
  // BetfairPlaceOrderResult's DRY_RUN branch, which has no real betId).
  matchedPrice?: number;
  betfairBetId?: string;
  dryRun?: boolean;
  // Human-readable explanation for "unmatched"/"error"/"expired" — surfaced
  // directly to the user rather than a bare status code, since each of
  // those states needs a different real-world action from them.
  note?: string;
}

export class BetOrderDAO {
  private collection: Collection<BetOrderDocument>;

  constructor(db: Db, collectionName = "bet_orders") {
    this.collection = db.collection<BetOrderDocument>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    await this.collection.createIndex({ userId: 1, createdAt: -1 });
    // The scheduled evaluator's own query — every order not yet in a
    // terminal state, across every user, regardless of who created it.
    await this.collection.createIndex({ status: 1 });
  }

  public async create(doc: Omit<BetOrderDocument, "_id">): Promise<BetOrderDocument> {
    const { insertedId } = await this.collection.insertOne(doc as BetOrderDocument);
    return { ...doc, _id: insertedId };
  }

  public async listByUser(userId: string): Promise<BetOrderDocument[]> {
    return await this.collection.find({ userId }).sort({ createdAt: -1 }).toArray();
  }

  public async getByIdForUser(id: string, userId: string): Promise<BetOrderDocument | null> {
    if (!ObjectId.isValid(id)) return null;
    return await this.collection.findOne({ _id: new ObjectId(id), userId });
  }

  // Only cancels while still pending/unmatched (still-open states) — a
  // user cancelling an order that already triggered a real bet wouldn't
  // actually cancel anything on Betfair itself, so pretending it worked
  // here would be actively misleading.
  public async cancelByIdForUser(id: string, userId: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const { modifiedCount } = await this.collection.updateOne(
      { _id: new ObjectId(id), userId, status: { $in: ["pending", "unmatched"] } },
      { $set: { status: "cancelled", updatedAt: new Date().toISOString() } }
    );
    return modifiedCount === 1;
  }

  // Cross-user by design — the scheduled evaluator has no single requesting
  // user, same reasoning as SavedFilterSetDAO.listAllUserOwned.
  public async listAllOpen(): Promise<BetOrderDocument[]> {
    return await this.collection.find({ status: { $in: ["pending", "unmatched"] } }).toArray();
  }

  // Any explicit `undefined` in patch (e.g. clearing a stale `note` once a
  // re-resolution succeeds) is turned into a real `$unset` — the MongoDB
  // driver silently drops `undefined`-valued keys from `$set` (BSON has no
  // "undefined"), so passing `{ note: undefined }` straight through would
  // silently do nothing and leave the old note in place.
  public async updateFields(id: ObjectId, patch: Partial<BetOrderDocument>): Promise<void> {
    const setFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const unsetFields: Record<string, "" > = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) unsetFields[key] = "";
      else setFields[key] = value;
    }
    const update: Record<string, unknown> = { $set: setFields };
    if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
    await this.collection.updateOne({ _id: id }, update);
  }

  // Atomic compare-and-swap: only succeeds if the order's status was still
  // exactly `from` at the moment of the update, and returns the document
  // as it was found under that condition (not the version after the
  // update). This is the concurrency guard against a real double-bet — if
  // two overlapping scheduled-evaluator invocations (or a retry after a
  // slow/timed-out Lambda) both try to act on the same order, only one can
  // ever win this compare-and-swap; the other sees no match and backs off
  // instead of also calling Betfair's real placeOrders.
  public async tryTransition(id: ObjectId, from: BetOrderStatus, to: BetOrderStatus): Promise<boolean> {
    const { modifiedCount } = await this.collection.updateOne(
      { _id: id, status: from },
      { $set: { status: to, updatedAt: new Date().toISOString() } }
    );
    return modifiedCount === 1;
  }
}
