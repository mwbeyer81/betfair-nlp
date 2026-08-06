#!/usr/bin/env python3
"""
Walk-forward (out-of-sample) scoring for the win-probability model.

WHY THIS EXISTS
---------------
train_and_predict.py's `run()` evaluates honestly on a held-out tail, then
throws that model away, refits on ALL rows (train + test) and writes
`modelWinProbability` for every runner using that refitted model
(train_and_predict.py:420-466). So every stored probability on a historical
race comes from a model that was trained on that same race's result.

That is fine for the purpose that field serves — it is a descriptive score
used by Model vs SP, the Filters screen and Daily Races, and tomorrow's card
is genuinely unseen by definition. It is NOT fine as the basis of the Model
Accuracy screen, whose entire job is to say how accurate the model is. In
sample, the model looks better than it is: measured Brier 0.0893 in-sample
against 0.0968 on the held-out tail.

This script produces the honest counterpart. Every race is scored by a model
trained only on races that finished BEFORE it, and the result is written to a
SEPARATE field, `modelWinProbabilityOos`. It never touches
`modelWinProbability`, never writes ml/models/, and never uploads to S3 — the
deployed model is train_and_predict.py's business alone.

THE FOLDS
---------
One expanding-window fold per calendar year:

    fold Y:   fit on raceDate < Y-01-01   ->   score races in year Y

The earliest year(s) have too little (or no) prior history and are
deliberately left unscored — a runner with no honest score must stay null,
never 0 and never backfilled from the in-sample field, or the accuracy screen
silently counts a guess as a measurement.

CALIBRATION
-----------
Production's calibration failure is a textbook favourite-longshot problem: the
model says 58.2% for its under-2.0 band which actually wins 75.5%, and
over-rates 20/1+ shots by more than 2x, while the 5.0-10.0 band where most of
the mass sits is nearly spot on. That is a calibration failure, not a ranking
one (AUC is respectable while Brier is not), so an isotonic correction is the
cheap fix.

The correction is fitted ONLY on data that is out-of-sample and strictly
earlier than the fold it is applied to (see fit_calibrator below). Fitting it
on the fold being scored would reintroduce exactly the leak this whole script
exists to remove.

THE MARKET BENCHMARK
--------------------
Each fold also scores the market itself: the probability the industry SP
implies, de-overrounded by that race's own book sum. Without it the pipeline
cannot tell that it is losing to the price it is trying to beat.

SP is a REFEREE, NEVER A TRAINING TARGET. It is loaded by a separate function
(load_isp_frame) into a separate frame that is merged in only for scoring, so
it cannot reach FEATURE_COLS even by accident — the same guarantee
train_and_predict.py's header makes for the deployed model.

USAGE
-----
    MONGODB_URI=... MONGODB_DB_NAME=... ml/venv/bin/python ml/walk_forward_score.py

Env knobs (all optional):
    WF_FOLD_YEARS       comma list, e.g. "2019,2020" — restrict which folds run
                        (used to time a single fold before committing to all)
    WF_WRITE_BACK       "false" to compute and evaluate without touching Mongo
    WF_MIN_TRAIN_ROWS   minimum prior rows before a year is scoreable (50000)
    WF_N_ESTIMATORS_CAP cap trees per fold for a faster run; recorded in the
                        evaluation doc so it is never confused with the
                        deployed model's own settings
    WF_CACHE_PATH       pickle of the loaded frame, reused if present — the
                        load is ~750MB off a shared Atlas tier, so a re-run
                        should not pay for it twice
    WF_LABEL            free-text label stored on the evaluation doc
"""

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from pymongo import MongoClient, UpdateOne
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss

# Imported, not reimplemented: a forked feature list or a second copy of the
# within-race normalisation would drift from the real one silently, and the
# whole point of this script is that its numbers describe the real model.
from market_benchmark import load_isp_frame, market_probabilities
from train_and_predict import (
    COLLECTION_NAME,
    EVALUATIONS_COLLECTION_NAME,
    FEATURE_COLS,
    TRAINING_PARAMS_CAMEL,
    chronological_split,
    load_dataframe,
    make_model,
    normalize_within_race,
)

OOS_FIELD = "modelWinProbabilityOos"
BATCH_SIZE = 500

WRITE_BACK = os.environ.get("WF_WRITE_BACK", "true").lower() != "false"
MIN_TRAIN_ROWS = int(os.environ.get("WF_MIN_TRAIN_ROWS", "50000"))
N_ESTIMATORS_CAP = int(os.environ.get("WF_N_ESTIMATORS_CAP", "0")) or None
CACHE_PATH = Path(os.environ.get("WF_CACHE_PATH", Path(__file__).parent / ".cache" / "wf_frame.pkl"))
RUN_LABEL = os.environ.get("WF_LABEL", "walk-forward")
FOLD_YEARS = [y.strip() for y in os.environ.get("WF_FOLD_YEARS", "").split(",") if y.strip()]

