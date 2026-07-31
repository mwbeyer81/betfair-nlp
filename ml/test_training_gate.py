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
