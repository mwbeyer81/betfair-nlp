import { test, expect } from "@playwright/test";

const BASE_URL = "https://app.backbet.co.uk";

// The header build badge (AppHeader.tsx) renders the commit that
// `apps/web/deploy.sh` stamped into index.html as
// <meta name="build-commit">. That makes it an end-to-end check on the whole
// deploy path rather than just a cosmetic assertion: the badge is drawn by the
// JS bundle S3 is serving, the meta tag is written by the deploy script, and
// the two can only agree if the bundle CloudFront handed us came from the same
// deploy as the index.html that referenced it. A stale bundle surviving behind
// a fresh index.html — the exact failure mode the three-step S3 sync in
// deploy.sh exists to prevent — shows up here as a mismatch.
//
// Set EXPECTED_COMMIT to pin the assertion to a specific deploy:
//   EXPECTED_COMMIT=$(git rev-parse --short HEAD) yarn test:live --grep "build badge"
// Left unset, the test still verifies badge/meta agreement, so it stays
// meaningful as a permanent regression test on later deploys.
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT?.trim();

test.describe("app.backbet.co.uk — header build badge", () => {
  test("badge shows the commit stamped into index.html by the deploy", async ({
    page,
    request,
  }) => {
    // Read the stamp straight from the served HTML first — this is the
    // deploy script's own record of what it shipped.
    const response = await request.get(`${BASE_URL}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();

    const metaMatch = html.match(
      /<meta name="build-commit" content="([^"]+)"/
    );
    expect(
      metaMatch,
      "no build-commit meta tag in index.html — was this deployed via apps/web/deploy.sh?"
    ).not.toBeNull();
    const metaCommit = metaMatch![1];
    expect(metaCommit).toMatch(/^[0-9a-f]{7,40}$/);

    // /isp is the one screen that renders anonymously, so the shared header
    // is reachable here without a login round-trip.
    await page.goto(`${BASE_URL}/isp`);

    const badge = page.getByTestId("industry-sp-build-badge");
    await expect(badge).toBeVisible({ timeout: 30000 });

    const badgeText = (await badge.textContent())?.trim() ?? "";
    expect(badgeText).toMatch(/^build [0-9a-f]{7,40}$/);

    // The rendered bundle and the served index.html must describe the same
    // deploy.
    const badgeCommit = badgeText.replace(/^build /, "");
    expect(
      badgeCommit,
      `badge says "${badgeCommit}" but index.html says "${metaCommit}" — served bundle and index.html are from different deploys`
    ).toBe(metaCommit);

    if (EXPECTED_COMMIT) {
      expect(
        badgeCommit,
        `expected the live site to be serving ${EXPECTED_COMMIT}, but it is serving ${badgeCommit}`
      ).toBe(EXPECTED_COMMIT);
    }
  });

  test("badge is present on a second screen, confirming it is in the shared header", async ({
    page,
  }) => {
    // AppHeader namespaces every testID by screen, so finding the badge under
    // a second prefix proves it comes from the shared header component rather
    // than being a one-off addition to the /isp screen. Same
    // ?email=&password= bookmarked-access login the other live specs use, so
    // /chat renders past the login wall.
    await page.goto(`${BASE_URL}/isp`);
    await expect(page.getByTestId("industry-sp-build-badge")).toBeVisible({
      timeout: 30000,
    });

    await page.goto(
      `${BASE_URL}/chat?email=matthew%40backbet.co.uk&password=beyer`
    );
    await expect(page.getByTestId("chat-build-badge")).toBeVisible({
      timeout: 30000,
    });
  });
});
