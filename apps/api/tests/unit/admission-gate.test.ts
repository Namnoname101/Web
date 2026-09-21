import { describe, expect, it } from 'vitest';
import { AdmissionGate } from '../../src/lib/admission-gate.js';

describe('process capacity admission gate', () => {
  it('rejects work at capacity and admits it after release', () => {
    const gate = new AdmissionGate(2);
    const releaseA = gate.tryAcquire();
    const releaseB = gate.tryAcquire();
    expect(releaseA).toBeTypeOf('function');
    expect(releaseB).toBeTypeOf('function');
    expect(gate.active).toBe(2);
    expect(gate.tryAcquire()).toBeNull();
    releaseA?.();
    expect(gate.tryAcquire()).toBeTypeOf('function');
  });

  it('makes release idempotent and validates the configured limit', () => {
    expect(() => new AdmissionGate(0)).toThrow(/positive integer/);
    const gate = new AdmissionGate(1);
    const release = gate.tryAcquire()!;
    release();
    release();
    expect(gate.active).toBe(0);
  });
});
