const activeSocketsByJti = new Map();

const registerActiveSocket = (jti, socketId) => {
  if (jti) activeSocketsByJti.set(jti, socketId);
};

const unregisterActiveSocket = (jti) => {
  if (jti) activeSocketsByJti.delete(jti);
};

const handleTokenInvalidate = (payload, io) => {
  const { jti, revokedAt, reason } = payload;
  if (!jti) return;

  const socketId = activeSocketsByJti.get(jti);
  
  if (socketId) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      console.log(`[TOKEN_INVALIDATOR] Revoking session JTI=${jti} - Disconnecting socket=${socketId}`);
      socket.emit('auth-revoked', { reason, revokedAt });
      // Breve delay per permettere il flush del socket buffer
      setTimeout(() => socket.disconnect(true), 50);
    } else {
      console.warn(`[TOKEN_INVALIDATOR] Desync detected: JTI=${jti} found in map but socket=${socketId} not in engine.`);
    }
    activeSocketsByJti.delete(jti);
  }
};

module.exports = { registerActiveSocket, unregisterActiveSocket, handleTokenInvalidate };
