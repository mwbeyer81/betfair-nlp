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
    toRow: number | null = null,
    minRaceTime: string | null = null,
    maxRaceTime: string | null = null
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
      toRow,
      minRaceTime,
      maxRaceTime
    );
  }

  public async getFilterBounds(): Promise<IspFilterBounds> {
    return this.industrySpDAO.getFilterBounds();
  }

  // Combines every request the /isp home page always needs on first load
  // (grand total, Race A split, Race B split, filter bounds, country list)
  // into one backend round trip. The three split-related queries used to
  // be their own HTTP requests, and filter-bounds/countries were (and
  // still can be, via their own standalone endpoints below) two more on
  // top — five separate concurrent Lambda invocations on a cold page load
  // in the worst case. Under real concurrent load that meant AWS Lambda
  // spinning up multiple separate execution environments (each paying its
  // own cold-start + fresh MongoDB connection setup) all hammering Atlas
  // M0's already-limited throughput at once — confirmed via CloudWatch:
  // individual `getSplitStats` invocations spiking to 20-30s (some hitting
  // the hard 30s Lambda timeout outright) specifically during bursts of
  // concurrent requests against the cluster, not in isolation (a single
  // warm, uncontended call consistently lands in ~2-2.5s). Running
  // everything from one already-warm Lambda invocation, over the one
  // already-open MongoDB connection, removes the extra cold-starts *and*
  // collapses concurrent-connection pressure on Atlas M0 down to a single
  // client per page load — the actual lever here, since M0's ceiling is
  // concurrent throughput, not any single query's cost (more `Promise.all`
  // parallelism without reducing invocation count would only add to that
  // pressure, not relieve it).
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
    toRowB: number | null = null,
    minRaceTime: string | null = null,
    maxRaceTime: string | null = null
  ): Promise<{
    totalRaces: number;
    totalRunners: number;
    filterBounds: IspFilterBounds;
    countries: string[];
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
    // filterBounds/countryCodes are independent of every filter param and
    // of the grand total — run them alongside it rather than after, so
    // they don't add a sequential hop on top of the grand→splits dependency.
    const [grand, filterBounds, countryCodes] = await Promise.all([
      this.industrySpDAO.getAllRacesByRace(
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, 1, null,
        minRaceTime, maxRaceTime
      ),
      // Deliberately dataset-global, not date-scoped — these are slider/
      // dropdown bounds (available countries, runner/ISP ranges), and
      // narrowing them to the current date window would make e.g. a
      // country only present outside that window silently disappear from
      // the picker instead of just returning zero matches once selected.
      this.industrySpDAO.getFilterBounds(),
      this.industrySpDAO.getDistinctCountryCodes(),
    ]);

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
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, effFromA, effToA,
        minRaceTime, maxRaceTime
      ),
      this.industrySpDAO.getAllRacesByRace(
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, effFromB, effToB,
        minRaceTime, maxRaceTime
      ),
    ]);

    return {
      totalRaces: grand.total,
      totalRunners: grand.totalRunners,
      filterBounds,
      countries: countryCodes,
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
