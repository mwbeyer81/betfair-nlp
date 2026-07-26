import { tagComment } from "../comment-lexicon";

const NEUTRAL = {
  hasTroubleInRunning: false,
  hasTravelledWell: false,
  hasWeakened: false,
  hasGreenness: false,
};

describe("tagComment", () => {
  it("returns null excuseScore and all-false tags for null/undefined/empty input", () => {
    expect(tagComment(null)).toEqual({ ...NEUTRAL, excuseScore: null });
    expect(tagComment(undefined)).toEqual({ ...NEUTRAL, excuseScore: null });
    expect(tagComment("")).toEqual({ ...NEUTRAL, excuseScore: null });
    expect(tagComment("   ")).toEqual({ ...NEUTRAL, excuseScore: null });
  });

  it("returns excuseScore 0 (not null) for a present but neutral comment", () => {
    expect(tagComment("Raced in mid-division throughout")).toEqual({ ...NEUTRAL, excuseScore: 0 });
  });

  it("detects trouble-in-running phrases with excuseScore 2", () => {
    expect(tagComment("Hampered leaving the stalls")).toEqual({
      ...NEUTRAL,
      hasTroubleInRunning: true,
      excuseScore: 2,
    });
    expect(tagComment("Checked 2 out")).toEqual({ ...NEUTRAL, hasTroubleInRunning: true, excuseScore: 2 });
    expect(tagComment("Carried wide on the turn")).toEqual({
      ...NEUTRAL,
      hasTroubleInRunning: true,
      excuseScore: 2,
    });
  });

  it("detects travelled-well phrases with excuseScore -2", () => {
    expect(tagComment("Travelled strongly into the lead")).toEqual({
      ...NEUTRAL,
      hasTravelledWell: true,
      excuseScore: -2,
    });
  });

  it("detects weakened phrases with excuseScore 1", () => {
    expect(tagComment("No extra close home")).toEqual({ ...NEUTRAL, hasWeakened: true, excuseScore: 1 });
    expect(tagComment("One paced final furlong")).toEqual({ ...NEUTRAL, hasWeakened: true, excuseScore: 1 });
    expect(tagComment("Faded into fourth")).toEqual({ ...NEUTRAL, hasWeakened: true, excuseScore: 1 });
  });

  it("detects green/inexperience phrases with excuseScore 1", () => {
    expect(tagComment("Led approaching next - hung left - pushed out")).toEqual({
      ...NEUTRAL,
      hasGreenness: true,
      excuseScore: 1,
    });
    expect(tagComment("Green in front, needs to settle")).toEqual({
      ...NEUTRAL,
      hasGreenness: true,
      excuseScore: 1,
    });
    expect(tagComment("Reluctant to go past")).toEqual({ ...NEUTRAL, hasGreenness: true, excuseScore: 1 });
  });

  it("does NOT treat 'held up' (neutral early positioning) as weakened", () => {
    expect(tagComment("Held up until progress after 3 out")).toEqual({ ...NEUTRAL, excuseScore: 0 });
  });

  it("is case-insensitive", () => {
    expect(tagComment("HAMPERED early")).toEqual({ ...NEUTRAL, hasTroubleInRunning: true, excuseScore: 2 });
    expect(tagComment("Travelled Well throughout")).toEqual({
      ...NEUTRAL,
      hasTravelledWell: true,
      excuseScore: -2,
    });
  });

  it("combines categories additively/subtractively rather than first-match-wins", () => {
    expect(tagComment("Hampered early - travelled strongly thereafter")).toEqual({
      ...NEUTRAL,
      hasTroubleInRunning: true,
      hasTravelledWell: true,
      excuseScore: 0,
    });
  });

  it("tags real sampled Racing Post comments correctly", () => {
    expect(
      tagComment(
        "Chased leaders in 4th until took closer order in 3rd 4 out - pressed leader in 2nd until led after 3 out until joined last - soon headed and no extra with winner closing stages(op 4/1)"
      )
    ).toEqual({ ...NEUTRAL, hasWeakened: true, excuseScore: 1 });

    expect(tagComment("Tracked leaders - effort 3 out - led approaching next - hung left - pushed out(op 1/2)")).toEqual(
      { ...NEUTRAL, hasGreenness: true, excuseScore: 1 }
    );
  });

  it("does not let odds notation like '(op 4/1)' spuriously match any category", () => {
    expect(tagComment("Always in rear - never a factor - pulled up before 2 out(op 4/1)")).toEqual({
      ...NEUTRAL,
      hasWeakened: true,
      excuseScore: 1,
    });
  });
});
