import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = `betfair_nlp_test_fav_pnl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Seed arithmetic, worked by hand so every expectation below is checkable
// rather than snapshotted. The favourite is the SHORTEST-PRICED backable
// runner in the race, chosen over the full field — see src/lib/service/fav-pnl.ts.
//
// RACE 1 — the favourite loses, and the winner is NOT the favourite. Rules out
//   any implementation that quietly backs the winner.
//   A isp 2.0 (FAV, LOSES)   B isp 6.0 (WINS)   C isp 11.0
//
// RACE 2 — same shape at different prices, favourite loses again.
//   D isp 3.0 (FAV, LOSES)   E isp 4.0 (WINS)   F isp 9.0
//
// RACE 3 — the shortest "price" in the document belongs to a NON-RUNNER with
//   no isp at all. The favourite must fall through to the best backable
//   runner rather than the race dropping out of the baseline.
//   G no isp   H isp 5.0 (FAV, WINS)   I isp 8.0
//
// RACE 4 — JOINT favourites. Both are backed at full stake (the same tie
//   decision modelTopPickCond makes), so this race contributes 2 bets and 1 race.
//   J isp 4.0 (JOINT FAV, WINS)   K isp 4.0 (JOINT FAV, LOSES)   L isp 10.0
//
// FAVOURITE SELECTION = A, D, H, J, K  (5 bets over 4 races)
//   level:  staked 5, returns = 5.0 (H) + 4.0 (J) = 9.0
//           pnl +4.0  ->  ROI +80%
//   to-win: stakes 1/(isp-1) = A 1.0, D 0.5, H 0.25, J 1/3, K 1/3
//           staked  = 2.416666..
//           returns = (0.25 + 1) + (1/3 + 1) = 2.583333..
//           pnl +0.166666..
//
// Deliberately profitable, and profitable by a different amount under each
// staking convention, so a mixed-up convention can't produce the right answer.

function runner(id: number, name: string, isp: number | null, status: "WINNER" | "LOSER") {
  return {
    id,
    name,
    num: id,
    ...(isp == null ? {} : { isp }),
    status,
    // Present so the model filters below have something to bite on — the
    // baseline must ignore them, which is the point of those cases.
    modelWinProbabilityOos: isp == null ? 70 : Math.round(100 / isp),
    modelWinProbability: isp == null ? 70 : Math.round(100 / isp),
  };
}

const RACES = [
  {
    _id: 1, raceId: 1, raceDate: "2024-01-01", raceTime: "2024-01-01T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 3,
    runners: [
      runner(11, "A", 2.0, "LOSER"),
      runner(12, "B", 6.0, "WINNER"),
      runner(13, "C", 11.0, "LOSER"),
    ],
  },
  {
    _id: 2, raceId: 2, raceDate: "2024-01-02", raceTime: "2024-01-02T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 3,
    runners: [
      runner(21, "D", 3.0, "LOSER"),
      runner(22, "E", 4.0, "WINNER"),
      runner(23, "F", 9.0, "LOSER"),
    ],
  },
  {
    _id: 3, raceId: 3, raceDate: "2024-01-03", raceTime: "2024-01-03T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 2,
    runners: [
      runner(31, "G", null, "LOSER"),
      runner(32, "H", 5.0, "WINNER"),
      runner(33, "I", 8.0, "LOSER"),
    ],
  },
  {
    _id: 4, raceId: 4, raceDate: "2024-01-04", raceTime: "2024-01-04T13:00:00",
    course: "Ascot", countryCode: "GB", ran: 3, runnersWithIspCount: 3,
    runners: [
      runner(41, "J", 4.0, "WINNER"),
      runner(42, "K", 4.0, "LOSER"),
      runner(43, "L", 10.0, "LOSER"),
    ],
  },
];

describe("IndustrySpDAO — favourite-backed baseline (integration)", () => {
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

  const query = (opts: {
    minIsp?: number;
    maxIsp?: number;
    fromRow?: number;
    toRow?: number | null;
    onlyModelTopPick?: boolean;
    minModelWinProbability?: number;
  } = {}) =>
    dao.getAllRacesByRace(
      1, 20, 1, 30, [], opts.minIsp ?? 1, opts.maxIsp ?? 1000, "asc", 1, 10000,
      opts.fromRow ?? 1, opts.toRow ?? null,
      null, null, [], [], [], [], null, null, 0, 0, 100, null,
      opts.minModelWinProbability ?? 0, false, null, null, null, 0,
      opts.onlyModelTopPick ?? false, true
    );

  it("backs one favourite per race, both halves of a joint favourite", async () => {
    const { favPnl } = await query();
    expect(favPnl.races).toBe(4);
    expect(favPnl.count).toBe(5);
  });

  it("computes the level-stakes baseline: £1 a bet, returning the price", async () => {
    const { favPnl } = await query();
    expect(favPnl.level.staked).toBeCloseTo(5, 6);
    expect(favPnl.level.returns).toBeCloseTo(9.0, 6);
    expect(favPnl.level.pnl).toBeCloseTo(4.0, 6);
    expect((100 * favPnl.level.pnl) / favPnl.level.staked).toBeCloseTo(80, 6);
  });

  it("computes the to-win-£1 baseline in the same convention as pnlStats", async () => {
    const { favPnl } = await query();
    expect(favPnl.staked).toBeCloseTo(1 + 0.5 + 0.25 + 1 / 3 + 1 / 3, 6);
    expect(favPnl.returns).toBeCloseTo(0.25 + 1 + 1 / 3 + 1, 6);
    expect(favPnl.pnl).toBeCloseTo(favPnl.returns - favPnl.staked, 6);
  });

  it("never treats an unpriced runner as the favourite", async () => {
    // Race 3's G has no isp at all. If it could hold the minimum, race 3 would
    // contribute a bet at a price that does not exist — or drop out entirely.
    const { favPnl } = await query({ fromRow: 3, toRow: 3 });
    expect(favPnl.races).toBe(1);
    expect(favPnl.count).toBe(1);
    expect(favPnl.level.returns).toBeCloseTo(5.0, 6);
  });

  it("is blind to the ISP range — the same races, the same favourites", async () => {
    // 5.0-1000 excludes every one of the four favourites from the FILTERED
    // selection (2.0, 3.0, and the 4.0 pair), and cuts race 3's own qualifying
    // set down. The baseline must not move: it is a property of the races, not
    // of the query. A baseline that shifted here could never be compared
    // across two filter sets.
    const wide = await query();
    const narrow = await query({ minIsp: 5, maxIsp: 1000 });
    expect(narrow.favPnl).toEqual(wide.favPnl);
    // ...and the filtered figure beside it genuinely did move, so the
    // assertion above is not passing because nothing happened.
    expect(narrow.pnlStats.count).not.toBe(wide.pnlStats.count);
  });

  it("is blind to the runner-level model filters", async () => {
    const all = await query();
    const topPick = await query({ onlyModelTopPick: true });
    expect(topPick.favPnl).toEqual(all.favPnl);
    // 11 qualifying runners down to 5 — one per race, plus both halves of
    // race 4's tie (J and K are the same price, so the model rates them
    // identically here too). The filtered figure moved; the baseline did not.
    expect(all.pnlStats.count).toBe(11);
    expect(topPick.pnlStats.count).toBe(5);
  });

  it("follows the split's row window, since the RACES are the filtered ones", async () => {
    // Split A = races 1-2 (both favourites lose), Split B = races 3-4.
    const a = await query({ fromRow: 1, toRow: 2 });
    expect(a.favPnl.races).toBe(2);
    expect(a.favPnl.count).toBe(2);
    expect(a.favPnl.level.returns).toBeCloseTo(0, 6);
    expect(a.favPnl.level.pnl).toBeCloseTo(-2, 6);

    const b = await query({ fromRow: 3, toRow: null });
    expect(b.favPnl.races).toBe(2);
    expect(b.favPnl.count).toBe(3);
    expect(b.favPnl.level.returns).toBeCloseTo(9.0, 6);

    // The two windows partition the whole set — sums, not means.
    const whole = await query();
    expect(a.favPnl.count + b.favPnl.count).toBe(whole.favPnl.count);
    expect(a.favPnl.level.pnl + b.favPnl.level.pnl).toBeCloseTo(whole.favPnl.level.pnl, 6);
  });

  it("reports zeros, not a break-even baseline, when no race matches", async () => {
    // An inverted row range short-circuits before the pipeline runs at all.
    const { favPnl } = await query({ fromRow: 3, toRow: 2 });
    expect(favPnl.races).toBe(0);
    expect(favPnl.count).toBe(0);
    expect(favPnl.level.pnl).toBe(0);
  });
});
