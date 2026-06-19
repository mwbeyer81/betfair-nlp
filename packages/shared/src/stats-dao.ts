import { getDb } from './db';

export interface SummaryStats {
  totalRaces: number;
  totalRunners: number;
}

export async function getSummaryStats(): Promise<SummaryStats> {
  const collection = getDb().collection('market_definitions');
  const result = await collection
    .aggregate<SummaryStats>([
      { $match: { marketType: { $in: ['WIN', 'ANTEPOST_WIN'] } } },
      { $sort: { marketId: 1, timestamp: -1 } },
      { $group: { _id: '$marketId', runners: { $first: '$runners' } } },
      {
        $facet: {
          races: [{ $count: 'count' }],
          runners: [
            { $unwind: '$runners' },
            { $match: { 'runners.status': { $ne: 'REMOVED' } } },
            { $group: { _id: '$runners.id' } },
            { $count: 'count' },
          ],
        },
      },
      {
        $project: {
          totalRaces: { $ifNull: [{ $arrayElemAt: ['$races.count', 0] }, 0] },
          totalRunners: { $ifNull: [{ $arrayElemAt: ['$runners.count', 0] }, 0] },
        },
      },
    ])
    .toArray();

  return result[0] ?? { totalRaces: 0, totalRunners: 0 };
}
