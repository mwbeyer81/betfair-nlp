#!/usr/bin/env python3
"""Walk-forward experiment harness for the win-probability model.

WHY THIS EXISTS
---------------
walk_forward_score.py answers "how good is the deployed model, honestly?". It
is not built to answer "would THIS feature set, or THIS training objective, be
better?" — it has one feature list, one objective, and it writes its answer
onto every runner in production.

This module answers the second question, and does so without touching anything
the deployed pipeline reads.

WHAT IT NEVER DOES
------------------
Never writes ml/models/. Never uploads to S3. Never writes a per-runner
probability field of any kind. Never writes to model_evaluations — that
collection is read by train_and_predict.current_champion() and by
predict_daily_races.py's latest-version lookup, which is on the DEPLOYED daily
prediction path. It only ever reads industry_starting_prices, and writes
exactly one document to model_experiments.

ml/test_experiment.py enforces that by scanning this file's own source for the
names that would do any of it. That is a blunt instrument on purpose: the
failure it guards against (a plausible-looking experiment silently replacing
the model serving tomorrow's racecards) is not one anybody would notice quickly.

THE ARMS
--------
Five variants, and the 2x2 between them is what makes the result attributable:

  base-binary    30 features, binary:logistic   -- must REPRODUCE the stored
                                                   walk-forward numbers; this
                                                   is the harness's own
                                                   correctness test
  rel-binary     ~143 features, binary:logistic -- features alone
  base-softmax   30 features, conditional logit -- objective alone
  rel-softmax    ~143 features, conditional logit
  rel-rank       ~143 features, rank:pairwise + fitted temperature

The conditional-logit ("softmax_race") objective is the interesting one. The
deployed model trains each runner as an independent binary event and then
normalises the race afterwards, which throws away the one thing that is
certainly true of a horse race: exactly one runner wins. Training on the
Plackett-Luce likelihood -log P(the actual winner | this field) optimises
within-race discrimination directly — and discrimination is 99.2% of the
measured Brier gap against industry SP (AGENTS.md 2026-08-04).

USAGE
-----
    MONGODB_URI=... MONGODB_DB_NAME=... EXP_NAME=rel-softmax \
      EXP_FEATURE_SET=all EXP_OBJECTIVE=softmax_race \
      ml/venv/bin/python ml/experiment.py

Env knobs (naming mirrors walk_forward_score.py's WF_* so they are guessable):
    EXP_NAME             required, free text, stored on the doc
    EXP_NOTES            free text
    EXP_FEATURE_SET      a key of features.FEATURE_SETS (default "all")
    EXP_OBJECTIVE        binary | softmax_race | rank_pairwise (default binary)
    EXP_MODE             fast | full (default fast)
    EXP_FOLD_YEARS       comma list, overrides the mode's default folds
    EXP_N_ESTIMATORS_CAP cap trees per fold
    EXP_RACE_SAMPLE_FRAC sample this fraction of RACES (never of runners)
    EXP_CACHE_PATH       pickle of the loaded frame
    EXP_WRITE            "false" to compute and print without inserting
    EXP_SEED             default 42
    EXP_BASELINE_ID      experiment to compute deltaVsBaseline against
    EXP_FILTER_BATTERY   "true" to POST discovered segments as saved filter sets
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import xgboost as xgb
from pymongo import MongoClient

import features as F
import walk_forward_score as wf
from market_benchmark import load_isp_frame, market_probabilities
from train_and_predict import (
    COLLECTION_NAME,
    EXTENDED_COLUMNS,
    TRAINING_PARAMS,
    TRAINING_PARAMS_CAMEL,
    chronological_split,
    load_dataframe,
    make_model,
    normalize_within_race,
)

EXPERIMENTS_COLLECTION_NAME = "model_experiments"

NAME = os.environ.get("EXP_NAME", "")
NOTES = os.environ.get("EXP_NOTES", "")
FEATURE_SET = os.environ.get("EXP_FEATURE_SET", "all")
OBJECTIVE = os.environ.get("EXP_OBJECTIVE", "binary")
MODE = os.environ.get("EXP_MODE", "fast").lower()
FOLD_YEARS = [y.strip() for y in os.environ.get("EXP_FOLD_YEARS", "").split(",") if y.strip()]
N_ESTIMATORS_CAP = int(os.environ.get("EXP_N_ESTIMATORS_CAP", "0")) or None
RACE_SAMPLE_FRAC = float(os.environ.get("EXP_RACE_SAMPLE_FRAC", "0") or 0) or None
CACHE_PATH = Path(os.environ.get("EXP_CACHE_PATH",
                                 Path(__file__).parent / ".cache" / "experiment_frame.pkl"))
ISP_CACHE_PATH = CACHE_PATH.with_name(CACHE_PATH.stem + "_isp.pkl")
WRITE = os.environ.get("EXP_WRITE", "true").lower() != "false"
SEED = int(os.environ.get("EXP_SEED", "42"))
BASELINE_ID = os.environ.get("EXP_BASELINE_ID", "")
RUN_FILTER_BATTERY = os.environ.get("EXP_FILTER_BATTERY", "false").lower() == "true"
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000")
TRAINING_PIPELINE_API_KEY = os.environ.get("TRAINING_PIPELINE_API_KEY", "")

OBJECTIVES = ("binary", "softmax_race", "rank_pairwise")

# Fast mode exists so a feature idea can be tested in minutes rather than hours.
# All three levers apply together, because any one alone is not enough of a
# saving to change how the work feels. Sampling is BY RACE, never by runner: a
# partial field would break the within-race relative features and make the
# softmax likelihood wrong (its whole premise is that one runner in the group
# won).
FAST_FOLD_YEARS = ["2022", "2023", "2024", "2025", "2026"]
FAST_N_ESTIMATORS_CAP = 300
FAST_LEARNING_RATE = 0.10
FAST_RACE_SAMPLE_FRAC = 0.5

# Above this, a feature is doing nothing and the run should stop rather than
# quietly train on it. Three of the deployed model's 22 numeric features are
# 100% NaN in production right now and nothing noticed for weeks.
MAX_NULL_PCT = 99.0

# The market's Brier over the same rows is the realistic ceiling. Beating it
# comfortably from public form data would be extraordinary; a leak is much more
# likely, and a leaking model looks spectacular right up until it is deployed.
SUSPICIOUS_BRIER_MARGIN = 0.005

MURPHY_BINS = 100

# Reusing scripts/model-vs-sp-brier-2026-08-04.ts's exact cutpoints so this
# harness's SP-band table is directly comparable to the one in AGENTS.md.
SP_BANDS = ((0, 2.0, "under 2.0"), (2.0, 3.0, "2.0-3.0"), (3.0, 5.0, "3.0-5.0"),
            (5.0, 10.0, "5.0-10.0"), (10.0, 20.0, "10.0-20.0"), (20.0, 1e9, "20.0+"))

# Half-open [lo, hi) like SP_BANDS, so the label and the bounds have to be read
# together: "7-8" is [7, 9). segment_to_isp_filters converts back to the
# Filters screen's INCLUSIVE maxRunners with hi - 1.
FIELD_SIZE_BUCKETS = ((0, 7, "2-6"), (7, 9, "7-8"), (9, 12, "9-11"),
                      (12, 16, "12-15"), (16, 20, "16-19"), (20, 1000, "20+"))

# Every threshold here is a lesson from AGENTS.md 2026-08-01's "Traps for
# whoever picks this up". Nine dimensions times three selections is ~168 cells,
# and at that count several land positive by chance — that entry hit exactly
# this with ~54 cells and names the two false positives it produced. Applying a
# fixed rule mechanically, and STORING it on the document, is what keeps a
# discovery from being a post-hoc story about noise.
ACCEPTANCE_RULE = {
    "minN": 20000,                     # a +3% ROI on 162 runners is noise
    "minBss": 0.0,                     # must beat the market's Brier in this slice
    "requirePositiveUnderBothStakings": True,
    # Structural, not one lucky window. Expressed as a FRACTION of the years a
    # run actually scored, not a fixed count: a fast run covers five years, so
    # a hardcoded "8 of 11" would make a discovery arithmetically impossible in
    # the mode that is used for almost every iteration — the rule would look
    # like it was working while silently rejecting everything. The effective
    # integer threshold is computed per run and recorded on the document.
    "minYearsPositiveFraction": 8 / 11,
}


def effective_min_years(fold_count: int) -> int:
    """The integer year count a segment must be profitable in, for a run that
    scored `fold_count` years. Always at least 2 — one year is a window, not a
    pattern, however short the run."""
    return max(2, int(np.ceil(ACCEPTANCE_RULE["minYearsPositiveFraction"] * fold_count)))

# Filter params that read a model probability out of Mongo. A saved-filter-set
# POST carrying any of these would be scored against the DEPLOYED walk-forward's
# stored numbers, not this experiment's predictions — i.e. it would measure the
# OLD model under the new filters and file the answer under the new
# experiment's name. That is the exact shape of the 2026-08-04 incident where
# the Filters screen scored itself with a model that already knew the winners.
MODEL_DEPENDENT_FILTER_PARAMS = ("onlyModelBeatsSp", "minModelWinProbability",
                                 "minModelSpEdgePts")


# ---------------------------------------------------------------------------
# Race grouping — the harness assumes rows arrive sorted so each race is one
# contiguous block, which features.build_features guarantees.
# ---------------------------------------------------------------------------

def race_groups(race_ids: np.ndarray):
    """(sizes, starts) for contiguous runs of the same raceId.

    Asserted rather than assumed: every softmax and ranking operation below
    reduces over these offsets with np.add.reduceat, and a non-contiguous frame
    would silently mix two races into one likelihood term rather than raising.
    """
    if len(race_ids) == 0:
        return np.array([], dtype="int64"), np.array([], dtype="int64")
    change = np.empty(len(race_ids), dtype=bool)
    change[0] = True
    change[1:] = race_ids[1:] != race_ids[:-1]
    starts = np.flatnonzero(change)
    sizes = np.diff(np.append(starts, len(race_ids)))
    if len(np.unique(race_ids)) != len(starts):
        raise AssertionError(
            "rows are not grouped by race — a race appears in more than one block. "
            "features.build_features sorts once by (raceTime, raceId, num) and nothing "
            "may re-sort afterwards."
        )
    return sizes, starts


def group_softmax(margin: np.ndarray, sizes: np.ndarray, starts: np.ndarray) -> np.ndarray:
    """Softmax within each race. Max-subtracted for numerical stability."""
    m = np.maximum.reduceat(margin, starts)
    e = np.exp(margin - np.repeat(m, sizes))
    s = np.add.reduceat(e, starts)
    return e / np.repeat(s, sizes)


# ---------------------------------------------------------------------------
# The three objectives
# ---------------------------------------------------------------------------

def _softmax_obj(preds, dmat):
    """Conditional logit / Plackett-Luce gradient and hessian.

    For race r with runners i: p_i = exp(f_i) / sum_j exp(f_j), and the loss is
    -sum_r log p_{winner(r)}. Then grad_i = p_i - y_i and hess_i = p_i(1 - p_i)
    — the same diagonal approximation XGBoost's own multi:softprob uses.

    This is the correct likelihood for the data-generating process (exactly one
    winner per race), which binary:logistic discards. The output is ALREADY a
    within-race probability, so no temperature or post-hoc scaling is needed.
    """
    sizes, starts = dmat.race_sizes
    p = group_softmax(preds, sizes, starts)
    y = dmat.get_label()
    return p - y, np.maximum(p * (1.0 - p), 1e-6)


def _softmax_feval(preds, dmat):
    """Per-race negative log likelihood of the actual winner — the quantity the
    objective above minimises, needed as a custom metric so early stopping
    watches the same thing rather than a binary logloss that means something
    slightly different."""
    sizes, starts = dmat.race_sizes
    p = group_softmax(preds, sizes, starts)
    y = dmat.get_label()
    winners = p[y == 1]
    if len(winners) == 0:
        return "race-nll", 0.0
    return "race-nll", float(-np.log(np.clip(winners, 1e-15, 1.0)).mean())


def _one_winner_mask(df: pd.DataFrame) -> np.ndarray:
    """Rows belonging to races with exactly one winner.

    Dead heats (two WINNERs) and voided races (none) break the Plackett-Luce
    likelihood, which assumes exactly one. They are dropped from TRAINING only
    and never from scoring — a race the model could not learn from is still a
    race it must be judged on.
    """
    winners = df.groupby("raceId", sort=False, observed=True)["label"].transform("sum")
    return (winners == 1).to_numpy()


def _dmatrix(df, feature_cols, sizes_starts=None, ref=None, quantile=False):
    X, y = df[feature_cols], df["label"]
    cls = xgb.QuantileDMatrix if quantile else xgb.DMatrix
    kwargs = {"label": y, "enable_categorical": True, "missing": np.nan}
    if quantile and ref is not None:
        kwargs["ref"] = ref
    d = cls(X, **kwargs)
    if sizes_starts is not None:
        d.race_sizes = sizes_starts
    return d


def _booster_params(learning_rate=None):
    p = dict(TRAINING_PARAMS)
    p.pop("n_estimators")
    if learning_rate is not None:
        p["learning_rate"] = learning_rate
    p["seed"] = p.pop("random_state")
    p["tree_method"] = "hist"
    # ~143 features against 30 makes each split evaluation materially more
    # expensive; sampling half the columns per tree is the cheapest lever that
    # does not change what the model can express.
    p["colsample_bytree"] = 0.5
    return p


def fit_binary(fit_df, val_df, fold_df, feature_cols, n_estimators, learning_rate):
    """The deployed model's own formulation: independent binary events, then
    normalise the race afterwards. Uses train_and_predict.make_model so the
    control arm really is the deployed configuration and not a lookalike."""
    model = make_model(early_stopping=True)
    params = {"colsample_bytree": 0.5}
    if n_estimators:
        params["n_estimators"] = n_estimators
    if learning_rate:
        params["learning_rate"] = learning_rate
    model.set_params(**params)
    model.fit(fit_df[feature_cols], fit_df["label"],
              eval_set=[(val_df[feature_cols], val_df["label"])], verbose=False)
    raw = model.predict_proba(fold_df[feature_cols])[:, 1]
    return raw, {"bestIteration": int(model.best_iteration)}


def fit_softmax(fit_df, val_df, fold_df, feature_cols, n_estimators, learning_rate):
    keep = _one_winner_mask(fit_df)
    dropped = int(fit_df.loc[~keep, "raceId"].nunique())
    fit_df = fit_df[keep]
    val_keep = _one_winner_mask(val_df)
    val_df = val_df[val_keep]

    fit_groups = race_groups(fit_df["raceId"].to_numpy())
    val_groups = race_groups(val_df["raceId"].to_numpy())
    dtrain = _dmatrix(fit_df, feature_cols, fit_groups, quantile=True)
    dval = _dmatrix(val_df, feature_cols, val_groups, ref=dtrain, quantile=True)

    params = _booster_params(learning_rate)
    # base_score must be pinned. XGBoost 3.x auto-estimates it from the label
    # mean, which is meaningless for a score that only has relative meaning
    # inside a race — softmax cancels any constant shift, but the auto-estimate
    # interacts badly with early stopping on the custom metric.
    params["base_score"] = 0.0
    params["disable_default_eval_metric"] = 1

    evals_result = {}
    booster = xgb.train(
        params, dtrain,
        num_boost_round=n_estimators or TRAINING_PARAMS["n_estimators"],
        obj=_softmax_obj, custom_metric=_softmax_feval,
        evals=[(dval, "val")], evals_result=evals_result,
        early_stopping_rounds=50, verbose_eval=False, maximize=False,
    )
    dfold = _dmatrix(fold_df, feature_cols)
    margin = booster.predict(dfold, output_margin=True,
                             iteration_range=(0, booster.best_iteration + 1))
    sizes, starts = race_groups(fold_df["raceId"].to_numpy())
    p = group_softmax(margin, sizes, starts)

    # Free correctness check on the objective: a conditional logit's output sums
    # to 1 within every race by construction, so if this ever fails the grouping
    # is wrong rather than the model being poor.
    sums = np.add.reduceat(p, starts)
    if not np.allclose(sums, 1.0, atol=1e-6):
        raise AssertionError(f"softmax race probabilities do not sum to 1 "
                             f"(worst {np.abs(sums - 1).max():.2e}) — check race grouping")
    return p, {"bestIteration": int(booster.best_iteration),
               "droppedTrainRaces": dropped}


def _fit_temperature(margin, labels, sizes, starts):
    """The T minimising per-race NLL of softmax(margin / T), by golden-section
    search on log T.

    A ranking objective's output is an unbounded score, so it needs exactly one
    scalar to become a probability. Fitted on the fold's own early-stopping
    validation slice, which is held out from the fit AND strictly earlier than
    the fold being scored — the same guarantee walk_forward_score.fit_calibrator
    already makes on its fallback path.

    Implemented in-file rather than reaching for scipy: adding a dependency to
    ml/requirements.txt (and so to the prediction Lambda's image) for one 1-D
    search over a smooth unimodal function is a poor trade.
    """
    def nll(log_t):
        p = group_softmax(margin / np.exp(log_t), sizes, starts)
        w = p[labels == 1]
        return float(-np.log(np.clip(w, 1e-15, 1.0)).mean()) if len(w) else np.inf

    lo, hi = np.log(0.05), np.log(20.0)
    phi = (np.sqrt(5) - 1) / 2
    c, d = hi - phi * (hi - lo), lo + phi * (hi - lo)
    fc, fd = nll(c), nll(d)
    for _ in range(40):
        if fc < fd:
            hi, d, fd = d, c, fc
            c = hi - phi * (hi - lo)
            fc = nll(c)
        else:
            lo, c, fc = c, d, fd
            d = lo + phi * (hi - lo)
            fd = nll(d)
        if hi - lo < 1e-4:
            break
    return float(np.exp((lo + hi) / 2))


def fit_rank(fit_df, val_df, fold_df, feature_cols, n_estimators, learning_rate):
    fit_groups = race_groups(fit_df["raceId"].to_numpy())
    val_groups = race_groups(val_df["raceId"].to_numpy())
    dtrain = _dmatrix(fit_df, feature_cols)
    dtrain.set_group(fit_groups[0])
    dval = _dmatrix(val_df, feature_cols)
    dval.set_group(val_groups[0])

    params = _booster_params(learning_rate)
    params["objective"] = "rank:pairwise"
    params["eval_metric"] = "ndcg@1"
    booster = xgb.train(
        params, dtrain, num_boost_round=n_estimators or TRAINING_PARAMS["n_estimators"],
        evals=[(dval, "val")], early_stopping_rounds=50, verbose_eval=False,
    )
    best = (0, booster.best_iteration + 1)
    val_margin = booster.predict(dval, output_margin=True, iteration_range=best)
    temperature = _fit_temperature(val_margin, val_df["label"].to_numpy(),
                                   val_groups[0], val_groups[1])

    fold_margin = booster.predict(_dmatrix(fold_df, feature_cols),
                                  output_margin=True, iteration_range=best)
    sizes, starts = race_groups(fold_df["raceId"].to_numpy())
    p = group_softmax(fold_margin / temperature, sizes, starts)
    return p, {"bestIteration": int(booster.best_iteration),
               "temperature": round(temperature, 6)}


FITTERS = {"binary": fit_binary, "softmax_race": fit_softmax, "rank_pairwise": fit_rank}


# ---------------------------------------------------------------------------
# Metrics beyond score_block
# ---------------------------------------------------------------------------

def murphy(labels: np.ndarray, probs: np.ndarray, bins: int = MURPHY_BINS) -> dict:
    """Brier = reliability - resolution + uncertainty, over equal-COUNT bins
    with an explicit noise debias.

    Two things AGENTS.md 2026-08-04 learned the hard way and which are encoded
    here rather than re-learned:

    1. The identity is exact only for the BINNED forecast, not the raw one — the
       remainder is within-bin discrimination the binning discarded. Asserting
       it against the raw Brier fails at ~2e-4. So the assertion below is
       against the binned forecast's own Brier (holds to <1e-9) and the
       within-bin term is REPORTED rather than hidden.
    2. Bin count is a bias-variance tradeoff, not a free parameter. Too fine and
       each bin's observed rate is noisy, which inflates reliability by roughly
       (bins/N)*p(1-p) — at 1000 equal-width bins that bias exceeds reliability
       itself. Equal-count bins plus the debias below is what makes the
       reliability/resolution split trustworthy.

    Resolution is the number this whole project is trying to move: the model's
    is 0.007336 against the market's 0.013368.
    """
    mask = np.isfinite(probs)
    y, p = labels[mask].astype("float64"), probs[mask].astype("float64")
    n = len(y)
    if n < bins * 2 or len(np.unique(y)) < 2:
        return {"reliability": None, "resolution": None, "uncertainty": None,
                "withinBin": None, "n": int(n)}

    order = np.argsort(p, kind="stable")
    edges = np.array_split(order, bins)
    obar = y.mean()

    rel = res = noise = 0.0
    brier_binned = 0.0
    for idx in edges:
        if len(idx) == 0:
            continue
        nk = len(idx)
        fk, ok = p[idx].mean(), y[idx].mean()
        w = nk / n
        rel += w * (fk - ok) ** 2
        res += w * (ok - obar) ** 2
        if nk > 1:
            noise += w * ok * (1 - ok) / (nk - 1)
        brier_binned += np.sum((fk - y[idx]) ** 2) / n

    unc = obar * (1 - obar)
    identity = abs(rel - res + unc - brier_binned)
    if identity > 1e-9:
        raise AssertionError(f"Murphy identity failed on the binned forecast by {identity:.2e}")

    brier_raw = float(np.mean((p - y) ** 2))
    return {
        # Debiased: the raw estimates are inflated by the sampling noise in each
        # bin's observed rate, and at 100 bins that inflation is the same order
        # as reliability itself.
        "reliability": round(max(rel - noise, 0.0), 8),
        "resolution": round(res - noise + unc / max(n - 1, 1), 8),
        "uncertainty": round(unc, 8),
        # Reported, not hidden: the discrimination the binning threw away.
        "withinBin": round(brier_raw - brier_binned, 8),
        "n": int(n),
    }


def discrimination_block(labels: np.ndarray, probs: np.ndarray,
                         race_ids: np.ndarray) -> dict:
    """Top-1 rate and mean reciprocal rank of the actual winner.

    top1Rate is the most legible measure of the thing being fixed: how often the
    model's highest-rated runner actually wins. It is a pure ranking statistic,
    so unlike Brier it cannot be improved by being better calibrated about
    outcomes it cannot separate.
    """
    frame = pd.DataFrame({"r": race_ids, "y": labels, "p": probs}).dropna(subset=["p"])
    if frame.empty:
        return {"top1Rate": None, "mrr": None, "races": 0}
    g = frame.groupby("r", sort=False)
    rank = g["p"].rank(method="first", ascending=False)
    winners = frame[frame["y"] == 1]
    winner_rank = rank[frame["y"] == 1]
    if len(winners) == 0:
        return {"top1Rate": None, "mrr": None, "races": int(frame["r"].nunique())}
    return {
        "top1Rate": round(float((winner_rank == 1).mean()), 6),
        "mrr": round(float((1.0 / winner_rank).mean()), 6),
        "races": int(frame["r"].nunique()),
    }


def pnl_block(isp: np.ndarray, won: np.ndarray) -> dict:
    """P&L under both staking conventions, over runners with a usable SP.

    to-win-1: stake = 1/(isp-1), return = stake+1 on a win. This is the repo's
    own convention everywhere (industry-sp-dao.ts, model-accuracy-dao.ts) and is
    target-profit staking with zero expectation at fair odds; the -11.67%
    no-filter baseline is just the ISP overround.

    level: stake = 1, return = isp on a win. Reported alongside because to-win-1
    stakes ~£2 on an evens shot and ~£0.05 on a 21.0 shot, so its ROI is
    dominated by favourites — level stakes is the one to read for "is there an
    edge". A cell that is positive under one and negative under the other is
    noise, and ACCEPTANCE_RULE refuses it for exactly that reason.
    """
    usable = np.isfinite(isp) & (isp > 1)
    isp, won = isp[usable], won[usable].astype("float64")
    if len(isp) == 0:
        return {"toWin1": None, "level": None, "bettableN": 0}

    to_win_stake = 1.0 / (isp - 1.0)
    to_win_ret = np.where(won == 1, to_win_stake + 1.0, 0.0)
    level_ret = np.where(won == 1, isp, 0.0)

    def summarise(staked, returns):
        staked_sum, ret_sum = float(staked.sum()), float(returns.sum())
        return {
            "staked": round(staked_sum, 2),
            "returns": round(ret_sum, 2),
            "pnl": round(ret_sum - staked_sum, 2),
            "roiPct": round(100.0 * (ret_sum - staked_sum) / staked_sum, 4) if staked_sum else None,
        }

    return {
        "toWin1": summarise(to_win_stake, to_win_ret),
        "level": summarise(np.ones_like(isp), level_ret),
        "bettableN": int(len(isp)),
    }


# ---------------------------------------------------------------------------
# Segments — how "the model is better under some filters" gets DISCOVERED
# rather than guessed
# ---------------------------------------------------------------------------

def ensure_segment_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Columns the segment breakdown needs, regardless of which families ran.

    isHandicap and month are FEATURES only when the "context" and "layoff"
    families are selected, but they are always needed as segment DIMENSIONS —
    the baseline arm has to be sliceable exactly the same way every other arm
    is, or the 2x2 between them cannot be compared. Derived from features.py's
    own definitions rather than re-spelled here, so a change to the handicap
    regex moves both at once.
    """
    if "isHandicap" not in df.columns:
        name = df["raceName"].astype("object").fillna("")
        df["isHandicap"] = name.str.contains(
            F.RACE_NAME_PATTERNS["isHandicap"]).astype("float32")
    if "month" not in df.columns:
        df["month"] = pd.to_datetime(df["raceDate"]).dt.month.astype("float32")
    return df


def _banded(values, bands):
    out = np.full(len(values), None, dtype=object)
    for lo, hi, name in bands:
        out[(values >= lo) & (values < hi)] = name
    return out


def segment_dimensions(oos: pd.DataFrame) -> dict:
    """The nine slices every experiment is evaluated across.

    Banding on the SP rather than on the model is deliberate for spBand: it does
    not condition on the thing under judgement, so the resulting table says what
    the model gets wrong rather than where it is confident.
    """
    isp = oos["isp"].to_numpy(dtype="float64")
    return {
        "raceType": oos["raceType"].astype("object").to_numpy(),
        "fieldSizeBucket": _banded(oos["ran"].to_numpy(dtype="float64"), FIELD_SIZE_BUCKETS),
        "spBand": _banded(isp, SP_BANDS),
        "raceClass": oos["raceClass"].astype("object").to_numpy(),
        "goingGroup": oos["goingGroup"].astype("object").to_numpy(),
        "distanceBand": oos["distanceBand"].astype("object").to_numpy(),
        "month": oos["month"].astype("object").to_numpy(),
        "isHandicap": np.where(oos["isHandicap"].to_numpy() == 1, "handicap", "non-handicap"),
        "year": oos["year"].astype("object").to_numpy(),
    }


def _selection_masks(sub: pd.DataFrame) -> dict:
    """Three ways of choosing which runners in a slice to back.

    A segment's P&L is meaningless without saying which runners were backed, so
    metrics live at segment level and P&L lives under a named selection.
    """
    model, market = sub["p"].to_numpy(), sub["market"].to_numpy()
    top1 = (sub.groupby("raceId", sort=False)["p"].rank(method="first", ascending=False) == 1)
    return {
        "all": np.ones(len(sub), dtype=bool),
        "modelBeatsMarket": np.isfinite(market) & (model > market),
        "modelTop1": top1.to_numpy(),
    }


def build_segments(oos: pd.DataFrame) -> list:
    dims = segment_dimensions(oos)
    labels = oos["label"].to_numpy()
    years = oos["year"].to_numpy()
    out = []

    for dimension, values in dims.items():
        for order, bucket in enumerate(sorted({v for v in values if v is not None and v == v},
                                              key=str)):
            mask = values == bucket
            sub = oos[mask]
            if len(sub) < 100:
                continue
            y = labels[mask]
            model_p, market_p = sub["p"].to_numpy(), sub["market"].to_numpy()

            # Score model and market on the SAME rows. The stored walk-forward
            # doc scores 885,089 against 885,067 and so is not strictly
            # like-for-like (AGENTS.md 2026-08-04 note 3); the harness must not
            # inherit that.
            both = np.isfinite(model_p) & np.isfinite(market_p)
            model_block = wf.score_block(pd.Series(y[both]), pd.Series(model_p[both]))
            market_block = wf.score_block(pd.Series(y[both]), pd.Series(market_p[both]))
            bss = None
            if model_block["brierScore"] is not None and market_block["brierScore"]:
                bss = round(1.0 - model_block["brierScore"] / market_block["brierScore"], 6)

            selections = {}
            years_positive = {"toWin1": 0, "level": 0}
            for sel_name, sel_mask in _selection_masks(sub).items():
                picked = sub[sel_mask]
                pnl = pnl_block(picked["isp"].to_numpy(dtype="float64"),
                                picked["label"].to_numpy())
                selections[sel_name] = {
                    "n": int(len(picked)),
                    "wins": int(picked["label"].sum()),
                    "strikeRate": round(100.0 * float(picked["label"].mean()), 4) if len(picked) else None,
                    "pnl": {"toWin1": pnl["toWin1"], "level": pnl["level"]},
                    "bettableN": pnl["bettableN"],
                }
                if sel_name == "all":
                    for year in np.unique(years[mask]):
                        yr = picked[picked["year"] == year]
                        ypnl = pnl_block(yr["isp"].to_numpy(dtype="float64"),
                                         yr["label"].to_numpy())
                        for conv in ("toWin1", "level"):
                            block = ypnl[conv]
                            if block and block["roiPct"] is not None and block["roiPct"] > 0:
                                years_positive[conv] += 1

            out.append({
                "dimension": dimension,
                "bucket": str(bucket),
                "bucketOrder": order,
                "n": int(len(sub)),
                "scoredN": int(both.sum()),
                "wins": int(y.sum()),
                "strikeRate": round(100.0 * float(y.mean()), 4),
                "model": {**model_block, **murphy(y[both], model_p[both], bins=20),
                          **discrimination_block(y, model_p, sub["raceId"].to_numpy()),
                          "meanProb": round(float(np.nanmean(model_p)), 6)},
                "market": {**market_block,
                           "meanProb": round(float(np.nanmean(market_p)), 6)},
                "bss": bss,
                "selections": selections,
                "yearsPositiveToWin1": years_positive["toWin1"],
                "yearsPositiveLevel": years_positive["level"],
            })
    return out


def segment_to_isp_filters(dimension: str, bucket: str, selection: str):
    """The Filters screen's own URL params for a segment, or None.

    Spellings come from client/src/utils/ispUrlParams.ts's
    ISP_FILTER_PARAM_NAMES. Returning None is the honest answer for a slice the
    screen has no param for — the document records ispFilterable: false so the
    UI can say "discovered, but not expressible as a saved filter" rather than
    anyone inventing a param that does not exist.
    """
    filters = None
    if dimension == "spBand":
        for lo, hi, name in SP_BANDS:
            if name == bucket:
                filters = {"minIsp": str(lo if lo else 1), "maxIsp": str(hi if hi < 1e8 else 1000)}
    elif dimension == "fieldSizeBucket":
        for lo, hi, name in FIELD_SIZE_BUCKETS:
            if name == bucket:
                # FIELD_SIZE_BUCKETS is half-open; maxRunners is inclusive.
                filters = {"minRunners": str(max(lo, 1)), "maxRunners": str(min(hi - 1, 100))}
    elif dimension == "raceType":
        filters = {"raceTypes": bucket}
    elif dimension == "raceClass":
        filters = {"raceClasses": bucket}
    elif dimension == "goingGroup":
        goings = [g for g, group in F.GOING_GROUPS.items() if group == bucket]
        filters = {"goings": ",".join(sorted(goings))} if goings else None
    elif dimension == "year":
        filters = {"minDate": f"{bucket}-01-01", "maxDate": f"{bucket}-12-31"}
    # month, distanceBand and isHandicap have no ISP filter param at all.

    if filters is None:
        return None
    if selection == "modelBeatsMarket":
        filters = {**filters, "onlyModelBeatsSp": "true"}
    elif selection == "modelTop1":
        return None      # not expressible as a filter
    return filters


def find_discoveries(segments: list, fold_count: int = 11) -> list:
    """Segments that pass ACCEPTANCE_RULE, applied mechanically.

    The both-stakings clause is the load-bearing one. AGENTS.md 2026-08-01
    records a grid cell at +2.0% level ROI and -1.5% to-win ROI ON THE SAME
    BETS, and correctly calls contradictory signs on one bet set noise.
    Encoding that here means the screen can never surface it as a discovery.
    """
    min_years = effective_min_years(fold_count)
    found = []
    for seg in segments:
        for sel_name, sel in seg["selections"].items():
            to_win, level = sel["pnl"]["toWin1"], sel["pnl"]["level"]
            if not to_win or not level:
                continue
            if sel["n"] < ACCEPTANCE_RULE["minN"]:
                continue
            if seg["bss"] is None or seg["bss"] < ACCEPTANCE_RULE["minBss"]:
                continue
            roi_to_win, roi_level = to_win["roiPct"], level["roiPct"]
            if roi_to_win is None or roi_level is None:
                continue
            if ACCEPTANCE_RULE["requirePositiveUnderBothStakings"] and not (
                    roi_to_win > 0 and roi_level > 0):
                continue
            if seg["yearsPositiveToWin1"] < min_years:
                continue
            filters = segment_to_isp_filters(seg["dimension"], seg["bucket"], sel_name)
            found.append({
                "dimension": seg["dimension"], "bucket": seg["bucket"],
                "selection": sel_name, "n": sel["n"], "bss": seg["bss"],
                "strikeRate": sel["strikeRate"],
                "roiToWin1": roi_to_win, "roiLevel": roi_level,
                "yearsPositiveToWin1": seg["yearsPositiveToWin1"],
                "ispFilterable": filters is not None,
                "filters": filters,
            })
    return sorted(found, key=lambda d: -(d["roiLevel"] or 0))


# ---------------------------------------------------------------------------
# Saved-filter-set battery
# ---------------------------------------------------------------------------

def post_filter_battery(experiment_id: str, discoveries: list) -> list:
    """POST discovered segments to the Node API so they show up in Saved Results.

    ONLY for segments whose filter map contains no model-dependent param. The
    endpoint routes through IndustrySpService.getSplitStats, which reads
    MODEL_PROB_FIELD ("modelWinProbabilityOos") out of Mongo — the DEPLOYED
    walk-forward's numbers, not this experiment's. A modelBeatsMarket segment
    posted here would therefore measure the OLD model under the new filters and
    file the answer under this experiment's name: confidently wrong, and exactly
    the shape of the 2026-08-04 incident where the Filters screen scored itself
    with a model that had already seen the winners.

    Those segments stay recorded on the document and become postable only once
    ml/walk_forward_score.py has been re-run with the winning feature set.
    """
    if not TRAINING_PIPELINE_API_KEY:
        print("TRAINING_PIPELINE_API_KEY not set — skipping filter battery.", file=sys.stderr)
        return []
    posted = []
    for d in discoveries:
        filters = d.get("filters")
        if not filters:
            continue
        if any(p in filters for p in MODEL_DEPENDENT_FILTER_PARAMS):
            posted.append({"label": f"{d['dimension']}={d['bucket']}", "filters": filters,
                           "skipped": "model-dependent filter — would score the deployed "
                                      "model, not this experiment"})
            continue
        label = f"AI Experiment · {d['dimension']} {d['bucket']} · {experiment_id}"
        try:
            resp = requests.post(
                f"{API_BASE_URL}/api/saved-filter-sets/agent",
                json={"filters": filters, "name": label, "experimentId": experiment_id},
                headers={"x-training-pipeline-api-key": TRAINING_PIPELINE_API_KEY},
                timeout=60,
            )
            resp.raise_for_status()
            posted.append({"label": label, "filters": filters,
                           "savedFilterSetId": resp.json().get("data", {}).get("_id")})
            print(f"  saved: {label}")
        except Exception as e:
            posted.append({"label": label, "filters": filters, "error": str(e)})
            print(f"  filter battery entry '{label}' failed: {e}", file=sys.stderr)
    return posted


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, timeout=10,
                              cwd=Path(__file__).parent).stdout.strip()
    except Exception:
        return ""


