#!/usr/bin/env python3
"""Unit tests for the champion/challenger gate and the market benchmark added
to train_and_predict.py. No MongoDB connection needed. Run with:
    ml/venv/bin/python ml/test_training_gate.py

The gate is the thing standing between a bad retrain and an irrecoverably
overwritten deployed model, so its edge cases are worth pinning down rather
than trusting to a one-line comparison.
"""

import unittest

import numpy as np
import pandas as pd

import train_and_predict as t
from market_benchmark import market_probabilities


class TestPromotionDecision(unittest.TestCase):
    def test_promotes_when_there_is_no_champion(self):
        promoted, reason = t.promotion_decision(0.30, None)
        self.assertTrue(promoted)
        self.assertIn("no previous champion", reason)

    def test_promotes_a_clearly_better_challenger(self):
        self.assertTrue(t.promotion_decision(0.30, {"logLoss": 0.31})[0])

    def test_rejects_a_clearly_worse_challenger(self):
        promoted, reason = t.promotion_decision(0.32, {"logLoss": 0.31, "modelVersionId": "xgb-old"})
        self.assertFalse(promoted)
        # The reason has to name the champion it lost to — otherwise the log
        # says a run was rejected without saying what to compare it against.
        self.assertIn("xgb-old", reason)

    def test_a_noise_level_regression_still_promotes(self):
        # Two runs of the same config differ slightly; blocking on that would
        # stop ordinary retrains on newer data from ever shipping.
        self.assertTrue(t.promotion_decision(0.31 + t.PROMOTION_TOLERANCE / 2, {"logLoss": 0.31})[0])

    def test_the_tolerance_is_one_sided(self):
        # Better by any margin promotes; worse by more than the tolerance does
        # not. The tolerance must never be readable as "within +/- 0.001".
        self.assertTrue(t.promotion_decision(0.31 - 1.0, {"logLoss": 0.31})[0])
        self.assertFalse(t.promotion_decision(0.31 + t.PROMOTION_TOLERANCE * 2, {"logLoss": 0.31})[0])

    def test_exactly_at_the_tolerance_promotes(self):
        self.assertTrue(t.promotion_decision(0.31 + t.PROMOTION_TOLERANCE, {"logLoss": 0.31})[0])

    def test_a_champion_with_no_log_loss_does_not_block(self):
        # A legacy doc missing the metric can't be compared against, and must
        # not become a permanent blocker.
        promoted, reason = t.promotion_decision(0.30, {"modelVersionId": "xgb-legacy"})
        self.assertTrue(promoted)
        self.assertIn("no log loss", reason)


class FakeEvaluations:
    """Stands in for a pymongo collection for current_champion() only —
    implements the handful of query operators that function actually uses."""

    def __init__(self, docs):
        self.docs = docs

    @staticmethod
    def _matches(doc, query):
        for key, cond in query.items():
            if key == "$or":
                if not any(FakeEvaluations._matches(doc, c) for c in cond):
                    return False
            elif isinstance(cond, dict) and "$exists" in cond:
                if (key in doc) != cond["$exists"]:
                    return False
            elif isinstance(cond, dict) and "$ne" in cond:
                if doc.get(key) == cond["$ne"]:
                    return False
            elif doc.get(key) != cond:
                return False
        return True

    def find_one(self, query, sort=None):
        hits = [d for d in self.docs if self._matches(d, query)]
        for key, direction in reversed(sort or []):
            hits.sort(key=lambda d: d.get(key), reverse=direction < 0)
        return hits[0] if hits else None


