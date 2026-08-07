#!/usr/bin/env python3
"""
Trains an XGBoost win-probability model on industry_starting_prices and
writes modelWinProbability back onto every runner subdocument.

Must be re-run after every reseed of industry_starting_prices (same gotcha
as src/commands/precompute-trainer-form.ts's replaceOne wiping derived
fields) — the new fields aren't precomputed at import time, they only exist
once this script has run.

Deliberately excludes isp/ispFraction/isFavourite from the feature set —
the model should produce an independent view, not a recalibration of the
market's own price. Also excludes pos/status (the label itself) and
sortPriority (redundant with num).

Also deliberately excludes the runner's own rpr/ts/beatenDistance (Racing
Post Rating / Topspeed / beaten distance) — those are POST-RACE performance
figures for the very race being predicted, so using them directly would
leak the outcome. horseAvgRPR/horseAvgTS/horseAvgBeatenDistance below are
the leakage-safe versions: trailing averages from the horse's prior runs
only, precomputed in src/commands/precompute-horse-form.ts.

Same leakage rule applies to horseAvgExcuseScore/horseTroubleInRunningRate/
horseTravelledWellRate: these come from tagging the free-text `comment`
field (Racing Post-style in-running commentary) with a keyword lexicon
(src/lib/dao/comment-lexicon.ts) and trailing-averaging over the horse's
last 3 prior runs, same as horseAvgRPR/TS — the current race's own comment
is never used directly, only prior-run history.

Usage:
    MONGODB_URI=... MONGODB_DB_NAME=... ml/venv/bin/python ml/train_and_predict.py

Two more env vars are optional and only affect the filter-battery step at
the end of a run (see FILTER_BATTERY/run_filter_battery below): API_BASE_URL
(defaults to http://localhost:3000) and TRAINING_PIPELINE_API_KEY. If the
API key isn't set, the battery step is skipped (logged, not an error) — so a
local run against a DB with no Node server running still succeeds.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import xgboost as xgb
from pymongo import MongoClient, UpdateOne
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss

from market_benchmark import load_isp_frame, market_probabilities

COLLECTION_NAME = "industry_starting_prices"
EVALUATIONS_COLLECTION_NAME = "model_evaluations"
BATCH_SIZE = 1000
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "win_probability_model.json"
# Training-time category values for each CAT_COLS column, read by
# ml/predict_daily_races.py so a freshly-built prediction dataframe's
# pandas category codes line up with what the saved model's splits were
# trained on — see that script for why this matters.
CATEGORIES_PATH = MODEL_DIR / "win_probability_model_categories.json"
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000")
TRAINING_PIPELINE_API_KEY = os.environ.get("TRAINING_PIPELINE_API_KEY", "")
RUN_LABEL = os.environ.get("RUN_LABEL", "unlabeled")
MODEL_S3_BUCKET = os.environ.get("MODEL_S3_BUCKET", "")

CAT_COLS = ["course", "going", "raceType", "raceClass", "trainer", "jockey", "sex", "hg"]
NUM_COLS = [
    "distanceFurlongs", "ran", "num", "draw",
    "trainerFormRuns", "trainerFormWinRate", "trainerFormROI",
    "jockeyFormRuns", "jockeyFormWinRate", "jockeyFormROI",
    "officialRating", "wgt", "age",
    "daysSinceLastRun", "horseCareerRuns", "horseCareerWinRate",
    "horseAvgRPR", "horseAvgTS", "horseAvgBeatenDistance",
    "horseAvgExcuseScore", "horseTroubleInRunningRate", "horseTravelledWellRate",
]
FEATURE_COLS = CAT_COLS + NUM_COLS

# Plain-language (helped_phrase, hurt_phrase) pair per NUM_COLS entry, used
# by apps/ml-api/handler.py to turn a runner's top SHAP contributions into
# a punter-readable "why this %" list. CAT_COLS are deliberately excluded —
# a SHAP value for an identity column like "trainer" reflects a learned
# per-category pattern that doesn't reduce to one clean "helped/hurt" line
# the way a numeric feature's sign does. Adding a new NUM_COLS entry above
# should always come with a new row here.
FEATURE_EXPLANATIONS = {
    "distanceFurlongs": ("Well-suited by this distance", "Less proven at this distance"),
    "ran": ("Field size suits this horse", "Field size less ideal for this horse"),
    "num": ("Race conditions suit this runner", "Race conditions less ideal for this runner"),
    "draw": ("Favourable draw", "Awkward draw"),
    "trainerFormRuns": ("Trainer active with plenty of recent runners", "Trainer has had fewer runners recently"),
    "trainerFormWinRate": ("In-form trainer", "Trainer out of form recently"),
    "trainerFormROI": ("Trainer's runners have been profitable to back", "Trainer's runners have been unprofitable to back"),
    "jockeyFormRuns": ("Jockey riding regularly at the moment", "Jockey riding less regularly lately"),
    "jockeyFormWinRate": ("In-form jockey", "Jockey out of form recently"),
    "jockeyFormROI": ("Jockey's rides have been profitable to back", "Jockey's rides have been unprofitable to back"),
    "officialRating": ("High official rating", "Lower official rating"),
    "wgt": ("Favourable weight carried", "Carrying more weight than ideal"),
    "age": ("Prime racing age", "Outside the ideal age range"),
    "daysSinceLastRun": ("Well-spaced racing schedule", "Time since last run less ideal"),
    "horseCareerRuns": ("Experienced horse", "Lightly-raced horse"),
    "horseCareerWinRate": ("Strong career win rate", "Modest career win rate"),
    "horseAvgRPR": ("Strong recent form", "Below-average recent form"),
    "horseAvgTS": ("Strong recent speed figures", "Weaker recent speed figures"),
    "horseAvgBeatenDistance": ("Usually finishes close up", "Often beaten by some distance"),
    "horseAvgExcuseScore": ("Few excuses in past runs", "Has had trouble in past runs"),
    "horseTroubleInRunningRate": ("Rarely hits trouble in running", "Often hits trouble in running"),
    "horseTravelledWellRate": ("Travels well in races", "Doesn't always travel well"),
}

# Single source of truth for make_model()'s XGBoost hyperparams (excluding
# early_stopping_rounds, which only applies to the early-stopping fit — see
# make_model() below) — persisted verbatim into each model_evaluations doc
# (camelCase, via TRAINING_PARAMS_CAMEL) so the dashboard can show exactly
# what a given model version was trained with, not just how it performed.
TRAINING_PARAMS = dict(
    n_estimators=2000,
    learning_rate=0.03,
    max_depth=5,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=8,
    random_state=42,
)
EARLY_STOPPING_ROUNDS = 50
# How much worse than the champion a challenger may be and still ship. Small
# and one-sided on purpose — see promotion_decision().
PROMOTION_TOLERANCE = 0.001
TRAINING_PARAMS_CAMEL = {
    "nEstimators": TRAINING_PARAMS["n_estimators"],
    "learningRate": TRAINING_PARAMS["learning_rate"],
    "maxDepth": TRAINING_PARAMS["max_depth"],
    "subsample": TRAINING_PARAMS["subsample"],
    "colsampleBytree": TRAINING_PARAMS["colsample_bytree"],
    "minChildWeight": TRAINING_PARAMS["min_child_weight"],
    "randomState": TRAINING_PARAMS["random_state"],
    "earlyStoppingRounds": EARLY_STOPPING_ROUNDS,
}

# Curated, hand-picked filter combinations exercised once per training run —
# deliberately NOT exhaustive/combinatorial and NOT a replay of any user's
# saved filter sets, just a handful of meaningfully different slices of the
# live Filters screen's own filter surface (client/src/utils/ispUrlParams.ts's
# ISP_FILTER_PARAM_NAMES), run against whatever data exists in
# industry_starting_prices at the time of this training run. See
# run_filter_battery() below for how each entry gets persisted.
FILTER_BATTERY = [
    {"label": "All races", "filters": {}},
    {"label": "Model beats SP", "filters": {"onlyModelBeatsSp": "true"}},
    {"label": "High model confidence", "filters": {"minModelWinProbability": "70"}},
    {"label": "Favourites (low ISP)", "filters": {"maxIsp": "3"}},
    {"label": "Small fields", "filters": {"maxRunners": "8"}},
    {"label": "Large fields", "filters": {"minRunners": "16"}},
]

_DISTANCE_RE = re.compile(r"^(?:(\d+)m)?(?:(\d*)(½)?f)?$")


def parse_distance_furlongs(distance):
    """'5f' -> 5.0, '1m3f' -> 11.0, '2m4½f' -> 20.5, '1m' -> 8.0, '1m½f' -> 8.5, None -> NaN."""
    if not distance:
        return np.nan
    m = _DISTANCE_RE.match(distance.strip())
    if not m:
        return np.nan
    miles, furlongs, half = m.groups()
    if not miles and not furlongs and not half:
        return np.nan
    total = (int(miles) * 8 if miles else 0) + (int(furlongs) if furlongs else 0) + (0.5 if half else 0)
    return float(total)


def normalize_within_race(df: pd.DataFrame, raw_col: str, out_col: str) -> pd.DataFrame:
    """Rescales each race's raw per-runner predictions to sum to 100 (an
    even split if a race's raw predictions are degenerate/sum to 0), so the
    stored number reads as "this horse's share of the win probability in
    this specific field" rather than an uncalibrated independent score."""
    def _norm(group: pd.Series) -> pd.Series:
        total = group.sum()
        if total > 0:
            return group / total * 100
        return pd.Series(100.0 / len(group), index=group.index)

    df[out_col] = df.groupby("raceId")[raw_col].transform(_norm)
    return df


