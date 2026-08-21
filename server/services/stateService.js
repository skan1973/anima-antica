// server/services/stateService.js
const mongoose = require('mongoose');
const { User } = require('../db');

const STATUS_FREE = 'libero';
const STATUS_BUSY = 'occupato';

const reconnectsInFlight = new Set();

const isNickInActiveCall = (activeSessions, nick) => {
  if (!(activeSessions instanceof Map) || typeof nick !== 'string' || !nick) {
    return false;
  }

  for (const session of activeSessions.values()) {
    if (session?.participantNicks instanceof Set && session.participantNicks.has(nick)) {
      return true;
    }
  }

  return false;
};

const restoreUserStateAfterReconnect = async ({
  nick,
  userModel = User,
  activeSessions
}) => {
  if (typeof nick !== 'string' || !nick.trim()) {
    throw new Error('Nick non valido');
  }

  const normalizedNick = nick.trim();
  if (reconnectsInFlight.has(normalizedNick)) {
    const error = new Error('Riconnessione già in corso');
    error.code = 'RECONNECT_IN_PROGRESS';
    throw error;
  }

  reconnectsInFlight.add(normalizedNick);

  try {
    const user = await userModel.findOne({ nick: normalizedNick });
    if (!user) {
      return { recovered: false, reason: 'USER_NOT_FOUND', user: null };
    }

    if (user.status !== STATUS_BUSY) {
      return { recovered: false, reason: 'STATUS_ALREADY_FREE', user };
    }

    if (isNickInActiveCall(activeSessions, normalizedNick)) {
      return { recovered: false, reason: 'ACTIVE_CALL_PRESENT', user };
    }

    const updatedUser = await userModel.findOneAndUpdate(
      { nick: normalizedNick, status: STATUS_BUSY },
      { status: STATUS_FREE },
      {
        new: true,
        runValidators: true
      }
    );

    return {
      recovered: Boolean(updatedUser),
      reason: updatedUser ? 'RECOVERED_TO_FREE' : 'STATUS_ALREADY_FREE',
      user: updatedUser || user
    };
  } finally {
    reconnectsInFlight.delete(normalizedNick);
  }
};

const cleanupBusyUsersOnStartup = async ({ userModel = User } = {}) => {
  const result = await userModel.updateMany(
    { status: STATUS_BUSY },
    { status: STATUS_FREE },
    { runValidators: true }
  );

  return {
    matchedCount: result?.matchedCount ?? result?.n ?? 0,
    modifiedCount: result?.modifiedCount ?? result?.nModified ?? 0
  };
};

const resetReconnectGuardsForTests = () => {
  reconnectsInFlight.clear();
};

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

async function getStateMetrics() {
  const [total, busy] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: STATUS_BUSY })
  ]);
  return { total, busy };
}

module.exports = {
  getUserByNick,
  reserveUser,
  releaseUser,
  reserveUsers,
  reconcileUserOnReconnect,
  cleanupBusyUsersWithoutSession,
  restoreUserStateAfterReconnect,
  cleanupBusyUsersOnStartup,
  isNickInActiveCall,
  resetReconnectGuardsForTests,
  getStateMetrics,
  STATUS_FREE,
  STATUS_BUSY
};