const { MongoClient } = require('./node_modules/mongodb');
const uri = 'mongodb://localhost:27019';
console.log('Connecting to', uri, '...');
const start = Date.now();
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
client.connect()
  .then(() => {
    console.log('Connected in', Date.now()-start, 'ms');
    return client.db('betfair_nlp_local').admin().ping();
  })
  .then(r => { console.log('Ping OK:', JSON.stringify(r)); client.close(); })
  .catch(e => { console.error('FAILED after', Date.now()-start, 'ms:', e.message); process.exit(1); });