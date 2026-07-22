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
    // Explicit runner-index split boundaries — the runner-mode equivalent
    // of fromRowA/toRowA/fromRowB/toRowB above. When any of these four are
    // set, they take priority over fromRowA/etc. (mirrors "explicit beats
    // default", just for the other unit) and get resolved into race-index
    // bounds via getQualifyingRunnerSplitBoundary before anything else in
    // this method runs — after that resolution, every line below (raceCap
    // clamping, the actual getAllRacesByRace calls) is completely
    // unchanged, since it only ever deals in race indices regardless of
    // which unit the caller asked in.
    fromRunnerA: number | null = null,
    toRunnerA: number | null = null,
    fromRunnerB: number | null = null,
    toRunnerB: number | null = null,
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

    // Resolves a runner-index target (e.g. "the runner at cumulative
    // position 2500") to the race-index of the first race (in raceTime
    // order) whose cumulative qualifying-runner count reaches it — the
    // same lookup the default-split bisection uses below, just exposed for
    // an arbitrary caller-supplied target instead of a single fixed
    // bisection point. Falls back to the given race-index bound (1 for a
    // "from" target, the grand total for a "to" target) if the target is
    // out of range (e.g. asking for runner 999999 in a field of 500).
    const resolveRunnerBoundary = async (target: number, fallback: number): Promise<number> => {
      const { boundaryRowIndex } = await this.industrySpDAO.getQualifyingRunnerSplitBoundary(
        minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
        minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
        trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
        minModelWinProbability, onlyModelBeatsSp, Math.max(1, target)
      );
      return boundaryRowIndex ?? fallback;
    };

    // Splits default to an even first-half/second-half divide of whatever
    // the current total is, whenever the caller doesn't pin down explicit
    // boundaries in either unit (a fresh page load, or after Reset).
    // Bisected by *qualifying runner count*, not race count — a race-count
    // bisection (the old behavior) can leave Split A and Split B with very
    // uneven numbers of runners that actually match the active filters
    // once trainer-form/model/model-beats-SP are on, since qualifying-
    // runner count per race varies once those filters cut some runners
    // out. effToB is left open-ended (null, "through the end") rather than
    // an explicit number so it never needs reclamping as the total changes
    // with the filters.
    const hasExplicitRunnerSplit = fromRunnerA != null || toRunnerA != null || fromRunnerB != null || toRunnerB != null;
    const hasExplicitRaceSplit = fromRowA != null || toRowA != null || fromRowB != null || toRowB != null;
    const splitsAreDefault = !hasExplicitRunnerSplit && !hasExplicitRaceSplit;

    if (hasExplicitRunnerSplit) {
      // Explicit runner-index split — selects individual qualifying runners
      // directly via getRunnerRangeStats rather than resolving each target
      // to a race and handing whole races to getAllRacesByRace. That older
      // approach rounded every target up to the next full race (since a
      // race is the smallest unit getAllRacesByRace can hand to one split),
      // so typing "1-1000" / "1001-2000" never showed exactly 1000/1000 —
      // reported live as the result cards "still not matching" what was
      // typed even after the double-counting bug (see git history) was
      // fixed. Selecting at the runner level instead gives an exact count
      // for each split with no rounding and no possibility of the two
      // ranges overlapping, as long as the caller's own from/to targets
      // don't overlap.
      const effFromRunnerA = Math.max(1, fromRunnerA ?? 1);
      const effFromRunnerB = Math.max(1, fromRunnerB ?? 1);

      // raceRowBound only bounds how many races this scans/unwinds (cost
      // control) — it is NOT the split boundary itself, unlike the old
      // effToA/effToB. Resolved via the existing (cheap, tiny-doc) boundary
      // lookup for an explicit "to" target, or raceCap alone when the
      // target is open-ended ("through the end").
      const raceRowBoundFor = async (toTarget: number | null): Promise<number> => {
        if (toTarget == null) return Math.min(raceCap, grand.total);
        const boundaryRow = await resolveRunnerBoundary(toTarget, grand.total);
        return Math.min(boundaryRow, raceCap, grand.total);
      };

      const [raceRowBoundA, raceRowBoundB] = await Promise.all([
        raceRowBoundFor(toRunnerA),
        raceRowBoundFor(toRunnerB),
      ]);

      const [splitA, splitB] = await Promise.all([
        this.industrySpDAO.getRunnerRangeStats(
          minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
          minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
          trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
          minModelWinProbability, onlyModelBeatsSp, effFromRunnerA, toRunnerA, raceRowBoundA
        ),
        this.industrySpDAO.getRunnerRangeStats(
          minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
          minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
          trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
          minModelWinProbability, onlyModelBeatsSp, effFromRunnerB, toRunnerB, raceRowBoundB
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
        splitA,
        splitB,
      };
    }

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

  // Cumulative ROI% convergence series for the "P&L graph" — requested
  // live alongside the split cards to show how the running profit % is
  // volatile over a small sample and settles down as more runners are
  // included. fromRunnerTarget/toRunnerTarget are one split's own runner
  // range (e.g. Split B's 1001..2000) — each split's graph is its own
  // independent convergence test starting fresh at fromRunnerTarget, not a
  // slice of one dataset-wide running total (see getRunnerConvergenceSeries
  // on the DAO for why). runnerOrdinal in the returned points is still the
  // true global ordinal, matching what that split's own card shows.
  public async getRunnerConvergenceSeries(
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
    fromRunnerTarget: number,
    toRunnerTarget: number,
    raceCap = 1000
  ): Promise<{ runnerOrdinal: number; cumulativeStaked: number; cumulativeReturns: number; cumulativePnl: number; roiPercent: number }[]> {
    const grand = await this.industrySpDAO.getAllRacesByRace(
      1, 1, minRunners, maxRunners, countries, minIsp, maxIsp, "asc", minInIspRange, maxInIspRange, 1, null,
      minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
      trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, null, minModelWinProbability,
      onlyModelBeatsSp
    );

    // Same "resolve a target ordinal to a race-row bound, then clamp to
    // raceCap" shape as getSplitStats' own raceRowBoundFor — bounds how
    // many races this scans regardless of how large toRunnerTarget is.
    // Still resolved from toRunnerTarget alone (not fromRunnerTarget) — the
    // scan always starts at race 1 to identify true global ordinals, see
    // the DAO method's own comment.
    const { boundaryRowIndex } = await this.industrySpDAO.getQualifyingRunnerSplitBoundary(
      minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
      minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
      trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
      minModelWinProbability, onlyModelBeatsSp, Math.max(1, toRunnerTarget)
    );
    const raceRowBound = Math.min(boundaryRowIndex ?? grand.total, raceCap, grand.total);

    const points = await this.industrySpDAO.getRunnerConvergenceSeries(
      minRunners, maxRunners, countries, minIsp, maxIsp, minInIspRange, maxInIspRange,
      minRaceTime, maxRaceTime, courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch,
      trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
      minModelWinProbability, onlyModelBeatsSp, Math.max(1, fromRunnerTarget), Math.max(1, toRunnerTarget), raceRowBound
    );

    return points.map(p => ({
      runnerOrdinal: p.runnerOrdinal,
      cumulativeStaked: p.cumulativeStaked,
      cumulativeReturns: p.cumulativeReturns,
      cumulativePnl: p.cumulativeReturns - p.cumulativeStaked,
      roiPercent: p.cumulativeStaked > 0 ? ((p.cumulativeReturns - p.cumulativeStaked) / p.cumulativeStaked) * 100 : 0,
    }));
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
