const fs = require('fs');
const dns = require('dns').promises;
const { MongoClient } = require('mongodb');

const env = fs.readFileSync('server/.env', 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('MONGO_URI='));
if (!line) {
  console.error('No MONGO_URI found in server/.env');
  process.exit(1);
}

const uri = line.split('=', 2)[1].replace(/^"|"$/g, '');
const url = new URL(uri);

console.log('parsed host:', url.host);
console.log('parsed protocol:', url.protocol);

(async () => {
  try {
    const srv = await dns.resolveSrv(`_mongodb._tcp.${url.host}`);
    console.log('resolveSrv returned', srv);
    for (const rec of srv) {
      try {
        const addrs = await dns.resolve(rec.name);
        console.log(`DNS addresses for ${rec.name}:`, addrs);
      } catch (err) {
        console.error(`DNS resolve error for ${rec.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('resolveSrv error:', err.message);
  }

  console.log('Attempting MongoClient connection...');
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    console.log('MongoDB Atlas connection succeeded');
    const adminDb = client.db().admin();
    const info = await adminDb.serverStatus();
    console.log('serverStatus ok, host:', info.host);
  } catch (err) {
    console.error('MongoDB Atlas connection failed:', err.message || err);
  } finally {
    await client.close().catch(() => {});
  }
})();
