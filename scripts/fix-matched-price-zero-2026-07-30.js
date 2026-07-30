// One-off prod data correction for the matched-price-zero bug (2026-07-30).
//
// Bet 436598726286 (Silken Bay, 20:40 Leicester) was stored with
// matchedPrice: 0 because it filled ~3 minutes after placeOrders returned
// (see betfair-api-client.ts). The code fix stops this happening again and
// self-corrects at settlement — but this document is already settled, so
// refreshSettledResults will never revisit it. Hence this script.
//
// Reads the true price from Betfair's own listClearedOrders rather than
// hardcoding it: the authoritative source, same as the code fix uses.
// Dry-run by default — pass --apply to write.
const { MongoClient } = require("mongodb");
const cfg = require("../config/local.json");

const APPLY = process.argv.includes("--apply");

async function betfair(op, params) {
  const r = await fetch(`https://api.betfair.com/exchange/betting/rest/v1.0/${op}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Application": cfg.betfair.delayAppKey,
      "X-Authentication": cfg.betfair.sessionId,
    },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(`Betfair ${op} failed: ${r.status}`);
  return r.json();
}

(async () => {
  const client = new MongoClient(cfg.mongodb.uri);
  await client.connect();
  const col = client.db(cfg.mongodb.dbName).collection("bet_orders");

  // Every real, settled bet whose stored matched price is missing or
  // non-positive — not just the one known bad doc, so any sibling the same
  // bug produced is caught too.
  const broken = await col
    .find({ dryRun: false, betfairBetId: { $ne: null }, betOutcome: { $exists: true } })
    .toArray();
  const candidates = broken.filter(d => typeof d.matchedPrice !== "number" || d.matchedPrice <= 0);

  console.log(`real settled bets: ${broken.length}, with a bad matchedPrice: ${candidates.length}`);
  if (candidates.length === 0) {
    await client.close();
    return;
  }

  const { clearedOrders = [] } = await betfair("listClearedOrders", {
    betStatus: "SETTLED",
    betIds: candidates.map(d => d.betfairBetId),
  });
  const byBetId = new Map(clearedOrders.map(c => [c.betId, c]));

  for (const doc of candidates) {
    const cleared = byBetId.get(doc.betfairBetId);
    if (!cleared || typeof cleared.priceMatched !== "number" || cleared.priceMatched <= 0) {
      console.log(`SKIP  ${doc.horse} (${doc.betfairBetId}) — Betfair reports no usable priceMatched`);
      continue;
    }
    console.log(`${APPLY ? "FIX  " : "WOULD"} ${doc.horse} (${doc.betfairBetId}): ${doc.matchedPrice} -> ${cleared.priceMatched}`);
    if (APPLY) {
      await col.updateOne(
        { _id: doc._id },
        { $set: { matchedPrice: cleared.priceMatched, updatedAt: new Date().toISOString() } }
      );
    }
  }

  if (!APPLY) console.log("\nDry run — re-run with --apply to write.");
  await client.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
