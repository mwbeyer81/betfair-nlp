#!/usr/bin/env python3
"""Unit tests for ml/experiment.py's pure functions — no MongoDB connection
needed. Run with:
    ml/venv/bin/python -m pytest ml/test_experiment.py -v
or plain:
    ml/venv/bin/python ml/test_experiment.py

TestTheHarnessCannotTouchProduction is the one that matters most. The harness
runs against the production Atlas cluster, and the thing it must never do is
write anything the deployed pipeline reads — a plausible-looking experiment
silently becoming the model that scores tomorrow's racecards is not a failure
anybody would notice quickly.
"""

import os
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

os.environ.setdefault("EXP_NAME", "unit-test")

import experiment as E
import features as F


class TestTheHarnessCannotTouchProduction(unittest.TestCase):
    def test_no_model_artifact_or_per_runner_write_appears_in_the_source(self):
        # A source scan is blunt, and deliberately so: it catches the mistake at
        # the moment it is typed rather than after a run has already written to
        # production. Every name here is one that would either replace the
        # deployed model or stamp a probability onto a runner subdocument.
        src = Path(E.__file__).read_text()
        for forbidden in ("save_model", "MODEL_PATH", "CATEGORIES_PATH",
                          "upload_model_to_s3", "UpdateOne", "bulk_write",
                          "update_one", "update_many", "delete_one", "replace_one"):
            self.assertNotIn(forbidden, src,
                             f"{forbidden!r} would let the harness write to production")

    def test_the_only_collection_written_is_model_experiments(self):
        # model_evaluations is read by train_and_predict.current_champion() and
        # by predict_daily_races.py's latest-version lookup, which is on the
        # DEPLOYED daily prediction path.
        self.assertEqual(E.EXPERIMENTS_COLLECTION_NAME, "model_experiments")
        src = Path(E.__file__).read_text()
        self.assertNotIn("EVALUATIONS_COLLECTION_NAME", src)

    def test_a_separate_frame_cache_from_the_walk_forward_one(self):
        # Sharing walk_forward_score's pickle would load a frame missing every
        # extended source column and produce a long run whose new features are
        # silently all-NaN.
        import walk_forward_score as wf
        self.assertNotEqual(E.CACHE_PATH, wf.CACHE_PATH)


class TestRaceGroups(unittest.TestCase):
    def test_contiguous_races_give_sizes_and_starts(self):
        sizes, starts = E.race_groups(np.array([1, 1, 1, 2, 2, 3]))
        self.assertEqual(list(sizes), [3, 2, 1])
        self.assertEqual(list(starts), [0, 3, 5])

    def test_a_non_contiguous_frame_raises_rather_than_mixing_races(self):
        # Every softmax and ranking operation reduces over these offsets, so an
        # unsorted frame would silently merge two races into one likelihood term.
        with self.assertRaises(AssertionError):
            E.race_groups(np.array([1, 2, 1]))

    def test_an_empty_frame_is_handled(self):
        sizes, starts = E.race_groups(np.array([], dtype="int64"))
        self.assertEqual(len(sizes), 0)


class TestGroupSoftmax(unittest.TestCase):
    def test_each_race_sums_to_one(self):
        margin = np.array([1.0, 2.0, 3.0, 0.5, -0.5])
        sizes, starts = E.race_groups(np.array([1, 1, 1, 2, 2]))
        p = E.group_softmax(margin, sizes, starts)
        self.assertAlmostEqual(p[:3].sum(), 1.0)
        self.assertAlmostEqual(p[3:].sum(), 1.0)

    def test_it_is_stable_against_large_margins(self):
        # Without the max subtraction this overflows to inf/inf = NaN.
        margin = np.array([900.0, 901.0])
        sizes, starts = E.race_groups(np.array([1, 1]))
        p = E.group_softmax(margin, sizes, starts)
        self.assertTrue(np.isfinite(p).all())
        self.assertAlmostEqual(p.sum(), 1.0)

    def test_a_constant_margin_gives_an_even_split(self):
        sizes, starts = E.race_groups(np.array([1, 1, 1, 1]))
        p = E.group_softmax(np.zeros(4), sizes, starts)
        self.assertTrue(np.allclose(p, 0.25))


