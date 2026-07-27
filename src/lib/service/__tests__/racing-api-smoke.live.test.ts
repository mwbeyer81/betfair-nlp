import { RacingApiClient } from "../racing-api-client";

// Hits the real RacingAPI (https://theracingapi.com) over the network with
// real credentials — not run by the default `npm test` sweep (see the
// `.live.test.ts` exclusion in jest.config.js). Run explicitly via:
//   npm run test:racing-api-live
//
// Credentials come from config/local.json (gitignored) or the
// RACINGAPI_USERNAME/RACINGAPI_PASSWORD env vars — never hardcode them here.
//
// As of writing, these credentials are on RacingAPI's Free plan: `courses`
// and `racecards/free` succeed, everything else (basic/standard/pro
// racecards, results) correctly 401s with a "<Tier> Plan required" body.
// The plan-gated assertions below tolerate either outcome so the suite
// keeps passing if the plan is later upgraded.
describe("RacingAPI smoke tests (live)", () => {
  const client = new RacingApiClient();

  beforeAll(() => {
    if (!client.hasCredentials()) {
      throw new Error(
        "RacingAPI credentials not configured — set racingApi.username/password in config/local.json " +
          "or RACINGAPI_USERNAME/RACINGAPI_PASSWORD env vars before running the live smoke suite."
      );
    }
  });

  it("rejects bad credentials with 401", async () => {
    const badAuth = "Basic " + Buffer.from("not-a-real-user:not-a-real-pass").toString("base64");
    const response = await fetch("https://api.theracingapi.com/v1/courses", {
      headers: { Authorization: badAuth },
    });
    const body = (await response.json()) as { detail: string };

    expect(response.status).toBe(401);
    expect(body.detail).toMatch(/incorrect (username|password)/i);
  });

  it("GET /courses returns a well-formed course list", async () => {
    const res = await client.get<{ courses: Array<Record<string, string>> }>("/courses");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.courses)).toBe(true);
    expect(res.body.courses.length).toBeGreaterThan(0);

    const course = res.body.courses[0];
    expect(typeof course.id).toBe("string");
    expect(typeof course.course).toBe("string");
    expect(typeof course.region_code).toBe("string");
    expect(typeof course.region).toBe("string");
  });

  it("GET /racecards/free returns well-formed racecards", async () => {
    const res = await client.get<{ racecards: Array<Record<string, unknown>> }>("/racecards/free");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.racecards)).toBe(true);

    // Racecard count depends on what's actually racing today, so only
    // assert on shape when there's at least one card to inspect.
    if (res.body.racecards.length > 0) {
      const racecard = res.body.racecards[0];
      expect(typeof racecard.race_id).toBe("string");
      expect(typeof racecard.course).toBe("string");
      expect(Array.isArray(racecard.runners)).toBe(true);

      const runners = racecard.runners as Array<Record<string, unknown>>;
      if (runners.length > 0) {
        const runner = runners[0];
        expect(typeof runner.horse).toBe("string");
        expect(typeof runner.horse_id).toBe("string");
        expect(typeof runner.trainer).toBe("string");
        expect(typeof runner.jockey).toBe("string");
      }
    }
  });

  it.each(["/racecards/basic", "/racecards/standard", "/racecards/pro", "/results/today"])(
    "GET %s is reachable and correctly gated by plan tier",
    async (path) => {
      const res = await client.get<{ detail?: string }>(path);

      if (res.status === 200) {
        // Plan has since been upgraded to include this endpoint.
        return;
      }
      expect(res.status).toBe(401);
      expect(res.body.detail).toMatch(/plan required/i);
    }
  );
});
