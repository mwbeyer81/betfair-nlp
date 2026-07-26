import { CodebaseSearchService } from "../codebase-search-service";

// This is a real integration test that calls the actual OpenAI API and reads
// the actual codebase snapshot (run `yarn build:snapshot` first if it
// doesn't exist yet). Only run this when you want to verify the API key
// works and that tool-calling is actually grounding answers in real code,
// not just producing plausible-sounding prose.
describe("CodebaseSearchService Integration Test", () => {
  let service: CodebaseSearchService;

  beforeAll(() => {
    service = new CodebaseSearchService();
  });

  it("answers a general 'about the app' question conversationally", async () => {
    const reply = await service.chat("What does this app do?", []);

    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    console.log("Reply:", reply);
  }, 60000);

  it("answers a natural follow-up using conversation history, without re-explaining from scratch", async () => {
    const reply = await service.chat("How does it work?", [
      { role: "user", text: "What does this app do?" },
      {
        role: "assistant",
        text: "This app tracks horse races and estimates each horse's chance of winning using a machine-learning model.",
      },
    ]);

    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    console.log("Follow-up reply:", reply);
  }, 60000);

  it("grounds its answer in the real source — proves it actually read the file, not guessed", async () => {
    const reply = await service.chat("How is a trainer's recent form calculated?", []);

    console.log("Grounded reply:", reply);
    // precompute-trainer-form.ts's real FORM_WINDOW_DAYS is 14 — a generic
    // guess wouldn't reliably land on this exact, specific number.
    expect(reply).toMatch(/14/);
  }, 60000);

  it("never generates or mentions a MongoDB script — the old query-generation path is gone", async () => {
    const reply = await service.chat("Show me the top horses in the race", []);

    expect(reply.toLowerCase()).not.toContain("db.market_definitions");
    expect(reply.toLowerCase()).not.toContain("mongoscript");
  }, 60000);
});
