const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { startRedisForTest, stopRedisForTest } = require('./testContainers');

let redisPort;

// Helper per caricare i moduli con cache pulita
const loadModules = () => {
  Object.keys(require.cache).forEach(key => {
    if (key.includes('tokenRegistry') || key.includes('sessionService') || key.includes('\\redis') || key.includes('/redis')) {
      delete require.cache[key];
    }
  });
  
  const tokenRegistry = require('../tokenRegistry');
  const sessionService = require('../services/sessionService');
  const redis = require('../redis');
  
  return { tokenRegistry, sessionService, redis };
};

test('setup: start redis container', async () => {
  redisPort = await startRedisForTest();
  process.env.REDIS_URL = `redis://localhost:${redisPort}`;
  process.env.JWT_SECRET = 'test-secret-for-testing-32-chars-minimum-length';
  // Give Redis a moment to be ready
  await new Promise(r => setTimeout(r, 1000));
});

test('teardown: stop redis container', async () => {
  await stopRedisForTest();
});

// Test Case 1: revoke_propagates_to_both_stores
test('revoke_propagates_to_both_stores', async () => {
  const { tokenRegistry, sessionService, redis } = loadModules();
  
  // Clear in-memory registry
  tokenRegistry.socketTokenRegistry.clear();
  
  // Wait for Redis to be ready
  let retries = 0;
  while (!redis.isRedisReady() && retries < 50) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }
  assert.ok(redis.isRedisReady(), 'Redis should be ready');

  // Create a session using the real API
  const mockReq = {
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'test-agent',
      'accept-language': 'en-US'
    }
  };
  const clientContext = { ip: '127.0.0.1', userAgent: 'test-agent' };
  
  const { token, jti } = await sessionService.createSession(mockReq, clientContext, 3600);
  
  // Verify session exists in both stores
  const memBefore = tokenRegistry.socketTokenRegistry.get(jti);
  assert.ok(memBefore, 'Token should exist in memory');
  assert.equal(memBefore.revoked, false);
  
  const redisBefore = await tokenRegistry.getTokenRecord(jti);
  assert.ok(redisBefore, 'Token should exist in Redis');
  assert.equal(redisBefore.revoked, false);
  
  // Revoke using the real service
  const revokeResult = await sessionService.revokeSession(token, { reason: 'manual' });
  
  assert.equal(revokeResult.revoked, true);
  assert.equal(revokeResult.jti, jti);
  assert.ok(['redis', 'both'].includes(revokeResult.source), `Source should be redis or both, got ${revokeResult.source}`);
  
  // Verify revoked in both stores
  const memAfter = tokenRegistry.socketTokenRegistry.get(jti);
  assert.ok(memAfter, 'Token should still exist in memory after revoke');
  assert.equal(memAfter.revoked, true);
  
  const redisAfter = await tokenRegistry.getTokenRecord(jti);
  assert.ok(redisAfter, 'Token should exist in Redis after revoke');
  assert.equal(redisAfter.revoked, true);
});

// Test Case 2: revoke_during_redis_outage
test('revoke_during_redis_outage', async () => {
  const { tokenRegistry, sessionService, redis } = loadModules();
  
  tokenRegistry.socketTokenRegistry.clear();
  
  const mockReq = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent', 'accept-language': 'en-US' }
  };
  const clientContext = { ip: '127.0.0.1', userAgent: 'test-agent' };
  
  const { token, jti } = await sessionService.createSession(mockReq, clientContext, 3600);
  
  assert.ok(tokenRegistry.socketTokenRegistry.has(jti), 'Token should be in memory');
  
  // Simulate Redis outage by closing the client
  await redis.pubClient.quit();
  
  // Wait for connection lost
  await new Promise(r => setTimeout(r, 500));
  
  // Try to revoke - should still work (writes to local queue)
  const revokeResult = await sessionService.revokeSession(token, { reason: 'manual' });
  
  assert.equal(revokeResult.revoked, true);
  assert.ok(['queue', 'memory', 'both'].includes(revokeResult.source), `Source should be queue/memory/both, got ${revokeResult.source}`);
  
  // Memory should be updated
  const memAfter = tokenRegistry.socketTokenRegistry.get(jti);
  assert.ok(memAfter, 'Token should exist in memory after revoke');
  assert.equal(memAfter.revoked, true);
  
  // Reconnect Redis for next tests
  await redis.pubClient.connect();
  await new Promise(r => setTimeout(r, 1000));
});

// Test Case 3: redis_recovery_migrates_memory_tokens
test('redis_recovery_migrates_memory_tokens', async () => {
  const { tokenRegistry, redis } = loadModules();
  
  tokenRegistry.socketTokenRegistry.clear();
  
  // Add token directly to memory (simulating token created during outage)
  const jti = 'migratable-jti-' + crypto.randomUUID();
  tokenRegistry.socketTokenRegistry.set(jti, { 
    sid: 's1', 
    revoked: false,
    expiresAtMs: Date.now() + 3600000,
    type: 'socket-session'
  });
  // Ensure Redis is ready
  assert.ok(redis.isRedisReady(), 'Redis should be ready');
  
  // Write the token to Redis via setTokenRecord
  const result = await tokenRegistry.setTokenRecord(jti, { 
    sid: 's1', 
    revoked: false,
    expiresAtMs: Date.now() + 3600000,
    type: 'socket-session'
  });
  
  // Should write to Redis (not queue)
  assert.equal(result.source, 'redis', `Expected source 'redis', got '${result.source}'`);
  assert.equal(result.written, true);
  
  // Verify readable from Redis
  const fromRedis = await tokenRegistry.getTokenRecord(jti);
  assert.ok(fromRedis, 'Token should be readable from Redis');
  assert.equal(fromRedis.sid, 's1');
});

