// db.js - connects the service to MongoDB.
// If MONGO_URL is not set (for example when testing on a laptop without Docker),
// a small in-memory store is used instead. Docker and Kubernetes always set MONGO_URL.
const { MongoClient } = require("mongodb");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function memoryCollection() {
  const docs = [];
  // supports plain equality and the $gt operator, which is all this project uses
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) =>
    v !== null && typeof v === "object" && "$gt" in v ? doc[k] > v.$gt : doc[k] === v);
  return {
    async createIndex() {},
    async countDocuments(filter = {}) { return docs.filter((d) => matches(d, filter)).length; },
    async insertOne(doc) { docs.push({ ...doc }); return { acknowledged: true }; },
    async insertMany(list) { list.forEach((d) => docs.push({ ...d })); return { acknowledged: true }; },
    async findOne(filter) { const d = docs.find((x) => matches(x, filter)); return d ? { ...d } : null; },
    async updateOne(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(d, update.$set || {});
      for (const [k, n] of Object.entries(update.$inc || {})) d[k] += n;
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find(filter = {}) {
      let result = docs.filter((d) => matches(d, filter)).map((d) => ({ ...d }));
      const cursor = {
        sort(spec) {
          const [key, dir] = Object.entries(spec)[0];
          result.sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0));
          return cursor;
        },
        limit(n) { result = result.slice(0, n); return cursor; },
        async toArray() { return result; },
      };
      return cursor;
    },
  };
}

async function connect(dbName) {
  if (!process.env.MONGO_URL) {
    console.log("MONGO_URL not set, using in-memory store (testing only)");
    const collections = {};
    return { collection: (name) => (collections[name] ||= memoryCollection()) };
  }
  const client = new MongoClient(process.env.MONGO_URL);
  // MongoDB may still be starting when this service starts, so retry for about a minute
  for (let attempt = 1; ; attempt++) {
    try {
      await client.connect();
      console.log("Connected to MongoDB");
      return client.db(dbName);
    } catch (err) {
      if (attempt >= 20) throw err;
      console.log(`Waiting for MongoDB (attempt ${attempt})`);
      await sleep(3000);
    }
  }
}

module.exports = { connect };
