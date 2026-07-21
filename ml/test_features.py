#!/usr/bin/env python3
"""Standalone unit tests for the pure feature-engineering functions in
train_and_predict.py — no MongoDB connection needed. Run with:
    ml/venv/bin/python -m pytest ml/test_features.py -v
or plain:
    ml/venv/bin/python ml/test_features.py
"""

import math
import unittest

import pandas as pd

from train_and_predict import parse_distance_furlongs, normalize_within_race


class TestParseDistanceFurlongs(unittest.TestCase):
    def test_furlongs_only(self):
        self.assertEqual(parse_distance_furlongs("5f"), 5.0)

    def test_miles_only(self):
        self.assertEqual(parse_distance_furlongs("2m"), 16.0)

    def test_miles_and_furlongs(self):
        self.assertEqual(parse_distance_furlongs("1m3f"), 11.0)

    def test_miles_furlongs_and_half(self):
        self.assertEqual(parse_distance_furlongs("2m4½f"), 20.5)

    def test_miles_and_half_furlong_no_whole_furlong_digit(self):
        self.assertEqual(parse_distance_furlongs("1m½f"), 8.5)

    def test_none_input(self):
        self.assertTrue(math.isnan(parse_distance_furlongs(None)))

    def test_empty_string(self):
        self.assertTrue(math.isnan(parse_distance_furlongs("")))

    def test_garbage_input(self):
        self.assertTrue(math.isnan(parse_distance_furlongs("not a distance")))


class TestNormalizeWithinRace(unittest.TestCase):
    def test_sums_to_100_per_race(self):
        df = pd.DataFrame({
            "raceId": [1, 1, 1, 2, 2],
            "raw_pred": [0.6, 0.3, 0.1, 0.2, 0.2],
        })
        result = normalize_within_race(df, "raw_pred", "modelWinProbability")
        race1_sum = result[result["raceId"] == 1]["modelWinProbability"].sum()
        race2_sum = result[result["raceId"] == 2]["modelWinProbability"].sum()
        self.assertAlmostEqual(race1_sum, 100.0, places=6)
        self.assertAlmostEqual(race2_sum, 100.0, places=6)

    def test_preserves_relative_order(self):
        df = pd.DataFrame({"raceId": [1, 1, 1], "raw_pred": [0.6, 0.3, 0.1]})
        result = normalize_within_race(df, "raw_pred", "modelWinProbability")
        values = result["modelWinProbability"].tolist()
        self.assertTrue(values[0] > values[1] > values[2])

    def test_degenerate_all_zero_falls_back_to_even_split(self):
        df = pd.DataFrame({"raceId": [1, 1], "raw_pred": [0.0, 0.0]})
        result = normalize_within_race(df, "raw_pred", "modelWinProbability")
        self.assertAlmostEqual(result["modelWinProbability"].iloc[0], 50.0, places=6)
        self.assertAlmostEqual(result["modelWinProbability"].iloc[1], 50.0, places=6)


if __name__ == "__main__":
    unittest.main()
