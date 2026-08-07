#!/usr/bin/env python3
"""Derived features for the win-probability model, built in pandas from the
frame train_and_predict.load_dataframe(extended=True) returns.

WHY THIS EXISTS
---------------
Every one of the deployed model's 30 features is ABSOLUTE. `officialRating=85`
is scored with no knowledge of whether the rest of the field is rated 60 or
105. But a horse race is a competition: P(win) depends entirely on how this
horse compares to THESE rivals, and a model scored one runner at a time cannot
express "standout in a weak field" at all.

That is not a guess about where the model loses. scripts/model-vs-sp-brier-
2026-08-04.ts decomposed the Brier gap against industry SP and found
calibration accounts for 0.2% of it and DISCRIMINATION for 99.2% — the market's
resolution is 1.8x the model's. The market gets relativity for free, because a
price is relative by construction. So the headline family here is
add_within_race_relative(): rank, normalised rank, within-race z-score and gap
to the best/second-best rival, for every attribute worth comparing.

The remaining families are ordinary horse-racing handicapping knowledge the
current feature set has no way to see: weight against rating ("well in"),
course/distance/going suitability, first-time headgear, class moves,
trainer-jockey combinations, layoff shape.

THE LEAKAGE RULE
----------------
Every trailing aggregation in this module is either

  (a) a cumcount/cumsum-minus-own construction, or
  (b) a daily-aggregated time-window rolling with closed="left".

Nothing else. No bare expanding(), no bare rolling(), no groupby.transform over
a history key. (a) is the pandas equivalent of src/commands/precompute-horse-
form.ts's Phase A (read all runners' form) / Phase B (only then append this race
to history), and is preferred over shift-then-expand because there is no shift
to forget.

ONE DIVERGENCE THAT MATTERS FOR THE EVENTUAL PORT. precompute-horse-form.ts and
precompute-trainer-form.ts use strictly-prior-*date*; a cumcount construction is
strictly-prior-*row*. For a horse those agree in practice — a horse does not run
twice in a day. For a TRAINER or JOCKEY they diverge constantly, because a yard
has six runners on a card and a cumcount would let the 09:00 result inform the
16:30 runner. That is why recipe (a) is only ever applied to horse-keyed and
combo-keyed features, and recipe (b) — which aggregates to (key, date) first and
so excludes every same-day race — is mandatory for the trainer/jockey windows.
Porting a recipe-(a) trainer feature into daily-race-feature-service.ts would
introduce a silent train/serve skew.

POST-RACE COLUMNS
-----------------
The frame carries postraceRpr/postraceTs/postraceBeatenDistance/postracePos/
postraceStatus — performance figures for the very race being predicted. They are
raw material for TRAILING history only (a horse's career-best RPR is built from
its prior runs' figures) and are never features themselves. build_features()
drops them from the returned frame, so the fit call physically cannot see them,
and assert_leakage_safe() rejects the whole class by prefix rather than by an
enumeration someone has to remember to extend.

`isp` never enters this module at all. It stays in market_benchmark's own narrow
frame, merged in only at scoring time — the guarantee train_and_predict.py's
header makes for the deployed model, preserved here.
"""

import re

import numpy as np
import pandas as pd

from train_and_predict import CAT_COLS, NUM_COLS

# Names that must never appear in a feature list. The market ones would make the
# model a recalibration of the price it is trying to beat; the rest are the
# label or post-race figures for the race being predicted.
FORBIDDEN_FEATURE_NAMES = frozenset({
    "isp", "ispFraction", "isFavourite", "sortPriority",
    "pos", "status", "label", "rpr", "ts", "beatenDistance",
    "modelWinProbability", "modelWinProbabilityOos",
})

POSTRACE_COLS = ("postraceRpr", "postraceTs", "postraceBeatenDistance",
                 "postracePos", "postraceStatus")

# Three of the deployed model's 22 numeric features are 100% NaN across all
# 972,486 production runners: they derive from runners[].comment, which is 0.1%
# populated because the Kaggle CSV the collection was seeded from never carried
# it. They have been contributing nothing, invisibly, since 2026-07-26. Kept
# nameable rather than silently dropped so an experiment can measure the
# difference rather than assume it.
DEAD_NUM_COLS = ("horseAvgExcuseScore", "horseTroubleInRunningRate",
                 "horseTravelledWellRate")


