/* eslint-disable no-console */
// One-off diagnostic: replicate the frontend's doubling walk
// (IspRacesScreen.tsx's ensureYearLoaded) directly against the DAO on the
// REAL production Mongo (config/local.json), bypassing HTTP/auth entirely.
//
// Why direct-to-DAO instead of the usual page.route()-intercepted
// Playwright prod-repro script: the anonymous-caller row cap
// (clampRowSpan, 100 rows) makes it impossible for this agent (no real
// login) to exercise the real backend at Split-B/~9500-race scale over
// HTTP at all — every previous prod-repro script for this feature used a
// synthetic page.route() mock instead, which never actually calls the real
// backend, so it can't reproduce a bug that's in the *real* Lambda/Mongo
// query behavior. This script calls IndustrySpDAO directly against
// production data instead, sidestepping both the HTTP auth wall and
// Lambda's own timeout, to find out whether the doubling walk itself
// (large `limit` values, repeated on every iteration) is what's actually
// failing.
//
// User's real reported scenario (screenshots, 2026-07-28): Split B
// (fromRow=338, toRow=9839), Date 2024-01-01 -> 2025-01-01, maxIsp=751,
// onlyModelBeatsSp=true, no other narrowing filters. Tapping the collapsed
// "2025" year header got to "1280/9502 races" then errored with "Failed
// to load races".
//
// Run: NODE_CONFIG_DIR=./config npx ts-node scripts/prod-repro-isp-year-walk-bson-limit-2026-07-28.ts
//
// Result (first run, before the fix): the walk succeeded through
// limit=1280, then failed requesting limit=2560 —
// `MongoServerError: BSONObj size: 20461144 ... invalid. Size must be
// between 0 and 16793600(16MB)`. Root cause: getAllRacesByRace's $facet
// packs the "data" page, "total", "totalRunners", and "pnlStats" branches
// into a single BSON document — a MongoDB $facet property, not something
// an index or allowDiskUse can work around — so an uncapped doubling
// batch size eventually produces a single result document over Mongo's
// 16MB limit. See AGENTS.md's isp-year-walk-error entry for the fix
// (MAX_WALK_BATCH client-side cap + a defensive backend clamp) and its
// confirmation re-run.
import { MongoClient } from "mongodb";
import config from "config";
import { IndustrySpDAO } from "../src/lib/dao/industry-sp-dao";

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
    const start = Date.now();
    try {
      console.log(`[iter ${iteration}] requesting page=2 limit=${loaded} (skip=${loaded}, take=${loaded})...`);
      const result = await dao.getAllRacesByRace(
        2, loaded, params.minRunners, params.maxRunners, params.countries, params.minIsp, params.maxIsp,
        params.sortOrder, params.minInIspRange, params.maxInIspRange, params.fromRow, params.toRow,
        params.minRaceTime, params.maxRaceTime, params.courses, params.goings, params.raceClasses,
        params.raceTypes, params.trainerSearch, params.jockeySearch, params.trainerFormMinWinRate,
        params.minTrainerFormRunners, params.maxTrainerFormRunners, params.runnerName,
        params.minModelWinProbability, params.onlyModelBeatsSp, params.modelVersionId
      );
      const elapsed = (Date.now() - start) / 1000;
      console.log(`[iter ${iteration}] OK in ${elapsed.toFixed(2)}s, got ${result.data.length} races`);
      if (result.data.length === 0) break;
      loaded += result.data.length;
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      console.error(`[iter ${iteration}] FAILED after ${elapsed.toFixed(2)}s at loaded=${loaded}:`, err);
      break;
    }
  }

  console.log(`Done. Final loaded=${loaded}/${totalRaces}`);
  await client.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
