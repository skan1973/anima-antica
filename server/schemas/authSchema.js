// server/schemas/authSchema.js
const { z } = require('zod');

/**
 * Schema di validazione per la revoca del token socket
 * Valida che il campo 'token' sia presente e non vuoto
 */
const socketTokenRevokeSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

module.exports = {
  socketTokenRevokeSchema,
};