# ---------------------------------------------------------------------------
# Domain groupings. Both are judgement calls that change results, so each has a
# single definition here and ml/experiment.py records the map it used in every
# experiment document — otherwise an old experiment stops being interpretable
# the moment someone re-cuts the bands.
# ---------------------------------------------------------------------------

# Turf ground and all-weather surfaces are deliberately NOT merged: "Standard"
# is a synthetic-surface description, not a wetness, and a horse's record on
# Polytrack says nothing about its record on soft turf.
GOING_GROUPS = {
    "Firm": "firm", "Good To Firm": "firm",
    "Good": "good",
    "Good To Soft": "soft", "Soft": "soft",
    "Heavy": "heavy",
    "Standard To Fast": "aw-fast",
    "Standard": "aw-standard",
    "Standard To Slow": "aw-slow", "Standard / Slow": "aw-slow", "Slow": "aw-slow",
}

# Banded separately for Flat and jumps because the same trip means different
# things: 16f is a staying test on the Flat and the minimum trip over jumps.
FLAT_DISTANCE_BANDS = ((6.5, "sprint-5-6f"), (8.5, "mile-7-8f"),
                       (10.5, "middle-9-10f"), (12.5, "middle-11-12f"))
JUMPS_DISTANCE_BANDS = ((17.0, "jumps-2m"), (20.5, "jumps-2m1-2m4"),
                        (24.5, "jumps-2m5-3m"))
JUMPS_RACE_TYPES = frozenset({"Chase", "Hurdle", "NH Flat"})

RACE_NAME_PATTERNS = {
    # "H'cap" and "Hcap" are both common in the source race names, and a
    # nursery is a handicap for two-year-olds — missing it would put ~2% of
    # handicaps on the wrong side of the single most informative race-shape
    # split there is.
    "isHandicap": re.compile(r"handicap|h'?cap|nursery", re.I),
    "isNursery": re.compile(r"nursery", re.I),
    "isMaiden": re.compile(r"maiden", re.I),
    "isNovice": re.compile(r"novice", re.I),          # also matches "Novices'"
    "isSeller": re.compile(r"selling|seller", re.I),
    "isClaimer": re.compile(r"claiming|claimer", re.I),
    "isRestrictedRider": re.compile(r"apprentice|amateur|lady riders|gentlemen", re.I),
}

# The attributes worth comparing across a field, with the direction that counts
# as "better" — which orients Rank and GapBest. Trees can invert either, so the
# direction is about readability more than power, but a mislabelled one makes
# every downstream table lie.
RELATIVE_BASE_COLS = {
    "officialRating": "higher",
    "horseAvgRPR": "higher",
    "horseAvgTS": "higher",
    "horseAvgBeatenDistance": "lower",
    "horseCareerWinRate": "higher",
    "wgt": "higher",              # top weight = the handicapper's best-rated
    "trainerFormWinRate": "higher",
    "jockeyFormWinRate": "higher",
    "daysSinceLastRun": "lower",
}

# Missing-value indicators for the STRUCTURALLY sparse sources only — five
# booleans, not one per relative column. officialRating is 78.1% populated and
# the gap is not noise: maidens and novices have no official rating at all, so
# "no OR published" is itself a strong signal about the kind of race this is.
MISSING_INDICATOR_COLS = ("officialRating", "horseAvgRPR", "horseAvgTS",
                          "daysSinceLastRun", "draw")

LAYOFF_BUCKETS = ((0, "debut"), (7, "0-7"), (14, "8-14"), (30, "15-30"),
                  (60, "31-60"), (120, "61-120"), (365, "121-365"))


class LeakageError(AssertionError):
    """Raised when a feature list contains a name that could carry the result
    of the race being predicted. Deliberately its own type so a caller cannot
    swallow it with a bare `except AssertionError` meant for something else."""


def assert_leakage_safe(feature_cols) -> None:
    bad = [c for c in feature_cols
           if c in FORBIDDEN_FEATURE_NAMES or c.startswith("postrace")]
    if bad:
        raise LeakageError(
            f"{len(bad)} feature(s) would leak the result of the race being "
            f"predicted: {', '.join(sorted(bad))}. Post-race figures are trailing "
            f"history only (see this module's header); the market is a referee, "
            f"never a feature."
        )


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------

