const test = require('node:test');
const assert = require('node:assert/strict');

const { messageSchema } = require('../server/schemas/messageSchema');
const { userLoginSchema } = require('../server/schemas/userLoginSchema');

test('messageSchema accepts valid message length', () => {
  const result = messageSchema.safeParse('ciao mondo');
  assert.equal(result.success, true);
});

test('messageSchema rejects empty message', () => {
  const result = messageSchema.safeParse('');
  assert.equal(result.success, false);
});

test('messageSchema rejects messages over 1000 chars', () => {
  const tooLong = 'a'.repeat(1001);
  const result = messageSchema.safeParse(tooLong);
  assert.equal(result.success, false);
});

test('userLoginSchema trims nick and uppercases country code', () => {
  const parsed = userLoginSchema.parse({ nick: '  Skan_User  ', countryCode: 'it' });
  assert.equal(parsed.nick, 'Skan_User');
  assert.equal(parsed.countryCode, 'IT');
});

test('userLoginSchema rejects invalid nick characters', () => {
  const result = userLoginSchema.safeParse({ nick: 'bad nick!' });
  assert.equal(result.success, false);
});

test('userLoginSchema rejects country codes that are not 2 letters', () => {
  const result = userLoginSchema.safeParse({ nick: 'SkanUser', countryCode: 'ITA' });
  assert.equal(result.success, false);
});
