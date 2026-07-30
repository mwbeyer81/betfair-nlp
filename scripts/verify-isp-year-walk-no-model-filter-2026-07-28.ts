/* eslint-disable no-console */
// Diagnostic: the user reported "still broke" tapping "Tap to load" on a
// year AFTER the isp-year-walk-error fix (MAX_WALK_BATCH cap) deployed —
// this time on a plainer scenario with NO Model win%/Model-beats-SP/
// trainer-form filters active (ISP range 1-1000, covering every real
// value) — unlike the scenario that fix targeted, which had "Model beats
// SP" checked. That difference matters: getAllRacesByRace's pnlStats
// facet branch takes a different code path when no runner-level filter is
// active (a cheap $sum over precomputed fields, "the fast path") vs. when
// one is (a $lookup + $filter over every matched race's runners, "the
// slow path" — see the router.ts comment). This script replicates the
// CURRENT, FIXED walk algorithm against real production Mongo with this
// exact no-filter scenario, to check whether the fast path has its own,
// different problem the slow-path fix didn't cover.
import { MongoClient } from "mongodb";
import config from "config";
import { IndustrySpDAO } from "../src/lib/dao/industry-sp-dao";

const MAX_WALK_BATCH = 1000;

async function main() {
  const uri = config.get<string>("mongodb.uri");
  const dbName = config.get<string>("mongodb.dbName");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const dao = new IndustrySpDAO(db);

  const params = {
    minRunners: 1,
    maxRunners: 20,
    countries: [] as string[],
    minIsp: 1,
    maxIsp: 1000,
    sortOrder: "asc" as const,
    minInIspRange: 1,
    maxInIspRange: 30,
    fromRow: 4925,
    toRow: 9848,
    minRaceTime: "2024-01-01",
    maxRaceTime: "2025-01-01",
    courses: [] as string[],
    goings: [] as string[],
    raceClasses: [] as string[],
    raceTypes: [] as string[],
    trainerSearch: null,
    jockeySearch: null,
    trainerFormMinWinRate: 0,
    minTrainerFormRunners: 0,
    maxTrainerFormRunners: 100,
    runnerName: null,
    minModelWinProbability: 0,
    onlyModelBeatsSp: false,
    modelVersionId: null,
  };

  console.log("Fetching page 1 to get totalRaces...");
  const first = await dao.getAllRacesByRace(
    1, 20, params.minRunners, params.maxRunners, params.countries, params.minIsp, params.maxIsp,
    params.sortOrder, params.minInIspRange, params.maxInIspRange, params.fromRow, params.toRow,
    params.minRaceTime, params.maxRaceTime, params.courses, params.goings, params.raceClasses,
    params.raceTypes, params.trainerSearch, params.jockeySearch, params.trainerFormMinWinRate,
    params.minTrainerFormRunners, params.maxTrainerFormRunners, params.runnerName,
    params.minModelWinProbability, params.onlyModelBeatsSp, params.modelVersionId
  );
  const totalRaces = first.total;
  console.log(`totalRaces=${totalRaces}, first page data.length=${first.data.length}`);

  let loaded = first.data.length;
  let iteration = 0;
  while (loaded < totalRaces) {
    iteration++;
    const batchLimit = Math.min(loaded, MAX_WALK_BATCH);
    const page = Math.floor(loaded / batchLimit) + 1;
    const skip = (page - 1) * batchLimit;
    const overlap = loaded - skip;
    const start = Date.now();
    try {
      console.log(`[iter ${iteration}] page=${page} limit=${batchLimit} (skip=${skip}, overlap=${overlap})...`);
      const result = await dao.getAllRacesByRace(
        page, batchLimit, params.minRunners, params.maxRunners, params.countries, params.minIsp, params.maxIsp,
        params.sortOrder, params.minInIspRange, params.maxInIspRange, params.fromRow, params.toRow,
        params.minRaceTime, params.maxRaceTime, params.courses, params.goings, params.raceClasses,
        params.raceTypes, params.trainerSearch, params.jockeySearch, params.trainerFormMinWinRate,
        params.minTrainerFormRunners, params.maxTrainerFormRunners, params.runnerName,
        params.minModelWinProbability, params.onlyModelBeatsSp, params.modelVersionId
      );
      const newRaces = result.data.slice(overlap);
      const elapsed = (Date.now() - start) / 1000;
      console.log(`[iter ${iteration}] OK in ${elapsed.toFixed(2)}s, got ${result.data.length} races (${newRaces.length} new)`);
      if (newRaces.length === 0) break;
      loaded += newRaces.length;
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      console.error(`[iter ${iteration}] FAILED after ${elapsed.toFixed(2)}s at loaded=${loaded}:`, err);
      await client.close();
      process.exit(1);
    }
  }

  console.log(`\nDone. Final loaded=${loaded}/${totalRaces} — ${iteration} requests, zero errors.`);
  await client.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