def _key(df: pd.DataFrame, cols) -> np.ndarray:
    """A single factorized integer group key over `cols`.

    Grouping ~1M rows on an int64 column is materially faster than on a tuple of
    object/category columns, and it sidesteps the categorical-product blowup
    that a groupby over two `category` dtypes can otherwise produce. NaN in any
    component yields its own key rather than being dropped, which is what we
    want: "trainer unknown" is a group, not an absence.
    """
    joined = df[cols[0]].astype("object").astype(str)
    for c in cols[1:]:
        joined = joined + "\x1f" + df[c].astype("object").astype(str)
    return pd.factorize(joined)[0]


def _safe_ratio(num, denom) -> np.ndarray:
    """num/denom where denom > 0, NaN otherwise — never inf.

    An inf sorts above every real value and survives into a split threshold; a
    NaN is routed by XGBoost's own learned default direction. The second is
    always what we mean by "there was nothing to divide by".
    """
    num = np.asarray(num, dtype="float64")
    denom = np.asarray(denom, dtype="float64")
    return np.where(denom > 0, np.divide(num, denom, out=np.full_like(num, np.nan),
                                         where=denom > 0), np.nan)


def _prior_counts_and_wins(df: pd.DataFrame, key_cols):
    """Recipe (a): strictly-prior run count and win count for a group key.

    cumcount() is 0 on a key's first appearance and n on its (n+1)th, i.e.
    already excludes the current row. cumsum() does NOT, so the current row's
    own label is subtracted back off — that subtraction is the whole leakage
    guarantee of this construction, and it is why there is no shift() here to
    forget.
    """
    k = _key(df, key_cols)
    label = df["label"].to_numpy(dtype="float64")
    g = pd.Series(label).groupby(k, sort=False)
    runs = g.cumcount().to_numpy(dtype="float64")
    wins = g.cumsum().to_numpy(dtype="float64") - label
    return runs, wins


def _trailing_window(df: pd.DataFrame, key_cols, window_days: int):
    """Recipe (b): runs and wins for a key over the last `window_days`,
    counting only races on STRICTLY EARLIER DATES.

    The naive `df.groupby(key).rolling("365D")` includes the current row and
    every earlier race on the same day. That does not match what
    precompute-trainer-form.ts computes (`raceDate >= windowStart &&
    raceDate < race.raceDate`), and for a trainer with six runners on a card the
    difference is not marginal — it lets the 13:30 winner inform the 16:00
    runner, which no live prediction could ever know.

    Aggregating to (key, date) first and then rolling with closed="left"
    reproduces the TypeScript semantics exactly, and is much faster besides: the
    daily frame is a small fraction of ~1M rows.
    """
    k = _key(df, key_cols)
    tmp = pd.DataFrame({
        "k": k,
        "d": pd.to_datetime(df["raceDate"].to_numpy()),
        "w": df["label"].to_numpy(dtype="float64"),
    })
    daily = (tmp.groupby(["k", "d"], as_index=False, sort=True)
                .agg(runs=("w", "size"), wins=("w", "sum"))
                .sort_values(["k", "d"]))
    rolled = (daily.set_index("d")
                   .groupby("k", sort=False)[["runs", "wins"]]
                   .rolling(f"{window_days}D", closed="left").sum()
                   .reset_index())
    merged = tmp[["k", "d"]].merge(rolled, on=["k", "d"], how="left")
    # closed="left" leaves a key's FIRST date with no window at all, which
    # rolling reports as NaN. Zero is the honest value: "this trainer had no
    # runners in the previous 90 days" is a real and informative state (a yard
    # just starting up, or back from a break), not an absence of data. The
    # derived win RATE stays NaN, via _safe_ratio's zero-denominator rule.
    return (np.nan_to_num(merged["runs"].to_numpy(dtype="float64"), nan=0.0),
            np.nan_to_num(merged["wins"].to_numpy(dtype="float64"), nan=0.0))


