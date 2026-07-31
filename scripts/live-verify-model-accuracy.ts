#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite (Jest,
// local-ci-e2e.sh, or otherwise). Post-deploy e2e check for the Model
// Accuracy screen (see ModelAccuracyScreen.tsx / model-accuracy-service.ts /
// the /api/model-accuracy route).
//
// READ-ONLY: issues GETs against the deployed API only. It never writes, and
// it touches no collection directly — every number it checks comes back
// through the real HTTP route, so a passing run proves the deployed
// aggregation itself is sound, not a local re-implementation of it.
//
// Checks arithmetic invariants rather than magic numbers, so it stays valid
// as the underlying data grows:
//   - all six price bands present, shortest first
//   - band runner counts and wins total the overall row
//   - pnl == returns - staked in every band
//   - the raw (overround-inclusive) market probability always exceeds the
//     de-overrounded one — if these ever match, de-overrounding has silently
//     stopped happening and the model-vs-market comparison is meaningless
//   - the route 401s without a token
//
// Usage (against the deployed API, real credentials):
//   API_BASE_URL=https://6fj7nh9mw6.execute-api.eu-west-2.amazonaws.com \
//   VERIFY_EMAIL=you@example.com VERIFY_PASSWORD=... \
//     npx ts-node scripts/live-verify-model-accuracy.ts
//
// Usage (against a local backend):
//   API_BASE_URL=http://localhost:3000 VERIFY_EMAIL=... VERIFY_PASSWORD=... \
//     npx ts-node scripts/live-verify-model-accuracy.ts

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const VERIFY_EMAIL = process.env.VERIFY_EMAIL || "";
const VERIFY_PASSWORD = process.env.VERIFY_PASSWORD || "";

const EXPECTED_LABELS = ["under 2.0", "2.0 – 3.0", "3.0 – 5.0", "5.0 – 10.0", "10.0 – 20.0", "20.0+"];

interface Band {
  bandKey: string;
  label: string;
  runners: number;
  wins: number;
  modelMeanProb: number;
  actualWinRate: number;
  marketMeanProbFair: number;
  marketMeanProbRaw: number;
  staked: number;
  returns: number;
  pnl: number;
  roiPercent: number;
  modelErrorPp: number;
  marketErrorPp: number;
  modelBrier: number;
  marketBrier: number;
}

let passed = 0;
let total = 0;

function check(label: string, ok: boolean, detail = ""): void {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ✗ UNEXPECTED: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function info(label: string): void {
  console.log(`  · ${label}`);
}

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: VERIFY_EMAIL, password: VERIFY_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed with ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("Login returned no token");
  return body.token;
}

async function main(): Promise<void> {
  console.log(`Verifying GET /api/model-accuracy against ${API_BASE_URL}\n`);

  if (!VERIFY_EMAIL || !VERIFY_PASSWORD) {
    console.error("VERIFY_EMAIL and VERIFY_PASSWORD are required — this route is auth-gated.");
    process.exit(1);
  }

  console.log("Auth gate:");
  const anon = await fetch(`${API_BASE_URL}/api/model-accuracy`);
  check("returns 401 without a token", anon.status === 401, `got ${anon.status}`);

  const token = await login();
  info("logged in");

  console.log("\nFetching bands:");
  const res = await fetch(`${API_BASE_URL}/api/model-accuracy`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check("returns 200 when authenticated", res.status === 200, `got ${res.status}`);
  const body = (await res.json()) as {
    success: boolean;
    data: Band[];
    count: number;
    overall: Band;
    coverage?: { eligibleRunners: number; scoredRunners: number; unscoredRunners: number; coveragePercent: number };
  };
  check("success is true", body.success === true);
  check("count matches data length", body.count === body.data.length, `${body.count} vs ${body.data.length}`);
  check(
    "all six bands present, shortest price first",
    JSON.stringify(body.data.map(b => b.label)) === JSON.stringify(EXPECTED_LABELS),
    body.data.map(b => b.label).join(" | ")
  );

  console.log("\nAggregation invariants:");
  const bandRunners = body.data.reduce((s, b) => s + b.runners, 0);
  const bandWins = body.data.reduce((s, b) => s + b.wins, 0);
  check("band runner counts total the overall row", bandRunners === body.overall.runners, `${bandRunners} vs ${body.overall.runners}`);
  check("band wins total the overall row", bandWins === body.overall.wins, `${bandWins} vs ${body.overall.wins}`);

  // Coverage arrived with the move to out-of-sample scoring. The banded
  // population must be exactly the runners the coverage line claims were
  // scored — if these drift apart, the sentence on the screen is describing a
  // different set of runners from the table beneath it.
  if (body.coverage) {
    check(
      "coverage scoredRunners equals the banded population",
      body.coverage.scoredRunners === body.overall.runners,
      `${body.coverage.scoredRunners} vs ${body.overall.runners}`
    );
    check(
      "unscored = eligible - scored",
      body.coverage.unscoredRunners === body.coverage.eligibleRunners - body.coverage.scoredRunners,
      JSON.stringify(body.coverage)
    );
    check(
      "some runners are genuinely unscored (the early years have no prior form)",
      body.coverage.unscoredRunners > 0,
      `unscored=${body.coverage.unscoredRunners} — if this is 0 over the full window, the OOS field may have been zero-filled`
    );
    info(`coverage: ${body.coverage.scoredRunners.toLocaleString()} of ${body.coverage.eligibleRunners.toLocaleString()} ` +
      `eligible runners scored out-of-sample (${body.coverage.coveragePercent}%)`);
  } else {
    info("no coverage block in the response — deployment predates out-of-sample scoring");
  }

  for (const band of [...body.data, body.overall]) {
    check(
      `pnl = returns - staked (${band.label})`,
      Math.abs(band.pnl - (band.returns - band.staked)) < 0.02,
      `${band.pnl} vs ${(band.returns - band.staked).toFixed(2)}`
    );
  }

  const populated = body.data.filter(b => b.runners > 0);
  if (populated.length === 0) {
    info("no scored runners returned — ml/walk_forward_score.py has not written modelWinProbabilityOos to this database yet, so the de-overround and calibration checks below are skipped");
  } else {
    console.log("\nDe-overrounding:");
    for (const band of populated) {
      check(
        `raw market % exceeds de-overrounded % (${band.label})`,
        band.marketMeanProbRaw > band.marketMeanProbFair,
        `${band.marketMeanProbRaw} vs ${band.marketMeanProbFair}`
      );
    }

    console.log("\nWhat the data actually says:");
    for (const band of populated) {
      const verdict =
        Math.abs(band.modelErrorPp) < Math.abs(band.marketErrorPp) ? "model closer" : "market closer";
      info(
        `${band.label.padEnd(12)} n=${String(band.runners).padStart(6)}  model ${band.modelMeanProb.toFixed(1)}%  actual ${band.actualWinRate.toFixed(1)}%  market ${band.marketMeanProbFair.toFixed(1)}%  → ${verdict}`
      );
    }
    info(
      `overall Brier — model ${body.overall.modelBrier.toFixed(4)}, market ${body.overall.marketBrier.toFixed(4)}`
    );
  }

  console.log(`\n${passed}/${total} checks passed.`);
  if (passed !== total) process.exit(1);
}

main().catch(err => {
  console.error("live-verify-model-accuracy failed:", err);
  process.exit(1);
});
