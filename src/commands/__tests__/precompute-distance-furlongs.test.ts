import { parseDistanceFurlongs } from "../precompute-distance-furlongs";

describe("parseDistanceFurlongs", () => {
  // The formats below are drawn from the real distinct values in production —
  // all 110,226 races parsed, 100%, when this ran on 2026-08-14.
  it.each([
    ["5f", 5],
    ["6f", 6],
    ["1m", 8],
    ["1m1f", 9],
    ["1m3f", 11],
    ["1m4f", 12],
    ["2m", 16],
    ["3m", 24],
  ])("parses %s as %d furlongs", (input, expected) => {
    expect(parseDistanceFurlongs(input)).toBe(expected);
  });

  it.each([
    ["1m½f", 8.5],
    ["1m2½f", 10.5],
    ["1m3½f", 11.5],
    ["2m4½f", 20.5],
  ])("handles the half-furlong glyph: %s -> %s", (input, expected) => {
    // A full-width "½", not "1/2" — the reason this is parsed once here rather
    // than per query in aggregation operators.
    expect(parseDistanceFurlongs(input)).toBe(expected);
  });

  it("returns null for absent or empty input rather than 0", () => {
    // 0 would be a real distance and would match `maxDistanceFurlongs=1`.
    expect(parseDistanceFurlongs(null)).toBeNull();
    expect(parseDistanceFurlongs(undefined)).toBeNull();
    expect(parseDistanceFurlongs("")).toBeNull();
    expect(parseDistanceFurlongs("   ")).toBeNull();
  });

  it("returns null for an unrecognised format", () => {
    expect(parseDistanceFurlongs("bogus")).toBeNull();
    expect(parseDistanceFurlongs("1km")).toBeNull();
    expect(parseDistanceFurlongs("about 5f")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDistanceFurlongs("  1m2f  ")).toBe(10);
  });

  it("agrees with ml/train_and_predict.py's own docstring examples", () => {
    // "'5f' -> 5.0, '1m3f' -> 11.0, '2m4½f' -> 20.5, '1m' -> 8.0, '1m½f' -> 8.5"
    expect([
      parseDistanceFurlongs("5f"),
      parseDistanceFurlongs("1m3f"),
      parseDistanceFurlongs("2m4½f"),
      parseDistanceFurlongs("1m"),
      parseDistanceFurlongs("1m½f"),
    ]).toEqual([5, 11, 20.5, 8, 8.5]);
  });
});
