/* eslint-disable no-console */
// Verifies the fix for scripts/prod-repro-isp-year-walk-bson-limit-2026-07-28.ts
// — replicates the CURRENT, shipped ensureYearLoaded walk algorithm
// (IspRacesScreen.tsx: MAX_WALK_BATCH=1000 cap + skip<=loaded + overlap
// trim) directly against IndustrySpDAO on the real production Mongo, with
// the exact same user-reported filter scenario the original bug script
// used. Direct-to-DAO (not HTTP) for the same reason as the original:
// anonymous HTTP callers are capped to a 100-row window (clampRowSpan),
// far too small to exercise the ~9500-race scale this bug only appeared
// at, and this agent has no real production login.
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
    maxIsp: 751,
    sortOrder: "asc" as const,
    minInIspRange: 1,
    maxInIspRange: 30,
    fromRow: 338,
    toRow: 9839,
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
    onlyModelBeatsSp: true,
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
