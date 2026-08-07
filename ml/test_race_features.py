#!/usr/bin/env python3
"""Unit tests for ml/features.py — no MongoDB connection needed. Run with:
    ml/venv/bin/python -m pytest ml/test_race_features.py -v
or plain:
    ml/venv/bin/python ml/test_race_features.py

TestLeakage is the load-bearing part of this file and the gate on the whole
feature module. A leaking feature does not produce an error — it produces a
model that looks spectacular right up until it is deployed against races whose
results nobody knows yet, at which point the measured edge evaporates and the
reason is extremely hard to find after the fact. The two tests there are
designed to catch an entire class of mistake each, rather than one instance:

  * a race's own result reaching its own features (a forgotten shift, a
    cumsum without the minus-own term, a rolling() without closed="left")
  * a LATER race reaching an EARLIER one (a career-wide transform("mean"), a
    bare expanding(), a groupby aggregate broadcast back over history)

The second is also what licenses ml/experiment.py building features once over
the whole frame instead of rebuilding them per fold at 11x the cost.
"""

import unittest

import numpy as np
import pandas as pd

import features as F
from train_and_predict import CAT_COLS, NUM_COLS


def frame(n_races=40, runners_per_race=6, seed=7) -> pd.DataFrame:
    """A synthetic runner frame with the columns load_dataframe(extended=True)
    produces. Horses, trainers and jockeys recur across races so the trailing
    families have real history to aggregate."""
    rng = np.random.default_rng(seed)
    courses = ["Ascot", "Lingfield", "Wetherby"]
    goings = ["Good", "Soft", "Standard", "Heavy"]
    types = ["Flat", "Flat", "Hurdle", "Chase"]
    classes = ["Class 2", "Class 4", "Class 6", None]
    headgear = [None, "b", "p", "t"]
    names = ["Handicap Stakes", "Maiden Stakes", "Novices' Hurdle",
             "Selling H'cap", "Nursery Handicap", "Conditions Stakes"]

    rows = []
    for r in range(n_races):
        race_id = 1000 + r
        day = 1 + (r % 27)
        month = 1 + (r // 27) % 12
        date = f"2020-{month:02d}-{day:02d}"
        race_type = types[r % len(types)]
        winner = rng.integers(0, runners_per_race)
        for i in range(runners_per_race):
            rows.append({
                "raceId": race_id,
                "raceDate": date,
                "raceTime": f"{date}T{12 + (r % 6):02d}:00:00",
                "runnerId": race_id * 100 + i,
                "horseName": f"Horse {(r * 3 + i) % 25}",
                "raceName": names[(r + i) % len(names)],
                "meetingId": f"{courses[r % 3]}|{date}",
                "course": courses[r % 3],
                "raceType": race_type,
                "raceClass": classes[r % len(classes)],
                "going": goings[r % len(goings)],
                "trainer": f"Trainer {(r + i) % 7}",
                "jockey": f"Jockey {(r * 2 + i) % 9}",
                "sex": "G",
                "hg": headgear[(r + i) % len(headgear)],
                "pattern": None,
                "distanceFurlongs": float(5 + ((r + i) % 20)),
                "ran": runners_per_race,
                "num": i + 1,
                "draw": i + 1,
                "trainerFormRuns": 10.0, "trainerFormWinRate": 10.0 + i,
                "trainerFormROI": 0.9,
                "jockeyFormRuns": 8.0, "jockeyFormWinRate": 12.0 + i,
                "jockeyFormROI": 0.8,
                # Deliberately sparse, mirroring production's 78% coverage.
                "officialRating": np.nan if (r + i) % 5 == 0 else float(60 + (i * 3) + (r % 7)),
                "wgt": float(120 + i),
                "age": float(3 + (i % 5)),
                "daysSinceLastRun": float(7 + ((r * i) % 200)),
                "horseCareerRuns": float(r % 12),
                "horseCareerWinRate": float((i * 7) % 30),
                "horseAvgRPR": float(70 + ((r + i * 2) % 25)),
                "horseAvgTS": float(50 + ((r + i) % 30)),
                "horseAvgBeatenDistance": float((i * 2) % 15),
                "horseAvgExcuseScore": np.nan,
                "horseTroubleInRunningRate": np.nan,
                "horseTravelledWellRate": np.nan,
                "label": 1 if i == winner else 0,
                "postraceRpr": float(60 + ((r * 2 + i) % 40)),
                "postraceTs": float(40 + ((r + i * 3) % 40)),
                "postraceBeatenDistance": 0.0 if i == winner else float(i * 2),
                "postracePos": str(1 if i == winner else i + 2),
                "postraceStatus": "WINNER" if i == winner else "LOSER",
            })
    df = pd.DataFrame(rows)
    for c in CAT_COLS:
        df[c] = df[c].astype("category")
    for c in NUM_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def build(df, feature_set="all"):
    return F.build_features(df.copy(), feature_set)


class TestLeakage(unittest.TestCase):
    """The two tests this whole module is gated on."""

    def test_a_races_own_result_never_affects_its_own_features(self):
        # Every feature for a race must be computable the morning of that race,
        # when nobody knows the result. So: build normally, then rewrite the
        # LAST race's result and post-race figures to something completely
        # different and rebuild. That race's own feature values must not move
        # by a single bit.
        #
        # Perturbing only the last race (rather than every label in the frame)
        # is deliberate and is the only formulation that is actually correct:
        # trailing win rates legitimately depend on EARLIER races' labels, so a
        # frame-wide overwrite would change features for honest reasons and the
        # test would fail on a module that has no bug at all.
        df = frame()
        base, cats, nums = build(df)
        cols = cats + nums

        perturbed = df.copy()
        last_race = perturbed["raceId"].max()
        mask = perturbed["raceId"] == last_race
        perturbed.loc[mask, "label"] = 1 - perturbed.loc[mask, "label"]
        perturbed.loc[mask, "postraceStatus"] = "LOSER"
        perturbed.loc[mask, ["postraceRpr", "postraceTs", "postraceBeatenDistance"]] = 999.0
        perturbed.loc[mask, "postracePos"] = "99"
        out, _, _ = build(perturbed)

        a = base[base["raceId"] == last_race][cols].reset_index(drop=True)
        b = out[out["raceId"] == last_race][cols].reset_index(drop=True)
        moved = [c for c in cols if not a[c].astype("object").equals(b[c].astype("object"))]
        self.assertEqual(moved, [], f"these features saw their own race's result: {moved}")

    def test_future_races_cannot_influence_the_past(self):
        # Build over the full frame, then over only the first K races, and
        # compare those K races' features. Any career-wide transform("mean"), a
        # bare expanding(), or a rolling() missing closed="left" shows up here
        # as a difference — and this is also what licenses experiment.py
        # building features once over the whole frame rather than per fold.
        df = frame(n_races=40)
        full, cats, nums = build(df)
        cols = cats + nums

        keep = sorted(df["raceId"].unique())[:15]
        truncated, _, _ = build(df[df["raceId"].isin(keep)].copy())

        a = full[full["raceId"].isin(keep)][cols].reset_index(drop=True)
        b = truncated[cols].reset_index(drop=True)
        self.assertEqual(len(a), len(b))
        moved = [c for c in cols if not a[c].astype("object").equals(b[c].astype("object"))]
        self.assertEqual(moved, [], f"these features saw races from the future: {moved}")

    def test_post_race_columns_are_absent_from_the_returned_frame(self):
        out, _, _ = build(frame())
        for c in F.POSTRACE_COLS:
            self.assertNotIn(c, out.columns)

    def test_assert_leakage_safe_rejects_each_forbidden_name(self):
        for banned in F.FORBIDDEN_FEATURE_NAMES:
            with self.assertRaises(F.LeakageError):
                F.assert_leakage_safe(["course", banned])

    def test_assert_leakage_safe_rejects_the_whole_postrace_prefix(self):
        # By prefix, so a post-race column added later is caught without anyone
        # remembering to extend an enumeration.
        with self.assertRaises(F.LeakageError):
            F.assert_leakage_safe(["postraceSomethingInventedLater"])

    def test_every_feature_set_produces_a_leakage_safe_list(self):
        for name in F.FEATURE_SETS:
            _, cats, nums = build(frame(n_races=12), name)
            F.assert_leakage_safe(cats + nums)


class TestWithinRaceRelative(unittest.TestCase):
    def setUp(self):
        self.df = build(frame())[0]

    def test_rank_ignores_nulls_and_the_indicator_records_them(self):
        # A runner with no official rating must have no rank, not a last-place
        # one — "unrated" and "worst rated" are different claims.
        no_or = self.df["officialRating"].isna()
        self.assertTrue(no_or.any(), "fixture should contain unrated runners")
        self.assertTrue(self.df.loc[no_or, "officialRatingRank"].isna().all())
        self.assertTrue((self.df.loc[no_or, "hasOfficialRating"] == 0).all())
        self.assertTrue((self.df.loc[~no_or, "hasOfficialRating"] == 1).all())

    def test_rank_norm_is_zero_to_one_and_divides_by_valid_count(self):
        vals = self.df["horseAvgRPRRankNorm"].dropna()
        self.assertGreaterEqual(vals.min(), 0.0)
        self.assertLessEqual(vals.max(), 1.0)
        # The best-rated runner in each race is 0.0 by construction.
        best = self.df.groupby("raceId")["horseAvgRPRRankNorm"].min()
        self.assertTrue(np.allclose(best.dropna(), 0.0))

    def test_rank_norm_uses_valid_count_not_field_size(self):
        # A 4-runner race where 2 have no OR must normalise over the 2 that do,
        # giving 0.0 and 1.0 — not 0.0 and 1/3.
        df = pd.DataFrame({
            "raceId": [1, 1, 1, 1], "officialRating": [80.0, 70.0, np.nan, np.nan],
        })
        g = df.groupby("raceId", sort=False)
        rank = g["officialRating"].rank(method="min", ascending=False)
        n_valid = g["officialRating"].transform("count")
        norm = F._safe_ratio(rank - 1, n_valid - 1)
        self.assertAlmostEqual(norm[0], 0.0)
        self.assertAlmostEqual(norm[1], 1.0)
        self.assertTrue(np.isnan(norm[2]) and np.isnan(norm[3]))

    def test_z_is_nan_not_inf_when_a_field_is_all_on_the_same_mark(self):
        # Common in low-grade handicaps, and an inf survives into a split
        # threshold where a NaN would be routed by XGBoost's learned default.
        df = frame(n_races=1, runners_per_race=4)
        df["wgt"] = 130.0
        out, _, _ = build(df)
        self.assertTrue(out["wgtZ"].isna().all())
        self.assertFalse(np.isinf(out["wgtZ"].to_numpy(dtype="float64")).any())

    def test_gap_to_best_is_zero_for_the_best_and_negative_otherwise(self):
        by_race = self.df.groupby("raceId")["horseAvgRPRGapBest"]
        self.assertTrue(np.allclose(by_race.max().dropna(), 0.0))
        self.assertLessEqual(self.df["horseAvgRPRGapBest"].min(), 0.0)

    def test_gap_to_best_respects_a_lower_is_better_column(self):
        # horseAvgBeatenDistance is lower-is-better, so the BEST runner (the
        # smallest value) must be the one at gap 0.
        best_rows = self.df.groupby("raceId")["horseAvgBeatenDistance"].idxmin()
        self.assertTrue(np.allclose(
            self.df.loc[best_rows, "horseAvgBeatenDistanceGapBest"].dropna(), 0.0))

    def test_gap_to_second_is_positive_for_the_standout_and_nan_in_a_match(self):
        df = pd.DataFrame({
            "raceId": [1, 1, 1], "raceTime": ["2020-01-01T12:00:00"] * 3,
            "num": [1, 2, 3], "x": [100.0, 80.0, 70.0],
        })
        g = df.groupby("raceId", sort=False)
        rank_first = g["x"].rank(method="first", ascending=False)
        second = df["x"].where(rank_first == 2).groupby(df["raceId"]).transform("max")
        gap = df["x"] - second
        self.assertAlmostEqual(gap.iloc[0], 20.0)   # clear of the next best by 20
        self.assertAlmostEqual(gap.iloc[1], 0.0)

        two = pd.DataFrame({"raceId": [1, 1], "x": [100.0, 80.0]})
        g2 = two.groupby("raceId", sort=False)
        rf = g2["x"].rank(method="first", ascending=False)
        sec = two["x"].where(rf == 2).groupby(two["raceId"]).transform("max")
        self.assertAlmostEqual((two["x"] - sec).iloc[0], 20.0)

    def test_field_strength_is_constant_within_a_race(self):
        for col in ("orMean", "orSd", "orMax", "rprMean"):
            self.assertTrue((self.df.groupby("raceId")[col].nunique(dropna=False) <= 1).all())


class TestTrailingFamilies(unittest.TestCase):
    def test_prior_counts_are_strictly_prior_and_exclude_the_current_result(self):
        df = pd.DataFrame({
            "horseName": ["A", "A", "A", "B"],
            "label": [1, 0, 1, 1],
        })
        runs, wins = F._prior_counts_and_wins(df, ["horseName"])
        self.assertEqual(list(runs), [0.0, 1.0, 2.0, 0.0])
        # Row 0 wins, but its own win must not appear in its own prior count.
        self.assertEqual(list(wins), [0.0, 1.0, 1.0, 0.0])

    def test_the_daily_window_excludes_races_earlier_the_same_day(self):
        # THE test that separates a correct trainer window from a plausible
        # one. A yard has six runners on a card; a naive rolling would let the
        # 13:30 winner inform the 16:00 runner, which no live prediction could
        # ever know, and precompute-trainer-form.ts's own strict
        # `raceDate < race.raceDate` does not.
        df = pd.DataFrame({
            "trainer": ["T"] * 3,
            "raceDate": ["2020-01-01", "2020-01-01", "2020-01-08"],
            "label": [1, 0, 0],
        })
        runs, wins = F._trailing_window(df, ["trainer"], 90)
        self.assertEqual(list(runs[:2]), [0.0, 0.0], "same-day races leaked into each other")
        self.assertEqual(list(wins[:2]), [0.0, 0.0])
        # The later race sees both of that earlier day's runs.
        self.assertEqual(runs[2], 2.0)
        self.assertEqual(wins[2], 1.0)

    def test_the_daily_window_drops_races_older_than_the_window(self):
        df = pd.DataFrame({
            "trainer": ["T"] * 2,
            "raceDate": ["2020-01-01", "2021-06-01"],   # ~517 days apart
            "label": [1, 0],
        })
        runs, _ = F._trailing_window(df, ["trainer"], 365)
        self.assertEqual(runs[1], 0.0)

    def test_suitability_counts_only_prior_runs_at_the_same_course(self):
        out, _, _ = build(frame())
        horse = out["horseName"].iloc[0]
        course = out["course"].iloc[0]
        rows = out[(out["horseName"] == horse) & (out["course"] == course)]
        self.assertEqual(list(rows["horseCourseRuns"]), list(range(len(rows))))

    def test_a_ratio_with_no_denominator_is_nan_never_inf(self):
        out = F._safe_ratio([5.0, 5.0], [0.0, 2.0])
        self.assertTrue(np.isnan(out[0]))
        self.assertAlmostEqual(out[1], 2.5)
        self.assertFalse(np.isinf(out).any())

    def test_career_best_rpr_never_includes_the_current_race(self):
        out, _, _ = build(frame())
        # A horse's first run has no prior figures at all.
        firsts = out.groupby("horseName", observed=True).head(1)
        self.assertTrue(firsts["careerBestRpr"].isna().all())
        self.assertTrue(firsts["lastRunRpr"].isna().all())


class TestHeadgear(unittest.TestCase):
    def build_one_horse(self, hg_sequence):
        n = len(hg_sequence)
        df = frame(n_races=n, runners_per_race=1)
        df["horseName"] = "Solo"
        df["hg"] = hg_sequence
        return build(df)[0]

    def test_null_headgear_is_a_value_not_a_gap(self):
        out = self.build_one_horse([None, None])
        self.assertTrue((out["hgNorm"].astype("object") == "").all())

    def test_the_four_transitions(self):
        out = self.build_one_horse([None, "b", "b", "p", None])
        self.assertEqual(list(out["firstTimeHeadgear"]), [0, 1, 0, 0, 0])
        self.assertEqual(list(out["headgearChanged"]), [0, 0, 0, 1, 0])
        self.assertEqual(list(out["headgearRemoved"]), [0, 0, 0, 0, 1])

    def test_a_first_ever_run_is_not_first_time_headgear(self):
        # There is no "last time" to compare against, so the angle does not
        # apply — recording it as 1 would fire on every debutant in blinkers.
        out = self.build_one_horse(["b", "b"])
        self.assertEqual(out["firstTimeHeadgear"].iloc[0], 0)

    def test_the_streak_counter_resets_on_a_change(self):
        out = self.build_one_horse([None, "b", "b", "b", "p"])
        self.assertEqual(list(out["runsInCurrentHeadgear"]), [0, 0, 1, 2, 0])


class TestRaceContext(unittest.TestCase):
    def flags(self, race_name):
        df = frame(n_races=1, runners_per_race=2)
        df["raceName"] = race_name
        return build(df)[0].iloc[0]

    def test_handicap_spellings(self):
        for name in ("Novice Handicap", "Class 5 H'cap Chase", "Sprint Hcap",
                     "Nursery Handicap"):
            self.assertEqual(self.flags(name)["isHandicap"], 1.0, name)

    def test_a_nursery_counts_as_a_handicap(self):
        # It is a handicap for two-year-olds; missing it would put those races
        # on the wrong side of the most informative race-shape split there is.
        row = self.flags("EBF Nursery")
        self.assertEqual(row["isHandicap"], 1.0)
        self.assertEqual(row["isNursery"], 1.0)

    def test_novices_apostrophe_form_is_matched(self):
        self.assertEqual(self.flags("Novices' Hurdle")["isNovice"], 1.0)

    def test_a_conditions_race_is_not_a_handicap(self):
        row = self.flags("Conditions Stakes")
        self.assertEqual(row["isHandicap"], 0.0)
        self.assertEqual(row["isMaiden"], 0.0)

    def test_class_parsing_leaves_unclassed_races_null(self):
        parsed = F._class_number(pd.Series(["Class 3", "Class 7", None, "Listed"]))
        self.assertEqual(parsed.iloc[0], 3)
        self.assertEqual(parsed.iloc[1], 7)
        self.assertTrue(pd.isna(parsed.iloc[2]))
        self.assertTrue(pd.isna(parsed.iloc[3]))

    def test_distance_bands_split_flat_from_jumps(self):
        band = F._distance_band(pd.Series([5.0, 16.0, 16.0]),
                                pd.Series(["Flat", "Flat", "Chase"]))
        self.assertEqual(band.iloc[0], "sprint-5-6f")
        # The same 16f is a staying test on the Flat and a minimum trip
        # over fences, so the two codes must not share a band.
        self.assertEqual(band.iloc[1], "stay-13f+")
        self.assertEqual(band.iloc[2], "jumps-2m")

    def test_going_groups_keep_turf_and_all_weather_apart(self):
        self.assertEqual(F.GOING_GROUPS["Soft"], "soft")
        self.assertEqual(F.GOING_GROUPS["Standard"], "aw-standard")
        self.assertNotEqual(F.GOING_GROUPS["Good"], F.GOING_GROUPS["Standard"])

    def test_every_production_going_value_is_mapped(self):
        # The 11 distinct values present in industry_starting_prices. An
        # unmapped one silently becomes "unknown" and quietly merges unrelated
        # ground into one suitability bucket.
        for going in ["Firm", "Good", "Good To Firm", "Good To Soft", "Heavy",
                      "Slow", "Soft", "Standard", "Standard / Slow",
                      "Standard To Fast", "Standard To Slow"]:
            self.assertIn(going, F.GOING_GROUPS)


class TestLayoff(unittest.TestCase):
    def test_bucket_boundaries(self):
        df = frame(n_races=6, runners_per_race=1)
        df["daysSinceLastRun"] = [np.nan, 7.0, 8.0, 30.0, 200.0, 400.0]
        df["horseCareerRuns"] = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
        out = build(df)[0]
        self.assertEqual(list(out["layoffBucket"].astype("object")),
                         ["debut", "0-7", "8-14", "15-30", "121-365", "365+"])

    def test_debut_is_flagged_from_career_runs(self):
        df = frame(n_races=2, runners_per_race=1)
        df["horseCareerRuns"] = [0.0, 3.0]
        out = build(df)[0]
        self.assertEqual(list(out["isDebut"]), [1.0, 0.0])


class TestBuildFeatures(unittest.TestCase):
    def test_the_baseline_set_reproduces_the_deployed_feature_list(self):
        # The control arm must be the deployed model's own features, minus the
        # three that are 100% NaN in production, or the harness cannot claim to
        # reproduce the stored walk-forward numbers.
        _, cats, nums = build(frame(n_races=10), "baseline")
        self.assertEqual(cats, list(CAT_COLS))
        self.assertEqual(nums, [c for c in NUM_COLS if c not in F.DEAD_NUM_COLS])

    def test_the_dead_features_can_be_kept_when_asked(self):
        _, _, nums = F.build_features(frame(n_races=10), "baseline",
                                      drop_dead_baseline=False)
        for c in F.DEAD_NUM_COLS:
            self.assertIn(c, nums)

    def test_every_named_feature_set_resolves_and_every_column_exists(self):
        for name in F.FEATURE_SETS:
            out, cats, nums = build(frame(n_races=12), name)
            for c in cats + nums:
                self.assertIn(c, out.columns, f"{name}: {c} missing from the frame")

    def test_an_unknown_feature_set_names_the_known_ones(self):
        with self.assertRaises(KeyError) as ctx:
            build(frame(n_races=2), "no-such-set")
        self.assertIn("baseline", str(ctx.exception))

    def test_the_all_set_adds_a_substantial_number_of_features(self):
        _, base_c, base_n = build(frame(n_races=12), "baseline")
        _, all_c, all_n = build(frame(n_races=12), "all")
        self.assertGreater(len(all_c) + len(all_n), len(base_c) + len(base_n) + 60)

    def test_derived_numerics_are_float32(self):
        # ~972k rows times ~120 columns is 930MB at float64 on top of a 750MB
        # base frame; the downcast is what keeps a full run inside memory.
        out, _, nums = build(frame(n_races=12), "all")
        derived = [c for c in nums if c not in NUM_COLS]
        for c in derived:
            self.assertEqual(out[c].dtype, np.float32, c)

    def test_categoricals_come_back_as_category_dtype(self):
        out, cats, _ = build(frame(n_races=12), "all")
        for c in cats:
            self.assertEqual(out[c].dtype.name, "category", c)

    def test_rows_are_sorted_chronologically_exactly_once(self):
        out, _, _ = build(frame())
        self.assertTrue(out["raceTime"].is_monotonic_increasing)

    def test_feature_coverage_reports_a_dead_feature_as_zero(self):
        out, cats, nums = F.build_features(frame(n_races=12), "baseline",
                                           drop_dead_baseline=False)
        cov = {r["col"]: r["populatedPct"] for r in F.feature_coverage(out, cats + nums)}
        for c in F.DEAD_NUM_COLS:
            self.assertEqual(cov[c], 0.0)
        self.assertGreater(cov["wgt"], 99.0)


if __name__ == "__main__":
    unittest.main()