def _assign(df: pd.DataFrame, new_cols: dict) -> pd.DataFrame:
    """Attach a family's columns in ONE concat rather than one insert each.

    Inserting ~120 columns individually into a ~1M-row frame is quadratic in
    copies and pandas rightly warns about the fragmentation; a single concat per
    family turns that into eight. Returned rather than mutated because concat
    produces a new object.
    """
    if not new_cols:
        return df
    return pd.concat([df, pd.DataFrame(new_cols, index=df.index)], axis=1)


def _prior_value(df: pd.DataFrame, key_cols, col: str):
    """The value `col` held on this key's immediately preceding row."""
    k = _key(df, key_cols)
    return df[col].groupby(k, sort=False).shift(1)


def _class_number(race_class: pd.Series) -> pd.Series:
    """'Class 3' -> 3. Unclassed races (a lot of jumps and pattern racing) stay
    NaN rather than being coerced to a middle value — 'no class stated' is a
    real category, not a Class 4."""
    return pd.to_numeric(race_class.astype("object").str.extract(r"Class\s*(\d)", expand=False),
                         errors="coerce")


def _distance_band(furlongs: pd.Series, race_type: pd.Series) -> pd.Series:
    is_jumps = race_type.astype("object").isin(JUMPS_RACE_TYPES).to_numpy()
    f = furlongs.to_numpy(dtype="float64")
    out = np.full(len(f), None, dtype=object)
    for bands, mask, tail in ((FLAT_DISTANCE_BANDS, ~is_jumps, "stay-13f+"),
                              (JUMPS_DISTANCE_BANDS, is_jumps, "jumps-3m+")):
        remaining = mask & ~np.isnan(f)
        for cut, name in bands:
            hit = remaining & (f < cut)
            out[hit] = name
            remaining = remaining & ~hit
        out[remaining] = tail
    return pd.Series(out, index=furlongs.index)


# ---------------------------------------------------------------------------
# Feature families. Each returns (cat_names, num_names) and mutates df in place.
# ---------------------------------------------------------------------------

def add_race_context(df: pd.DataFrame):
    """Race shape from the race name, plus banded distance and field size.

    `raceClass` alone cannot say handicap vs maiden vs conditions, and that is
    the single most informative thing about a field's shape: a handicap is
    deliberately compressed so every runner has a chance, while a maiden can
    contain one unbeaten favourite and eleven no-hopers. A model that cannot
    tell them apart has to average over both.
    """
    name = df["raceName"].astype("object").fillna("")
    new = {}
    num = []
    for col, pattern in RACE_NAME_PATTERNS.items():
        new[col] = name.str.contains(pattern).astype("float32")
        num.append(col)

    class_num = _class_number(df["raceClass"]).astype("float32")
    new["isPattern"] = df["pattern"].notna().astype("float32")
    new["raceClassNum"] = class_num
    new["hasRaceClass"] = class_num.notna().astype("float32")
    num += ["isPattern", "raceClassNum", "hasRaceClass"]

    # distanceBand itself is built once in build_features (add_suitability
    # groups by it, and that family can be selected without this one) — here it
    # is only CLAIMED as a feature, which it is not unless this family runs.
    new["fieldSizeBucket"] = pd.cut(
        df["ran"], bins=[0, 6, 8, 11, 15, 19, 1000],
        labels=["2-6", "7-8", "9-11", "12-15", "16-19", "20+"],
    ).astype("category")
    return _assign(df, new), ["distanceBand", "fieldSizeBucket"], num