class TestSoftmaxObjective(unittest.TestCase):
    class FakeDMatrix:
        def __init__(self, labels, sizes_starts):
            self._y = np.asarray(labels, dtype="float64")
            self.race_sizes = sizes_starts

        def get_label(self):
            return self._y

    def test_gradient_is_probability_minus_label(self):
        sizes, starts = E.race_groups(np.array([1, 1, 1]))
        d = self.FakeDMatrix([0, 1, 0], (sizes, starts))
        margin = np.array([0.0, 1.0, 0.0])
        grad, hess = E._softmax_obj(margin, d)
        p = E.group_softmax(margin, sizes, starts)
        self.assertTrue(np.allclose(grad, p - np.array([0.0, 1.0, 0.0])))
        # The gradient over a race sums to zero — a pure reallocation of
        # probability between rivals, which is what a competition is.
        self.assertAlmostEqual(grad.sum(), 0.0)
        self.assertTrue((hess > 0).all(), "a non-positive hessian stalls the boosting")

    def test_the_metric_is_the_winners_negative_log_probability(self):
        sizes, starts = E.race_groups(np.array([1, 1]))
        d = self.FakeDMatrix([0, 1], (sizes, starts))
        name, value = E._softmax_feval(np.array([0.0, 0.0]), d)
        self.assertEqual(name, "race-nll")
        self.assertAlmostEqual(value, -np.log(0.5), places=6)

    def test_a_confident_correct_prediction_scores_near_zero(self):
        sizes, starts = E.race_groups(np.array([1, 1]))
        d = self.FakeDMatrix([0, 1], (sizes, starts))
        _, value = E._softmax_feval(np.array([-10.0, 10.0]), d)
        self.assertLess(value, 1e-6)

    def test_dead_heats_and_voided_races_are_excluded_from_training(self):
        # Two winners breaks the Plackett-Luce likelihood, which assumes
        # exactly one. Dropped from TRAINING only — a race the model could not
        # learn from is still one it must be judged on.
        df = pd.DataFrame({"raceId": [1, 1, 2, 2, 3, 3],
                           "label": [1, 1, 1, 0, 0, 0]})
        keep = E._one_winner_mask(df)
        self.assertEqual(list(keep), [False, False, True, True, False, False])


class TestTemperature(unittest.TestCase):
    def test_it_recovers_the_temperature_a_score_was_scaled_by(self):
        rng = np.random.default_rng(0)
        n_races, per_race = 400, 8
        race_ids = np.repeat(np.arange(n_races), per_race)
        sizes, starts = E.race_groups(race_ids)
        true_t = 2.5
        latent = rng.normal(size=n_races * per_race)
        p = E.group_softmax(latent, sizes, starts)
        labels = np.zeros(len(p))
        for i, (s, n) in enumerate(zip(starts, sizes)):
            labels[s + rng.choice(n, p=p[s:s + n] / p[s:s + n].sum())] = 1
        fitted = E._fit_temperature(latent * true_t, labels, sizes, starts)
        self.assertAlmostEqual(fitted, true_t, delta=0.6)

    def test_it_stays_inside_its_bounds(self):
        sizes, starts = E.race_groups(np.array([1, 1]))
        t = E._fit_temperature(np.array([0.0, 0.0]), np.array([0.0, 1.0]), sizes, starts)
        self.assertGreaterEqual(t, 0.05)
        self.assertLessEqual(t, 20.0)


