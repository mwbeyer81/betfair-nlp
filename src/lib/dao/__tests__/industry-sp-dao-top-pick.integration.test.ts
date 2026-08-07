import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = `betfair_nlp_test_top_pick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Seed arithmetic, worked by hand so every expectation below is checkable
// rather than snapshotted. modelWinProbabilityOos is the field every model
// filter reads (see MODEL_PROB_FIELD).
//
// RACE 1 — 3 runners. Model likes B most.
//   A isp 2.0  model 30      B isp 6.0  model 50 (TOP PICK, and it WINS)
//   C isp 11.0 model 20
//
// RACE 2 — 3 runners. The model's favourite is a LOSER, and the runner it
//   rates highest is also the shortest price, so top-pick and market-favourite
//   coincide here (they do not in race 1 — that divergence is the point).
//   D isp 3.0  model 60 (TOP PICK, LOSES)   E isp 4.0 model 25 (WINS)
//   F isp 9.0  model 15
//
// RACE 3 — 3 runners, and the model's highest-rated runner is a NON-RUNNER
//   (no isp). The top pick must fall to the best BACKABLE runner, H, rather
//   than the race dropping out of the selection entirely.
//   G no isp   model 70      H isp 5.0  model 20 (TOP PICK, WINS)
//   I isp 8.0  model 10
//
// RACE 4 — a TIE at the top. Both J and K must be kept: a dead heat in the
//   model's opinion, and breaking it arbitrarily would make the result depend
//   on document order.
//   J isp 4.0 model 40 (WINS)   K isp 6.0 model 40   L isp 10.0 model 20
//
// TOP-PICK SELECTION = B, D, H, J, K  (5 runners over 4 races)
//   level:  staked 5, returns = 6.0 (B) + 5.0 (H) + 4.0 (J) = 15.0
//           pnl +10.0  ->  ROI +200%
//   to-win: stakes 1/(isp-1) = B 0.2, D 0.5, H 0.25, J 0.3333.., K 0.2
//           staked = 1.48333..
//           returns = (0.2+1) + (0.25+1) + (0.33333+1) = 3.78333..
//           pnl +2.3  ->  ROI ~155%
// Deliberately profitable so a filter that silently fell through to "every
// runner" (which loses here) cannot accidentally produce the same numbers.

function runner(
  id: number,
  name: string,
  isp: number | null,
  model: number | null,
  status: "WINNER" | "LOSER"
) {
  return {
    id,
    name,
    num: id,
    ...(isp == null ? {} : { isp }),
    status,
    modelWinProbabilityOos: model,
    modelWinProbability: model,
  };
}

const RACES = [
  {
    _id: 1, raceId: 1, raceDate: "2024-01-01", raceTime: "2024-01-01T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 3,
    runners: [
      runner(11, "A", 2.0, 30, "LOSER"),
      runner(12, "B", 6.0, 50, "WINNER"),
      runner(13, "C", 11.0, 20, "LOSER"),
    ],
  },
  {
    _id: 2, raceId: 2, raceDate: "2024-01-02", raceTime: "2024-01-02T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 3,
    runners: [
      runner(21, "D", 3.0, 60, "LOSER"),
      runner(22, "E", 4.0, 25, "WINNER"),
      runner(23, "F", 9.0, 15, "LOSER"),
    ],
  },
  {
    _id: 3, raceId: 3, raceDate: "2024-01-03", raceTime: "2024-01-03T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 2,
    runners: [
      runner(31, "G", null, 70, "LOSER"),
      runner(32, "H", 5.0, 20, "WINNER"),
      runner(33, "I", 8.0, 10, "LOSER"),
    ],
  },
  {
    _id: 4, raceId: 4, raceDate: "2024-01-04", raceTime: "2024-01-04T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 3,
    runners: [
      runner(41, "J", 4.0, 40, "WINNER"),
      runner(42, "K", 6.0, 40, "LOSER"),
      runner(43, "L", 10.0, 20, "LOSER"),
    ],
  },
];

describe("IndustrySpDAO — model top pick and level stakes (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    await db.collection("industry_starting_prices").insertMany(RACES as never);
    dao = new IndustrySpDAO(db);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  // `day` isolates a single race via the date range, because the returned
  // `data` branch deliberately carries EVERY isp-in-range runner (it also
  // backs /isp/races, which must show the whole field) — only the counts and
  // P&L describe the qualifying subset. So a per-race assertion has to be made
  // through the numbers, not by reading data[].runners.
  const query = (onlyModelTopPick: boolean, includeLevelStakes = true, day?: string) =>
    dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null,
      day ? `${day}T00:00:00` : null, day ? `${day}T23:59:59` : null,
      [], [], [], [], null, null, 0, 0, 100, null, 0, false, null, null, null, 0,
      onlyModelTopPick, includeLevelStakes
    );

  it("keeps exactly one runner per race, plus both halves of a tie", async () => {
    const r = await query(true);
    // B, D, H, J, K — 5 runners over 4 races.
    expect(r.totalRunners).toBe(5);
    expect(r.pnlStats.count).toBe(5);
  });

  it("scores the top-pick selection, not every runner", async () => {
    const r = await query(true);
    // Hand-computed above: level staked 5, returned 15.
    expect(r.levelPnl!.staked).toBeCloseTo(5, 6);
    expect(r.levelPnl!.returns).toBeCloseTo(15.0, 6);
    expect(r.levelPnl!.pnl).toBeCloseTo(10.0, 6);
    expect(r.pnlStats.staked).toBeCloseTo(1.4833333, 5);
    expect(r.pnlStats.returns).toBeCloseTo(3.7833333, 5);
  });

  // The bug this filter shipped with once and must never regress: the runner
  // COUNT respected the filter while the P&L was computed over every runner,
  // because the pnlStats facet builds its own copy of the qualifying
  // condition. Both numbers looked plausible; only the pair was wrong.
  it("the runner count and the P&L describe the SAME set of runners", async () => {
    const filtered = await query(true);
    const all = await query(false);
    expect(filtered.pnlStats.count).toBe(filtered.totalRunners);
    expect(all.pnlStats.count).toBe(all.totalRunners);
    // 5 of 11 backable runners — so the two must not be equal.
    expect(filtered.totalRunners).toBeLessThan(all.totalRunners);
    expect(filtered.levelPnl!.staked).toBeLessThan(all.levelPnl!.staked);
  });

  it("a non-runner cannot hold the top pick and remove the race", async () => {
    // Race 3's highest-rated runner G has no price. If the maximum were taken
    // over ALL runners, no backable runner could equal it and the race would
    // vanish from the selection instead of contributing its best BACKABLE
    // runner, H (isp 5.0, wins).
    const r = await query(true, true, "2024-01-03");
    expect(r.totalRunners).toBe(1);
    expect(r.levelPnl!.staked).toBeCloseTo(1, 6);
    expect(r.levelPnl!.returns).toBeCloseTo(5.0, 6);
  });

  it("a tie at the top keeps both runners", async () => {
    // Race 4: J and K both on 40. Two runners staked, and only J (isp 4.0)
    // wins — so level returns 4.0 on 2 staked.
    const r = await query(true, true, "2024-01-04");
    expect(r.totalRunners).toBe(2);
    expect(r.levelPnl!.staked).toBeCloseTo(2, 6);
    expect(r.levelPnl!.returns).toBeCloseTo(4.0, 6);
  });

  it("the model's top pick is not simply the market favourite", async () => {
    // Race 1: the shortest price is A at 2.0 and it LOSES; the model's pick is
    // B at 6.0 and it WINS. Backing the market favourite would return 0 here,
    // so the returns figure alone distinguishes them — if this ever reads 0
    // the filter has collapsed onto price instead of the model.
    const r = await query(true, true, "2024-01-01");
    expect(r.totalRunners).toBe(1);
    expect(r.levelPnl!.returns).toBeCloseTo(6.0, 6);
  });

  it("level and to-win disagree on the same bets, and both are returned", async () => {
    const r = await query(true);
    const levelRoi = (100 * r.levelPnl!.pnl) / r.levelPnl!.staked;
    const toWinRoi = (100 * r.pnlStats.pnl) / r.pnlStats.staked;
    expect(levelRoi).toBeCloseTo(200, 4);
    expect(toWinRoi).toBeGreaterThan(100);
    // The whole reason both are shown: they are the SAME bets weighted
    // differently, so they can and do differ materially.
    expect(Math.abs(levelRoi - toWinRoi)).toBeGreaterThan(10);
  });

  it("omits levelPnl entirely when it was not asked for", async () => {
    // Absent must mean "not requested", never zero — a zero would render as a
    // break-even level-stakes book.
    const r = await query(true, false);
    expect(r.levelPnl).toBeUndefined();
    expect(r.pnlStats.staked).toBeGreaterThan(0);
  });

  it("leaves the unfiltered result untouched", async () => {
    const r = await query(false);
    // Every backable runner: 3 + 3 + 2 + 3 = 11.
    expect(r.totalRunners).toBe(11);
    expect(r.levelPnl!.staked).toBeCloseTo(11, 6);
  });
});
