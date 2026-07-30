import {
  deriveStatus,
  synthNumericId,
  synthRunnerId,
  synthRaceId,
  toNullableInt,
  toNullableFloat,
  toNullableRating,
  parseWeightPounds,
  formatMeetingName,
} from "../industry-sp-row-mapping";

describe("deriveStatus", () => {
  it("maps position 1 to WINNER", () => {
    expect(deriveStatus("1")).toBe("WINNER");
  });

  it("maps positions 2 and 3 to PLACED", () => {
    expect(deriveStatus("2")).toBe("PLACED");
    expect(deriveStatus("3")).toBe("PLACED");
  });

  it("maps other numeric positions to LOSER", () => {
    expect(deriveStatus("4")).toBe("LOSER");
    expect(deriveStatus("20")).toBe("LOSER");
  });

  it("maps non-numeric positions (PU, F, UR, etc.) to NON_FINISHER", () => {
    expect(deriveStatus("PU")).toBe("NON_FINISHER");
    expect(deriveStatus("F")).toBe("NON_FINISHER");
    expect(deriveStatus("")).toBe("NON_FINISHER");
    expect(deriveStatus("  ")).toBe("NON_FINISHER");
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(deriveStatus(" 1 ")).toBe("WINNER");
  });
});

describe("synthNumericId / synthRunnerId / synthRaceId", () => {
  it("is deterministic for the same seed", () => {
    expect(synthNumericId("abc")).toBe(synthNumericId("abc"));
  });

  it("differs for different seeds", () => {
    expect(synthNumericId("abc")).not.toBe(synthNumericId("abd"));
  });

  it("synthRunnerId combines raceId and horse into one seed", () => {
    expect(synthRunnerId("rac_1", "Horse A")).toBe(synthNumericId("rac_1:Horse A"));
    expect(synthRunnerId("rac_1", "Horse A")).not.toBe(synthRunnerId("rac_1", "Horse B"));
  });

  it("synthRaceId hashes the raw id directly", () => {
    expect(synthRaceId("rac_12345")).toBe(synthNumericId("rac_12345"));
  });

  it("always returns a non-negative safe integer", () => {
    const id = synthNumericId("some-race-id-string");
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
  });
});

describe("toNullableInt", () => {
  it("parses a valid integer string", () => {
    expect(toNullableInt("42")).toBe(42);
  });

  it("returns null for blank/undefined input", () => {
    expect(toNullableInt("")).toBeNull();
    expect(toNullableInt("   ")).toBeNull();
    expect(toNullableInt(undefined)).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(toNullableInt("abc")).toBeNull();
  });
});

describe("toNullableFloat", () => {
  it("parses a valid float string", () => {
    expect(toNullableFloat("0.2")).toBeCloseTo(0.2);
  });

  it("returns null for blank input", () => {
    expect(toNullableFloat("")).toBeNull();
  });
});

describe("toNullableRating", () => {
  it("parses a valid rating", () => {
    expect(toNullableRating("54")).toBe(54);
  });

  it("treats en-dash and hyphen placeholders as null", () => {
    expect(toNullableRating("–")).toBeNull();
    expect(toNullableRating("-")).toBeNull();
  });

  it("treats empty string as null", () => {
    expect(toNullableRating("")).toBeNull();
  });
});

describe("parseWeightPounds", () => {
  it("converts stone-lb to total pounds", () => {
    expect(parseWeightPounds("11-12")).toBe(11 * 14 + 12);
    expect(parseWeightPounds("9-4")).toBe(9 * 14 + 4);
  });

  it("returns null for an unrecognized shape", () => {
    expect(parseWeightPounds("130")).toBeNull();
    expect(parseWeightPounds(undefined)).toBeNull();
  });
});

describe("formatMeetingName", () => {
  it("formats course + date into a display string", () => {
    expect(formatMeetingName("Ripon", "2026-07-27")).toBe("Ripon — 27 July 2026");
  });
});
