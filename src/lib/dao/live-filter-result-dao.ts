import { Collection, Db, ObjectId } from "mongodb";
import type { BrierSums } from "../service/brier";

export interface LiveFilterResultPnlStats {
  staked: number;
  returns: number;
  pnl: number;
  count: number;
}

// One document per (savedFilterSetId, raceId) — the live, actual-results
// counterpart to SavedFilterSetDocument's one-time splitA/splitB backtest
// snapshot (see saved-filter-set-dao.ts). Per-race (not pre-aggregated per
// meeting/day) so the frontend can build the same Meeting → Race tap-through
// hierarchy the historical Races view already has — meeting/day/month/year
// rollups are a derived client-side sum over these race rows, not stored
// here. Written by LiveFilterResultService.captureLiveResultsForDate,
// chained onto the same daily results-capture cron that populates
// industry_starting_prices, so this only ever reflects races RacingAPI has
// actually reported as finished — never a projection or estimate.
export interface LiveFilterResultDocument {
  _id?: ObjectId;
  savedFilterSetId: ObjectId;
  // Snapshot of the filter set's own filters map at capture time, same shape
  // as SavedFilterSetDocument.filters — kept here too (not just joined via
  // savedFilterSetId) so a historical row still means the same thing even if
  // the parent filter set is ever edited or deleted.
  filters: Record<string, string>;
  modelVersionId: string | null;
  raceDate: string;
  raceId: number;
  raceTime: string;
  raceName: string;
  meetingId: string;
  meetingName: string;
  pnlStats: LiveFilterResultPnlStats;
  // Raw squared-error sums for this race alone, NOT a finished Brier score:
  // the Live Performance rollup adds these across every captured day and
  // divides once, because averaging per-race Brier scores would weight a
  // 5-runner race the same as a 16-runner one. Optional because this
  // collection has real production documents written before Brier scores
  // existed and nothing migrates them — absence means "captured before this
  // was recorded", which the frontend shows as "—" rather than as a zero.
  brierSums?: BrierSums;
  capturedAt: string;
}

const OLD_UNIQUE_INDEX_NAME = "savedFilterSetId_1_meetingId_1_raceDate_1";

export class LiveFilterResultDAO {
  private collection: Collection<LiveFilterResultDocument>;

  constructor(db: Db, collectionName = "saved_filter_set_live_results") {
    this.collection = db.collection<LiveFilterResultDocument>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    // Self-healing: this collection's unique key changed from per-meeting
    // (savedFilterSetId+meetingId+raceDate) to per-race (savedFilterSetId+
    // raceId) — same "detect and drop the old index" pattern user-dao.ts
    // uses for its email index change, needed since this app has no
    // migration tooling. Drop is a no-op (caught, logged, ignored) once the
    // old index no longer exists.
    try {
      await this.collection.dropIndex(OLD_UNIQUE_INDEX_NAME);
    } catch (err) {
      console.warn("dropIndex for old live-filter-result meeting-level key (non-fatal, likely already gone):", err);
    }
    try {
      await this.collection.createIndex({ savedFilterSetId: 1, raceId: 1 }, { unique: true });
    } catch (err) {
      console.warn("createIndex failed for live-filter-result unique key (non-fatal):", err);
    }
    console.log("Live filter result indexes ensured");
  }

  // Idempotent by (savedFilterSetId, raceId) — safe to re-run
  // captureLiveResultsForDate for the same date more than once (e.g. a
  // manual re-trigger after a partial failure).
  public async upsertMany(docs: Omit<LiveFilterResultDocument, "_id">[]): Promise<void> {
    if (docs.length === 0) return;
    await this.collection.bulkWrite(
      docs.map(doc => ({
        updateOne: {
          filter: { savedFilterSetId: doc.savedFilterSetId, raceId: doc.raceId },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  public async listBySavedFilterSetId(savedFilterSetId: ObjectId): Promise<LiveFilterResultDocument[]> {
    return this.collection.find({ savedFilterSetId }).sort({ raceTime: -1 }).toArray();
  }
}
