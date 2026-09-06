// server/tests/testContainers.js
const { GenericContainer } = require('testcontainers');

let redisContainer;

exports.startRedisForTest = async () => {
  if (redisContainer) return await redisContainer.getMappedPort(6379);

  // Avvia un container Redis effimero
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const port = await redisContainer.getMappedPort(6379);
  console.log(`[TEST] Redis started on localhost:${port}`);
  return port;
};

exports.stopRedisForTest = async () => {
  if (redisContainer) {
    await redisContainer.stop();
    redisContainer = null;
  }
};
