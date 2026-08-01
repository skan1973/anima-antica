const { User } = require('../db');

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

    if (user.status !== 'occupato') {
      return { recovered: false, reason: 'STATUS_ALREADY_FREE', user };
    }

    if (isNickInActiveCall(activeSessions, normalizedNick)) {
      return { recovered: false, reason: 'ACTIVE_CALL_PRESENT', user };
    }

    const updatedUser = await userModel.findOneAndUpdate(
      { nick: normalizedNick, status: 'occupato' },
      { status: 'libero' },
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
    { status: 'occupato' },
    { status: 'libero' },
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

module.exports = {
  restoreUserStateAfterReconnect,
  cleanupBusyUsersOnStartup,
  isNickInActiveCall,
  resetReconnectGuardsForTests
};
