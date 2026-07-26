import { Collection, Db, ObjectId } from "mongodb";

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

// filters is stored as the exact URL-param string map IndustrySpScreen's own
// syncUrl() writes (see client/src/utils/ispUrlParams.ts's
// ISP_FILTER_PARAM_NAMES) — one representation used for persistence,
// snapshot computation, and restore, so there's no risk of drift between
// what Apply writes to the URL and what Save persists.
export interface SavedFilterSetDocument {
  _id?: ObjectId;
  userId: string;
  name: string;
  filters: Record<string, string>;
  pnlStats: SavedFilterSetPnlStats;
  graphPoints: SavedFilterSetGraphPoint[];
  createdAt: string;
}

// First user-owned MongoDB resource in this codebase — every method takes
// and filters by userId, and there is no "get any doc by id" method, so
// cross-user leakage can't happen even if a route forgets an ownership
// check.
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
}
