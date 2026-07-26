const { z } = require('zod');

const callRequestSchema = z.object({
  targetNick: z.string().min(3).max(24).regex(/^[a-zA-Z0-9._-]+$/)
});

module.exports = { callRequestSchema };