def resolve_settings():
    """Fold years, tree cap, learning rate and sampling for the chosen mode.

    Full mode is a claim about comparability, so it is enforced rather than
    trusted: a run may only call itself "full" if it really did score every fold
    with no cap and no sampling. Otherwise a fast run's numbers could be
    compared against a full baseline and the difference read as a feature
    effect when it is a budget effect.
    """
    if MODE not in ("fast", "full"):
        raise SystemExit(f"EXP_MODE must be fast or full, got {MODE!r}")
    if OBJECTIVE not in OBJECTIVES:
        raise SystemExit(f"EXP_OBJECTIVE must be one of {OBJECTIVES}, got {OBJECTIVE!r}")
    if not NAME:
        raise SystemExit("EXP_NAME is required — an unnamed experiment is unfindable later.")

    if MODE == "fast":
        return {
            "foldYears": FOLD_YEARS or FAST_FOLD_YEARS,
            "nEstimatorsCap": N_ESTIMATORS_CAP or FAST_N_ESTIMATORS_CAP,
            "learningRate": FAST_LEARNING_RATE,
            "raceSampleFrac": RACE_SAMPLE_FRAC or FAST_RACE_SAMPLE_FRAC,
        }
    if N_ESTIMATORS_CAP or RACE_SAMPLE_FRAC or FOLD_YEARS:
        raise SystemExit(
            "EXP_MODE=full refuses a tree cap, race sampling or a fold-year subset — "
            "those are what make a fast run fast, and a capped run recorded as 'full' "
            "would be compared against real full runs as if the difference were the "
            "feature set. Drop them, or use EXP_MODE=fast."
        )
    return {"foldYears": [], "nEstimatorsCap": None,
            "learningRate": None, "raceSampleFrac": None}


