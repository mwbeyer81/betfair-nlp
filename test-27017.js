const { MongoClient } = require('./node_modules/mongodb');
const uri = 'mongodb://localhost:27017';
console.log('Connecting to', uri, '...');
const start = Date.now();
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
client.connect()
  .then(() => client.db('admin').admin().ping())
  .then(r => { console.log('OK in', Date.now()-start, 'ms, ping:', JSON.stringify(r)); client.close(); })
  .catch(e => { console.error('FAIL in', Date.now()-start, 'ms:', e.message); });