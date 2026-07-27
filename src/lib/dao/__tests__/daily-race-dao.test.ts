import { Db } from "mongodb";
import { DailyRaceDAO, DailyRaceDoc, deriveDailyRaceEventId, mapRacecardToDoc } from "../daily-race-dao";

function makeDoc(overrides: Partial<DailyRaceDoc> = {}): DailyRaceDoc {
  return {
    _id: "rac_1",
    raceId: "rac_1",
    eventId: "newton-abbot-2026-06-03",
    course: "Newton Abbot",
    date: "2026-06-03",
    offTime: "1:50",
    offDt: "2026-06-03T13:50:00+01:00",
    raceName: "Novices' Hurdle",
    distanceF: "16.0",
    region: "GB",
    raceClass: "Class 4",
    type: "Hurdle",
    ageBand: "4yo+",
    prize: "£3,769",
    fieldSize: "1",
    going: "Good",
    surface: "Turf",
    runners: [],
    ingestedAt: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveDailyRaceEventId", () => {
  it("slugifies course + date", () => {
    expect(deriveDailyRaceEventId("Newton Abbot", "2026-06-03")).toBe("newton-abbot-2026-06-03");
  });

  it("strips punctuation and collapses repeated separators", () => {
    expect(deriveDailyRaceEventId("Ffos Las (Wales)", "2026-06-03")).toBe("ffos-las-wales-2026-06-03");
  });
});

describe("mapRacecardToDoc", () => {
  it("maps RacingAPI snake_case fields to our camelCase shape", () => {
    const doc = mapRacecardToDoc({
      race_id: "rac_1",
      course: "Newton Abbot",
      date: "2026-06-03",
      off_time: "1:50",
      off_dt: "2026-06-03T13:50:00+01:00",
      race_name: "Novices' Hurdle",
      distance_f: "16.0",
      runners: [{ horse_id: "hrs_1", horse: "Fixture Star", trainer: "A Trainer", jockey: "B Jockey" }],
    });
    expect(doc._id).toBe("rac_1");
    expect(doc.eventId).toBe("newton-abbot-2026-06-03");
    expect(doc.distanceF).toBe("16.0");
    expect(doc.runners).toHaveLength(1);
    expect(doc.runners[0]).toMatchObject({ runnerId: "hrs_1", horse: "Fixture Star", trainer: "A Trainer" });
  });

  it("maps blank/absent optional fields to null, not empty string", () => {
    const doc = mapRacecardToDoc({ race_id: "rac_1", course: "X", date: "2026-06-03", runners: [] });
    expect(doc.raceClass).toBeNull();
    expect(doc.going).toBeNull();
  });
});

describe("DailyRaceDAO.bulkUpsertRaces", () => {
  it("upserts each doc by _id via bulkWrite", async () => {
    const bulkWrite = jest.fn().mockResolvedValue({});
    const collection = { bulkWrite };
    const db = { collection: jest.fn().mockReturnValue(collection) } as unknown as Db;
    const dao = new DailyRaceDAO(db);

    const docs = [makeDoc(), makeDoc({ _id: "rac_2", raceId: "rac_2" })];
    await dao.bulkUpsertRaces(docs);

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops).toEqual([
      { replaceOne: { filter: { _id: "rac_1" }, replacement: docs[0], upsert: true } },
      { replaceOne: { filter: { _id: "rac_2" }, replacement: docs[1], upsert: true } },
    ]);
    expect(bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
  });

  it("is a no-op for an empty array — never calls bulkWrite", async () => {
    const bulkWrite = jest.fn();
    const db = { collection: jest.fn().mockReturnValue({ bulkWrite }) } as unknown as Db;
    const dao = new DailyRaceDAO(db);

    await dao.bulkUpsertRaces([]);

    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
