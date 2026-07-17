import { test, expect } from "@playwright/test";

const BASE_URL = "https://app.backbet.co.uk";

// app.backbet.co.uk is deployed by apps/web/deploy.sh, which always builds
// from a worktree pinned to origin/develop and stamps the branch + commit it
// built from into <meta> tags on index.html. This confirms the site is
// actually serving a `develop` build and not a stale or wrong-branch deploy.
test.describe("app.backbet.co.uk — branch verification", () => {
  test("index.html reports build-branch=develop", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();

    const branchMatch = html.match(/<meta name="build-branch" content="([^"]+)"/);
    expect(
      branchMatch,
      "expected a build-branch meta tag in index.html — was this deployed via apps/web/deploy.sh?"
    ).not.toBeNull();
    expect(branchMatch![1]).toBe("develop");

    const commitMatch = html.match(/<meta name="build-commit" content="([^"]+)"/);
    expect(commitMatch).not.toBeNull();
    expect(commitMatch![1]).toMatch(/^[0-9a-f]{7,40}$/);
  });
});
