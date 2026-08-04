import { Collection, Db, ObjectId } from "mongodb";
import type { BrierStats } from "../service/brier";

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

// One split's resolved snapshot — fromRow/toRow/total/totalRunners mirror
// exactly what IndustrySpService.getSplitStats() resolved at save time
// (explicit fromRowA/toRowA/fromRowB/toRowB if the caller set them, or the
// default half/half divide otherwise), so a saved result's Split A/B always
// match what the live Filters screen would have shown for the same filters.
export interface SavedFilterSetSplit {
  fromRow: number;
  toRow: number | null;
  total: number;
  totalRunners: number;
  pnlStats: SavedFilterSetPnlStats;
  graphPoints: SavedFilterSetGraphPoint[];
  // A finished score, not raw sums (unlike LiveFilterResultDocument's
  // per-race brierSums): a snapshot split is already the whole set, computed
  // in one aggregation, so there is nothing left to add it to. Optional for
  // the same reason splitA/splitB themselves are optional on the frontend —
  // documents saved before this field existed are real and are not migrated.
  brier?: BrierStats;
}

// filters is stored as the exact URL-param string map IndustrySpScreen's own
// syncUrl() writes (see client/src/utils/ispUrlParams.ts's
// ISP_FILTER_PARAM_NAMES) — one representation used for persistence,
// snapshot computation, and restore, so there's no risk of drift between
// what Apply writes to the URL and what Save persists.
// createdBy/modelVersionId are both optional and additive — this collection
// already has real production documents from before these fields existed,
// and this app has no migration tooling, so absence must stay meaningful:
// a doc with no createdBy is a pre-existing user-saved result, exactly as
// before. Only the AI training pipeline sets createdBy: "agent" (see
// AGENT_USER_ID below), tagged with the modelVersionId of the training run
// that produced it.
export interface SavedFilterSetDocument {
  _id?: ObjectId;
  userId: string;
  name: string;
  filters: Record<string, string>;
  splitA: SavedFilterSetSplit;
  splitB: SavedFilterSetSplit;
  createdAt: string;
  createdBy?: "user" | "agent";
  modelVersionId?: string;
}

// Reserved userId for agent-generated results — deliberately not a valid
// ObjectId hex string, so it can never collide with a real user's
// `_id.toString()`. Agent docs are cross-user by design (any logged-in user
// should see them), which is why they get their own DAO methods below
// instead of going through listByUser/getByIdForUser/deleteByIdForUser.
export const AGENT_USER_ID = "agent:training-battery";

// First user-owned MongoDB resource in this codebase — every per-user
// method takes and filters by userId, and there is no "get any doc by id"
// method scoped to a real user, so cross-user leakage can't happen even if
// a route forgets an ownership check. (Agent-generated docs are the one
// deliberate exception — see listAgentGenerated/getAgentGeneratedById.)
export class SavedFilterSetDAO {
  private collection: Collection<SavedFilterSetDocument>;

  constructor(db: Db, collectionName = "saved_filter_sets") {
    this.collection = db.collection<SavedFilterSetDocument>(collectionName);
  }

  public async create(doc: Omit<SavedFilterSetDocument, "_id">): Promise<SavedFilterSetDocument> {
    const { insertedId } = await this.collection.insertOne(doc as SavedFilterSetDocument);
    return { ...doc, _id: insertedId };
  }

  public async listByUser(userId: string): Promise<SavedFilterSetDocument[]> {
    return await this.collection.find({ userId }).sort({ createdAt: -1 }).toArray();
  }

  public async getByIdForUser(id: string, userId: string): Promise<SavedFilterSetDocument | null> {
    if (!ObjectId.isValid(id)) return null;
    return await this.collection.findOne({ _id: new ObjectId(id), userId });
  }

  public async deleteByIdForUser(id: string, userId: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const { deletedCount } = await this.collection.deleteOne({ _id: new ObjectId(id), userId });
    return deletedCount === 1;
  }

  // Cross-user by design — agent-generated training results aren't any one
  // user's private data, every logged-in user should see the same list.
  public async listAgentGenerated(): Promise<SavedFilterSetDocument[]> {
    return await this.collection.find({ createdBy: "agent" }).sort({ createdAt: -1 }).toArray();
  }

  public async getAgentGeneratedById(id: string): Promise<SavedFilterSetDocument | null> {
    if (!ObjectId.isValid(id)) return null;
    return await this.collection.findOne({ _id: new ObjectId(id), createdBy: "agent" });
  }

  // Every real user's own saved filter set, across all users — excludes
  // agent-generated training-battery rows (createdBy: "agent"), which have
  // no live/day-by-day tracking of their own (they're a fixed training-run
  // artifact, not something a user is watching play out). Used by
  // LiveFilterResultService.captureLiveResultsForDate to know which filter
  // sets to compute a day's live rollup for — deliberately cross-user
  // (unlike listByUser), since this cron-driven capture has no single
  // requesting user to scope to.
  public async listAllUserOwned(): Promise<SavedFilterSetDocument[]> {
    return await this.collection.find({ createdBy: { $ne: "agent" } }).toArray();
  }
}
