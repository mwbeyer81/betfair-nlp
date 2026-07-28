"""
Container-image Lambda that serves the already-trained XGBoost win-
probability model for on-demand scoring — no retraining, no MongoDB
access. Invoked directly via `lambda:InvokeFunction` (RequestResponse)
from the `hello-api` Node Lambda, never via a public Function URL or API
Gateway route; the plain-dict return here is the raw Invoke response
payload, not the API-Gateway proxy statusCode/body envelope.

Reuses train_and_predict.py's CAT_COLS/NUM_COLS/FEATURE_COLS and
normalize_within_race verbatim (bundled into this image, see Dockerfile)
rather than re-deriving the categorical-encoding logic — see
ml/predict_daily_races.py's apply_trained_categories() for why that
sidecar-driven approach matters (an independently-built category list
would silently produce wrong predictions, not an error).

Model + categories sidecar are baked into the image at build time (see
apps/ml-api/build.sh) at models/win_probability_model*.json, next to this
file — train_and_predict.py's MODEL_DIR = Path(__file__).parent / "models"
resolves relative to wherever train_and_predict.py itself sits, so the
layout here must match: handler.py, train_and_predict.py, and models/
all live together at the Lambda task root.

Request payload (the Lambda `Payload` Node sends via InvokeCommand):
    {"apiKey": "<shared secret>", "runners": [{"raceId": ..., "runnerId": ..., <every CAT_COLS/NUM_COLS field>}]}
Response (success):
    {"modelVersionId": "...", "predictions": [{"runnerId": ..., "modelWinProbability": 12.34,
        "topFactors": [{"label": "Strong recent form", "direction": "positive"}, ...]}]}
Response (handled error):
    {"error": "..."}
Unexpected errors are allowed to raise — Lambda surfaces them as
FunctionError in the Invoke response rather than a 200 with an error body.

topFactors is the model's per-runner top-3 SHAP contributions (computed
natively via XGBoost's pred_contribs, no extra ML dependency), restricted
to NUM_COLS and translated through FEATURE_EXPLANATIONS into a plain-
language "why this %" line for a non-technical punter — see that table in
train_and_predict.py for why CAT_COLS (course/trainer/jockey/etc. identity
columns) are excluded from this list.
"""

import json
import os

import numpy as np
import pandas as pd
import xgboost as xgb

from train_and_predict import (
    CAT_COLS,
    NUM_COLS,
    FEATURE_COLS,
    FEATURE_EXPLANATIONS,
    MODEL_PATH,
    CATEGORIES_PATH,
    normalize_within_race,
)

TOP_FACTORS_COUNT = 3

API_KEY = os.environ.get("PREDICTION_API_KEY", "")
MODEL_VERSION_ID = os.environ.get("MODEL_VERSION_ID", "unknown")

# Loaded once per warm Lambda execution environment, reused across
# invocations — loading a ~48.6MB XGBoost model on every request would
# defeat the point of not retraining.
_model = None
_trained_categories = None


def _load_model():
    global _model, _trained_categories
    if _model is None:
        if not MODEL_PATH.exists():
            raise RuntimeError(f"No trained model baked into this image at {MODEL_PATH}")
        m = xgb.XGBClassifier()
        m.load_model(str(MODEL_PATH))
        _model = m
    if _trained_categories is None:
        if not CATEGORIES_PATH.exists():
            raise RuntimeError(f"No category sidecar baked into this image at {CATEGORIES_PATH}")
        with open(CATEGORIES_PATH) as f:
            _trained_categories = json.load(f)
    return _model, _trained_categories


def _derive_roi_fields(runners: list) -> list:
    # Same derivation as ml/predict_daily_races.py:load_daily_dataframe
    # (lines 65-74) — trainerFormROI/jockeyFormROI aren't stored fields on
    # daily_racecards, they're computed from Staked/Returns at read time.
    # Node passes the raw Staked/Returns fields through as-is rather than
    # duplicating this 2-line calc in TypeScript.
    out = []
    for r in runners:
        r = dict(r)
        trainer_staked = r.get("trainerFormStaked")
        trainer_returns = r.get("trainerFormReturns")
        r["trainerFormROI"] = (trainer_returns or 0) / trainer_staked if trainer_staked else float("nan")
        jockey_staked = r.get("jockeyFormStaked")
        jockey_returns = r.get("jockeyFormReturns")
        r["jockeyFormROI"] = (jockey_returns or 0) / jockey_staked if jockey_staked else float("nan")
        out.append(r)
    return out


def _apply_trained_categories(df: pd.DataFrame, trained_categories: dict) -> pd.DataFrame:
    # Same non-deprecated astype("category").cat.set_categories(...) form
    # as ml/predict_daily_races.py:apply_trained_categories — any runner
    # value unseen in training becomes NaN, handled by XGBoost's learned
    # per-split missing-value direction.
    for c in CAT_COLS:
        df[c] = df[c].astype("category").cat.set_categories(trained_categories[c])
    for c in NUM_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _top_factors_for_row(feature_values: np.ndarray) -> list:
    # feature_values is one row of pred_contribs, aligned to FEATURE_COLS,
    # with a trailing bias term already stripped by the caller.
    num_contribs = [
        (feature, float(value))
        for feature, value in zip(FEATURE_COLS, feature_values)
        if feature in NUM_COLS
    ]
    top = sorted(num_contribs, key=lambda pair: -abs(pair[1]))[:TOP_FACTORS_COUNT]
    factors = []
    for feature, value in top:
        helped_phrase, hurt_phrase = FEATURE_EXPLANATIONS[feature]
        direction = "positive" if value >= 0 else "negative"
        factors.append({"label": helped_phrase if direction == "positive" else hurt_phrase, "direction": direction})
    return factors


def handler(event, context):
    if API_KEY and event.get("apiKey") != API_KEY:
        return {"error": "unauthorized"}

    runners = event.get("runners") or []
    if not isinstance(runners, list) or not runners:
        return {"error": "runners must be a non-empty array"}

    runners = _derive_roi_fields(runners)

    required = set(FEATURE_COLS) | {"raceId", "runnerId"} - {"trainerFormROI", "jockeyFormROI"}
    missing = sorted(required - set().union(*(r.keys() for r in runners)))
    if missing:
        return {"error": f"missing fields across runners: {missing}"}

    model, trained_categories = _load_model()

    df = pd.DataFrame(runners)
    df = _apply_trained_categories(df, trained_categories)

    raw = model.predict_proba(df[FEATURE_COLS])[:, 1]
    df["raw_pred"] = raw
    df = normalize_within_race(df, "raw_pred", "modelWinProbability")
    df["modelWinProbability"] = df["modelWinProbability"].round(2)

    dmatrix = xgb.DMatrix(df[FEATURE_COLS], enable_categorical=True)
    contribs = model.get_booster().predict(dmatrix, pred_contribs=True)[:, :-1]  # drop trailing bias column

    predictions = [
        {
            "runnerId": row["runnerId"],
            "modelWinProbability": float(row["modelWinProbability"]),
            "topFactors": _top_factors_for_row(contribs[i]),
        }
        for i, (_, row) in enumerate(df.iterrows())
    ]
    return {"modelVersionId": MODEL_VERSION_ID, "predictions": predictions}