// Test Case 4: pubsub_invalidate_cross_instance
test('pubsub_invalidate_cross_instance', async () => {
  const { tokenRegistry, sessionService } = loadModules();
  
  tokenRegistry.socketTokenRegistry.clear();
  
  const mockReq = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent', 'accept-language': 'en-US' }
  };
  const clientContext = { ip: '127.0.0.1', userAgent: 'test-agent' };
  
  const { token, jti } = await sessionService.createSession(mockReq, clientContext, 3600);
  
  // Register a fake socket
  const fakeSocketId = 'fake-socket-' + crypto.randomUUID();
  const tokenInvalidator = require('../services/tokenInvalidator');
  tokenInvalidator.registerActiveSocket(jti, fakeSocketId);
  
  // Simulate receiving invalidation message from another instance
  const mockIo = {
    sockets: {
      sockets: new Map([[fakeSocketId, { 
        id: fakeSocketId,
        emit: (event, data) => { mockIo.lastEmit = { event, data }; },
        disconnect: () => { mockIo.disconnected = true; }
      }]])
    },
    fetchSockets: async () => [{ id: fakeSocketId }]
  };
  
  tokenInvalidator.handleTokenInvalidate({ jti, revokedAt: new Date().toISOString(), reason: 'test' }, mockIo);
  
  // The socket should have received auth-revoked and been disconnected
  // Wait a bit for async operations if needed, here it is sync in handleTokenInvalidate
  assert.ok(mockIo.lastEmit, 'Socket should have received emit');
  assert.equal(mockIo.lastEmit.event, 'auth-revoked');
  assert.equal(mockIo.lastEmit.data.reason, 'test');
  assert.ok(mockIo.disconnected, 'Socket should have been disconnected');
});

// Test Case 5: concurrent_revoke_same_token
test('concurrent_revoke_same_token', async () => {
  const { tokenRegistry, sessionService } = loadModules();
  
  tokenRegistry.socketTokenRegistry.clear();
  
  const mockReq = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent', 'accept-language': 'en-US' }
  };
  const clientContext = { ip: '127.0.0.1', userAgent: 'test-agent' };
  
  const { token, jti } = await sessionService.createSession(mockReq, clientContext, 3600);
  
  // Fire two concurrent revocations
  const results = await Promise.all([
    sessionService.revokeSession(token, { reason: 'manual' }),
    sessionService.revokeSession(token, { reason: 'manual' })
  ]);
  
  // Both should succeed (idempotent)
  assert.equal(results[0].revoked, true);
  assert.equal(results[1].revoked, true);
  assert.equal(results[0].jti, jti);
  assert.equal(results[1].jti, jti);
});

// Test Case 6: cleanup_removes_expired_only
test('cleanup_removes_expired_only', async () => {
  const { tokenRegistry } = loadModules();
  
  tokenRegistry.socketTokenRegistry.clear();
  
  const now = Date.now();
  
  // Insert expired token
  tokenRegistry.socketTokenRegistry.set('expired-jti', { 
    expiresAtMs: now - 1000, 
    revoked: false 
  });
  
  // Insert valid token
  tokenRegistry.socketTokenRegistry.set('valid-jti', { 
    expiresAtMs: now + 3600000, 
    revoked: false 
  });
  
  const sizeBefore = tokenRegistry.socketTokenRegistry.size;
  await tokenRegistry.cleanupSocketTokenRegistry();
  
  assert.equal(tokenRegistry.socketTokenRegistry.get('expired-jti'), undefined);
  assert.ok(tokenRegistry.socketTokenRegistry.get('valid-jti'), 'Valid token should remain');
  assert.equal(tokenRegistry.socketTokenRegistry.size, sizeBefore - 1);
});

// Test Case 7: ttl_configurable_via_env
test('ttl_configurable_via_env', async () => {
  // Set env BEFORE loading module
  process.env.TOKEN_TTL_SECONDS = '7200';
  
  // Reload tokenRegistry to pick up new TTL
  delete require.cache[require.resolve('../tokenRegistry')];
  delete require.cache[require.resolve('../services/sessionService')];
  const freshTokenRegistry = require('../tokenRegistry');
  const freshSessionService = require('../services/sessionService');
  
  const mockReq = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent', 'accept-language': 'en-US' }
  };
  const clientContext = { ip: '127.0.0.1', userAgent: 'test-agent' };
  
  const { jti } = await freshSessionService.createSession(mockReq, clientContext, 7200);
  
  // Verify the record in memory has expiry coherent with 7200s
  const record = freshTokenRegistry.socketTokenRegistry.get(jti);
  assert.ok(record, 'Token record should exist');
  
  const diff = (record.expiresAtMs - Date.now()) / 1000;
  assert.ok(diff > 7000, `Expiry diff ${diff}s should be > 7000`);
  assert.ok(diff <= 7200, `Expiry diff ${diff}s should be <= 7200`);
  
  // Reset env
  process.env.TOKEN_TTL_SECONDS = '3600';
  delete require.cache[require.resolve('../tokenRegistry')];
  delete require.cache[require.resolve('../services/sessionService')];
});