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


if __name__ == "__main__":
    unittest.main()
