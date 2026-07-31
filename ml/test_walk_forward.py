#!/usr/bin/env python3
"""Standalone unit tests for walk_forward_score.py's pure functions — no
MongoDB connection needed. Run with:
    ml/venv/bin/python -m pytest ml/test_walk_forward.py -v
or plain:
    ml/venv/bin/python ml/test_walk_forward.py

The leakage tests here are the load-bearing ones. Every number the Model
Accuracy screen will show depends on a fold's training rows being strictly
earlier than the rows it scores, and on the calibrator never having seen the
rows it corrects — neither of which is visible by reading an output.
"""

import unittest

import numpy as np
import pandas as pd

import walk_forward_score as wf


def frame(years, rows_per_year=10):
    """A synthetic runner frame: `rows_per_year` rows in each listed year,
    one winner per race, two runners per race."""
    rows = []
    for year in years:
        for i in range(rows_per_year):
            race_id = int(f"{year}{i // 2:03d}")
            rows.append({
                "raceId": race_id,
                "runnerId": i,
                "raceDate": f"{year}-06-{(i % 28) + 1:02d}",
                "label": 1 if i % 2 == 0 else 0,
            })
    df = pd.DataFrame(rows)
    df["year"] = df["raceDate"].map(wf.year_of)
    return df


class TestYearOf(unittest.TestCase):
    def test_extracts_the_calendar_year(self):
        self.assertEqual(wf.year_of("2019-06-15"), "2019")

    def test_works_on_a_timestamp_shaped_value(self):
        self.assertEqual(wf.year_of("2019-06-15T14:30:00"), "2019")


class TestBuildFolds(unittest.TestCase):
    def setUp(self):
        self._min_rows = wf.MIN_TRAIN_ROWS
        self._fold_years = wf.FOLD_YEARS
        wf.MIN_TRAIN_ROWS = 15
        wf.FOLD_YEARS = []

    def tearDown(self):
        wf.MIN_TRAIN_ROWS = self._min_rows
        wf.FOLD_YEARS = self._fold_years

    def test_no_fold_training_rows_overlap_the_year_it_scores(self):
        df = frame(["2018", "2019", "2020", "2021"])
        for year, train_idx, fold_idx in wf.build_folds(df):
            train_max = df.loc[train_idx, "raceDate"].max()
            fold_min = df.loc[fold_idx, "raceDate"].min()
            self.assertLess(train_max, fold_min, f"fold {year} leaks")
            # And nothing from the scored year is in the training set at all.
            self.assertNotIn(year, set(df.loc[train_idx, "year"]))

    def test_earliest_years_are_left_unscored_rather_than_guessed(self):
        # 10 rows a year against a 15-row minimum: 2018 has no prior history,
        # 2019 has only 10 — neither is scoreable, so both stay out entirely.
        df = frame(["2018", "2019", "2020", "2021"])
        scored = [year for year, _, _ in wf.build_folds(df)]
        self.assertNotIn("2018", scored)
        self.assertNotIn("2019", scored)
        self.assertEqual(scored, ["2020", "2021"])

    def test_folds_come_back_in_chronological_order(self):
        df = frame(["2018", "2019", "2020", "2021"])
        scored = [year for year, _, _ in wf.build_folds(df)]
        self.assertEqual(scored, sorted(scored))

    def test_fold_years_env_restricts_which_folds_run(self):
        wf.FOLD_YEARS = ["2021"]
        df = frame(["2018", "2019", "2020", "2021"])
        self.assertEqual([year for year, _, _ in wf.build_folds(df)], ["2021"])

    def test_every_row_of_the_scored_year_is_in_its_fold(self):
        df = frame(["2018", "2019", "2020"])
        folds = {year: fold_idx for year, _, fold_idx in wf.build_folds(df)}
        self.assertEqual(len(folds["2020"]), int((df["year"] == "2020").sum()))


class TestFitCalibrator(unittest.TestCase):
    def test_prefers_prior_out_of_sample_rows_when_there_are_enough(self):
        prior = pd.DataFrame({"p": np.linspace(0.01, 0.9, wf.MIN_CALIBRATION_ROWS),
                              "label": [i % 2 for i in range(wf.MIN_CALIBRATION_ROWS)]})
        fallback = pd.DataFrame({"p": [0.1, 0.9] * 600, "label": [0, 1] * 600})
        _, source = wf.fit_calibrator(prior, fallback)
        self.assertEqual(source, "prior-folds-oos")

    def test_falls_back_to_the_validation_slice_for_the_first_fold(self):
        # No prior folds exist yet — the calibrator must still never be fitted
        # on the fold it is about to correct.
        prior = pd.DataFrame(columns=["p", "label"])
        fallback = pd.DataFrame({"p": [0.1, 0.9] * 600, "label": [0, 1] * 600})
        _, source = wf.fit_calibrator(prior, fallback)
        self.assertEqual(source, "validation-slice")

    def test_returns_no_calibrator_when_neither_source_is_usable(self):
        prior = pd.DataFrame(columns=["p", "label"])
        fallback = pd.DataFrame({"p": [0.5] * 10, "label": [0] * 10})
        calibrator, source = wf.fit_calibrator(prior, fallback)
        self.assertIsNone(calibrator)
        self.assertEqual(source, "none")

    def test_returns_no_calibrator_when_one_class_is_missing(self):
        # A single-class source can't teach a mapping to a win rate.
        prior = pd.DataFrame({"p": np.linspace(0.01, 0.9, wf.MIN_CALIBRATION_ROWS),
                              "label": [0] * wf.MIN_CALIBRATION_ROWS})
        fallback = pd.DataFrame({"p": [0.5] * 10, "label": [0] * 10})
        calibrator, source = wf.fit_calibrator(prior, fallback)
        self.assertIsNone(calibrator)
        self.assertEqual(source, "none")

    def test_it_actually_corrects_a_known_bias(self):
        # Production's shape: predictions that systematically understate the
        # true win rate at the short end. The calibrator should pull a 0.58
        # prediction up toward the ~0.75 that actually happens.
        n = wf.MIN_CALIBRATION_ROWS
        p = np.full(n, 0.58)
        labels = np.array([1 if i % 4 != 0 else 0 for i in range(n)])  # 75% win rate
        calibrator, _ = wf.fit_calibrator(pd.DataFrame({"p": p, "label": labels}),
                                          pd.DataFrame(columns=["p", "label"]))
        self.assertIsNotNone(calibrator)
        self.assertAlmostEqual(float(calibrator.predict([0.58])[0]), 0.75, places=2)