# Below this many out-of-sample rows the isotonic fit is too noisy to trust, so
# the fold falls back to its own validation slice (still held out from the fit
# and still strictly earlier than the fold — see fit_calibrator).
MIN_CALIBRATION_ROWS = 20000


def year_of(race_date) -> str:
    return str(race_date)[:4]


def fit_calibrator(prior: pd.DataFrame, fallback: pd.DataFrame):
    """Isotonic regression mapping predicted probability -> observed win rate.

    `prior` is every out-of-sample prediction from folds ALREADY scored, i.e.
    strictly earlier races that this fold's model never saw. That is the ideal
    training set for a calibrator: same shape of error, no contact with the
    fold being corrected.

    The first scoreable fold has no prior folds, so it falls back to the
    fold's own early-stopping validation slice — held out from the fit, and
    still entirely earlier than the fold. Never the fold's own rows.
    """
    source, source_name = (prior, "prior-folds-oos") if len(prior) >= MIN_CALIBRATION_ROWS else (fallback, "validation-slice")
    if len(source) < 1000 or source["label"].nunique() < 2:
        return None, "none"
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    iso.fit(source["p"].to_numpy(), source["label"].to_numpy())
    return iso, source_name


def score_block(labels: pd.Series, probs: pd.Series) -> dict:
    """AUC/log loss/Brier over one block of rows, guarding the degenerate
    cases (a block with no winner, or an all-NaN market column) that would
    otherwise raise mid-run rather than reporting honestly."""
    mask = probs.notna().to_numpy()
    y = labels.to_numpy()[mask]
    p = np.clip(probs.to_numpy()[mask], 1e-9, 1 - 1e-9)
    if len(y) == 0 or len(np.unique(y)) < 2:
        return {"n": int(len(y)), "aucRoc": None, "logLoss": None, "brierScore": None}
    return {
        "n": int(len(y)),
        "aucRoc": round(float(roc_auc_score(y, p)), 6),
        "logLoss": round(float(log_loss(y, p, labels=[0, 1])), 6),
        "brierScore": round(float(brier_score_loss(y, p)), 6),
    }


def calibration_table(labels: pd.Series, probs: pd.Series, bins: int = 10) -> list:
    frame = pd.DataFrame({"p": probs, "label": labels}).dropna()
    if len(frame) < bins:
        return []
    frame["bucket"] = pd.qcut(frame["p"], bins, duplicates="drop")
    grouped = frame.groupby("bucket", observed=True).agg(
        meanPredicted=("p", "mean"), actualWinRate=("label", "mean"), n=("label", "size")
    )
    return [
        {"meanPredicted": round(float(r.meanPredicted), 6),
         "actualWinRate": round(float(r.actualWinRate), 6),
         "n": int(r.n)}
        for r in grouped.itertuples()
    ]


def load_frame(collection) -> pd.DataFrame:
    if CACHE_PATH.exists():
        print(f"Loading cached frame from {CACHE_PATH}...")
        df = pd.read_pickle(CACHE_PATH)
    else:
        print("Loading data from Mongo (no cache)...")
        try:
            df = load_dataframe(collection)
        except KeyError as e:
            # load_dataframe indexes race["raceDate"] directly, so a document
            # without it dies as a bare KeyError naming only the field. That
            # is what a run pointed at the wrong database looks like: the
            # local CI fixture races carry no raceDate at all, and a worktree
            # without the gitignored config/local.json resolves to
            # localhost:27019 rather than Atlas. Say so, rather than making
            # the next person work it out from one quoted word.
            raise RuntimeError(
                f"missing field {e} while loading — this collection's documents aren't the "
                f"shape the trainer expects. Check the target above is the intended database "
                f"(the local CI fixtures have no raceDate; a worktree without config/local.json "
                f"points at localhost:27019, not Atlas)."
            ) from e
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        df.to_pickle(CACHE_PATH)
        print(f"Cached frame to {CACHE_PATH}")

    undated = int(df["raceDate"].isna().sum()) if "raceDate" in df else len(df)
    if undated:
        raise RuntimeError(f"{undated} of {len(df)} rows have no raceDate — every fold boundary "
                           f"is a date comparison, so this cannot be scored safely.")
    return df


