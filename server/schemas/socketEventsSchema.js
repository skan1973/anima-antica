// server/schemas/socketEventsSchema.js
const { z } = require('zod');

const userSnapshotSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').max(800000),
  timestamp: z.number().int().positive().optional()
});

const sdpSignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string().max(200000)
}).strict();

const iceCandidateSignalSchema = z.object({
  candidate: z.string().max(10000),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional()
}).strict();

const controlSignalSchema = z.object({
  type: z.enum(['renegotiate', 'end', 'hangup'])
}).strict();

const signalDataSchema = z.union([
  sdpSignalSchema,
  iceCandidateSignalSchema,
  controlSignalSchema
]);

const signalSchema = z.object({
  roomId: z.string().min(1),
  signalData: signalDataSchema
}).strict();

module.exports = { userSnapshotSchema, signalSchema, signalDataSchema };