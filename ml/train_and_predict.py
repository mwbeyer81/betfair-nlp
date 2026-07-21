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

Usage:
    MONGODB_URI=... MONGODB_DB_NAME=... ml/venv/bin/python ml/train_and_predict.py
"""

import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from pymongo import MongoClient, UpdateOne
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss

COLLECTION_NAME = "industry_starting_prices"
BATCH_SIZE = 1000
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "win_probability_model.json"

CAT_COLS = ["course", "going", "raceType", "raceClass", "trainer", "jockey"]
NUM_COLS = ["distanceFurlongs", "ran", "num", "draw", "trainerFormRuns", "trainerFormWinRate", "trainerFormROI"]
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
            roi = np.nan
            if trainer_staked:
                roi = (trainer_returns or 0) / trainer_staked
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
                "distanceFurlongs": distance_furlongs,
                "ran": race.get("ran"),
                "num": runner.get("num"),
                "draw": runner.get("draw"),
                "trainerFormRuns": runner.get("trainerFormRuns"),
                "trainerFormWinRate": runner.get("trainerFormWinRate"),
                "trainerFormROI": roi,
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


def evaluate(model: xgb.XGBClassifier, test_df: pd.DataFrame):
    p = model.predict_proba(test_df[FEATURE_COLS])[:, 1]
    print(f"AUC-ROC:  {roc_auc_score(test_df['label'], p):.4f}")
    print(f"LogLoss:  {log_loss(test_df['label'], p):.4f}")
    print(f"Brier:    {brier_score_loss(test_df['label'], p):.4f}")

    calib = test_df.assign(p=p)
    calib["decile"] = pd.qcut(calib["p"], 10, duplicates="drop")
    table = calib.groupby("decile", observed=True).agg(
        mean_predicted=("p", "mean"),
        actual_win_rate=("label", "mean"),
        n=("label", "size"),
    )
    print("\nCalibration (predicted vs actual win rate by decile):")
    print(table.to_string())


def run():
    uri = os.environ["MONGODB_URI"]
    db_name = os.environ["MONGODB_DB_NAME"]
    print(f"Connecting to {db_name}...")
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[COLLECTION_NAME]

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
    evaluate(es_model, test_df)

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