def load_dataframe(collection, extended: bool = False) -> pd.DataFrame:
    """Every runner-row in the collection, one row per runner subdocument.

    `extended=True` widens both the projection and the per-row dict with the
    raw material ml/features.py needs to derive within-race and trailing
    features (see EXTENDED_COLUMNS). It is strictly additive: with the default
    `extended=False` this function returns exactly the frame it always has, so
    train_and_predict.run() and walk_forward_score.run() are untouched by it.

    The extra post-race columns land under deliberately ugly `postrace*` names
    rather than their source names. `rpr`/`ts`/`beatenDistance`/`pos`/`status`
    are performance figures for the very race being predicted — using any of
    them as a feature would leak the outcome (this file's header says so at
    length). Naming them `postraceRpr` etc. means an accidental appearance in
    a printed feature list is *visible*, and lets features.assert_leakage_safe
    reject a whole class of mistake with one prefix check rather than an
    enumeration that someone has to remember to extend.

    `isp` is deliberately NOT loaded here even under extended — it stays in
    market_benchmark.load_isp_frame's own narrow frame, merged in only at
    scoring time, which is the guarantee this file's header makes.
    """
    rows = []
    projection = {
        "raceId": 1, "raceDate": 1, "course": 1, "raceType": 1, "raceClass": 1,
        "going": 1, "distance": 1, "ran": 1, "runners": 1,
    }
    if extended:
        projection.update({"raceName": 1, "raceTime": 1, "meetingId": 1})
    cursor = collection.find({}, projection)
    for race in cursor:
        distance_furlongs = parse_distance_furlongs(race.get("distance"))
        for runner in race.get("runners", []):
            trainer_staked = runner.get("trainerFormStaked")
            trainer_returns = runner.get("trainerFormReturns")
            trainer_roi = np.nan
            if trainer_staked:
                trainer_roi = (trainer_returns or 0) / trainer_staked
            jockey_staked = runner.get("jockeyFormStaked")
            jockey_returns = runner.get("jockeyFormReturns")
            jockey_roi = np.nan
            if jockey_staked:
                jockey_roi = (jockey_returns or 0) / jockey_staked
            rows.append({
                "raceId": race["raceId"],
                "raceDate": race["raceDate"],
                "runnerId": runner["id"],
                "course": race.get("course"),
                "raceType": race.get("raceType"),
                "raceClass": race.get("raceClass"),
                "going": race.get("going"),
                "trainer": runner.get("trainer"),
                "jockey": runner.get("jockey"),
                "sex": runner.get("sex"),
                "hg": runner.get("hg"),
                "distanceFurlongs": distance_furlongs,
                "ran": race.get("ran"),
                "num": runner.get("num"),
                "draw": runner.get("draw"),
                "trainerFormRuns": runner.get("trainerFormRuns"),
                "trainerFormWinRate": runner.get("trainerFormWinRate"),
                "trainerFormROI": trainer_roi,
                "jockeyFormRuns": runner.get("jockeyFormRuns"),
                "jockeyFormWinRate": runner.get("jockeyFormWinRate"),
                "jockeyFormROI": jockey_roi,
                "officialRating": runner.get("officialRating"),
                "wgt": runner.get("wgt"),
                "age": runner.get("age"),
                "daysSinceLastRun": runner.get("daysSinceLastRun"),
                "horseCareerRuns": runner.get("horseCareerRuns"),
                "horseCareerWinRate": runner.get("horseCareerWinRate"),
                "horseAvgRPR": runner.get("horseAvgRPR"),
                "horseAvgTS": runner.get("horseAvgTS"),
                "horseAvgBeatenDistance": runner.get("horseAvgBeatenDistance"),
                "horseAvgExcuseScore": runner.get("horseAvgExcuseScore"),
                "horseTroubleInRunningRate": runner.get("horseTroubleInRunningRate"),
                "horseTravelledWellRate": runner.get("horseTravelledWellRate"),
                "label": 1 if runner.get("status") == "WINNER" else 0,
            })
            if extended:
                rows[-1].update({
                    # The horse's identity. runners[].id is a SHA1 of
                    # raceId+horse, so it is DIFFERENT for the same horse in
                    # every race and cannot track a career — `name` is the only
                    # key available, exactly as precompute-horse-form.ts's
                    # header explains and for the same reason.
                    "horseName": runner.get("name"),
                    "raceName": race.get("raceName"),
                    "raceTime": race.get("raceTime"),
                    "meetingId": race.get("meetingId"),
                    "pattern": runner.get("pattern"),
                    "postraceRpr": runner.get("rpr"),
                    "postraceTs": runner.get("ts"),
                    "postraceBeatenDistance": runner.get("beatenDistance"),
                    "postracePos": runner.get("pos"),
                    "postraceStatus": runner.get("status"),
                })
    df = pd.DataFrame(rows)
    for c in CAT_COLS:
        df[c] = df[c].astype("category")
    for c in NUM_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    if extended:
        for c in ("postraceRpr", "postraceTs", "postraceBeatenDistance"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


# The columns load_dataframe(extended=True) adds on top of the default frame.
# ml/experiment.py validates a cached pickle against this set and rebuilds on
# mismatch: a cache written before a column was added would otherwise produce
# a 20-minute run whose new features are silently all-NaN, which is exactly the
# failure mode that left horseAvgExcuseScore/horseTroubleInRunningRate/
# horseTravelledWellRate at 100% NaN in the live feature set for weeks.
EXTENDED_COLUMNS = (
    "horseName", "raceName", "raceTime", "meetingId", "pattern",
    "postraceRpr", "postraceTs", "postraceBeatenDistance",
    "postracePos", "postraceStatus",
)


def chronological_split(df: pd.DataFrame, holdout_frac: float):
    dates = sorted(df["raceDate"].unique())
    cutoff = dates[int(len(dates) * (1 - holdout_frac))]
    return df[df["raceDate"] < cutoff].copy(), df[df["raceDate"] >= cutoff].copy()


def build_agent_result_name(label: str, model_version_id: str) -> str:
    return f"AI Training · {label} · {model_version_id}"


def upload_model_to_s3(model_version_id: str):
    """Uploads the just-saved model + categories sidecar to S3 under
    models/win-probability/<model_version_id>/ — the durable source of
    truth apps/ml-api/build.sh pulls from to bake a model into the
    prediction Lambda's container image (see that script). ml/models/ is
    gitignored and only ever exists on whichever machine last trained, so
    without this step a trained model is unrecoverable once that machine's
    disk is gone. Best-effort/optional, same guard style as
    run_filter_battery() above — a bare local training run without
    MODEL_S3_BUCKET set (or without AWS creds) still succeeds locally."""
    if not MODEL_S3_BUCKET:
        print("MODEL_S3_BUCKET not set — skipping S3 model upload.", file=sys.stderr)
        return
    import subprocess

    prefix = f"models/win-probability/{model_version_id}"
    for path in (MODEL_PATH, CATEGORIES_PATH):
        dest = f"s3://{MODEL_S3_BUCKET}/{prefix}/{path.name}"
        try:
            subprocess.run(["aws", "s3", "cp", str(path), dest], check=True)
        except Exception as e:
            print(f"  S3 upload of {path.name} failed: {e}", file=sys.stderr)
            return
    print(f"Uploaded model to s3://{MODEL_S3_BUCKET}/{prefix}/")


def run_filter_battery(model_version_id: str):
    """POSTs one saved-filter-set result per FILTER_BATTERY entry to the
    Node API (POST /api/saved-filter-sets/agent), tagged createdBy="agent"
    and this model_version_id, so SavedResultsListScreen shows a record of
    how the freshly retrained model performed under each filter slice.
    Best-effort: an individual entry failing (or the API key being unset for
    a local run with no Node server) is logged and skipped, never fatal —
    the model has already been trained/saved/written back by this point."""
    if not TRAINING_PIPELINE_API_KEY:
        print("TRAINING_PIPELINE_API_KEY not set — skipping filter battery.", file=sys.stderr)
        return
    for entry in FILTER_BATTERY:
        name = build_agent_result_name(entry["label"], model_version_id)
        try:
            resp = requests.post(
                f"{API_BASE_URL}/api/saved-filter-sets/agent",
                json={"filters": entry["filters"], "name": name, "modelVersionId": model_version_id},
                headers={"x-training-pipeline-api-key": TRAINING_PIPELINE_API_KEY},
                timeout=30,
            )
            resp.raise_for_status()
            print(f"  saved agent result: {name}")
        except Exception as e:
            print(f"  filter battery entry '{entry['label']}' failed: {e}", file=sys.stderr)


def make_model(early_stopping: bool) -> xgb.XGBClassifier:
    kwargs = dict(
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        enable_categorical=True,
        **TRAINING_PARAMS,
    )
    if early_stopping:
        kwargs["early_stopping_rounds"] = EARLY_STOPPING_ROUNDS
    return xgb.XGBClassifier(**kwargs)


def save_evaluation(evaluations_collection, doc: dict):
    doc = {"runAt": datetime.now(timezone.utc).isoformat(), **doc}
    result = evaluations_collection.insert_one(doc)
    print(f"\nSaved evaluation to {EVALUATIONS_COLLECTION_NAME} (modelVersionId={doc.get('modelVersionId')})")
    return result.inserted_id


def current_champion(evaluations_collection):
    """The best previously-promoted model, by held-out log loss.

    Legacy docs predate the `promoted` flag entirely; they were all promoted
    (nothing could stop them), so they count. Walk-forward docs never do —
    they describe a scoring pass, not a deployable model, and their metrics
    are not comparable to a single held-out tail.

    `modelVersionId: {$exists: true}` is what makes this an ALLOW-list, and
    that distinction is load-bearing. Excluding only `walk_forward` made every
    *future* document type in model_evaluations eligible the moment it carried
    a top-level numeric logLoss and no `promoted` field. Not hypothetical: an
    out-of-sample scoring pass measures log loss around 0.30 against the best
    real training run's 0.32091, so such a doc would win, become permanent
    champion, and then silently reject every genuine retrain from then on —
    against a "champion" that has no model artifact anywhere.

    Only run() writes `modelVersionId`. walk_forward_score.py writes
    `oosVersionId` instead, and ml/experiment.py writes to a different
    collection entirely and neither field. That disjointness is the same one
    ModelVersionDAO.getWalkForwardCoverage() already relies on.
    """
    champion = evaluations_collection.find_one(
        {"modelVersionId": {"$exists": True},
         "logLoss": {"$ne": None},
         "evaluationType": {"$ne": "walk_forward"},
         "$or": [{"promoted": True}, {"promoted": {"$exists": False}}]},
        sort=[("logLoss", 1)],
    )
    return champion


def promotion_decision(challenger_log_loss: float, champion) -> tuple:
    """Should this run's model replace the deployed one?

    Until now nothing ever read model_evaluations back, so a worse retrain
    silently overwrote a better one — irrecoverably, since ml/models/ is
    gitignored and only the S3 copy survives. This is the gate that stops
    that.

    The tolerance is deliberately one-sided and small: a challenger that is
    genuinely equal (noise-level differences between runs of the same config)
    still promotes, so an ordinary retrain on newer data isn't blocked, while
    a real regression is.
    """
    if champion is None:
        return True, "no previous champion — promoting by default"
    champion_ll = champion.get("logLoss")
    if champion_ll is None:
        return True, "champion has no log loss recorded — promoting by default"
    if challenger_log_loss <= champion_ll + PROMOTION_TOLERANCE:
        return True, (f"log loss {challenger_log_loss:.6f} <= champion "
                      f"{champion_ll:.6f} + {PROMOTION_TOLERANCE}")
    return False, (f"log loss {challenger_log_loss:.6f} is worse than champion "
                   f"{champion_ll:.6f} ({champion.get('modelVersionId')}) by more than "
                   f"{PROMOTION_TOLERANCE} — keeping the champion")


def benchmark_metrics(labels: pd.Series, probs: pd.Series) -> dict:
    """AUC/log loss/Brier over the rows that actually have a probability.

    Used for the two comparison lines added alongside the headline metrics
    below. NaNs (a runner with no usable SP) are dropped rather than scored as
    zero, and a block with no winner reports None rather than raising —
    neither should ever take down a training run that has already succeeded.
    """
    mask = probs.notna().to_numpy()
    y = np.asarray(labels)[mask]
    p = np.clip(np.asarray(probs)[mask], 1e-9, 1 - 1e-9)
    if len(y) == 0 or len(np.unique(y)) < 2:
        return {"n": int(len(y)), "aucRoc": None, "logLoss": None, "brierScore": None}
    return {
        "n": int(len(y)),
        "aucRoc": round(float(roc_auc_score(y, p)), 6),
        "logLoss": round(float(log_loss(y, p, labels=[0, 1])), 6),
        "brierScore": round(float(brier_score_loss(y, p)), 6),
    }


def evaluate(model: xgb.XGBClassifier, test_df: pd.DataFrame, evaluations_collection, run_meta: dict,
             market_probs: pd.Series | None = None):
    p = model.predict_proba(test_df[FEATURE_COLS])[:, 1]
    auc = roc_auc_score(test_df["label"], p)
    ll = log_loss(test_df["label"], p)
    brier = brier_score_loss(test_df["label"], p)
    print(f"AUC-ROC:  {auc:.4f}")
    print(f"LogLoss:  {ll:.4f}")
    print(f"Brier:    {brier:.4f}")

    calib = test_df.assign(p=p)
    calib["decile"] = pd.qcut(calib["p"], 10, duplicates="drop")
    table = calib.groupby("decile", observed=True).agg(
        mean_predicted=("p", "mean"),
        actual_win_rate=("label", "mean"),
        n=("label", "size"),
    )
    print("\nCalibration (predicted vs actual win rate by decile):")
    print(table.to_string())

    calibration_table = [
        {
            "meanPredicted": round(float(row["mean_predicted"]), 6),
            "actualWinRate": round(float(row["actual_win_rate"]), 6),
            "n": int(row["n"]),
        }
        for _, row in table.reset_index(drop=True).iterrows()
    ]
    # Two comparison lines, both additive — the three headline keys above keep
    # their exact existing meaning so model_evaluations stays readable by
    # ModelVersionDAO and the performance dashboard.
    #
    # `normalized` matters because the headline metrics score the model's RAW
    # output, which doesn't sum to 1 across a race, while the market's does
    # (see market_benchmark.market_probabilities) and while the stored
    # modelWinProbability is normalised too. Scoring raw against de-overrounded
    # market would be comparing two different objects, so the fair comparison
    # is normalised-vs-market and that is what beatsMarket uses.
    extra: dict = {}
    normalized = normalize_within_race(test_df.assign(p=p), "p", "p_norm")["p_norm"] / 100.0
    extra["normalizedMetrics"] = benchmark_metrics(test_df["label"], normalized)
    print(f"\nNormalised (per-race, comparable to the market): {extra['normalizedMetrics']}")

    if market_probs is not None:
        market = benchmark_metrics(test_df["label"], market_probs)
        extra["marketMetrics"] = market
        print(f"Market (SP, de-overrounded):                   {market}")
        model_ll = extra["normalizedMetrics"]["logLoss"]
        if model_ll is not None and market["logLoss"] is not None:
            # The question the pipeline could not previously answer about
            # itself. SP is the referee here and nothing more — never a
            # feature, never a target (see this file's header).
            extra["beatsMarket"] = bool(model_ll < market["logLoss"])
            verdict = "BEATS" if extra["beatsMarket"] else "LOSES TO"
            print(f"=> the model {verdict} the market on log loss "
                  f"({model_ll} vs {market['logLoss']})")

    doc_id = save_evaluation(evaluations_collection, {
        **run_meta,
        "aucRoc": round(float(auc), 6),
        "logLoss": round(float(ll), 6),
        "brierScore": round(float(brier), 6),
        "calibrationTable": calibration_table,
        **extra,
    })
    return doc_id, round(float(ll), 6)


def run():
    # Stable id for this training run — timestamp-based so it's guaranteed
    # unique across runs (even same-day reruns) and sorts chronologically,
    # unlike RUN_LABEL, which stays free-text/optional and can repeat.
    model_version_id = datetime.now(timezone.utc).strftime("xgb-%Y%m%d-%H%M%S")
    print(f"Model version id: {model_version_id}")

    uri = os.environ["MONGODB_URI"]
    db_name = os.environ["MONGODB_DB_NAME"]
    print(f"Connecting to {db_name}...")
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[COLLECTION_NAME]
    evaluations_collection = db[EVALUATIONS_COLLECTION_NAME]

    print("Loading data...")
    df = load_dataframe(collection)
    print(f"Loaded {len(df)} runner-rows across {df['raceId'].nunique()} races.")

    train_df, test_df = chronological_split(df, holdout_frac=0.15)
    print(f"Train: {len(train_df)} rows up to {train_df['raceDate'].max()}")
    print(f"Test:  {len(test_df)} rows from {test_df['raceDate'].min()}")
    assert train_df["raceDate"].max() < test_df["raceDate"].min(), "train/test dates overlap"

    # Further chronological carve-out of the training portion for early stopping.
    fit_df, val_df = chronological_split(train_df, holdout_frac=0.10)
    print(f"\nTraining with early stopping ({len(fit_df)} fit / {len(val_df)} val rows)...")
    es_model = make_model(early_stopping=True)
    es_model.fit(
        fit_df[FEATURE_COLS], fit_df["label"],
        eval_set=[(val_df[FEATURE_COLS], val_df["label"])],
        verbose=False,
    )
    best_n = es_model.best_iteration
    print(f"Early stopping selected n_estimators={best_n}")

    print("\n--- Held-out chronological test evaluation ---")
    run_meta = {
        "modelVersionId": model_version_id,
        "runLabel": RUN_LABEL,
        "trainingParams": TRAINING_PARAMS_CAMEL,
        "featureCols": FEATURE_COLS,
        "trainRows": len(fit_df) + len(val_df),
        "testRows": len(test_df),
        "trainDateMax": str(train_df["raceDate"].max()),
        "testDateMin": str(test_df["raceDate"].min()),
        "bestIteration": int(best_n),
    }
    # The market's own view of the same test rows, for the benchmark line in
    # evaluate(). Loaded through market_benchmark's own narrow loader and
    # merged in only here, after the split — so `isp` never shares a frame
    # with FEATURE_COLS and cannot become a feature by accident, which is the
    # guarantee this file's header makes.
    print("\nLoading industry SP for the market benchmark...")
    isp_frame = load_isp_frame(collection)
    test_with_isp = test_df.merge(isp_frame, on=["raceId", "runnerId"], how="left")
    market_probs = market_probabilities(test_with_isp).set_axis(test_df.index)
    doc_id, challenger_ll = evaluate(es_model, test_df, evaluations_collection, run_meta,
                                     market_probs=market_probs)

    # The gate. Before this existed, model_evaluations was written every run
    # and never read back, so a worse retrain silently replaced a better one
    # with no way to recover it (ml/models/ is gitignored; only the S3 copy
    # survives, under the *new* version id). A rejected run still leaves its
    # evaluation doc behind — a failed experiment should be a record, not a
    # gap — but touches nothing else.
    champion = current_champion(evaluations_collection)
    promoted, reason = promotion_decision(challenger_ll, champion)
    evaluations_collection.update_one(
        {"_id": doc_id},
        {"$set": {"promoted": promoted,
                  "promotionReason": reason,
                  "comparedAgainst": champion.get("modelVersionId") if champion else None}},
    )
    print(f"\nPromotion: {'PROMOTED' if promoted else 'REJECTED'} — {reason}")
    if not promoted:
        print("Leaving the deployed model, its S3 copy and every stored "
              "modelWinProbability exactly as they were.")
        client.close()
        return

    print(f"\nRefitting on all {len(df)} rows (train+test) at n_estimators={best_n} for the deployed model...")
    final_model = make_model(early_stopping=False)
    final_model.set_params(n_estimators=max(best_n, 1))
    final_model.fit(df[FEATURE_COLS], df["label"])

    MODEL_DIR.mkdir(exist_ok=True)
    final_model.save_model(str(MODEL_PATH))
    print(f"Saved model to {MODEL_PATH}")

    categories = {c: df[c].cat.categories.tolist() for c in CAT_COLS}
    with open(CATEGORIES_PATH, "w") as f:
        json.dump(categories, f)
    print(f"Saved category lists to {CATEGORIES_PATH}")

    upload_model_to_s3(model_version_id)

    print("\nGenerating final predictions and normalizing within each race...")
    raw = final_model.predict_proba(df[FEATURE_COLS])[:, 1]
    df["raw_pred"] = raw
    df = normalize_within_race(df, "raw_pred", "modelWinProbability")
    df["modelWinProbability"] = df["modelWinProbability"].round(2)

    print(f"Writing modelWinProbability back onto {df['raceId'].nunique()} races...")
    by_race = df.groupby("raceId")
    ops = []
    written = 0
    for race_id, group in by_race:
        array_filters = []
        set_fields = {}
        for i, (_, row) in enumerate(group.iterrows()):
            set_fields[f"runners.$[r{i}].modelWinProbability"] = float(row["modelWinProbability"])
            set_fields[f"runners.$[r{i}].modelVersionId"] = model_version_id
            array_filters.append({f"r{i}.id": int(row["runnerId"])})
        ops.append(UpdateOne(
            {"_id": int(race_id)},
            {"$set": set_fields},
            array_filters=array_filters,
        ))
        if len(ops) >= BATCH_SIZE:
            collection.bulk_write(ops, ordered=False)
            written += len(ops)
            print(f"  updated {written} races...")
            ops = []
    if ops:
        collection.bulk_write(ops, ordered=False)
        written += len(ops)
    print(f"Done. Updated {written} races.")

    print("\nRunning filter battery against the newly retrained model...")
    run_filter_battery(model_version_id)

    client.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"Training/prediction failed: {e}", file=sys.stderr)
        sys.exit(1)
