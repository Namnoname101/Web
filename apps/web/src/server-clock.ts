/** Advance server time with a monotonic clock, even if the device clock changes. */
export class ServerClock {
  private anchor: { epoch: number; elapsed: number } | null = null;

  synchronize(asOf: string, sentAt: number, receivedAt: number): boolean {
    const epoch = Date.parse(asOf);
    if (!Number.isFinite(epoch) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt) || receivedAt < sentAt) return false;
    this.anchor = { epoch: epoch + (receivedAt - sentAt) / 2, elapsed: receivedAt };
    return true;
  }

  now(elapsed = performance.now(), fallback = Date.now()): number {
    return this.anchor ? this.anchor.epoch + Math.max(0, elapsed - this.anchor.elapsed) : fallback;
  }
}
