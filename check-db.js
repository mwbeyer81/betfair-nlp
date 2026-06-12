const { MongoClient } = require('./node_modules/mongodb');
const client = new MongoClient('mongodb://localhost:27017');
client.connect().then(async () => {
  const db = client.db('betfair_nlp_local');
  const collections = await db.listCollections().toArray();
  console.log('Collections:', JSON.stringify(collections.map(c => c.name)));
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(` ${col.name}: ${count} docs`);
  }
  client.close();
}).catch(e => console.error('Error:', e.message));