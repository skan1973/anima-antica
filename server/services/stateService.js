const mongoose = require('mongoose');
const { User } = require('../db');

const STATUS_FREE = 'libero';
const STATUS_BUSY = 'occupato';

async function getUserByNick(nick, options = {}) {
  return User.findOne(
    { nick },
    null,
    { session: options.session }
  );
}

async function reserveUser(nick, options = {}) {
  return User.findOneAndUpdate(
    { nick, status: STATUS_FREE },
    { $set: { status: STATUS_BUSY } },
    {
      new: true,
      runValidators: true,
      session: options.session
    }
  );
}

async function releaseUser(nick, options = {}) {
  return User.findOneAndUpdate(
    { nick, status: STATUS_BUSY },
    { $set: { status: STATUS_FREE } },
    {
      new: true,
      runValidators: true,
      session: options.session
    }
  );
}

// Reserve two users as a single operation so only one call can win the race.
async function reserveUsers(nick1, nick2) {
  let session = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const first = await reserveUser(nick1, { session });
    if (!first) {
      throw new Error(`STATE_CONFLICT:${nick1}`);
    }

    const second = await reserveUser(nick2, { session });
    if (!second) {
      throw new Error(`STATE_CONFLICT:${nick2}`);
    }

    await session.commitTransaction();
    return { ok: true, mode: 'transaction' };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction().catch(() => {});
    }

    if (error?.message?.startsWith('STATE_CONFLICT:')) {
      return { ok: false, code: 'STATE_CONFLICT' };
    }

    const first = await reserveUser(nick1);
    if (!first) {
      return { ok: false, code: 'STATE_CONFLICT' };
    }

    const second = await reserveUser(nick2);
    if (!second) {
      await releaseUser(nick1).catch(() => {});
      return { ok: false, code: 'STATE_CONFLICT' };
    }

    return { ok: true, mode: 'cas-fallback' };
  } finally {
    if (session) {
      await session.endSession().catch(() => {});
    }
  }
}

async function reconcileUserOnReconnect(nick, hasActiveSession) {
  const user = await getUserByNick(nick);
  if (!user) {
    return { ok: false, code: 'USER_NOT_FOUND' };
  }

  if (user.status === STATUS_BUSY && !hasActiveSession) {
    const released = await releaseUser(nick);
    return {
      ok: true,
      code: 'RELEASED_STALE_BUSY',
      user: released || { ...user.toObject(), status: STATUS_FREE }
    };
  }

  return {
    ok: true,
    code: 'UNCHANGED',
    user
  };
}

async function cleanupBusyUsersWithoutSession(hasActiveSession) {
  const busyUsers = await User.find({ status: STATUS_BUSY });
  const released = [];

  for (const user of busyUsers) {
    if (!hasActiveSession(user.nick)) {
      const result = await releaseUser(user.nick);
      if (result) {
        released.push(user.nick);
      }
    }
  }

  return released;
}

module.exports = {
  getUserByNick,
  reserveUser,
  releaseUser,
  reserveUsers,
  reconcileUserOnReconnect,
  cleanupBusyUsersWithoutSession,
  STATUS_FREE,
  STATUS_BUSY
};