def add_within_race_relative(df: pd.DataFrame):
    """THE core family: every comparable attribute expressed relative to the
    field it is actually competing against.

    Five views per attribute, because they answer different questions and trees
    cannot derive one from another cheaply:
      Rank      — ordinal position, immune to the scale of the race
      RankNorm  — rank on 0..1, so it means the same in a 5- and a 20-runner field
      Z         — how far clear in units of the field's own spread
      GapBest   — raw margin to the best rival (0 for the best horse itself)
      GapSecond — how far the best horse is CLEAR of the next one, i.e. is this
                  a standout or a two-horse race

    NaN policy: pandas' rank() skips NaN and returns NaN, which IS the
    rank-over-non-null-only policy, for free. RankNorm divides by the count of
    VALID values, not by `ran` — dividing by `ran` when 4 of 12 runners have no
    official rating would make the top-rated horse's normalised rank depend on
    how many of its rivals happen to be unrated, which is noise.
    """
    g = df.groupby("raceId", sort=False, observed=True)
    new = {}
    num = []
    for col, direction in RELATIVE_BASE_COLS.items():
        ascending = direction == "lower"
        gcol = g[col]
        rank = gcol.rank(method="min", ascending=ascending)
        n_valid = gcol.transform("count")
        mean = gcol.transform("mean")
        std = gcol.transform("std")
        best = gcol.transform("min" if ascending else "max")

        # method="first" breaks ties by row order, so exactly one row is rank 2
        # and the extraction below is single-valued. The REPORTED rank stays
        # method="min", where a genuine dead heat on ratings correctly reads as
        # a shared rank. Row order is fixed once in build_features() and never
        # re-sorted, which is what makes "first" deterministic here.
        rank_first = gcol.rank(method="first", ascending=ascending)
        second = df[col].where(rank_first == 2).groupby(df["raceId"], sort=False).transform("max")

        new[f"{col}Rank"] = rank.astype("float32")
        new[f"{col}RankNorm"] = pd.Series(
            _safe_ratio(rank - 1, n_valid - 1), index=df.index).astype("float32")
        # std == 0 (a whole field on the same mark, common in low-grade
        # handicaps) must give NaN, never inf.
        new[f"{col}Z"] = pd.Series(
            _safe_ratio(df[col] - mean, std.where(std > 0)), index=df.index).astype("float32")
        new[f"{col}GapBest"] = (df[col] - best).astype("float32")
        new[f"{col}GapSecond"] = (df[col] - second).astype("float32")
        num += [f"{col}Rank", f"{col}RankNorm", f"{col}Z",
                f"{col}GapBest", f"{col}GapSecond"]

    for col in MISSING_INDICATOR_COLS:
        name = f"has{col[0].upper()}{col[1:]}"
        new[name] = df[col].notna().astype("float32")
        num.append(name)
    return _assign(df, new), [], num


def add_field_strength(df: pd.DataFrame):
    """Race-level aggregates. Constant within a race, so they cannot reorder one
    on their own — their value is entirely in what trees do with them in
    combination with the relative columns above. A +10 official-rating edge over
    the field means something very different in a Class 6 seller than in a
    Group 1, and the current absolute feature set has no way to say so."""
    g = df.groupby("raceId", sort=False, observed=True)
    or_mean, or_std = g["officialRating"].transform("mean"), g["officialRating"].transform("std")
    or_max, or_min = g["officialRating"].transform("max"), g["officialRating"].transform("min")
    or_count = g["officialRating"].transform("count")
    new = {
        "orMean": or_mean.astype("float32"),
        "orSd": or_std.astype("float32"),
        "orMax": or_max.astype("float32"),
        "orRange": (or_max - or_min).astype("float32"),
        "orCount": or_count.astype("float32"),
        "orCoverage": pd.Series(_safe_ratio(or_count, df["ran"]), index=df.index).astype("float32"),
        "rprMean": g["horseAvgRPR"].transform("mean").astype("float32"),
        "rprSd": g["horseAvgRPR"].transform("std").astype("float32"),
        "wgtRange": (g["wgt"].transform("max") - g["wgt"].transform("min")).astype("float32"),
    }
    return _assign(df, new), [], list(new)


def add_weights_vs_ratings(df: pd.DataFrame):
    """Classic handicapping arithmetic the model currently cannot do.

    In a handicap the weights ARE the ratings: 1lb carried is worth about 1
    rating point, so a horse rated 10lb higher than its weight concession
    implies is "well in". officialRating and wgt are both already features, but
    their difference is the informative quantity and a tree would need many
    splits to approximate it.

    handicapperGap is the other half: a horse whose recent Racing Post Ratings
    run well ahead of its official mark is one the handicapper has not caught up
    with yet.
    """
    g = df.groupby("raceId", sort=False, observed=True)
    wgt_min = g["wgt"].transform("min")
    well_in = (df["officialRating"] - (df["wgt"] - wgt_min)).astype("float32")

    # Career-best and last-run figures, from the horse's PRIOR runs only.
    # shift(1) comes FIRST so the current race's own post-race figure can never
    # enter its own running maximum.
    k = _key(df, ["horseName"])
    prior_rpr = df["postraceRpr"].groupby(k, sort=False).shift(1)
    career_best = prior_rpr.groupby(k, sort=False).cummax()

    new = {
        "orMinusWeightAllowance": well_in,
        "orMinusWeightRank": well_in.groupby(df["raceId"], sort=False)
                                    .rank(method="min", ascending=False).astype("float32"),
        "weightPerFurlong": pd.Series(
            _safe_ratio(df["wgt"], df["distanceFurlongs"]), index=df.index).astype("float32"),
        "handicapperGap": (df["horseAvgRPR"] - df["officialRating"]).astype("float32"),
        "lastRunRpr": prior_rpr.astype("float32"),
        "careerBestRpr": career_best.astype("float32"),
        "bestMinusRecent": (career_best - df["horseAvgRPR"]).astype("float32"),
        # Improving or regressing: the most recent figure against the trailing
        # mean of the three before it. horseAvgRPR is already a last-3 trailing
        # mean (precompute-horse-form.ts), so this reads as "latest vs recent".
        "rprTrend": (prior_rpr - df["horseAvgRPR"]).astype("float32"),
    }
    return _assign(df, new), [], list(new)


