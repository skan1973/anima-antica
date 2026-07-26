const test = require('node:test');
const assert = require('node:assert/strict');

const banService = require('../server/services/banService');
const Ban = require('../server/models/ban');

test('isIpBanned returns true when active ban exists', async (t) => {
  const originalFindOne = Ban.findOne;
  t.after(() => {
    Ban.findOne = originalFindOne;
  });

  Ban.findOne = async () => ({ _id: 'ban-1' });
  const banned = await banService.isIpBanned('127.0.0.1');
  assert.equal(banned, true);
});

test('isIpBanned returns false when no ban exists', async (t) => {
  const originalFindOne = Ban.findOne;
  t.after(() => {
    Ban.findOne = originalFindOne;
  });

  Ban.findOne = async () => null;
  const banned = await banService.isIpBanned('127.0.0.1');
  assert.equal(banned, false);
});

test('isIpBanned rejects invalid IP input', async () => {
  await assert.rejects(
    () => banService.isIpBanned('not-an-ip'),
    /IP non valido/
  );
});

test('addBan normalizes inputs and writes expected payload', async (t) => {
  const originalFindOneAndUpdate = Ban.findOneAndUpdate;
  t.after(() => {
    Ban.findOneAndUpdate = originalFindOneAndUpdate;
  });

  let capturedQuery;
  let capturedUpdate;
  let capturedOptions;
  Ban.findOneAndUpdate = async (query, update, options) => {
    capturedQuery = query;
    capturedUpdate = update;
    capturedOptions = options;
    return { acknowledged: true };
  };

  const before = Date.now();
  await banService.addBan(' 127.0.0.1 ', 10);

  assert.deepEqual(capturedQuery, { ip: '127.0.0.1' });
  assert.equal(capturedOptions.upsert, true);
  assert.equal(capturedOptions.new, true);
  assert.equal(capturedOptions.runValidators, true);
  assert.equal(capturedOptions.setDefaultsOnInsert, true);
  assert.ok(capturedUpdate.expiresAt instanceof Date);

  const minExpected = before + 10 * 60000;
  const maxExpected = Date.now() + 10 * 60000 + 2000;
  assert.ok(capturedUpdate.expiresAt.getTime() >= minExpected);
  assert.ok(capturedUpdate.expiresAt.getTime() <= maxExpected);
});

test('addBan rejects invalid duration', async () => {
  await assert.rejects(
    () => banService.addBan('127.0.0.1', 0),
    /Durata ban non valida/
  );
});
