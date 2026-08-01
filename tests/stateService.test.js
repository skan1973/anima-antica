const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { User } = require('../server/db');
const stateService = require('../server/services/stateService');

test('reserveUser reserves only a libero user', async (t) => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  t.after(() => {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  });

  User.findOneAndUpdate = async (query, update) => {
    if (query.nick === 'A' && query.status === 'libero') {
      return { nick: 'A', status: update.$set.status };
    }
    return null;
  };

  const result = await stateService.reserveUser('A');
  assert.equal(result.nick, 'A');
  assert.equal(result.status, 'occupato');
});

test('reserveUsers returns conflict when second reservation fails inside transaction', async (t) => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalStartSession = mongoose.startSession;

  t.after(() => {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    mongoose.startSession = originalStartSession;
  });

  const fakeSession = {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    async endSession() {},
    inTransaction() { return true; }
  };

  mongoose.startSession = async () => fakeSession;

  User.findOneAndUpdate = async (query, update) => {
    if (query.nick === 'caller' && query.status === 'libero') {
      return { nick: 'caller', status: update.$set.status };
    }
    if (query.nick === 'callee' && query.status === 'libero') {
      return null;
    }
    return null;
  };

  const result = await stateService.reserveUsers('caller', 'callee');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STATE_CONFLICT');
});

test('simultaneous reservations on the same callee produce one winner and one conflict', async (t) => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalStartSession = mongoose.startSession;

  t.after(() => {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    mongoose.startSession = originalStartSession;
  });

  mongoose.startSession = async () => {
    throw new Error('transactions unavailable');
  };

  const statuses = {
    caller1: 'libero',
    caller2: 'libero',
    callee: 'libero'
  };

  User.findOneAndUpdate = async (query, update) => {
    const current = statuses[query.nick];
    if (current !== query.status) {
      return null;
    }

    statuses[query.nick] = update.$set.status;
    return { nick: query.nick, status: statuses[query.nick] };
  };

  const [first, second] = await Promise.all([
    stateService.reserveUsers('caller1', 'callee'),
    stateService.reserveUsers('caller2', 'callee')
  ]);

  const successCount = [first, second].filter((entry) => entry.ok).length;
  const conflictCount = [first, second].filter((entry) => !entry.ok && entry.code === 'STATE_CONFLICT').length;

  assert.equal(successCount, 1);
  assert.equal(conflictCount, 1);
  assert.equal(statuses.callee, 'occupato');

  const busyCallers = ['caller1', 'caller2'].filter((nick) => statuses[nick] === 'occupato');
  const freeCallers = ['caller1', 'caller2'].filter((nick) => statuses[nick] === 'libero');

  assert.equal(busyCallers.length, 1);
  assert.equal(freeCallers.length, 1);
});

test('reconcileUserOnReconnect releases stale busy user without active session', async (t) => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;

  t.after(() => {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  });

  User.findOne = async () => ({
    nick: 'ghost',
    status: 'occupato',
    toObject() {
      return { nick: 'ghost', status: 'occupato' };
    }
  });

  User.findOneAndUpdate = async (query, update) => ({
    nick: query.nick,
    status: update.$set.status
  });

  const result = await stateService.reconcileUserOnReconnect('ghost', false);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'RELEASED_STALE_BUSY');
  assert.equal(result.user.status, 'libero');
});

test('cleanupBusyUsersWithoutSession releases only stale busy users at startup', async (t) => {
  const originalFind = User.find;
  const originalFindOneAndUpdate = User.findOneAndUpdate;

  t.after(() => {
    User.find = originalFind;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  });

  User.find = async () => ([
    { nick: 'busy1', status: 'occupato' },
    { nick: 'busy2', status: 'occupato' }
  ]);

  User.findOneAndUpdate = async (query, update) => ({
    nick: query.nick,
    status: update.$set.status
  });

  const released = await stateService.cleanupBusyUsersWithoutSession(
    (nick) => nick === 'busy2'
  );

  assert.deepEqual(released, ['busy1']);
});