class TestMurphy(unittest.TestCase):
    def test_the_identity_holds_on_the_binned_forecast(self):
        # It does NOT hold on the raw forecast — the remainder is within-bin
        # discrimination the binning discarded. The first version of
        # scripts/model-vs-sp-brier-2026-08-04.ts asserted against the raw
        # Brier, failed at 2.4e-4, and printed "identity holds" anyway because
        # the success line was unconditional.
        rng = np.random.default_rng(3)
        p = rng.uniform(0.01, 0.5, 40000)
        y = (rng.uniform(size=len(p)) < p).astype("float64")
        out = E.murphy(y, p, bins=50)
        self.assertIsNotNone(out["reliability"])
        # If the identity had failed, murphy() would have raised.
        self.assertIn("withinBin", out)

    def test_within_bin_discrimination_is_reported_not_hidden(self):
        rng = np.random.default_rng(4)
        p = rng.uniform(0.01, 0.6, 20000)
        y = (rng.uniform(size=len(p)) < p).astype("float64")
        out = E.murphy(y, p, bins=20)
        self.assertIsNotNone(out["withinBin"])

    def test_a_perfectly_calibrated_forecast_has_near_zero_reliability(self):
        rng = np.random.default_rng(5)
        p = rng.uniform(0.05, 0.55, 60000)
        y = (rng.uniform(size=len(p)) < p).astype("float64")
        out = E.murphy(y, p, bins=50)
        self.assertLess(out["reliability"], 1e-3)

    def test_a_more_informative_forecast_has_higher_resolution(self):
        # Resolution IS discrimination, and it is the number this whole
        # project exists to move: 0.007336 for the model against 0.013368 for
        # the market.
        rng = np.random.default_rng(6)
        n = 60000
        truth = rng.uniform(0.02, 0.6, n)
        y = (rng.uniform(size=n) < truth).astype("float64")
        sharp = E.murphy(y, truth, bins=50)
        flat = E.murphy(y, np.full(n, truth.mean()), bins=50)
        self.assertGreater(sharp["resolution"], flat["resolution"])

    def test_too_few_rows_reports_rather_than_raises(self):
        out = E.murphy(np.array([0.0, 1.0]), np.array([0.2, 0.8]), bins=100)
        self.assertIsNone(out["reliability"])


class TestDiscriminationBlock(unittest.TestCase):
    def test_top1_rate_counts_races_where_the_favourite_won(self):
        out = E.discrimination_block(
            labels=np.array([1, 0, 0, 1]),
            probs=np.array([0.6, 0.4, 0.7, 0.3]),
            race_ids=np.array([1, 1, 2, 2]))
        self.assertAlmostEqual(out["top1Rate"], 0.5)
        self.assertEqual(out["races"], 2)

    def test_mrr_rewards_ranking_the_winner_near_the_top(self):
        good = E.discrimination_block(np.array([1, 0, 0]), np.array([0.9, 0.05, 0.05]),
                                      np.array([1, 1, 1]))
        bad = E.discrimination_block(np.array([1, 0, 0]), np.array([0.05, 0.9, 0.05]),
                                     np.array([1, 1, 1]))
        self.assertGreater(good["mrr"], bad["mrr"])


class TestPnl(unittest.TestCase):
    def test_the_two_staking_conventions(self):
        # to-win-1 stakes 1/(isp-1) to return 1 profit; level stakes 1 flat.
        out = E.pnl_block(np.array([3.0, 3.0]), np.array([1, 0]))
        self.assertAlmostEqual(out["toWin1"]["staked"], 1.0)     # 0.5 + 0.5
        self.assertAlmostEqual(out["toWin1"]["returns"], 1.5)    # 0.5 + 1
        self.assertAlmostEqual(out["level"]["staked"], 2.0)
        self.assertAlmostEqual(out["level"]["returns"], 3.0)

    def test_a_fair_book_breaks_even_under_to_win_staking(self):
        # Target-profit staking has zero expectation at fair odds, which is why
        # the -11.67% no-filter baseline is the ISP overround and nothing else.
        isp = np.full(1000, 5.0)
        won = np.zeros(1000)
        won[:200] = 1                                  # exactly the implied 20%
        out = E.pnl_block(isp, won)
        self.assertAlmostEqual(out["toWin1"]["roiPct"], 0.0, places=6)
        self.assertAlmostEqual(out["level"]["roiPct"], 0.0, places=6)

    def test_unpriced_runners_are_excluded_from_the_denominator(self):
        out = E.pnl_block(np.array([3.0, np.nan, 1.0]), np.array([1, 1, 1]))
        self.assertEqual(out["bettableN"], 1)

    def test_no_bettable_runners_reports_none_rather_than_dividing_by_zero(self):
        out = E.pnl_block(np.array([np.nan]), np.array([0]))
        self.assertIsNone(out["toWin1"])


