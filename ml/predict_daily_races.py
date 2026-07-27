#!/usr/bin/env python3
"""
Scores today's daily_racecards runners with the ALREADY-TRAINED win-
probability model — no retraining. Requires:
  1. daily_racecards populated for the target date (fetch-daily-races.ts /
     seed-daily-races-fixture.ts)
  2. trailing-form fields already computed onto those runners
     (compute-daily-race-features.ts) — this script does NOT compute form
     itself, only predicts from whatever's already on the document.
  3. A trained model + its category sidecar already saved by
     train_and_predict.py (ml/models/win_probability_model.json +
     win_probability_model_categories.json).

Never touches industry_starting_prices — this script doesn't even open
that collection. All inputs come from daily_racecards; feature computation
against real historical data already happened in step 2, in TypeScript.

Categorical-dtype correctness: a freshly-built prediction dataframe's
pandas `category` codes are NOT the same as the codes XGBoost's saved
splits were trained on unless built from the exact same category value
list. train_and_predict.py now persists that list
(win_probability_model_categories.json) — every CAT_COLS column here is
built via `pd.Categorical(values, categories=trained_categories[c])`, so
any value unseen in training becomes NaN, handled by XGBoost's own
learned per-split missing-value direction, rather than silently
colliding with an unrelated category code.

Usage:
    MONGODB_URI=... MONGODB_DB_NAME=... [DAILY_RACE_DATE=YYYY-MM-DD] \
        ml/venv/bin/python ml/predict_daily_races.py
DAILY_RACE_DATE defaults to today's UTC date.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from pymongo import MongoClient, UpdateOne

from train_and_predict import (
    CAT_COLS,
    NUM_COLS,
    FEATURE_COLS,
    MODEL_PATH,
    CATEGORIES_PATH,
    EVALUATIONS_COLLECTION_NAME,
    normalize_within_race,
)

COLLECTION_NAME = "daily_racecards"
DAILY_RACE_DATE = os.environ.get("DAILY_RACE_DATE") or datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_daily_dataframe(collection, date: str) -> pd.DataFrame:
    rows = []
    cursor = collection.find({"date": date})
    for race in cursor:
        distance_furlongs = pd.to_numeric(race.get("distanceF"), errors="coerce")
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
                "runnerId": runner["runnerId"],
                "course": race.get("course"),
                "raceType": race.get("type"),
                "raceClass": race.get("raceClass"),
                "going": race.get("going"),
                "trainer": runner.get("trainer"),
                "jockey": runner.get("jockey"),
                "sex": runner.get("sex"),
                "hg": runner.get("headgear"),
                "distanceFurlongs": distance_furlongs,
                "ran": race.get("fieldSize"),
                "num": runner.get("number"),
                "draw": runner.get("draw"),
                "trainerFormRuns": runner.get("trainerFormRuns"),
                "trainerFormWinRate": runner.get("trainerFormWinRate"),
                "trainerFormROI": trainer_roi,
                "jockeyFormRuns": runner.get("jockeyFormRuns"),
                "jockeyFormWinRate": runner.get("jockeyFormWinRate"),
                "jockeyFormROI": jockey_roi,
                "officialRating": runner.get("officialRating"),
                "wgt": runner.get("lbs"),
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
            })
    df = pd.DataFrame(rows)
    return df


def apply_trained_categories(df: pd.DataFrame, trained_categories: dict) -> pd.DataFrame:
    for c in CAT_COLS:
        # astype("category") first (unrestricted categories from the data
        # itself), then set_categories() to remap onto the training-time
        # category list — any value not in that list becomes NaN. This is
        # the non-deprecated equivalent of pd.Categorical(values,
        # categories=...) when values contains entries outside categories
        # (that form is deprecated as of pandas 4 and will raise in a
        # future version instead of silently NaN-ing them).
        df[c] = df[c].astype("category").cat.set_categories(trained_categories[c])
    for c in NUM_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def latest_model_version_id(evaluations_collection) -> str:
    doc = evaluations_collection.find_one(
        {"modelVersionId": {"$exists": True}}, sort=[("runAt", -1)]
    )
    if not doc:
        raise RuntimeError(
            f"No documents in {EVALUATIONS_COLLECTION_NAME} — run train_and_predict.py at least "
            "once before predict_daily_races.py."
        )
    return doc["modelVersionId"]


def run():
    if not MODEL_PATH.exists():
        print(f"No trained model at {MODEL_PATH} — run train_and_predict.py first.", file=sys.stderr)
        sys.exit(1)
    if not CATEGORIES_PATH.exists():
        print(
            f"No category sidecar at {CATEGORIES_PATH} — run train_and_predict.py first "
            "(it must be a version that includes the sidecar-persistence step).",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(CATEGORIES_PATH) as f:
        trained_categories = json.load(f)

    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_PATH))

    uri = os.environ["MONGODB_URI"]
    db_name = os.environ["MONGODB_DB_NAME"]
    print(f"Connecting to {db_name}...")
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[COLLECTION_NAME]
    evaluations_collection = db[EVALUATIONS_COLLECTION_NAME]

    model_version_id = latest_model_version_id(evaluations_collection)
    print(f"Using model version: {model_version_id}")

    print(f"Loading daily_racecards for {DAILY_RACE_DATE}...")
    df = load_daily_dataframe(collection, DAILY_RACE_DATE)
    if len(df) == 0:
        print(f"No runners found for {DAILY_RACE_DATE} — nothing to predict.")
        client.close()
        return
    print(f"Loaded {len(df)} runner-rows across {df['raceId'].nunique()} races.")

    df = apply_trained_categories(df, trained_categories)

    raw = model.predict_proba(df[FEATURE_COLS])[:, 1]
    df["raw_pred"] = raw
    df = normalize_within_race(df, "raw_pred", "modelWinProbability")
    df["modelWinProbability"] = df["modelWinProbability"].round(2)

    # Sanity checks — warn, don't silently pass a broken run.
    out_of_range = df[(df["modelWinProbability"] < 0) | (df["modelWinProbability"] > 100)]
    if len(out_of_range) > 0:
        print(f"WARNING: {len(out_of_range)} predictions outside [0,100] range.", file=sys.stderr)
    race_sums = df.groupby("raceId")["modelWinProbability"].sum()
    bad_sums = race_sums[(race_sums - 100).abs() > 0.5]
    if len(bad_sums) > 0:
        print(f"WARNING: {len(bad_sums)} races don't sum to ~100: {bad_sums.to_dict()}", file=sys.stderr)
    if df["raceId"].nunique() >= 5:
        within_race_std = df.groupby("raceId")["modelWinProbability"].std()
        if within_race_std.mean() < 1.0:
            print(
                "WARNING: average within-race standard deviation is very low "
                f"({within_race_std.mean():.3f}) across {len(within_race_std)} races — "
                "predictions look suspiciously flat, possible categorical-encoding issue.",
                file=sys.stderr,
            )

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
            array_filters.append({f"r{i}.runnerId": str(row["runnerId"])})
        ops.append(UpdateOne(
            {"_id": str(race_id)},
            {"$set": set_fields},
            array_filters=array_filters,
        ))
    if ops:
        collection.bulk_write(ops, ordered=False)
        written = len(ops)
    print(f"Done. Updated {written} races.")

    client.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"Daily races prediction failed: {e}", file=sys.stderr)
        sys.exit(1)
