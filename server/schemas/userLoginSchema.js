const { z } = require('zod');

const NICK_REGEX = /^[A-Za-z0-9._-]+$/;

const userLoginSchema = z.object({
  nick: z.string().trim().min(3).max(24).regex(NICK_REGEX),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional()
});

module.exports = {
  userLoginSchema,
  NICK_REGEX
};
