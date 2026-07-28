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
    modelVersionId: string | null = null
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
      maxRaceTime,
      courses,
      goings,
      raceClasses,
      raceTypes,
      trainerSearch,
      jockeySearch,
      trainerFormMinWinRate,
      minTrainerFormRunners,
      maxTrainerFormRunners,
      runnerName,
      minModelWinProbability,
      onlyModelBeatsSp,
      modelVersionId
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
    // Per-window race cap: 10000 for an authenticated caller (effectively
    // the whole dataset today), 100 for an anonymous one. Applied to both
    // the auto-computed default window below and any explicit
    // fromRowA/toRowA/fromRowB/toRowB the caller supplies — an anonymous
    // caller can't just ask for a bigger window directly, since the whole
    // point of the cap is that it's enforced server-side.
    raceCap = 10000
  ): Promise<{
    totalRaces: number;
    totalRunners: number;
    raceCap: number;
    filterBounds: IspFilterBounds;
    countries: string[];
    courses: string[];
    goings: string[];
    raceClasses: string[];
    raceTypes: string[];
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
    const [grand, filterBounds, countryCodes, courseValues, goingValues, raceClassValues, raceTypeValues] =
      await Promise.all([
        this.industrySpDAO.getAllRacesByRace(
          1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, 1, null,
          minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
          trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, null, minModelWinProbability,
          onlyModelBeatsSp
        ),
        // Deliberately dataset-global, not date-scoped — these are slider/
        // dropdown bounds (available countries, runner/ISP ranges), and
        // narrowing them to the current date window would make e.g. a
        // country only present outside that window silently disappear from
        // the picker instead of just returning zero matches once selected.
        this.industrySpDAO.getFilterBounds(),
        this.industrySpDAO.getDistinctCountryCodes(),
        this.industrySpDAO.getDistinctCourses(),
        this.industrySpDAO.getDistinctGoings(),
        this.industrySpDAO.getDistinctRaceClasses(),
        this.industrySpDAO.getDistinctRaceTypes(),
      ]);

    // Splits default to an even first-half/second-half divide of whatever
    // the current total is, whenever the caller doesn't pin down explicit
    // fromRowA/toRowA/fromRowB/toRowB boundaries (a fresh page load, or
    // after Reset). effToB is left open-ended (null, "through the end")
    // rather than an explicit number so it never needs reclamping as the
    // total changes with the filters.
    const hasExplicitRaceSplit = fromRowA != null || toRowA != null || fromRowB != null || toRowB != null;

    let effFromA: number;
    let effToA: number | null;
    let effFromB: number;
    let effToB: number | null;

    if (hasExplicitRaceSplit) {
      // Explicit race-index split, unchanged from before this method
      // learned about runner-index splits.
      effFromA = fromRowA ?? 1;
      effToA = toRowA;
      effFromB = fromRowB ?? 1;
      effToB = toRowB;
    } else {
      const half = Math.floor(grand.total / 2);
      effFromA = 1;
      effToA = half;
      effFromB = half + 1;
      effToB = null;
    }

    // raceCap is a hard ceiling on each split's window span (100 races for
    // an anonymous caller, 10000 for an authenticated one — see the router,
    // which decides raceCap from the request's auth state). Applied on top
    // of the half/half default above (not instead of it), so a small
    // filtered total still gets the "both splits populated" behavior that
    // default computes, while a large total (or an explicit caller-supplied
    // range) gets bounded to raceCap rather than the previous unbounded
    // "through the end" window. An open-ended toRow (null) becomes
    // "exactly raceCap races", not "unlimited" — but also never "more races
    // than actually exist": also clamped to grand.total (already known at
    // this point), otherwise whenever the matched total is smaller than
    // raceCap (the common case for anything but a very wide filter — e.g.
    // reported live with totalRaces=675 vs. a raceCap-derived toRowB of
    // 1334) the displayed/returned toRow implied a race range that didn't
    // exist, even though the underlying total/totalRunners counts were
    // still correct (MongoDB's own $skip/$limit silently returns fewer
    // rows than requested, so only the boundary *number* was wrong, not
    // the actual query result).
    const maxToA = Math.min(effFromA + raceCap - 1, grand.total);
    effToA = effToA == null ? maxToA : Math.min(effToA, maxToA);
    const maxToB = Math.min(effFromB + raceCap - 1, grand.total);
    effToB = effToB == null ? maxToB : Math.min(effToB, maxToB);

    const [resultA, resultB] = await Promise.all([
      this.industrySpDAO.getAllRacesByRace(
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, effFromA, effToA,
        minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
        trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, null, minModelWinProbability,
        onlyModelBeatsSp
      ),
      this.industrySpDAO.getAllRacesByRace(
        1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, effFromB, effToB,
        minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
        trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, null, minModelWinProbability,
        onlyModelBeatsSp
      ),
    ]);

    return {
      totalRaces: grand.total,
      totalRunners: grand.totalRunners,
      raceCap,
      filterBounds,
      countries: countryCodes,
      courses: courseValues,
      goings: goingValues,
      raceClasses: raceClassValues,
      raceTypes: raceTypeValues,
      splitA: { fromRow: effFromA, toRow: effToA, total: resultA.total, totalRunners: resultA.totalRunners, pnlStats: resultA.pnlStats },
      splitB: { fromRow: effFromB, toRow: effToB, total: resultB.total, totalRunners: resultB.totalRunners, pnlStats: resultB.pnlStats },
    };
  }

  // Cumulative ROI% convergence series for the "P&L graph" — requested live
  // alongside the split cards to show how the running profit % is volatile
  // over a small sample and settles down as more races are included.
  // fromRow/toRow are one split's own race range (e.g. Split B's 501..1000,
  // the same fromRow/toRow its own card shows) — no boundary-resolution
  // round trip is needed before calling the DAO, since the caller already
  // knows exactly which race range it wants (unlike the runner-ordinal
  // version this replaced, which had to scan from race 1 to translate a
  // runner target into a race-row bound).
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
    fromRow = 1,
    toRow: number
  ): Promise<{ raceRowNumber: number; cumulativeStaked: number; cumulativeReturns: number; cumulativePnl: number; roiPercent: number }[]> {
    const points = await this.industrySpDAO.getRaceConvergenceSeries(
      minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
      minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
      trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
      minModelWinProbability, onlyModelBeatsSp, Math.max(1, fromRow), toRow
    );

    return points.map(p => ({
      raceRowNumber: p.raceRowNumber,
      cumulativeStaked: p.cumulativeStaked,
      cumulativeReturns: p.cumulativeReturns,
      cumulativePnl: p.cumulativeReturns - p.cumulativeStaked,
      roiPercent: p.cumulativeStaked > 0 ? ((p.cumulativeReturns - p.cumulativeStaked) / p.cumulativeStaked) * 100 : 0,
    }));
  }

  public async getQualifyingResultsByMeetingForDate(p: {
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
  }): Promise<
    {
      meetingId: string;
      meetingName: string;
      raceDate: string;
      modelVersionId: string | null;
      pnlStats: { staked: number; returns: number; pnl: number; count: number };
    }[]
  > {
    return this.industrySpDAO.getQualifyingResultsByMeetingForDate(p);
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

  public async getDistinctCourses(): Promise<string[]> {
    return this.industrySpDAO.getDistinctCourses();
  }

  public async getDistinctGoings(): Promise<string[]> {
    return this.industrySpDAO.getDistinctGoings();
  }

  public async getDistinctRaceClasses(): Promise<string[]> {
    return this.industrySpDAO.getDistinctRaceClasses();
  }

  public async getDistinctRaceTypes(): Promise<string[]> {
    return this.industrySpDAO.getDistinctRaceTypes();
  }

  public async getPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    return this.industrySpDAO.getPnlStats();
  }
}
