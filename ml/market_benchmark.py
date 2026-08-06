#!/usr/bin/env python3
"""The market's own win probability, for use as a benchmark.

Shared by train_and_predict.py's evaluate() (so every ordinary training run
reports whether it beat the price) and walk_forward_score.py (so the honest
out-of-sample numbers carry the same comparison).

THE ONE RULE: the industry SP is a REFEREE, NEVER A TRAINING TARGET.

Gating a model on "did it beat SP's log loss" is safe. Tuning a model toward
"match SP's number" would distil the market into the model through the back
door — the same failure as putting `isp` in the feature set, which
train_and_predict.py's header forbids for good reason. That is also why this
lives in its own module with its own loader: the SP frame is built separately
and merged in only after predictions already exist, so it cannot reach
FEATURE_COLS even by accident.
"""

import numpy as np
import pandas as pd


def load_isp_frame(collection) -> pd.DataFrame:
    """(raceId, runnerId, isp) only — deliberately narrow. Nothing else from
    the runner subdocument is loaded here, so there is no frame in the process
    that carries both the market price and a feature column."""
    rows = []
    for race in collection.find({}, {"raceId": 1, "runners.id": 1, "runners.isp": 1}):
        for runner in race.get("runners", []):
            rows.append({
                "raceId": race["raceId"],
                "runnerId": runner["id"],
                "isp": runner.get("isp"),
            })
    df = pd.DataFrame(rows)
    df["isp"] = pd.to_numeric(df["isp"], errors="coerce")
    return df


def market_probabilities(frame: pd.DataFrame) -> pd.Series:
    """The SP-implied win probability, de-overrounded by that race's own book.

    100/isp across a real book sums to ~115-125%, not 100 — the bookmakers'
    margin. Comparing that directly against a model whose probabilities are
    normalised to sum to 100 would make the model look systematically
    pessimistic by roughly the margin, on every single runner. Dividing by the
    race's own book sum removes it, which is the same correction
    model-accuracy-dao.ts already applies with $reduce for the screen's
    "Market (fair)" column.

    Runners with no usable SP come back NaN, never 0 — "the market had no view"
    and "the market said 0%" are different claims, and only the first is true.
    An isp of 1.0 or less is treated as unusable: it implies certainty and
    would swamp the book sum.
    """
    isp = pd.to_numeric(frame["isp"], errors="coerce").to_numpy(dtype="float64", na_value=np.nan)
    raw = np.where(isp > 1, 100.0 / isp, np.nan)
    out = pd.Series(raw, index=frame.index, name="marketProb")
    book_sum = out.groupby(frame["raceId"]).transform("sum")
    return (out / book_sum).where(book_sum > 0)
