const { z } = require('zod');
const { captureError } = require('../logger');

/**
 * Middleware generico per validare i dati di richiesta Express
 * @param {z.ZodSchema} schema 
 */
const validateRequest = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      captureError('validation.error', error, {
        path: req.originalUrl,
        method: req.method
      });
      return res.status(400).json({
        error: 'Dati non validi.',
        details: error.errors
      });
    }
    next(error);
  }
};

module.exports = {
  validateRequest,
  schemas: {
    socketTokenRevoke: z.object({
      body: z.object({
        token: z.string().min(1)
      })
    })
  }
};

