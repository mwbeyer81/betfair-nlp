const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient('mongodb://localhost:27019');
  await c.connect();
  const db = c.db('betfair_nlp_local');
  const coll = db.collection('market_definitions');
  const indexes = await coll.indexes();
  console.log(JSON.stringify(indexes.map(i => i.key), null, 2));
  await c.close();
})();
