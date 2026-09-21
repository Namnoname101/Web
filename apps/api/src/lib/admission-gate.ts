/** A tiny process-wide capacity gate. Every release callback is idempotent. */
export class AdmissionGate {
  private activeCount = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Admission limit must be a positive integer.');
  }

  get active(): number { return this.activeCount; }

  tryAcquire(): (() => void) | null {
    if (this.activeCount >= this.limit) return null;
    this.activeCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;
    };
  }
}