class TestMarketProbabilities(unittest.TestCase):
    def test_de_overrounds_using_the_races_own_book(self):
        # A two-runner book at 2.0/2.0 implies 50+50 = 100% — no overround, so
        # the de-overrounded figures are unchanged.
        fold = pd.DataFrame({"raceId": [1, 1], "isp": [2.0, 2.0]})
        out = wf.market_probabilities(fold)
        self.assertAlmostEqual(out.iloc[0], 0.5, places=6)
        self.assertAlmostEqual(out.iloc[1], 0.5, places=6)

    def test_a_real_overround_book_still_sums_to_one(self):
        # 1.5/3.0/6.0 implies 66.7+33.3+16.7 = 116.7% — a ~17% book.
        fold = pd.DataFrame({"raceId": [1, 1, 1], "isp": [1.5, 3.0, 6.0]})
        out = wf.market_probabilities(fold)
        self.assertAlmostEqual(float(out.sum()), 1.0, places=6)
        self.assertGreater(out.iloc[0], out.iloc[1])

    def test_each_race_is_de_overrounded_by_its_own_book(self):
        fold = pd.DataFrame({"raceId": [1, 1, 2, 2], "isp": [1.5, 3.0, 2.0, 2.0]})
        out = wf.market_probabilities(fold)
        self.assertAlmostEqual(float(out[fold["raceId"] == 1].sum()), 1.0, places=6)
        self.assertAlmostEqual(float(out[fold["raceId"] == 2].sum()), 1.0, places=6)

    def test_unpriced_runners_are_nan_not_zero(self):
        # A missing or nonsensical SP means "no market view", which must not be
        # scored as "the market said 0%".
        fold = pd.DataFrame({"raceId": [1, 1], "isp": [2.0, None]})
        out = wf.market_probabilities(fold)
        self.assertTrue(np.isnan(out.iloc[1]))

    def test_an_isp_of_one_or_less_is_rejected(self):
        # 1.0 implies a 100% certainty and would swamp the book sum.
        fold = pd.DataFrame({"raceId": [1, 1], "isp": [1.0, 2.0]})
        out = wf.market_probabilities(fold)
        self.assertTrue(np.isnan(out.iloc[0]))


class TestScoreBlock(unittest.TestCase):
    def test_scores_a_normal_block(self):
        labels = pd.Series([0, 1, 0, 1])
        probs = pd.Series([0.1, 0.9, 0.2, 0.8])
        out = wf.score_block(labels, probs)
        self.assertEqual(out["n"], 4)
        self.assertAlmostEqual(out["aucRoc"], 1.0, places=6)
        self.assertLess(out["brierScore"], 0.05)

    def test_a_better_prediction_scores_lower_on_brier(self):
        labels = pd.Series([0, 1, 0, 1])
        good = wf.score_block(labels, pd.Series([0.1, 0.9, 0.1, 0.9]))
        bad = wf.score_block(labels, pd.Series([0.4, 0.6, 0.4, 0.6]))
        self.assertLess(good["brierScore"], bad["brierScore"])

    def test_nan_probabilities_are_excluded_not_counted_as_zero(self):
        labels = pd.Series([0, 1, 0, 1])
        probs = pd.Series([0.1, 0.9, np.nan, np.nan])
        self.assertEqual(wf.score_block(labels, probs)["n"], 2)

    def test_a_block_with_no_winner_reports_rather_than_raises(self):
        out = wf.score_block(pd.Series([0, 0, 0]), pd.Series([0.1, 0.2, 0.3]))
        self.assertEqual(out["n"], 3)
        self.assertIsNone(out["aucRoc"])
        self.assertIsNone(out["logLoss"])

    def test_a_certain_wrong_prediction_does_not_produce_infinity(self):
        # log(0) is -inf; the clip is what keeps one confident miss from
        # rendering a whole fold's log loss unusable.
        out = wf.score_block(pd.Series([0, 1]), pd.Series([1.0, 0.0]))
        self.assertTrue(np.isfinite(out["logLoss"]))


class TestCalibrationTable(unittest.TestCase):
    def test_buckets_sum_back_to_the_population(self):
        labels = pd.Series([i % 3 == 0 for i in range(500)]).astype(int)
        probs = pd.Series(np.linspace(0.01, 0.99, 500))
        table = wf.calibration_table(labels, probs)
        self.assertEqual(sum(row["n"] for row in table), 500)

    def test_too_few_rows_returns_empty_rather_than_raising(self):
        self.assertEqual(wf.calibration_table(pd.Series([1, 0]), pd.Series([0.5, 0.4])), [])


if __name__ == "__main__":
    unittest.main()