class TestCurrentChampion(unittest.TestCase):
    def test_picks_the_lowest_log_loss_training_run(self):
        champ = t.current_champion(FakeEvaluations([
            {"modelVersionId": "xgb-a", "logLoss": 0.33},
            {"modelVersionId": "xgb-b", "logLoss": 0.31},
        ]))
        self.assertEqual(champ["modelVersionId"], "xgb-b")

    def test_a_walk_forward_doc_is_never_the_champion(self):
        # It describes a scoring pass, not a deployable model, and its metrics
        # are not comparable to a single held-out tail.
        self.assertIsNone(t.current_champion(FakeEvaluations([
            {"oosVersionId": "wf-1", "evaluationType": "walk_forward", "logLoss": 0.29},
        ])))

    def test_an_experiment_doc_can_never_become_the_champion(self):
        # Why current_champion() is an allow-list on modelVersionId rather than
        # merely a deny-list on "walk_forward". An out-of-sample scoring pass
        # measures log loss around 0.30 against the best real training run's
        # 0.32091 — so a doc like this would win, become PERMANENT champion
        # (nothing later can beat 0.29), and from then on silently reject every
        # genuine retrain, in favour of a champion with no model artifact
        # anywhere to deploy or roll back to.
        champ = t.current_champion(FakeEvaluations([
            {"evaluationType": "experiment", "experimentId": "exp-1", "logLoss": 0.29},
            {"modelVersionId": "xgb-real", "logLoss": 0.32},
        ]))
        self.assertIsNotNone(champ)
        self.assertEqual(champ["modelVersionId"], "xgb-real")

    def test_an_unknown_future_doc_type_with_a_log_loss_is_ignored(self):
        # Generalises the case above: the guard is "carries a modelVersionId",
        # not "is not one of the types we happen to know about today".
        self.assertIsNone(t.current_champion(FakeEvaluations([
            {"evaluationType": "something-nobody-has-invented-yet", "logLoss": 0.10},
        ])))

    def test_a_legacy_doc_without_the_promoted_flag_still_counts(self):
        # Those docs predate the flag; nothing could have stopped them
        # shipping, so in effect they were all promoted.
        champ = t.current_champion(FakeEvaluations([
            {"modelVersionId": "xgb-legacy", "logLoss": 0.30},
        ]))
        self.assertEqual(champ["modelVersionId"], "xgb-legacy")

    def test_a_rejected_challenger_is_not_eligible(self):
        champ = t.current_champion(FakeEvaluations([
            {"modelVersionId": "xgb-rejected", "logLoss": 0.20, "promoted": False},
            {"modelVersionId": "xgb-good", "logLoss": 0.31, "promoted": True},
        ]))
        self.assertEqual(champ["modelVersionId"], "xgb-good")


class TestBenchmarkMetrics(unittest.TestCase):
    def test_scores_a_normal_block(self):
        out = t.benchmark_metrics(pd.Series([0, 1, 0, 1]), pd.Series([0.1, 0.9, 0.2, 0.8]))
        self.assertEqual(out["n"], 4)
        self.assertAlmostEqual(out["aucRoc"], 1.0, places=6)

    def test_runners_with_no_market_price_are_excluded_not_zeroed(self):
        # "The market had no view" and "the market said 0%" are different
        # claims, and scoring the second would punish the market for a data gap.
        out = t.benchmark_metrics(pd.Series([0, 1, 0, 1]), pd.Series([0.1, 0.9, np.nan, np.nan]))
        self.assertEqual(out["n"], 2)

    def test_a_block_with_no_winner_reports_rather_than_raises(self):
        out = t.benchmark_metrics(pd.Series([0, 0]), pd.Series([0.1, 0.2]))
        self.assertIsNone(out["logLoss"])

    def test_a_confident_miss_does_not_produce_infinity(self):
        out = t.benchmark_metrics(pd.Series([0, 1]), pd.Series([1.0, 0.0]))
        self.assertTrue(np.isfinite(out["logLoss"]))


class TestMarketIsNeverAFeature(unittest.TestCase):
    def test_isp_is_not_in_the_feature_set(self):
        # The guarantee train_and_predict.py's header makes, asserted rather
        # than trusted — the benchmark work added an isp-carrying frame to the
        # same module, and this is what catches it leaking into training.
        for banned in ("isp", "ispFraction", "isFavourite", "pos", "status"):
            self.assertNotIn(banned, t.FEATURE_COLS)

    def test_the_de_overrounded_book_sums_to_one(self):
        fold = pd.DataFrame({"raceId": [1, 1, 1], "isp": [1.5, 3.0, 6.0]})
        self.assertAlmostEqual(float(market_probabilities(fold).sum()), 1.0, places=6)


if __name__ == "__main__":
    unittest.main()
