const { MongoClient } = require('./node_modules/mongodb');
// Try both portproxy and direct connection
const uris = ['mongodb://localhost:27019', 'mongodb://172.21.247.124:27017'];
Promise.all(uris.map(uri => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  const start = Date.now();
  return client.connect()
    .then(() => client.db('admin').admin().ping())
    .then(r => { client.close(); return `${uri}: OK (${Date.now()-start}ms)`; })
    .catch(e => `${uri}: FAIL (${Date.now()-start}ms) - ${e.message}`);
})).then(results => { results.forEach(r => console.log(r)); });