import { DatabaseConnection } from "../../config/database";
import {
  ModelAccuracyDAO,
  ModelAccuracyQuery,
  ModelAccuracyBandRaw,
  MODEL_ACCURACY_BAND_BOUNDARIES,
  UNBANDED_KEY,
} from "../dao/model-accuracy-dao";

/**
 * Turns the DAO's raw per-band sums into the presentation figures the Model
 * Accuracy screen reads: means, strike rate, P&L, signed error against the
 * truth, and Brier scores. Derived fields live here rather than in Mongo, the
 * same division of labour as industry-sp-service.ts:316-322.
 */

export interface ModelAccuracyBand {
  // Stable key for testIDs and React keys — the band's lower probability
  // boundary as a string, or "unbanded".
  bandKey: string;
  // Human label, in decimal odds, since price = 100 / modelWinProbability.
  label: string;
  minPrice: number | null;
  maxPrice: number | null;
  runners: number;
  wins: number;
  // What the model claimed, averaged over the band.
  modelMeanProb: number;
  // What actually happened.
  actualWinRate: number;
  // What the market thought, with the bookmaker's overround divided out so it
  // is comparable to a model probability that already sums to 100 per race.
  marketMeanProbFair: number;
  // The same market view WITHOUT the overround removed — this is the number a
  // bet actually has to beat to be value, and the one modelBeatsSp /
  // onlyModelBeatsSp compare against (ispFormat.ts:130-133,
  // industry-sp-dao.ts:181-186). Always >= marketMeanProbFair.
  marketMeanProbRaw: number;
  staked: number;
  returns: number;
  pnl: number;
  roiPercent: number;
  // Signed percentage-point error against what actually happened. Positive
  // means over-rated. Comparing the two is the whole point of the screen:
  // whichever is closer to zero was nearer the truth in that band.
  modelErrorPp: number;
  marketErrorPp: number;
  modelBrier: number;
  marketBrier: number;
}

export interface ModelAccuracyResult {
  bands: ModelAccuracyBand[];
  overall: ModelAccuracyBand;
}

interface BandDefinition {
  lowerBoundary: number;
  label: string;
  minPrice: number | null;
  maxPrice: number | null;
}

// Presented shortest-price-first, i.e. descending by model probability. Each
// entry's lowerBoundary must be one of MODEL_ACCURACY_BAND_BOUNDARIES.
const BAND_DEFINITIONS: BandDefinition[] = [
  { lowerBoundary: 50, label: "under 2.0", minPrice: null, maxPrice: 2 },
  { lowerBoundary: 100 / 3, label: "2.0 – 3.0", minPrice: 2, maxPrice: 3 },
  { lowerBoundary: 20, label: "3.0 – 5.0", minPrice: 3, maxPrice: 5 },
  { lowerBoundary: 10, label: "5.0 – 10.0", minPrice: 5, maxPrice: 10 },
  { lowerBoundary: 5, label: "10.0 – 20.0", minPrice: 10, maxPrice: 20 },
  { lowerBoundary: 0, label: "20.0+", minPrice: 20, maxPrice: null },
];

// 100/3 is not exactly representable, so the boundary that comes back from
// Mongo can differ from the JS literal in the last bit. Match on proximity
// rather than identity.
const BOUNDARY_EPSILON = 1e-6;

function boundaryKey(value: number): string {
  return value.toFixed(4);
}

function emptySums(): Omit<ModelAccuracyBandRaw, "_id"> {
  return {
    runnerCount: 0,
    wins: 0,
    modelProbSum: 0,
    marketProbFairSum: 0,
    marketProbRawSum: 0,
    staked: 0,
    returns: 0,
    modelSqErrSum: 0,
    marketSqErrSum: 0,
  };
}

