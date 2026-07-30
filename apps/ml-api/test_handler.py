"""Unit tests for apps/ml-api/handler.py — pure function of its input
event, no Lambda runtime or MongoDB needed. Run with:
    ml/venv/bin/python apps/ml-api/test_handler.py -v
(plain unittest, matching ml/test_features.py — pytest isn't a repo
dependency, see ml/requirements.txt)

Uses the same committed CI-fixture model local-ci-e2e.sh uses
(ml/fixtures/*.ci-fixture.json) for fast, deterministic tests — no real
~48.6MB model or training run needed here.
"""

import os
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
# train_and_predict.py lives in ml/ in this repo checkout; the deployed
# container copies it next to handler.py instead (see Dockerfile) — this
# path shim lets local tests import the same module both ways use without
# a duplicate copy.
sys.path.insert(0, str(REPO_ROOT / "ml"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import train_and_predict  # noqa: E402

# Point at the committed CI-fixture model before importing handler, so its
# module-level MODEL_PATH/CATEGORIES_PATH (imported from train_and_predict)
# resolve to the fixture rather than whatever's in ml/models/ locally.
train_and_predict.MODEL_PATH = REPO_ROOT / "ml" / "fixtures" / "win_probability_model.ci-fixture.json"
train_and_predict.CATEGORIES_PATH = REPO_ROOT / "ml" / "fixtures" / "win_probability_model_categories.ci-fixture.json"

import handler  # noqa: E402

handler.MODEL_PATH = train_and_predict.MODEL_PATH
handler.CATEGORIES_PATH = train_and_predict.CATEGORIES_PATH


def make_runner(race_id="race-1", runner_id="r1", **overrides):
    row = {
        "raceId": race_id,
        "runnerId": runner_id,
        "course": "Beverley",
        "going": "Good",
        "raceType": "Flat",
        "raceClass": "Class 1",
        "trainer": "A Trainer",
        "jockey": "Aiden Brookes",
        "sex": "G",
        "hg": "",
        "distanceFurlongs": 8.0,
        "ran": 6,
        "num": 1,
        "draw": 1,
        "trainerFormRuns": 3,
        "trainerFormWinRate": 33.3,
        "trainerFormStaked": 3,
        "trainerFormReturns": 5,
        "jockeyFormRuns": 2,
        "jockeyFormWinRate": 50.0,
        "jockeyFormStaked": 2,
        "jockeyFormReturns": 4,
        "officialRating": 80,
        "wgt": 130,
        "age": 5,
        "daysSinceLastRun": 14,
        "horseCareerRuns": 10,
        "horseCareerWinRate": 20.0,
        "horseAvgRPR": 90,
        "horseAvgTS": 85,
        "horseAvgBeatenDistance": 2.5,
        "horseAvgExcuseScore": 0,
        "horseTroubleInRunningRate": 0.1,
        "horseTravelledWellRate": 0.7,
    }
    row.update(overrides)
    return row


class TestHandlerAuth(unittest.TestCase):
    def test_wrong_api_key_rejected(self):
        handler.API_KEY = "secret"
        try:
            result = handler.handler({"apiKey": "wrong", "runners": [make_runner()]}, None)
        finally:
            handler.API_KEY = ""
        self.assertEqual(result, {"error": "unauthorized"})

    def test_no_api_key_configured_allows_any(self):
        handler.API_KEY = ""
        result = handler.handler({"apiKey": "anything", "runners": [make_runner()]}, None)
        self.assertIn("predictions", result)


class TestHandlerValidation(unittest.TestCase):
    def test_empty_runners_rejected(self):
        result = handler.handler({"runners": []}, None)
        self.assertEqual(result, {"error": "runners must be a non-empty array"})

    def test_missing_field_rejected(self):
        bad_runner = make_runner()
        del bad_runner["trainer"]
        result = handler.handler({"runners": [bad_runner]}, None)
        self.assertIn("error", result)
        self.assertIn("trainer", result["error"])


class TestHandlerPrediction(unittest.TestCase):
    def test_single_runner_predicts_in_range(self):
        result = handler.handler({"runners": [make_runner()]}, None)
        self.assertIn("predictions", result)
        self.assertEqual(len(result["predictions"]), 1)
        prob = result["predictions"][0]["modelWinProbability"]
        self.assertGreaterEqual(prob, 0)
        self.assertLessEqual(prob, 100)
        # A single-runner "race" always gets 100% by construction
        # (normalize_within_race divides by the group's own total).
        self.assertAlmostEqual(prob, 100.0, places=1)

    def test_multi_runner_race_sums_to_100(self):
        runners = [
            make_runner(runner_id="r1", officialRating=90),
            make_runner(runner_id="r2", officialRating=70),
            make_runner(runner_id="r3", officialRating=50),
        ]
        result = handler.handler({"runners": runners}, None)
        total = sum(p["modelWinProbability"] for p in result["predictions"])
        self.assertAlmostEqual(total, 100.0, delta=0.5)

    def test_roi_derived_not_required_in_payload(self):
        runner = make_runner()
        self.assertNotIn("trainerFormROI", runner)
        self.assertNotIn("jockeyFormROI", runner)
        result = handler.handler({"runners": [runner]}, None)
        self.assertIn("predictions", result)

    def test_unseen_category_value_does_not_crash(self):
        runner = make_runner(course="Nonexistent Racecourse")
        result = handler.handler({"runners": [runner]}, None)
        self.assertIn("predictions", result)

    def test_separate_races_normalize_independently(self):
        runners = [
            make_runner(race_id="race-A", runner_id="a1"),
            make_runner(race_id="race-A", runner_id="a2"),
            make_runner(race_id="race-B", runner_id="b1"),
        ]
        result = handler.handler({"runners": runners}, None)
        by_race = {"race-A": [], "race-B": []}
        preds = {p["runnerId"]: p["modelWinProbability"] for p in result["predictions"]}
        by_race["race-A"] = [preds["a1"], preds["a2"]]
        by_race["race-B"] = [preds["b1"]]
        self.assertAlmostEqual(sum(by_race["race-A"]), 100.0, delta=0.5)
        self.assertAlmostEqual(sum(by_race["race-B"]), 100.0, delta=0.5)


class TestHandlerTopFactors(unittest.TestCase):
    def test_top_factors_present_and_shaped(self):
        result = handler.handler({"runners": [make_runner()]}, None)
        factors = result["predictions"][0]["topFactors"]
        self.assertLessEqual(len(factors), handler.TOP_FACTORS_COUNT)
        self.assertGreater(len(factors), 0)
        for factor in factors:
            self.assertIn("label", factor)
            self.assertIn("direction", factor)
            self.assertIn(factor["direction"], ("positive", "negative"))

    def test_top_factors_only_from_num_cols_labels(self):
        result = handler.handler({"runners": [make_runner()]}, None)
        factors = result["predictions"][0]["topFactors"]
        all_labels = {label for pair in train_and_predict.FEATURE_EXPLANATIONS.values() for label in pair}
        for factor in factors:
            self.assertIn(factor["label"], all_labels)

    def test_top_factors_direction_matches_contribution_sign(self):
        # Exercises _top_factors_for_row directly with synthetic
        # contributions rather than through the full model pipeline, so
        # the sign-to-direction mapping is pinned down precisely.
        feature_values = [0.0] * len(handler.FEATURE_COLS)
        feature_values[handler.FEATURE_COLS.index("horseAvgRPR")] = 5.0
        feature_values[handler.FEATURE_COLS.index("officialRating")] = -3.0
        factors = handler._top_factors_for_row(feature_values)
        by_label = {f["label"]: f["direction"] for f in factors}
        self.assertEqual(by_label[train_and_predict.FEATURE_EXPLANATIONS["horseAvgRPR"][0]], "positive")
        self.assertEqual(by_label[train_and_predict.FEATURE_EXPLANATIONS["officialRating"][1]], "negative")

    def test_top_factors_each_runner_scored_independently(self):
        runners = [
            make_runner(runner_id="r1", officialRating=95, horseAvgRPR=95),
            make_runner(runner_id="r2", officialRating=40, horseAvgRPR=40),
        ]
        result = handler.handler({"runners": runners}, None)
        by_runner = {p["runnerId"]: p["topFactors"] for p in result["predictions"]}
        self.assertGreater(len(by_runner["r1"]), 0)
        self.assertGreater(len(by_runner["r2"]), 0)


if __name__ == "__main__":
    unittest.main()