def build_folds(df: pd.DataFrame) -> list:
    """One fold per calendar year that has enough prior history behind it.

    Returns [(year, train_index, fold_index)] in chronological order. The
    leakage guarantee is structural — a fold's training rows are selected by
    `raceDate < {year}-01-01` — and is re-asserted per fold in run() as well,
    because a silent leak here would invalidate every number downstream.
    """
    years = sorted(df["year"].unique())
    folds = []
    for year in years:
        if FOLD_YEARS and year not in FOLD_YEARS:
            continue
        train_mask = df["raceDate"] < f"{year}-01-01"
        if int(train_mask.sum()) < MIN_TRAIN_ROWS:
            print(f"  {year}: only {int(train_mask.sum())} prior rows (< {MIN_TRAIN_ROWS}) — left unscored")
            continue
        folds.append((year, df.index[train_mask], df.index[df["year"] == year]))
    return folds


def run():
    started = time.time()
    oos_version_id = datetime.now(timezone.utc).strftime("wf-%Y%m%d-%H%M%S")
    print(f"Walk-forward run id: {oos_version_id}")

    client = MongoClient(os.environ["MONGODB_URI"])
    db = client[os.environ["MONGODB_DB_NAME"]]
    collection = db[COLLECTION_NAME]
    # Printed before anything else touches the data: this script writes a new
    # field onto every scored runner, so which database it is pointed at is
    # never something to infer afterwards from a stack trace.
    print(f"Target: db={db.name} collection={COLLECTION_NAME} "
          f"({collection.estimated_document_count()} race docs) write_back={WRITE_BACK}")

    df = load_frame(collection)
    df["year"] = df["raceDate"].map(year_of)
    print(f"Loaded {len(df)} runner-rows across {df['raceId'].nunique()} races, "
          f"{df['year'].min()}-{df['year'].max()}.")

    folds = build_folds(df)
    if not folds:
        print("No scoreable folds — nothing to do.", file=sys.stderr)
        return
    print(f"{len(folds)} fold(s) to score: {', '.join(y for y, _, _ in folds)}")

    # Accumulates every out-of-sample prediction as folds complete: the
    # calibration source for later folds, and the population every headline
    # metric is computed over at the end.
    oos_rows = []
    prior = pd.DataFrame(columns=["p", "label"])
    fold_summaries = []

    for year, train_idx, fold_idx in folds:
        fold_started = time.time()
        train_df = df.loc[train_idx]
        fold_df = df.loc[fold_idx].copy()
        # Structural, but asserted anyway — this single line is what every
        # number produced downstream depends on being true.
        assert train_df["raceDate"].max() < fold_df["raceDate"].min(), \
            f"fold {year} leaks: train max {train_df['raceDate'].max()} >= fold min {fold_df['raceDate'].min()}"

        fit_df, val_df = chronological_split(train_df, holdout_frac=0.10)
        model = make_model(early_stopping=True)
        if N_ESTIMATORS_CAP:
            model.set_params(n_estimators=N_ESTIMATORS_CAP)
        print(f"\n--- fold {year}: fit {len(fit_df)} / val {len(val_df)} -> score {len(fold_df)} rows ---")
        model.fit(fit_df[FEATURE_COLS], fit_df["label"],
                  eval_set=[(val_df[FEATURE_COLS], val_df["label"])], verbose=False)
        print(f"  early stopping chose n_estimators={model.best_iteration}")

        # Same two-step the live path uses: raw model output, then normalised
        # within the race so the number reads as "share of this field's win
        # probability" and every race sums to 100.
        fold_df["raw_pred"] = model.predict_proba(fold_df[FEATURE_COLS])[:, 1]
        fold_df = normalize_within_race(fold_df, "raw_pred", "p_norm_pct")
        fold_df["p_norm"] = fold_df["p_norm_pct"] / 100.0

        val_df = val_df.copy()
        val_df["raw_pred"] = model.predict_proba(val_df[FEATURE_COLS])[:, 1]
        val_df = normalize_within_race(val_df, "raw_pred", "p_norm_pct")
        fallback = pd.DataFrame({"p": val_df["p_norm_pct"] / 100.0, "label": val_df["label"]})

        calibrator, calib_source = fit_calibrator(prior, fallback)
        if calibrator is None:
            fold_df["p_cal"] = fold_df["p_norm"]
        else:
            fold_df["p_cal_raw"] = calibrator.predict(fold_df["p_norm"].to_numpy())
            # Isotonic breaks the sum-to-100 property, and exactly one runner
            # wins each race, so the constraint has to be restored afterwards.
            fold_df = normalize_within_race(fold_df, "p_cal_raw", "p_cal_pct")
            fold_df["p_cal"] = fold_df["p_cal_pct"] / 100.0
        print(f"  calibration source: {calib_source}")

        summary = {
            "year": year,
            "trainRows": int(len(train_df)),
            "scoredRows": int(len(fold_df)),
            "trainDateMax": str(train_df["raceDate"].max()),
            "foldDateMin": str(fold_df["raceDate"].min()),
            "foldDateMax": str(fold_df["raceDate"].max()),
            "bestIteration": int(model.best_iteration),
            "calibrationSource": calib_source,
            "raw": score_block(fold_df["label"], fold_df["p_norm"]),
            "calibrated": score_block(fold_df["label"], fold_df["p_cal"]),
            "seconds": round(time.time() - fold_started, 1),
        }
        fold_summaries.append(summary)
        print(f"  raw        {summary['raw']}")
        print(f"  calibrated {summary['calibrated']}")
        print(f"  fold took {summary['seconds']}s")

        oos_rows.append(fold_df[["raceId", "runnerId", "raceDate", "year", "label", "p_norm", "p_cal"]])
        prior = pd.concat([prior, pd.DataFrame({"p": fold_df["p_norm"], "label": fold_df["label"]})],
                          ignore_index=True)

    oos = pd.concat(oos_rows, ignore_index=True)
    print(f"\nScored {len(oos)} runner-rows out-of-sample across {len(fold_summaries)} fold(s).")

    print("Loading industry SP for the market benchmark...")
    isp = load_isp_frame(collection)
    oos = oos.merge(isp, on=["raceId", "runnerId"], how="left")
    oos["market"] = market_probabilities(oos)

    overall = {
        "raw": score_block(oos["label"], oos["p_norm"]),
        "calibrated": score_block(oos["label"], oos["p_cal"]),
        "market": score_block(oos["label"], oos["market"]),
    }
    print("\n=== OVERALL (out-of-sample) ===")
    for name, block in overall.items():
        print(f"  {name:<11} {block}")

    better = None
    if overall["raw"]["logLoss"] is not None and overall["calibrated"]["logLoss"] is not None:
        better = "calibrated" if overall["calibrated"]["logLoss"] < overall["raw"]["logLoss"] else "raw"
        print(f"\nCalibration {'HELPS' if better == 'calibrated' else 'DOES NOT HELP'} "
              f"(log loss {overall['raw']['logLoss']} -> {overall['calibrated']['logLoss']})")

    # The field the accuracy screen reads carries whichever variant actually
    # won on out-of-sample log loss — never calibration on faith.
    chosen = "p_cal" if better == "calibrated" else "p_norm"
    oos["stored"] = (oos[chosen] * 100).round(2)

    doc = {
        "runAt": datetime.now(timezone.utc).isoformat(),
        "evaluationType": "walk_forward",
        "oosVersionId": oos_version_id,
        "runLabel": RUN_LABEL,
        "storedVariant": chosen,
        "calibrationHelped": better == "calibrated",
        "trainingParams": {**TRAINING_PARAMS_CAMEL,
                           **({"nEstimatorsCap": N_ESTIMATORS_CAP} if N_ESTIMATORS_CAP else {})},
        "featureCols": FEATURE_COLS,
        "foldCount": len(fold_summaries),
        "scoredRows": int(len(oos)),
        "unscoredRows": int(len(df) - len(oos)),
        "coverageMinDate": str(oos["raceDate"].min()),
        "coverageMaxDate": str(oos["raceDate"].max()),
        "overall": overall,
        "folds": fold_summaries,
        "calibrationTableRaw": calibration_table(oos["label"], oos["p_norm"]),
        "calibrationTableCalibrated": calibration_table(oos["label"], oos["p_cal"]),
        "calibrationTableMarket": calibration_table(oos["label"], oos["market"]),
        "totalSeconds": round(time.time() - started, 1),
    }
    db[EVALUATIONS_COLLECTION_NAME].insert_one(dict(doc))
    print(f"\nSaved walk-forward evaluation (oosVersionId={oos_version_id}).")

    if not WRITE_BACK:
        print("WF_WRITE_BACK=false — skipping the Mongo write-back.")
        client.close()
        return

    print(f"\nWriting {OOS_FIELD} onto {oos['raceId'].nunique()} races...")
    ops = []
    written = 0
    for race_id, group in oos.groupby("raceId"):
        set_fields = {}
        array_filters = []
        for i, row in enumerate(group.itertuples()):
            set_fields[f"runners.$[r{i}].{OOS_FIELD}"] = float(row.stored)
            array_filters.append({f"r{i}.id": int(row.runnerId)})
        ops.append(UpdateOne({"_id": int(race_id)}, {"$set": set_fields}, array_filters=array_filters))
        if len(ops) >= BATCH_SIZE:
            collection.bulk_write(ops, ordered=False)
            written += len(ops)
            print(f"  updated {written} races...")
            ops = []
    if ops:
        collection.bulk_write(ops, ordered=False)
        written += len(ops)
    print(f"Done. Updated {written} races in {round(time.time() - started, 1)}s total.")
    client.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"Walk-forward scoring failed: {e}", file=sys.stderr)
        sys.exit(1)
