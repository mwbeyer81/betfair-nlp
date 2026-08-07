#!/usr/bin/env ts-node

// Smoke-tests the DEPLOYED app (https://app.backbet.co.uk by default) in a real
// browser and prints why it is broken, rather than just that it is.
//
// Written for a white-screen report: the HTML and the JS bundle both returned
// 200, so `curl` said everything was fine while users saw nothing. A white
// screen with a hanging loading bar is almost always one of
//   - a runtime exception thrown before React's first paint (bundle loads,
//     nothing renders),
//   - a request that never settles, holding the browser's loading indicator
//     blue forever, or
//   - an asset 404 for a chunk the entry bundle imports.
// None of those are visible without a browser, so this drives one and reports
// console errors, uncaught exceptions, failed requests, requests still in
// flight at timeout, and whether anything actually painted.
//
// DELIBERATELY read-only and unauthenticated: it only visits public routes and
// never logs in, places a bet, or POSTs anything. Safe to run against
// production at any time, including during an incident.
//
// Usage:
//   cd client && npx ts-node ../scripts/prod-smoke.ts
//   APP_URL=https://app.backbet.co.uk npx ts-node ../scripts/prod-smoke.ts
//   ROUTES=/isp,/results npx ts-node ../scripts/prod-smoke.ts
//
// Exits non-zero if any route fails, so it can gate a deploy.

import * as path from "path";

// Playwright lives in client/node_modules, not at the repo root, and Node
// resolves from THIS file's directory — so point it at the client explicitly
// rather than depending on the cwd the script happens to be run from.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require(require.resolve("playwright", {
  paths: [path.join(__dirname, "..", "client")],
}));

const APP_URL = (process.env.APP_URL ?? "https://app.backbet.co.uk").replace(/\/$/, "");
const ROUTES = (process.env.ROUTES ?? "/,/isp,/results,/daily-races,/model-accuracy")
  .split(",")
  .map(r => r.trim())
  .filter(Boolean);
// Long enough that a slow cold Lambda is not mistaken for a hang, short enough
// that a real hang does not stall the whole run.
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 45000);
// After load, how long to keep watching for late errors and unsettled requests
// — the blue-bar symptom is precisely a request that never finishes, so the
// interesting evidence arrives AFTER the navigation promise resolves.
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 8000);

interface RouteReport {
  route: string;
  httpStatus: number | null;
  painted: boolean;
  visibleChars: number;
  buildCommit: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; failure: string }[];
  badResponses: { url: string; status: number }[];
  pendingAtTimeout: string[];
  navError: string | null;
}

function short(url: string): string {
  return url.length > 110 ? `${url.slice(0, 107)}...` : url;
}