class TestSegmentToIspFilters(unittest.TestCase):
    def test_every_expressible_dimension_round_trips(self):
        cases = {
            ("spBand", "5.0-10.0"): {"minIsp": "5.0", "maxIsp": "10.0"},
            ("raceType", "Chase"): {"raceTypes": "Chase"},
            ("raceClass", "Class 4"): {"raceClasses": "Class 4"},
            ("year", "2023"): {"minDate": "2023-01-01", "maxDate": "2023-12-31"},
        }
        for (dim, bucket), expected in cases.items():
            self.assertEqual(E.segment_to_isp_filters(dim, bucket, "all"), expected)

    def test_field_size_bounds_are_inclusive_on_the_screens_side(self):
        # FIELD_SIZE_BUCKETS is half-open [7, 9); maxRunners is inclusive.
        self.assertEqual(E.segment_to_isp_filters("fieldSizeBucket", "7-8", "all"),
                         {"minRunners": "7", "maxRunners": "8"})

    def test_a_going_group_expands_to_its_member_goings(self):
        out = E.segment_to_isp_filters("goingGroup", "soft", "all")
        self.assertEqual(set(out["goings"].split(",")), {"Good To Soft", "Soft"})

    def test_the_three_inexpressible_dimensions_return_none(self):
        # Honest, rather than inventing a param the Filters screen does not have.
        for dim, bucket in (("month", "6.0"), ("distanceBand", "sprint-5-6f"),
                            ("isHandicap", "handicap")):
            self.assertIsNone(E.segment_to_isp_filters(dim, bucket, "all"))

    def test_the_top1_selection_is_not_expressible_as_a_filter(self):
        self.assertIsNone(E.segment_to_isp_filters("spBand", "5.0-10.0", "modelTop1"))

    def test_the_model_beats_market_selection_adds_the_model_param(self):
        out = E.segment_to_isp_filters("raceType", "Flat", "modelBeatsMarket")
        self.assertEqual(out["onlyModelBeatsSp"], "true")
        # ...and that param is exactly what makes it unpostable until the
        # deployed walk-forward has been re-run.
        self.assertTrue(any(p in out for p in E.MODEL_DEPENDENT_FILTER_PARAMS))


class TestAcceptanceRule(unittest.TestCase):
    def segment(self, **overrides):
        base = {
            "dimension": "spBand", "bucket": "5.0-10.0", "bss": 0.01,
            "yearsPositiveToWin1": 9, "yearsPositiveLevel": 9,
            "selections": {"all": {
                "n": 50000, "strikeRate": 12.0,
                "pnl": {"toWin1": {"roiPct": 3.0}, "level": {"roiPct": 2.0}},
            }},
        }
        base.update(overrides)
        return base

    def test_a_clean_segment_is_discovered(self):
        self.assertEqual(len(E.find_discoveries([self.segment()])), 1)

    def test_a_cell_positive_under_only_one_staking_convention_is_rejected(self):
        # THE load-bearing clause. AGENTS.md 2026-08-01 records a grid cell at
        # +2.0% level ROI and -1.5% to-win ROI on the SAME BETS, and correctly
        # calls contradictory signs on one bet set noise.
        seg = self.segment()
        seg["selections"]["all"]["pnl"] = {"toWin1": {"roiPct": -1.5},
                                           "level": {"roiPct": 2.0}}
        self.assertEqual(E.find_discoveries([seg]), [])

    def test_a_small_sample_is_rejected_however_good_the_roi(self):
        seg = self.segment()
        seg["selections"]["all"]["n"] = 162
        seg["selections"]["all"]["pnl"] = {"toWin1": {"roiPct": 40.0},
                                           "level": {"roiPct": 40.0}}
        self.assertEqual(E.find_discoveries([seg]), [])

    def test_losing_to_the_market_on_brier_is_rejected(self):
        self.assertEqual(E.find_discoveries([self.segment(bss=-0.02)]), [])

    def test_a_single_lucky_window_is_rejected(self):
        self.assertEqual(E.find_discoveries([self.segment(yearsPositiveToWin1=3)]), [])

    def test_the_rule_is_recorded_so_a_discovery_is_never_post_hoc(self):
        for key in ("minN", "minBss", "requirePositiveUnderBothStakings",
                    "minYearsPositiveFraction"):
            self.assertIn(key, E.ACCEPTANCE_RULE)

    def test_the_year_threshold_scales_to_the_years_a_run_actually_scored(self):
        # A fast run covers five years. A hardcoded "8 of 11" would make a
        # discovery arithmetically impossible in the mode used for almost every
        # iteration — the rule would look like it was working while silently
        # rejecting everything.
        self.assertEqual(E.effective_min_years(11), 8)
        self.assertEqual(E.effective_min_years(5), 4)
        # And a segment that clears the scaled bar in fast mode IS discovered.
        seg = self.segment(yearsPositiveToWin1=4)
        self.assertEqual(len(E.find_discoveries([seg], fold_count=5)), 1)
        self.assertEqual(E.find_discoveries([seg], fold_count=11), [])

    def test_one_good_year_is_never_enough_however_short_the_run(self):
        self.assertEqual(E.effective_min_years(1), 2)
        self.assertEqual(E.find_discoveries([self.segment(yearsPositiveToWin1=1)],
                                            fold_count=1), [])


