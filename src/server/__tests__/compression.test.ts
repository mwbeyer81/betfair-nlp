import express from "express";
import compression from "compression";
import request from "supertest";

// Standalone from app.test.ts's mocked-DAO app: that mock's fixed shared
// response shape is too small (well under compression's default 1KB
// threshold) to actually exercise gzip either way, so this mounts the same
// compression() middleware app.ts/handler.ts use in isolation against a
// deliberately large payload — the real-world trigger (confirmed live: a
// 640-race /api/industry-sp page came back ~5MB with no Content-Encoding
// header at all, before this fix — see the isp-response-compression entry
// in AGENTS.md).
describe("compression middleware", () => {
  const app = express();
  app.use(compression());
  app.get("/big", (_req, res) => {
    // ~50KB of repetitive JSON — comfortably over the default 1KB
    // threshold, and repetitive enough that gzip's size reduction is
    // obviously non-trivial if it ran at all.
    const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: "Repetitive Race Name", isp: 5 }));
    res.json({ success: true, data });
  });
  app.get("/small", (_req, res) => {
    res.json({ success: true, data: [] });
  });

  it("compresses a large JSON response when the client accepts gzip", async () => {
    const response = await request(app).get("/big").set("Accept-Encoding", "gzip");
    expect(response.headers["content-encoding"]).toBe("gzip");
  });

  it("does not compress a response under the default threshold", async () => {
    const response = await request(app).get("/small").set("Accept-Encoding", "gzip");
    expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("skips compression when the client doesn't advertise support", async () => {
    const response = await request(app).get("/big").set("Accept-Encoding", "identity");
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.body.data).toHaveLength(1000);
  });
});
