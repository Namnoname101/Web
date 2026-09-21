import { describe, expect, it } from 'vitest';
import { safeErrorSummary } from '../../src/lib/safe-error.js';

describe('safe error summaries', () => {
  it('keeps known operational labels and bounded error codes', () => {
    const error = Object.assign(new TypeError('private student data'), { code: 'ECONNRESET' });
    expect(safeErrorSummary(error)).toEqual({ name: 'TypeError', code: 'ECONNRESET' });
  });

  it('never trusts a writable Error.name as log-safe content', () => {
    const error = Object.assign(new Error('private message'), {
      name: 'Student_Name_And_Remote_Page_Text',
      code: 'unsafe code with spaces',
    });
    const summary = safeErrorSummary(error);
    expect(summary).toEqual({ name: 'Error', code: 'UNEXPECTED_ERROR' });
    expect(JSON.stringify(summary)).not.toContain('Student_Name');
  });

  it('cannot be broken by hostile metadata getters', () => {
    const error = new Error('private message');
    Object.defineProperties(error, {
      name: { get: () => { throw new Error('name getter secret'); } },
      code: { get: () => { throw new Error('code getter secret'); } },
    });
    expect(safeErrorSummary(error)).toEqual({ name: 'Error', code: 'UNEXPECTED_ERROR' });
  });
});
