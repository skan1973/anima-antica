const { z } = require('zod');

const userSnapshotSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').max(800000),
  timestamp: z.number().int().positive().optional()
});

const signalSchema = z.object({
  roomId: z.string().min(1),
  signalData: z.any() // Signal data è complesso, validiamo solo la presenza di roomId
});

module.exports = { userSnapshotSchema, signalSchema };
