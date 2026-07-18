import { IndustrySpDAO, IspRace, IspFilterBounds } from "../dao/industry-sp-dao";
import { DatabaseConnection } from "../../config/database";

export class IndustrySpService {
  private industrySpDAO: IndustrySpDAO;

  constructor(industrySpDAO?: IndustrySpDAO) {
    if (industrySpDAO) {
      this.industrySpDAO = industrySpDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.industrySpDAO = new IndustrySpDAO(db);
    }
  }

  public async createIndexes(): Promise<void> {
    return this.industrySpDAO.createIndexes();
  }

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
    fromRow = 1,
    toRow: number | null = null
  ): Promise<{
    data: IspRace[];
    total: number;
    totalRunners: number;
    pnlStats: { staked: number; returns: number; pnl: number; count: number };
  }> {
    return this.industrySpDAO.getAllRacesByRace(
      page,
      limit,
      minRunners,
      maxRunners,
      countries,
      minIsp,
      maxIsp,
      sortOrder,
      minInIspRange,
      maxInIspRange,
      fromRow,
      toRow
    );
  }

  public async getFilterBounds(): Promise<IspFilterBounds> {
    return this.industrySpDAO.getFilterBounds();
  }

  // Combines the three requests the /isp home page always needs (grand
  // total, Race A split, Race B split) into one backend round trip. These
  // used to be three separate HTTP requests fired concurrently from the
  // browser — under real load that meant AWS Lambda spinning up multiple
  // separate execution environments (each paying its own cold-start +
  // fresh MongoDB connection setup against Atlas M0's already-limited
  // throughput) to serve them in parallel, plus the browser had to wait
  // for the grand-total round trip to finish before it even knew the
  // default split boundaries to ask for. Smoke-tested live: Lambda
  // `Duration` for these queries varied wildly (500ms-2.7s) in a pattern
  // consistent with connection/throughput contention, not query cost.
  // Running all three from one already-warm Lambda invocation, over the
  // one already-open MongoDB connection, removes both the extra
  // cold-starts and the extra round trip.
  public async getSplitStats(
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    minInIspRange = 1,
    maxInIspRange = 1000,
    fromRowA: number | null = null,
    toRowA: number | null = null,
    fromRowB: number | null = null,
    toRowB: number | null = null
  ): Promise<{
    totalRaces: number;
    totalRunners: number;
    splitA: {
      fromRow: number;
      toRow: number | null;
      total: number;
      totalRunners: number;
      pnlStats: { staked: number; returns: number; pnl: number; count: number };
    };
    splitB: {
      fromRow: number;
      toRow: number | null;
      total: number;
      totalRunners: number;
      pnlStats: { staked: number; returns: number; pnl: number; count: number };
    };
  }> {
    const grand = await this.industrySpDAO.getAllRacesByRace(
      1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, 1, null
    );

    // Splits default to an even first-half/second-half of the grand total
    // whenever the caller doesn't pin down explicit boundaries (a fresh
    // page load, or after Reset) — mirrors the frontend's own previous
    // client-side default logic, just computed here instead so it can
    // happen without an extra round trip to learn the grand total first.
    const splitsAreDefault = fromRowA == null && toRowA == null && fromRowB == null && toRowB == null;
    let effFromA = fromRowA ?? 1;
    let effToA = toRowA;
    let effFromB = fromRowB ?? 1;
    let effToB = toRowB;
    if (splitsAreDefault) {
      const half = Math.floor(grand.total / 2);
      effFromA = 1;
      effToA = half;
      effFromB = half + 1;
      effToB = null;
    }

    const [resultA, resultB] = await Promise.all([
      this.industrySpDAO.getAllRacesByRace(
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, effFromA, effToA
      ),
      this.industrySpDAO.getAllRacesByRace(
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, effFromB, effToB
      ),
    ]);

    return {
      totalRaces: grand.total,
      totalRunners: grand.totalRunners,
      splitA: { fromRow: effFromA, toRow: effToA, total: resultA.total, totalRunners: resultA.totalRunners, pnlStats: resultA.pnlStats },
      splitB: { fromRow: effFromB, toRow: effToB, total: resultB.total, totalRunners: resultB.totalRunners, pnlStats: resultB.pnlStats },
    };
  }

  public async getRacesByMeetingId(meetingId: string): Promise<IspRace[]> {
    return this.industrySpDAO.getRacesByMeetingId(meetingId);
  }

  public async getRaceById(raceId: number): Promise<IspRace | null> {
    return this.industrySpDAO.getRaceById(raceId);
  }

  public async getDistinctCountryCodes(): Promise<string[]> {
    return this.industrySpDAO.getDistinctCountryCodes();
  }

  public async getPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    return this.industrySpDAO.getPnlStats();
  }
}
