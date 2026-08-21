// server/schemas/callSchema.js
const { z } = require('zod');
const { NICK_REGEX } = require('./userLoginSchema');

/**
 * Schema di validazione per richieste di chiamata
 * Valida che targetNick rispetti le stesse regole di userLoginSchema
 */
const callRequestSchema = z.object({
  targetNick: z.string().min(3).max(24).regex(NICK_REGEX)
});

module.exports = { callRequestSchema };