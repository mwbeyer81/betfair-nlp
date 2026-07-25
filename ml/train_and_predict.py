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
"""

import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from pymongo import MongoClient, UpdateOne
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss

COLLECTION_NAME = "industry_starting_prices"
EVALUATIONS_COLLECTION_NAME = "model_evaluations"
BATCH_SIZE = 1000
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "win_probability_model.json"
RUN_LABEL = os.environ.get("RUN_LABEL", "unlabeled")

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


def load_dataframe(collection) -> pd.DataFrame:
    rows = []
    cursor = collection.find(
        {},
        {
            "raceId": 1, "raceDate": 1, "course": 1, "raceType": 1, "raceClass": 1,
            "going": 1, "distance": 1, "ran": 1, "runners": 1,
        },
    )
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
    df = pd.DataFrame(rows)
    for c in CAT_COLS:
        df[c] = df[c].astype("category")
    for c in NUM_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def chronological_split(df: pd.DataFrame, holdout_frac: float):
    dates = sorted(df["raceDate"].unique())
    cutoff = dates[int(len(dates) * (1 - holdout_frac))]
    return df[df["raceDate"] < cutoff].copy(), df[df["raceDate"] >= cutoff].copy()


def make_model(early_stopping: bool) -> xgb.XGBClassifier:
    kwargs = dict(
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        enable_categorical=True,
        n_estimators=2000,
        learning_rate=0.03,
        max_depth=5,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=8,
        random_state=42,
    )
    if early_stopping:
        kwargs["early_stopping_rounds"] = 50
    return xgb.XGBClassifier(**kwargs)


def evaluate(model: xgb.XGBClassifier, test_df: pd.DataFrame, evaluations_collection, run_meta: dict):
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
    save_evaluation(evaluations_collection, {
        **run_meta,
        "aucRoc": round(float(auc), 6),
        "logLoss": round(float(ll), 6),
        "brierScore": round(float(brier), 6),
        "calibrationTable": calibration_table,
    })


def save_evaluation(evaluations_collection, doc: dict):
    doc = {"runAt": datetime.now(timezone.utc).isoformat(), **doc}
    evaluations_collection.insert_one(doc)
    print(f"\nSaved evaluation to {EVALUATIONS_COLLECTION_NAME} (runLabel={doc.get('runLabel')})")


def run():
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
        "runLabel": RUN_LABEL,
        "featureCols": FEATURE_COLS,
        "trainRows": len(fit_df) + len(val_df),
        "testRows": len(test_df),
        "trainDateMax": str(train_df["raceDate"].max()),
        "testDateMin": str(test_df["raceDate"].min()),
        "bestIteration": int(best_n),
    }
    evaluate(es_model, test_df, evaluations_collection, run_meta)

    print(f"\nRefitting on all {len(df)} rows (train+test) at n_estimators={best_n} for the deployed model...")
    final_model = make_model(early_stopping=False)
    final_model.set_params(n_estimators=max(best_n, 1))
    final_model.fit(df[FEATURE_COLS], df["label"])

    MODEL_DIR.mkdir(exist_ok=True)
    final_model.save_model(str(MODEL_PATH))
    print(f"Saved model to {MODEL_PATH}")

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

    client.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"Training/prediction failed: {e}", file=sys.stderr)
        sys.exit(1)