def add_suitability(df: pd.DataFrame):
    """Has this horse done it HERE, over THIS trip, on THIS ground, in THIS code?

    "Course and distance winner" is on every racecard for a reason, and none of
    it is currently available to the model: horseCareerWinRate is a single
    all-conditions number.

    All recipe (a) — every key starts with the horse, and a horse does not run
    twice in a day, so strictly-prior-row and strictly-prior-date agree.
    """
    new = {}
    for suffix, key_cols in (
        ("Course", ["horseName", "course"]),
        ("Distance", ["horseName", "distanceBand"]),
        ("Going", ["horseName", "goingGroup"]),
        ("Type", ["horseName", "raceType"]),
    ):
        runs, wins = _prior_counts_and_wins(df, key_cols)
        new[f"horse{suffix}Runs"] = runs.astype("float32")
        new[f"horse{suffix}WinRate"] = _safe_ratio(wins, runs).astype("float32")

    # Stepping up or down in trip / class relative to the last run. Both are
    # standard form-book reads, and both need the PREVIOUS row's value, which
    # shift(1) within the horse gives exactly.
    k = _key(df, ["horseName"])
    prior_dist = df["distanceFurlongs"].groupby(k, sort=False).shift(1)
    prior_mean_dist = (df["distanceFurlongs"].groupby(k, sort=False)
                         .transform(lambda s: s.shift(1).expanding().mean()))
    prior_class = df["raceClassNum"].groupby(k, sort=False).shift(1)
    new["distanceVsLast"] = (df["distanceFurlongs"] - prior_dist).astype("float32")
    new["distanceVsUsual"] = (df["distanceFurlongs"] - prior_mean_dist).astype("float32")
    # POSITIVE = dropping in class, because Class 1 is the best. That sign is
    # the opposite of the intuitive reading, so it is stated here rather than
    # left for whoever reads a SHAP plot to work out.
    new["classMove"] = (df["raceClassNum"] - prior_class).astype("float32")
    return _assign(df, new), [], list(new)


def add_headgear_change(df: pd.DataFrame):
    """First-time headgear is one of the few genuinely well-known angles in the
    form book, and the deployed model cannot see it: `hg` is a categorical of
    what is worn TODAY, with no reference to what was worn last time.

    Note hg == null means NO HEADGEAR, not a missing value — so it is filled to
    a real empty-string category and gets no missing-indicator, unlike the
    sparse numerics.
    """
    cur = df["hg"].astype("object").fillna("")
    k = _key(df, ["horseName"])
    prior = cur.groupby(k, sort=False).shift(1)
    has_prior = prior.notna()

    # How long the horse has been in its current headgear: a streak id that
    # increments whenever the headgear changes, then a cumcount within it.
    changed = (cur != prior) | ~has_prior
    streak = pd.Series(changed.to_numpy(dtype="float64")).groupby(k, sort=False).cumsum()

    new = {
        "hgNorm": cur.astype("category"),
        "firstTimeHeadgear": ((cur != "") & (prior == "") & has_prior).astype("float32"),
        "headgearRemoved": ((cur == "") & (prior != "") & has_prior).astype("float32"),
        "headgearChanged": ((cur != prior) & (cur != "") & (prior != "")
                            & has_prior).astype("float32"),
        "runsInCurrentHeadgear": pd.Series(
            pd.Series(np.arange(len(df)))
            .groupby([k, streak.to_numpy()], sort=False).cumcount().to_numpy(),
            index=df.index).astype("float32"),
    }
    return _assign(df, new), ["hgNorm"], [c for c in new if c != "hgNorm"]


