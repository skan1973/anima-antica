const { captureError } = require('../logger');

/**
 * Wrapper per validare i messaggi WebSocket in ingresso.
 * @param {import('socket.io').Socket} socket 
 * @param {import('zod').ZodSchema} schema 
 * @param {Function} handler 
 */
const validateSocketEvent = (schema, handler) => {
  return async (payload) => {
    try {
      const result = schema.safeParse(payload);
      if (!result.success) {
        return; // Silenziamo o logghiamo in base alla criticità
      }
      await handler(result.data);
    } catch (error) {
      captureError('socket.event_handler_error', error);
    }
  };
};

module.exports = { validateSocketEvent };