def load_isp(collection) -> pd.DataFrame:
    if ISP_CACHE_PATH.exists():
        print(f"Loading cached SP frame from {ISP_CACHE_PATH}...")
        return pd.read_pickle(ISP_CACHE_PATH)
    print("Loading industry SP for the market benchmark...")
    isp = load_isp_frame(collection)
    ISP_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    isp.to_pickle(ISP_CACHE_PATH)
    return isp


def run():
    started = time.time()
    settings = resolve_settings()
    experiment_id = datetime.now(timezone.utc).strftime("exp-%Y%m%d-%H%M%S")
    print(f"Experiment {experiment_id}: name={NAME!r} featureSet={FEATURE_SET} "
          f"objective={OBJECTIVE} mode={MODE}")

    client = MongoClient(os.environ["MONGODB_URI"])
    db = client[os.environ["MONGODB_DB_NAME"]]
    collection = db[COLLECTION_NAME]
    print(f"Target: db={db.name} collection={COLLECTION_NAME} "
          f"({collection.estimated_document_count()} race docs) write={WRITE}")

    df = wf.load_frame(collection, cache_path=CACHE_PATH,
                       loader=partial(load_dataframe, extended=True),
                       required_columns=EXTENDED_COLUMNS)
    df["year"] = df["raceDate"].map(wf.year_of)
    print(f"Loaded {len(df)} runner-rows across {df['raceId'].nunique()} races, "
          f"{df['year'].min()}-{df['year'].max()}.")

    if settings["raceSampleFrac"]:
        # By RACE. Sampling runners would leave partial fields, which breaks
        # both the within-race relative features and the softmax likelihood.
        rng = np.random.default_rng(SEED)
        races = df["raceId"].unique()
        keep = set(rng.choice(races, size=int(len(races) * settings["raceSampleFrac"]),
                              replace=False).tolist())
        df = df[df["raceId"].isin(keep)].reset_index(drop=True)
        print(f"Sampled {settings['raceSampleFrac']:.0%} of races -> {len(df)} rows.")

    print(f"Building features ({FEATURE_SET})...")
    t = time.time()
    # ONCE over the whole frame, not per fold at 11x the cost. Safe because and
    # only because every derivation in features.py is strictly-prior-row — the
    # two tests that license this are named in build_features's docstring.
    df, cat_cols, num_cols = F.build_features(df, FEATURE_SET)
    feature_cols = cat_cols + num_cols
    F.assert_leakage_safe(feature_cols)
    # Segment dimensions, not features — see ensure_segment_columns. Added
    # AFTER assert_leakage_safe and deliberately not appended to feature_cols.
    df = ensure_segment_columns(df)
    print(f"  {len(cat_cols)} categorical + {len(num_cols)} numeric = "
          f"{len(feature_cols)} features in {time.time() - t:.0f}s")

    coverage = F.feature_coverage(df, feature_cols)
    dead = [c for c in coverage if c["populatedPct"] < (100 - MAX_NULL_PCT)]
    if dead:
        raise SystemExit(
            f"{len(dead)} feature(s) are more than {MAX_NULL_PCT}% null and would train as "
            f"noise: {', '.join(c['col'] for c in dead)}. Fix the source or drop them — "
            f"three of the deployed model's features have been in exactly this state, "
            f"contributing nothing, since 2026-07-26."
        )

    wf.FOLD_YEARS = settings["foldYears"]
    folds = wf.build_folds(df)
    if not folds:
        raise SystemExit("No scoreable folds — nothing to do.")
    print(f"{len(folds)} fold(s): {', '.join(y for y, _, _ in folds)}")

    fitter = FITTERS[OBJECTIVE]
    oos_rows, prior, fold_summaries = [], pd.DataFrame(columns=["p", "label"]), []
    dropped_train_races = 0

    for year, train_idx, fold_idx in folds:
        fold_started = time.time()
        train_df, fold_df = df.loc[train_idx], df.loc[fold_idx].copy()
        assert train_df["raceDate"].max() < fold_df["raceDate"].min(), \
            f"fold {year} leaks: train max {train_df['raceDate'].max()} >= " \
            f"fold min {fold_df['raceDate'].min()}"

        fit_df, val_df = chronological_split(train_df, holdout_frac=0.10)
        print(f"\n--- fold {year}: fit {len(fit_df)} / val {len(val_df)} "
              f"-> score {len(fold_df)} rows ---")
        raw, info = fitter(fit_df, val_df, fold_df, feature_cols,
                           settings["nEstimatorsCap"], settings["learningRate"])
        dropped_train_races += info.get("droppedTrainRaces", 0)

        fold_df["raw_pred"] = raw
        fold_df = normalize_within_race(fold_df, "raw_pred", "p_norm_pct")
        fold_df["p_norm"] = fold_df["p_norm_pct"] / 100.0

        # Calibration, exactly as walk_forward_score does it: isotonic fitted
        # only on ALREADY-SCORED earlier folds, never on the fold being
        # corrected. Kept even though the conditional-logit arm should need none
        # — "calibration does not help" is itself a confirmatory result, and one
        # code path is easier to trust than two.
        fallback = pd.DataFrame({"p": fold_df["p_norm"], "label": fold_df["label"]}).iloc[:0]
        calibrator, calib_source = wf.fit_calibrator(prior, fallback)
        if calibrator is None:
            fold_df["p_cal"] = fold_df["p_norm"]
        else:
            fold_df["p_cal_raw"] = calibrator.predict(fold_df["p_norm"].to_numpy())
            fold_df = normalize_within_race(fold_df, "p_cal_raw", "p_cal_pct")
            fold_df["p_cal"] = fold_df["p_cal_pct"] / 100.0

        summary = {
            "year": year, "trainRows": int(len(train_df)), "scoredRows": int(len(fold_df)),
            "trainDateMax": str(train_df["raceDate"].max()),
            "foldDateMin": str(fold_df["raceDate"].min()),
            "foldDateMax": str(fold_df["raceDate"].max()),
            "calibrationSource": calib_source,
            "raw": wf.score_block(fold_df["label"], fold_df["p_norm"]),
            "calibrated": wf.score_block(fold_df["label"], fold_df["p_cal"]),
            "seconds": round(time.time() - fold_started, 1),
            **info,
        }
        fold_summaries.append(summary)
        print(f"  raw        {summary['raw']}")
        print(f"  fold took {summary['seconds']}s")

        oos_rows.append(fold_df[["raceId", "runnerId", "raceDate", "year", "label",
                                 "p_norm", "p_cal", "ran", "raceType", "raceClass",
                                 "goingGroup", "distanceBand", "isHandicap", "month"]])
        prior = pd.concat([prior, pd.DataFrame({"p": fold_df["p_norm"],
                                                "label": fold_df["label"]})],
                          ignore_index=True)

    oos = pd.concat(oos_rows, ignore_index=True)
    print(f"\nScored {len(oos)} runner-rows out-of-sample across {len(fold_summaries)} fold(s).")

    isp = load_isp(collection)
    oos = oos.merge(isp, on=["raceId", "runnerId"], how="left")
    oos["market"] = market_probabilities(oos)

    # Intersect BEFORE scoring: model and market must be judged on the same
    # rows or the headline pair is not like-for-like (AGENTS.md 2026-08-04
    # note 3 — the stored walk-forward doc compares 885,089 against 885,067).
    both = oos["p_norm"].notna() & oos["market"].notna()
    scored = oos[both].copy()
    scored["p"] = scored["p_norm"]
    y = scored["label"].to_numpy()

    model_block = {**wf.score_block(scored["label"], scored["p_norm"]),
                   **murphy(y, scored["p_norm"].to_numpy()),
                   **discrimination_block(y, scored["p_norm"].to_numpy(),
                                          scored["raceId"].to_numpy())}
    calibrated_block = {**wf.score_block(scored["label"], scored["p_cal"]),
                        **discrimination_block(y, scored["p_cal"].to_numpy(),
                                               scored["raceId"].to_numpy())}
    market_block = {**wf.score_block(scored["label"], scored["market"]),
                    **murphy(y, scored["market"].to_numpy()),
                    **discrimination_block(y, scored["market"].to_numpy(),
                                           scored["raceId"].to_numpy())}
    bss = round(1.0 - model_block["brierScore"] / market_block["brierScore"], 6)

    print("\n=== OVERALL (out-of-sample, model and market on the same rows) ===")
    for label, block in (("model", model_block), ("calibrated", calibrated_block),
                         ("market", market_block)):
        print(f"  {label:<11} brier={block['brierScore']} auc={block['aucRoc']} "
              f"logloss={block['logLoss']} top1={block.get('top1Rate')} "
              f"resolution={block.get('resolution')}")
    print(f"  Brier Skill Score vs market: {bss:+.6f}")

    if market_block["brierScore"] - model_block["brierScore"] > SUSPICIOUS_BRIER_MARGIN:
        print("\n" + "!" * 72, file=sys.stderr)
        print(f"! This arm beats the market's Brier by "
              f"{market_block['brierScore'] - model_block['brierScore']:.6f}. Treat that as a "
              f"LEAK until proven otherwise:\n! comfortably beating industry SP from public "
              f"form data would be extraordinary, and a leaking\n! model looks spectacular "
              f"right up until it is deployed against unknown results.", file=sys.stderr)
        print("!" * 72 + "\n", file=sys.stderr)

    print("Building segments...")
    segments = build_segments(scored)
    discoveries = find_discoveries(segments, fold_count=len(fold_summaries))
    print(f"  {len(segments)} segments, {len(discoveries)} passing the acceptance rule")
    for d in discoveries:
        print(f"    {d['dimension']}={d['bucket']} [{d['selection']}] n={d['n']} "
              f"bss={d['bss']} roi(level)={d['roiLevel']}% roi(toWin1)={d['roiToWin1']}%")

    sp_table = [s for s in segments if s["dimension"] == "spBand"]

    doc = {
        "experimentId": experiment_id,
        "name": NAME,
        "notes": NOTES,
        "runAt": datetime.now(timezone.utc).isoformat(),
        "gitCommit": git_commit(),
        "mode": MODE,
        "featureSetName": FEATURE_SET,
        "objective": OBJECTIVE,
        "featureCols": feature_cols,
        "newFeatureCols": [c for c in feature_cols
                           if c not in F.CAT_COLS and c not in F.NUM_COLS],
        "featureCoverage": coverage,
        "goingGroupMap": dict(F.GOING_GROUPS),
        "trainingParams": {
            **TRAINING_PARAMS_CAMEL,
            "colsampleBytree": 0.5,
            "nEstimatorsCap": settings["nEstimatorsCap"],
            "learningRateOverride": settings["learningRate"],
            "raceSampleFrac": settings["raceSampleFrac"],
            "seed": SEED,
        },
        "foldYears": [y for y, _, _ in folds],
        "foldCount": len(fold_summaries),
        "scoredRows": int(len(scored)),
        "unscoredRows": int(len(df) - len(scored)),
        "droppedTrainRaces": dropped_train_races,
        "coverageMinDate": str(scored["raceDate"].min()),
        "coverageMaxDate": str(scored["raceDate"].max()),
        "overall": {"model": model_block, "calibrated": calibrated_block,
                    "market": market_block, "bss": bss},
        "folds": fold_summaries,
        "calibrationTableModel": wf.calibration_table(scored["label"], scored["p_norm"]),
        "calibrationTableMarket": wf.calibration_table(scored["label"], scored["market"]),
        "spBandTable": sp_table,
        "segments": segments,
        # The rule AND the integer threshold it resolved to for this run's fold
        # count, so a stored discovery can be re-checked later without anyone
        # having to re-derive which bar it actually cleared.
        "acceptanceRule": {**ACCEPTANCE_RULE,
                           "minYearsPositive": effective_min_years(len(fold_summaries)),
                           "foldYearsScored": len(fold_summaries)},
        "discoveredSegments": discoveries,
        "filterBattery": [],
        "totalSeconds": round(time.time() - started, 1),
        "wroteModelArtifacts": False,
    }

    baseline = None
    if BASELINE_ID:
        baseline = db[EXPERIMENTS_COLLECTION_NAME].find_one({"experimentId": BASELINE_ID})
        if baseline is None:
            print(f"  baseline {BASELINE_ID} not found — recording without a delta.",
                  file=sys.stderr)
        elif baseline.get("mode") != MODE:
            # A fast run's numbers against a full baseline would read a budget
            # difference as a feature effect.
            print(f"  baseline {BASELINE_ID} is mode={baseline.get('mode')} but this run is "
                  f"{MODE} — not comparable, recording without a delta.", file=sys.stderr)
            baseline = None
    if baseline:
        base = baseline.get("overall", {}).get("model", {})
        doc["baselineExperimentId"] = BASELINE_ID
        doc["overall"]["deltaVsBaseline"] = {
            k: (round(model_block[k] - base[k], 6)
                if model_block.get(k) is not None and base.get(k) is not None else None)
            for k in ("brierScore", "aucRoc", "logLoss", "resolution", "top1Rate")
        }
        print(f"  delta vs {BASELINE_ID}: {doc['overall']['deltaVsBaseline']}")

    if RUN_FILTER_BATTERY:
        print("\nPosting discovered segments to the saved-filter-set API...")
        doc["filterBattery"] = post_filter_battery(experiment_id, discoveries)

    if not WRITE:
        print("\nEXP_WRITE=false — computed but not inserted.")
        print(json.dumps({k: v for k, v in doc.items()
                          if k not in ("segments", "featureCoverage", "featureCols",
                                       "goingGroupMap", "spBandTable")},
                         indent=2, default=str))
        client.close()
        return

    db[EXPERIMENTS_COLLECTION_NAME].insert_one(dict(doc))
    print(f"\nSaved experiment {experiment_id} to {EXPERIMENTS_COLLECTION_NAME} "
          f"in {doc['totalSeconds']}s total.")
    client.close()


if __name__ == "__main__":
    try:
        run()
    except SystemExit:
        raise
    except Exception as e:
        print(f"Experiment failed: {e}", file=sys.stderr)
        sys.exit(1)