async function checkRoute(browser: unknown, route: string): Promise<RouteReport> {
  const context = await (browser as { newContext: Function }).newContext({
    // A real iOS-ish viewport: the report came from an iOS browser, and a
    // layout/pointer bug that only fires on a narrow viewport would be missed
    // at desktop width.
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  const report: RouteReport = {
    route,
    httpStatus: null,
    painted: false,
    visibleChars: 0,
    buildCommit: null,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    pendingAtTimeout: [],
    navError: null,
  };

  const inFlight = new Map<string, number>();

  page.on("console", (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });
  // An uncaught exception during module evaluation or the first render is the
  // single most likely cause of a white screen, and it never appears in the
  // network tab.
  page.on("pageerror", (err: Error) => {
    report.pageErrors.push(`${err.name}: ${err.message}`);
  });
  page.on("request", (req: { url: () => string }) => {
    inFlight.set(req.url(), Date.now());
  });
  page.on("requestfinished", (req: { url: () => string }) => inFlight.delete(req.url()));
  page.on("requestfailed", (req: { url: () => string; failure: () => { errorText: string } | null }) => {
    inFlight.delete(req.url());
    report.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? "unknown" });
  });
  page.on("response", (res: { url: () => string; status: () => number }) => {
    if (res.status() >= 400) report.badResponses.push({ url: res.url(), status: res.status() });
  });

  try {
    // "commit" not "networkidle": networkidle never resolves on a page whose
    // symptom IS a request that never settles, which would turn the diagnostic
    // into the same hang it is trying to diagnose.
    const response = await page.goto(`${APP_URL}${route}`, {
      waitUntil: "commit",
      timeout: NAV_TIMEOUT_MS,
    });
    report.httpStatus = response ? response.status() : null;
    await page.waitForTimeout(SETTLE_MS);

    report.buildCommit = await page
      .locator('meta[name="build-commit"]')
      .getAttribute("content")
      .catch(() => null);

    // "Did anything paint?" — innerText of body, which is empty on a white
    // screen even though the DOM has a root div and the bundle has run.
    //
    // Passed as a source string rather than a closure: this file compiles
    // under the backend tsconfig, which has no "dom" lib, so a closure
    // referencing `document` fails to typecheck even though it only ever runs
    // inside the browser.
    const text: string = await page.evaluate(
      "document.body ? (document.body.innerText || '').trim() : ''"
    );
    report.visibleChars = text.length;
    report.painted = text.length > 0;
  } catch (err) {
    report.navError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  report.pendingAtTimeout = [...inFlight.keys()];
  await context.close();
  return report;
}

function printReport(r: RouteReport): boolean {
  const ok =
    r.navError == null && r.painted && r.pageErrors.length === 0 && r.httpStatus === 200;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${r.route}`);
  console.log(`   http ${r.httpStatus ?? "-"}   painted ${r.painted ? "yes" : "NO"} (${r.visibleChars} visible chars)   build ${r.buildCommit ?? "-"}`);
  if (r.navError) console.log(`   navigation error: ${r.navError}`);
  for (const e of r.pageErrors) console.log(`   UNCAUGHT: ${e}`);
  for (const e of r.consoleErrors.slice(0, 8)) console.log(`   console.error: ${e.slice(0, 240)}`);
  if (r.consoleErrors.length > 8) console.log(`   ...and ${r.consoleErrors.length - 8} more console errors`);
  for (const f of r.failedRequests.slice(0, 8)) console.log(`   request FAILED (${f.failure}): ${short(f.url)}`);
  for (const b of r.badResponses.slice(0, 8)) console.log(`   response ${b.status}: ${short(b.url)}`);
  for (const p of r.pendingAtTimeout.slice(0, 8)) console.log(`   still in flight after ${SETTLE_MS}ms: ${short(p)}`);
  if (r.pendingAtTimeout.length > 8) console.log(`   ...and ${r.pendingAtTimeout.length - 8} more pending`);
  return ok;
}

/**
 * The failure a browser-based smoke test cannot see, because it always fetches
 * a FRESH index.html and therefore always asks for a bundle that exists.
 *
 * Every deploy prunes the previous build's hashed bundle (apps/web/deploy.sh's
 * third step, `sync --delete`). Meanwhile the CDN serves index.html as the
 * SPA fallback for any unmatched path — INCLUDING .js. So a client still
 * holding a stale index.html (an iOS in-app webview cache, the back-forward
 * cache, an open tab that reloads) requests the old hash and receives HTML with
 * a 200 and `content-type: text/html`. The browser parses it as JavaScript,
 * dies on `Unexpected token '<'`, and paints nothing: a white screen with no
 * failed request anywhere in the network tab to explain it.
 *
 * A missing bundle must therefore 404 rather than 200 with HTML — that is what
 * makes the failure detectable instead of silent.
 */
async function checkMissingAssetIs404(): Promise<boolean> {
  const url = `${APP_URL}/_expo/static/js/web/index-smoke-test-does-not-exist.js`;
  const res = await fetch(url);
  const contentType = res.headers.get("content-type") ?? "";
  const servesHtml = contentType.includes("text/html");
  const ok = res.status === 404 || !servesHtml;

  console.log(`\n${ok ? "PASS" : "FAIL"}  missing bundle returns an error, not the SPA fallback`);
  console.log(`   ${url.replace(APP_URL, "")}`);
  console.log(`   status ${res.status}   content-type ${contentType || "-"}`);
  if (!ok) {
    console.log("   A stale index.html on a user's device asks for a bundle hash this");
    console.log("   deploy has already pruned. It gets HTML back with a 200, tries to run");
    console.log("   it as JavaScript, and dies on: SyntaxError: Unexpected token '<'.");
    console.log("   Symptom: white screen, loading bar that never completes, and NOTHING");
    console.log("   red in the network tab. Exclude /_expo/static/** from the SPA");
    console.log("   fallback so it 404s, and/or stop pruning the previous build's assets.");
  }
  return ok;
}

async function run(): Promise<void> {
  console.log(`Smoke-testing ${APP_URL}`);
  console.log(`routes: ${ROUTES.join(", ")}   nav timeout ${NAV_TIMEOUT_MS}ms   settle ${SETTLE_MS}ms`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let failures = 0;
  try {
    for (const route of ROUTES) {
      const report = await checkRoute(browser, route);
      if (!printReport(report)) failures++;
    }
  } finally {
    await browser.close();
  }

  const checks = ROUTES.length + 1;
  if (!(await checkMissingAssetIs404())) failures++;

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) process.exit(1);
}

run().catch(err => {
  console.error("prod-smoke failed to run:", err);
  process.exit(1);
});