def add_connections(df: pd.DataFrame):
    """Trainer and jockey signal the 14-day form windows cannot carry.

    trainerJockey is the interesting one: a top yard books a top jockey when it
    fancies one, so the COMBINATION is informative in a way neither party's
    solo strike rate is. trainerRunnersInThisRace is the other side of that —
    when a yard runs two, one of them is the second string, and which one the
    stable jockey is on is a signal the model can currently only guess at.

    The 90d/365d windows use recipe (b): a trainer has six runners on a card, so
    a cumcount here would let the 13:30 result inform the 16:00 runner.
    """
    new = {}
    # Recipe (a) is safe here: both keys are combinations a single yard/rider
    # pairing rarely repeats twice in a day, and the combo is the point.
    for name, key_cols in (("trainerJockey", ["trainer", "jockey"]),
                           ("trainerCourse", ["trainer", "course"])):
        runs, wins = _prior_counts_and_wins(df, key_cols)
        new[f"{name}Runs"] = runs.astype("float32")
        new[f"{name}WinRate"] = _safe_ratio(wins, runs).astype("float32")

    # Recipe (b), and it is NOT optional here — see this module's header. A
    # trainer has six runners on a card, so a cumcount would let the 13:30
    # result inform the 16:00 runner.
    for who in ("trainer", "jockey"):
        for window in (90, 365):
            runs, wins = _trailing_window(df, [who], window)
            new[f"{who}Runs{window}d"] = runs.astype("float32")
            new[f"{who}WinRate{window}d"] = _safe_ratio(wins, runs).astype("float32")

    # Pure within-race: no history, so no leakage is possible.
    k = _key(df, ["raceId", "trainer"])
    new["trainerRunnersInThisRace"] = pd.Series(
        pd.Series(np.ones(len(df))).groupby(k, sort=False).transform("size").to_numpy(),
        index=df.index).astype("float32")
    new["trainerRunnerRankInRace"] = (
        df["officialRating"].groupby(k, sort=False)
        .rank(method="min", ascending=False).astype("float32"))
    return _assign(df, new), [], list(new)


def add_layoff_seasonality(df: pd.DataFrame):
    """Fitness and campaign shape. daysSinceLastRun is already a feature but is
    a bare number: the form-book reading of it is bucketed and non-monotonic (a
    horse off 10 days is 'quick reappearance', off 300 is 'needs the run'), and
    the second run after a long layoff is its own well-known angle."""
    days = df["daysSinceLastRun"]
    k = _key(df, ["horseName"])
    labels = [name for _, name in LAYOFF_BUCKETS] + ["365+"]
    new = {
        "isDebut": (df["horseCareerRuns"].fillna(0) == 0).astype("float32"),
        # fillna(-1) lands a horse with no prior run in the "debut" bucket,
        # which is what a null daysSinceLastRun means.
        "layoffBucket": pd.cut(days.fillna(-1),
                               bins=[-2] + [c for c, _ in LAYOFF_BUCKETS] + [10 ** 6],
                               labels=labels).astype("category"),
        "secondRunAfterLayoff": (days.groupby(k, sort=False).shift(1) > 120).astype("float32"),
        "month": pd.to_datetime(df["raceDate"]).dt.month.astype("float32"),
    }
    for window in (30, 90):
        runs, _ = _trailing_window(df, ["horseName"], window)
        new[f"horseRunsLast{window}"] = runs.astype("float32")
    return _assign(df, new), ["layoffBucket"], [c for c in new if c != "layoffBucket"]


FAMILIES = {
    "context": add_race_context,
    "relative": add_within_race_relative,
    "fieldStrength": add_field_strength,
    "ratings": add_weights_vs_ratings,
    "suitability": add_suitability,
    "headgear": add_headgear_change,
    "connections": add_connections,
    "layoff": add_layoff_seasonality,
}

