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
    onlyModelBeatsSp = false
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
      onlyModelBeatsSp
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
    // Whether the default (auto-computed) split bisects by qualifying-
    // runner count (true, the current default — matches what shipped
    // before this toggle existed) or by race count (false, the original
    // behavior, exposed as an explicit UI opt-out). Has no effect when the
    // caller supplies explicit fromRowA/toRowA/etc. — those always stay
    // race-index, regardless of this flag.
    splitByRunners = true,
    // Per-window race cap: 1000 for an authenticated caller (the
    // longstanding default), 100 for an anonymous one. Applied to both the
    // auto-computed default window below and any explicit
    // fromRowA/toRowA/fromRowB/toRowB the caller supplies — an anonymous
    // caller can't just ask for a bigger window directly, since the whole
    // point of the cap is that it's enforced server-side.
    raceCap = 1000
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
    // boundaries (a fresh page load, or after Reset). Bisected by
    // *qualifying runner count*, not race count — a race-count bisection
    // (the old behavior) can leave Split A and Split B with very uneven
    // numbers of runners that actually match the active filters once
    // trainer-form/model/model-beats-SP are on, since qualifying-runner
    // count per race varies once those filters cut some runners out.
    // effToB is left open-ended (null, "through the end") rather than an
    // explicit number so it never needs reclamping as the total changes
    // with the filters. Explicit (user-edited) split boundaries are
    // unaffected — they stay race-index numbers, since "View Races" always
    // needs to fetch actual race documents.
    const splitsAreDefault = fromRowA == null && toRowA == null && fromRowB == null && toRowB == null;
    let effFromA = fromRowA ?? 1;
    let effToA = toRowA;
    let effFromB = fromRowB ?? 1;
    let effToB = toRowB;
    if (splitsAreDefault) {
      let half: number;
      if (splitByRunners && grand.totalRunners > 0) {
        const target = Math.ceil(grand.totalRunners / 2);
        const { boundaryRowIndex } = await this.industrySpDAO.getQualifyingRunnerSplitBoundary(
          minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
          minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
          trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
          minModelWinProbability, onlyModelBeatsSp, target
        );
        // Defensive fallback only — boundaryRowIndex should always resolve
        // when grand.totalRunners > 0 (the same matched set produced that
        // total), but a race-count bisection is a safe degradation if it
        // somehow doesn't.
        half = boundaryRowIndex ?? Math.floor(grand.total / 2);
      } else {
        // Either splitByRunners is off (explicit UI opt-out to the original
        // race-count bisection) or there are no qualifying runners at all
        // (both splits stay empty either way, so skip the extra query).
        half = Math.floor(grand.total / 2);
      }
      effFromA = 1;
      effToA = half;
      effFromB = half + 1;
      effToB = null;
    }

    // raceCap is a hard ceiling on each split's window span (100 races for
    // an anonymous caller, 1000 for an authenticated one — see the router,
    // which decides raceCap from the request's auth state). Applied on top
    // of the half/half default above (not instead of it), so a small
    // filtered total still gets the "both splits populated" behavior that
    // default computes, while a large total (or an explicit caller-supplied
    // range) gets bounded to raceCap rather than the previous unbounded
    // "through the end" window. An open-ended toRow (null) becomes
    // "exactly raceCap races", not "unlimited".
    const maxToA = effFromA + raceCap - 1;
    effToA = effToA == null ? maxToA : Math.min(effToA, maxToA);
    const maxToB = effFromB + raceCap - 1;
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
