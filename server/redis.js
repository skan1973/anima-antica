// server/redis.js
const { createClient } = require('ioredis');

const redisUrl = process.env.REDIS_URL;
let pubClient, subClient;
let isRedisReady = () => false;

if (redisUrl) {
  pubClient = createClient({ url: redisUrl });
  subClient = pubClient.duplicate();
  isRedisReady = () => pubClient && pubClient.status === 'ready';
}

module.exports = {
  pubClient,
  subClient,
  isRedisReady,
  redisUrl
};