class TestModeGuards(unittest.TestCase):
    def setUp(self):
        self._saved = {k: getattr(E, k) for k in
                       ("MODE", "OBJECTIVE", "NAME", "N_ESTIMATORS_CAP",
                        "RACE_SAMPLE_FRAC", "FOLD_YEARS")}

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(E, k, v)

    def configure(self, **kw):
        for k, v in {"MODE": "fast", "OBJECTIVE": "binary", "NAME": "t",
                     "N_ESTIMATORS_CAP": None, "RACE_SAMPLE_FRAC": None,
                     "FOLD_YEARS": [], **kw}.items():
            setattr(E, k, v)

    def test_fast_mode_applies_all_three_levers(self):
        self.configure()
        s = E.resolve_settings()
        self.assertEqual(s["foldYears"], E.FAST_FOLD_YEARS)
        self.assertEqual(s["nEstimatorsCap"], E.FAST_N_ESTIMATORS_CAP)
        self.assertEqual(s["raceSampleFrac"], E.FAST_RACE_SAMPLE_FRAC)

    def test_full_mode_refuses_a_cap(self):
        # Otherwise a capped run recorded as "full" gets compared against real
        # full runs and the budget difference reads as a feature effect.
        self.configure(MODE="full", N_ESTIMATORS_CAP=300)
        with self.assertRaises(SystemExit):
            E.resolve_settings()

    def test_full_mode_refuses_race_sampling_and_a_fold_subset(self):
        for kw in ({"RACE_SAMPLE_FRAC": 0.5}, {"FOLD_YEARS": ["2024"]}):
            self.configure(MODE="full", **kw)
            with self.assertRaises(SystemExit):
                E.resolve_settings()

    def test_full_mode_with_nothing_set_is_accepted(self):
        self.configure(MODE="full")
        s = E.resolve_settings()
        self.assertEqual(s["foldYears"], [])
        self.assertIsNone(s["nEstimatorsCap"])

    def test_an_unnamed_experiment_is_refused(self):
        self.configure(NAME="")
        with self.assertRaises(SystemExit):
            E.resolve_settings()

    def test_an_unknown_objective_is_refused(self):
        self.configure(OBJECTIVE="magic")
        with self.assertRaises(SystemExit):
            E.resolve_settings()

    def test_every_objective_has_a_fitter(self):
        for name in E.OBJECTIVES:
            self.assertIn(name, E.FITTERS)


class TestFeatureSetsAreReachable(unittest.TestCase):
    def test_the_baseline_set_is_the_deployed_feature_list(self):
        self.assertIn("baseline", F.FEATURE_SETS)
        self.assertEqual(F.FEATURE_SETS["baseline"], ())


if __name__ == "__main__":
    unittest.main()