function addSums(
  a: Omit<ModelAccuracyBandRaw, "_id">,
  b: Omit<ModelAccuracyBandRaw, "_id">
): Omit<ModelAccuracyBandRaw, "_id"> {
  return {
    runnerCount: a.runnerCount + b.runnerCount,
    wins: a.wins + b.wins,
    modelProbSum: a.modelProbSum + b.modelProbSum,
    marketProbFairSum: a.marketProbFairSum + b.marketProbFairSum,
    marketProbRawSum: a.marketProbRawSum + b.marketProbRawSum,
    staked: a.staked + b.staked,
    returns: a.returns + b.returns,
    modelSqErrSum: a.modelSqErrSum + b.modelSqErrSum,
    marketSqErrSum: a.marketSqErrSum + b.marketSqErrSum,
  };
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Divides the raw sums through by the band's runner count. A band with no
 * runners yields zeroes throughout rather than NaN — $bucket omits empty
 * buckets entirely, so these rows exist purely so the table always shows every
 * band rather than silently collapsing.
 */
function toBand(
  def: Pick<BandDefinition, "label" | "minPrice" | "maxPrice">,
  bandKey: string,
  sums: Omit<ModelAccuracyBandRaw, "_id">
): ModelAccuracyBand {
  const { runnerCount: runners, wins, staked, returns } = sums;
  const safeRunners = runners > 0 ? runners : 1;

  const modelMeanProb = runners > 0 ? sums.modelProbSum / safeRunners : 0;
  const marketMeanProbFair = runners > 0 ? sums.marketProbFairSum / safeRunners : 0;
  const marketMeanProbRaw = runners > 0 ? sums.marketProbRawSum / safeRunners : 0;
  const actualWinRate = runners > 0 ? (wins / safeRunners) * 100 : 0;

  // Derived from the ROUNDED staked/returns, not the raw ones, so the money
  // columns visibly add up on screen — a user reading "staked £2.34, returns
  // £3.67" expects a P&L of £1.33, and a pre-rounding pnl of 1.32 would look
  // like an arithmetic bug. Costs at most a penny of precision.
  const roundedStaked = round(staked, 2);
  const roundedReturns = round(returns, 2);
  const pnl = round(roundedReturns - roundedStaked, 2);

  return {
    bandKey,
    label: def.label,
    minPrice: def.minPrice,
    maxPrice: def.maxPrice,
    runners,
    wins,
    modelMeanProb: round(modelMeanProb, 2),
    actualWinRate: round(actualWinRate, 2),
    marketMeanProbFair: round(marketMeanProbFair, 2),
    marketMeanProbRaw: round(marketMeanProbRaw, 2),
    staked: roundedStaked,
    returns: roundedReturns,
    pnl,
    roiPercent: roundedStaked > 0 ? round((pnl / roundedStaked) * 100, 2) : 0,
    modelErrorPp: round(modelMeanProb - actualWinRate, 2),
    marketErrorPp: round(marketMeanProbFair - actualWinRate, 2),
    modelBrier: runners > 0 ? round(sums.modelSqErrSum / safeRunners, 6) : 0,
    marketBrier: runners > 0 ? round(sums.marketSqErrSum / safeRunners, 6) : 0,
  };
}

export class ModelAccuracyService {
  private dao: ModelAccuracyDAO;

  // Optional DAO injection with a lazy default, mirroring ModelVersionService
  // (model-version-service.ts:56-63) — the default path resolves the db through
  // DatabaseConnection, which is what app.test.ts's collection mock intercepts.
  constructor(dao?: ModelAccuracyDAO) {
    this.dao = dao ?? new ModelAccuracyDAO(DatabaseConnection.getInstance().getDb());
  }

  public async getPriceBandAccuracy(p: ModelAccuracyQuery): Promise<ModelAccuracyResult> {
    const raw = await this.dao.getPriceBandAccuracy(p);

    const byBoundary = new Map<string, Omit<ModelAccuracyBandRaw, "_id">>();
    let unbanded: Omit<ModelAccuracyBandRaw, "_id"> | null = null;

    for (const row of raw) {
      const { _id, ...sums } = row;
      if (_id === UNBANDED_KEY) {
        unbanded = sums;
        continue;
      }
      const matched = MODEL_ACCURACY_BAND_BOUNDARIES.find(
        b => Math.abs(b - (_id as number)) < BOUNDARY_EPSILON
      );
      // An _id that matches no known boundary would mean the DAO and this
      // service have drifted apart — fold it into "unbanded" so it stays
      // visible rather than vanishing.
      if (matched === undefined) {
        unbanded = unbanded ? addSums(unbanded, sums) : sums;
        continue;
      }
      byBoundary.set(boundaryKey(matched), sums);
    }

    const bands = BAND_DEFINITIONS.map(def =>
      toBand(def, boundaryKey(def.lowerBoundary), byBoundary.get(boundaryKey(def.lowerBoundary)) ?? emptySums())
    );

    // Surfaced, never silently dropped — a non-empty row here means the
    // boundaries in model-accuracy-dao.ts are wrong.
    if (unbanded != null && unbanded.runnerCount > 0) {
      bands.push(
        toBand({ label: "unbanded", minPrice: null, maxPrice: null }, UNBANDED_KEY, unbanded)
      );
    }

    // Built from the untouched DAO sums rather than from the rounded bands
    // above, so accumulated rounding can't make the overall row disagree with
    // the rows it totals.
    const overallRaw = raw.reduce<Omit<ModelAccuracyBandRaw, "_id">>((acc, row) => {
      const { _id, ...sums } = row;
      void _id;
      return addSums(acc, sums);
    }, emptySums());

    const overall = toBand({ label: "All bands", minPrice: null, maxPrice: null }, "overall", overallRaw);

    return { bands, overall };
  }
}
