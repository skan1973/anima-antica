// server/schemas/socketEventsSchema.js
const { z } = require('zod');

const userSnapshotSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').max(800000),
  timestamp: z.number().int().positive().optional()
});

const signalSchema = z.object({
  roomId: z.string().min(1),
  signalData: z.any()
});

module.exports = { userSnapshotSchema, signalSchema };