# Dependency order, not preference order: add_suitability groups by
# distanceBand and goingGroup, which add_race_context and build_features create.
FAMILY_ORDER = ("context", "relative", "fieldStrength", "ratings",
                "suitability", "headgear", "connections", "layoff")

# Named, composable variants. "baseline" is the deployed 30-feature set and
# exists so the harness can reproduce the stored walk-forward numbers through
# the new code path — until it does, no other number the harness produces means
# anything. The single-family sets are for phase-4 ablation: the port cost in
# daily-race-feature-service.ts is proportional to how many families survive.
FEATURE_SETS = {
    "baseline": (),
    "relative": ("context", "relative", "fieldStrength"),
    "relativeOnly": ("relative",),
    "ratings": ("context", "ratings"),
    "suitability": ("context", "suitability"),
    "headgear": ("headgear",),
    "connections": ("connections",),
    "layoff": ("layoff",),
    "all": FAMILY_ORDER,
}


def build_features(df: pd.DataFrame, feature_set: str = "all",
                   drop_dead_baseline: bool = True):
    """Derive `feature_set`'s families and return (df, cat_cols, num_cols).

    Mutates and returns the same frame — at ~1M rows a defensive copy is a
    gigabyte, so callers that need the original should copy before calling.

    Sorting happens exactly ONCE here and is never redone. Every trailing
    construction in this module is strictly-prior-ROW, so row order IS the
    leakage guarantee, and add_within_race_relative's method="first" tie-break
    is only deterministic because of it.

    That same property is what lets ml/experiment.py build features once over
    the whole frame and then fold, rather than rebuilding per fold at 11x the
    cost: a row's features cannot depend on any later row. The two tests that
    license that optimisation are
    test_a_races_own_result_never_affects_its_own_features and
    test_future_races_cannot_influence_the_past in ml/test_race_features.py.
    """
    if feature_set not in FEATURE_SETS:
        raise KeyError(f"unknown feature set {feature_set!r}; "
                       f"known: {', '.join(sorted(FEATURE_SETS))}")

    df = df.sort_values(["raceTime", "raceId", "num"], kind="stable").reset_index(drop=True)

    # goingGroup is needed by add_suitability and is cheap, so it is built here
    # rather than inside a family that a chosen set might not include.
    df["goingGroup"] = (df["going"].astype("object").map(GOING_GROUPS)
                          .fillna("unknown").astype("category"))
    # distanceBand likewise: add_suitability groups by it, and a set that skips
    # "context" would otherwise fail on a missing column.
    if "distanceBand" not in df.columns:
        df["distanceBand"] = _distance_band(df["distanceFurlongs"],
                                            df["raceType"]).astype("category")

    cat_cols = list(CAT_COLS)
    num_cols = [c for c in NUM_COLS
                if not (drop_dead_baseline and c in DEAD_NUM_COLS)]

    families = FEATURE_SETS[feature_set]
    for name in FAMILY_ORDER:
        if name not in families:
            continue
        df, cats, nums = FAMILIES[name](df)
        cat_cols += [c for c in cats if c not in cat_cols]
        num_cols += [c for c in nums if c not in num_cols]

    if families:
        cat_cols.append("goingGroup")

    feature_cols = cat_cols + num_cols
    assert_leakage_safe(feature_cols)

    # Structural, not decorative: with the post-race columns physically absent
    # from the frame, a fit() call cannot see them even if the name check above
    # were somehow bypassed.
    df = df.drop(columns=[c for c in POSTRACE_COLS if c in df.columns])

    for c in cat_cols:
        if df[c].dtype.name != "category":
            df[c] = df[c].astype("category")
    return df, cat_cols, num_cols


def feature_coverage(df: pd.DataFrame, cols) -> list:
    """Populated percentage per feature, newest-first in the caller's order.

    ml/experiment.py fails a run outright on anything above 99% null. That is
    not defensive programming for its own sake: three of the deployed model's
    22 numeric features are 100% NaN in production right now (see
    DEAD_NUM_COLS), and nothing in the pipeline noticed for weeks because a
    silently-dead feature costs no error, just accuracy.
    """
    n = len(df)
    out = []
    for c in cols:
        populated = float(df[c].notna().mean() * 100) if n else 0.0
        out.append({"col": c, "populatedPct": round(populated, 3)})
    return out
