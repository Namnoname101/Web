import { SchedulingService } from './scheduling.service.js';

/** Triggered only after a student accepts a cancellation/change. New blocks
 * remain a proposal; a freed slot never authorizes an automatic calendar write. */
export async function proposeAfterCalendarChange(userId: string): Promise<void> {
  const from = new Date();
  try { await new SchedulingService().runAutoRescheduler(userId, from, new Date(+from + 7 * 86_400_000)); }
  catch { console.warn('Automatic proposal unavailable; student can retry from Suggestions.'); }
}
