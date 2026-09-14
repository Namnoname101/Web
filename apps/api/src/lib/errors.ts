import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } });
  } else if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  } else if (error?.code === 'P2002') {
    res.status(409).json({ error: { code: 'DUPLICATE_RECORD' } });
  } else if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { code: 'INVALID_JSON' } });
  } else {
    // Never log tokens, request bodies, connection strings or upstream responses.
    console.error('Request failed', { name: error?.name, code: error?.code });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  }
};
