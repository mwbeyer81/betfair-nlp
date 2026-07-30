import { buildEdgeSummary, EDGE_BAND_BOUNDS, RawEdgeBandCounts } from "../model-vs-sp-summary";

// EDGE_BAND_BOUNDS is [2, 5, 10, 20, 50], so six bands:
//   0: within ±2      1: ±2 to ±5     2: ±5 to ±10
//   3: ±10 to ±20     4: ±20 to ±50   5: beyond ±50
function raw(overrides: Partial<RawEdgeBandCounts> = {}): RawEdgeBandCounts {
  return {
    allRunners: 100,
    matchedRunners: 100,
    sumAbsEdge: 528,
    bandCounts: [40, 25, 20, 10, 4, 1],
    ...overrides,
  };
}

describe("buildEdgeSummary", () => {
  it("labels every band, including the open-ended last one", () => {
    const { bands } = buildEdgeSummary(raw());
    expect(bands.map(b => b.label)).toEqual([
      "within ±2 pts",
      "±2 to ±5 pts",
      "±5 to ±10 pts",
      "±10 to ±20 pts",
      "±20 to ±50 pts",
      "beyond ±50 pts",
    ]);
  });

  it("emits one band per bound plus the open-ended tail", () => {
    const { bands } = buildEdgeSummary(raw());
    expect(bands).toHaveLength(EDGE_BAND_BOUNDS.length + 1);
    expect(bands[0].minAbs).toBe(0);
    expect(bands[0].maxAbs).toBe(2);
    expect(bands[bands.length - 1].maxAbs).toBeNull();
    expect(bands[bands.length - 1].minAbs).toBe(50);
  });

  it("computes each band's own share of all runners", () => {
    const { bands } = buildEdgeSummary(raw());
    expect(bands.map(b => b.percent)).toEqual([40, 25, 20, 10, 4, 1]);
  });

  // The headline number the user asked for: "what percentage of runners is the
  // model within ±10 points of?"
  it("accumulates each band's share with every narrower band", () => {
    const { bands } = buildEdgeSummary(raw());
    expect(bands[0].cumulativePercent).toBe(40); // within ±2
    expect(bands[1].cumulativePercent).toBe(65); // within ±5
    expect(bands[2].cumulativePercent).toBe(85); // within ±10
    expect(bands[3].cumulativePercent).toBe(95); // within ±20
    expect(bands[4].cumulativePercent).toBe(99); // within ±50
  });

  // It would always be 100 by definition, and showing "100%" next to the tail
  // band reads as though everything is in it.
  it("leaves the open-ended band's cumulative share null", () => {
    const { bands } = buildEdgeSummary(raw());
    expect(bands[bands.length - 1].cumulativePercent).toBeNull();
  });

  it("reports the matched share against the unfiltered population", () => {
    const summary = buildEdgeSummary(raw({ allRunners: 200, matchedRunners: 50 }));
    expect(summary.allRunners).toBe(200);
    expect(summary.matchedRunners).toBe(50);
    expect(summary.matchedPercent).toBe(25);
  });

  it("computes the mean absolute gap", () => {
    expect(buildEdgeSummary(raw({ allRunners: 100, sumAbsEdge: 528 })).meanAbsEdge).toBe(5.3);
  });

  it("rounds percentages and the mean to one decimal place", () => {
    const summary = buildEdgeSummary(raw({ allRunners: 3, matchedRunners: 1, sumAbsEdge: 10, bandCounts: [1, 1, 1, 0, 0, 0] }));
    expect(summary.matchedPercent).toBe(33.3);
    expect(summary.bands[0].percent).toBe(33.3);
    expect(summary.bands[1].cumulativePercent).toBe(66.7);
    expect(summary.meanAbsEdge).toBe(3.3);
  });

  // An empty result set is an ordinary state here (the summary renders before the
  // user narrows anything), so every percentage must be 0 — a NaN would reach the
  // UI as the literal string "NaN%".
  it("returns zeroes rather than NaN when nothing matches", () => {
    const summary = buildEdgeSummary({ allRunners: 0, matchedRunners: 0, sumAbsEdge: 0, bandCounts: [0, 0, 0, 0, 0, 0] });
    expect(summary.matchedPercent).toBe(0);
    expect(summary.meanAbsEdge).toBe(0);
    expect(summary.bands.every(b => b.percent === 0)).toBe(true);
    expect(summary.bands.slice(0, -1).every(b => b.cumulativePercent === 0)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("null,\"meanAbsEdge\":null");
    expect(Number.isNaN(summary.meanAbsEdge)).toBe(false);
  });

  it("handles every runner sitting in the open-ended tail", () => {
    const summary = buildEdgeSummary(raw({ allRunners: 10, matchedRunners: 10, bandCounts: [0, 0, 0, 0, 0, 10] }));
    expect(summary.bands[4].cumulativePercent).toBe(0);
    expect(summary.bands[5].percent).toBe(100);
  });

  // Defensive rather than aspirational: a mismatch means the aggregation and this
  // module have drifted, and a summary bug must never take the list down with it.
  it("pads a short bandCounts array instead of throwing", () => {
    const summary = buildEdgeSummary(raw({ bandCounts: [40, 25] }));
    expect(summary.bands).toHaveLength(EDGE_BAND_BOUNDS.length + 1);
    expect(summary.bands[2].count).toBe(0);
    expect(summary.bands[5].count).toBe(0);
  });

  it("truncates an over-long bandCounts array instead of throwing", () => {
    const summary = buildEdgeSummary(raw({ bandCounts: [1, 2, 3, 4, 5, 6, 7, 8] }));
    expect(summary.bands).toHaveLength(EDGE_BAND_BOUNDS.length + 1);
    expect(summary.bands[5].count).toBe(6);
  });
});
