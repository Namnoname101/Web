const SAFE_ERROR_NAMES = new Set([
  'AbortError', 'AggregateError', 'DOMException', 'Error', 'EvalError',
  'PrismaClientInitializationError', 'PrismaClientKnownRequestError',
  'PrismaClientRustPanicError', 'PrismaClientUnknownRequestError',
  'PrismaClientValidationError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'SystemError', 'TimeoutError', 'TypeError', 'URIError',
]);

const safeCode = (error: unknown): string => {
  let candidate: unknown;
  try {
    candidate = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  } catch {
    candidate = undefined;
  }
  return typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate)
    ? candidate
    : 'UNEXPECTED_ERROR';
};

const safeName = (error: unknown): string => {
  if (!(error instanceof Error)) return typeof error;
  // Error.name is writable and may originate in a third-party/remote error.
  // Emit only fixed diagnostic labels so names, tokens and page text cannot be
  // smuggled into logs through a crafted name property.
  try { return SAFE_ERROR_NAMES.has(error.name) ? error.name : 'Error'; }
  catch { return 'Error'; }
};

/** Operational error metadata that can be logged without serializing content. */
export function safeErrorSummary(error: unknown): { name: string; code: string } {
  return {
    name: safeName(error),
    code: safeCode(error),
  };
}
