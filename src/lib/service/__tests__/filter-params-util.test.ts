import {
  parseFloatParam,
  clampPct,
  clampModelVsSpDateWindow,
  MODEL_VS_SP_MAX_SPAN_DAYS,
  MODEL_VS_SP_DEFAULT_MIN_DATE,
  MODEL_VS_SP_DEFAULT_MAX_DATE,
} from "../filter-params-util";

describe("parseFloatParam", () => {
  it("parses a plain number", () => {
    expect(parseFloatParam("42.5", 0)).toBe(42.5);
    expect(parseFloatParam("7", 0)).toBe(7);
  });

  // The whole reason this helper exists: `parseFloat(x) || fallback` (the idiom
  // used throughout router.ts) turns a legitimate 0 into the fallback, which
  // would silently widen /api/model-vs-sp's `minEdge=0` back to -100 and match
  // every runner instead of only the ones the model rates above the market.
  it("preserves an explicit zero instead of falling back", () => {
    expect(parseFloatParam("0", -100)).toBe(0);
    expect(parseFloatParam("0.0", 100)).toBe(0);
  });

  it("preserves a negative value", () => {
    expect(parseFloatParam("-12.5", 0)).toBe(-12.5);
  });

  it("falls back on blank, null, undefined and garbage", () => {
    expect(parseFloatParam("", 5)).toBe(5);
    expect(parseFloatParam("   ", 5)).toBe(5);
    expect(parseFloatParam(null, 5)).toBe(5);
    expect(parseFloatParam(undefined, 5)).toBe(5);
    expect(parseFloatParam("abc", 5)).toBe(5);
  });

  it("falls back on NaN and Infinity rather than passing them into a query", () => {
    expect(parseFloatParam("NaN", 5)).toBe(5);
    expect(parseFloatParam("Infinity", 5)).toBe(5);
    expect(parseFloatParam("-Infinity", 5)).toBe(5);
  });

  // parseFloat's own leniency is kept deliberately — it matches how every other
  // numeric param in router.ts behaves, so a trailing-junk value doesn't behave
  // differently here than it does on /api/industry-sp.
  it("keeps parseFloat's leading-number leniency", () => {
    expect(parseFloatParam("12abc", 0)).toBe(12);
  });
});

describe("clampPct", () => {
  it("passes an in-range percentage through untouched", () => {
    expect(clampPct(37.5)).toBe(37.5);
  });

  it("passes the 0 and 100 boundaries through", () => {
    expect(clampPct(0)).toBe(0);
    expect(clampPct(100)).toBe(100);
  });

  it("clamps below 0 and above 100", () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
  });
});

describe("clampModelVsSpDateWindow", () => {
  it("defaults to the configured window when both dates are absent", () => {
    const w = clampModelVsSpDateWindow(undefined, undefined);
    expect(w.minDate).toBe(MODEL_VS_SP_DEFAULT_MIN_DATE);
    expect(w.maxDate).toBe(MODEL_VS_SP_DEFAULT_MAX_DATE);
  });

  it("defaults when both dates are malformed", () => {
    const w = clampModelVsSpDateWindow("not-a-date", "2024/03/01");
    expect(w.minDate).toBe(MODEL_VS_SP_DEFAULT_MIN_DATE);
    expect(w.maxDate).toBe(MODEL_VS_SP_DEFAULT_MAX_DATE);
  });

  it("honours a valid range", () => {
    const w = clampModelVsSpDateWindow("2025-03-01", "2025-03-31");
    expect(w.minDate).toBe("2025-03-01");
    expect(w.maxDate).toBe("2025-03-31");
  });

  // A single supplied bound shouldn't be silently discarded in favour of the
  // default window — collapse to that one day instead.
  it("collapses to a single day when only one bound is supplied", () => {
    expect(clampModelVsSpDateWindow("2025-06-10", undefined)).toMatchObject({
      minDate: "2025-06-10",
      maxDate: "2025-06-10",
    });
    expect(clampModelVsSpDateWindow(undefined, "2025-06-10")).toMatchObject({
      minDate: "2025-06-10",
      maxDate: "2025-06-10",
    });
  });

  it("swaps an inverted range instead of returning an empty window", () => {
    const w = clampModelVsSpDateWindow("2025-12-31", "2025-01-01");
    expect(w.minDate).toBe("2025-01-01");
    expect(w.maxDate).toBe("2025-12-31");
  });

  it(`clamps a span wider than ${MODEL_VS_SP_MAX_SPAN_DAYS} days back to minDate plus the cap`, () => {
    const w = clampModelVsSpDateWindow("2020-01-01", "2026-12-31");
    expect(w.minDate).toBe("2020-01-01");
    expect(w.maxDate).toBe("2021-01-01"); // 2020 is a leap year: 366 days on
  });

  it("leaves a span exactly at the cap alone", () => {
    const w = clampModelVsSpDateWindow("2023-01-01", "2024-01-01"); // 365 days
    expect(w.maxDate).toBe("2024-01-01");
  });

  it("appends T23:59:59.999 to maxRaceTime, matching parseDateRangeParams", () => {
    const w = clampModelVsSpDateWindow("2024-02-01", "2024-02-29");
    expect(w.minRaceTime).toBe("2024-02-01");
    expect(w.maxRaceTime).toBe("2024-02-29T23:59:59.999");
  });

  it("keeps a same-day window inclusive of that whole day", () => {
    const w = clampModelVsSpDateWindow("2024-05-04", "2024-05-04");
    expect(w.minRaceTime).toBe("2024-05-04");
    expect(w.maxRaceTime).toBe("2024-05-04T23:59:59.999");
  });
});
