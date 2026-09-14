import { z } from 'zod';
export const idSchema = z.string().uuid();
export const instant = z.iso.datetime({ offset: true }).transform(v => new Date(v));
export const title = z.string().trim().min(1).max(255);
export const location = z.string().trim().max(255).nullable().optional();
export const taskInput = z.object({
  title, notes: z.string().max(5000).default(''), location,
  durationMinutes: z.number().int().min(15).max(43_200), deadline: instant,
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  isSplittable: z.boolean().default(true),
});
export const eventInput = z.object({
  title, location, startTime: instant, endTime: instant,
  eventType: z.enum(['CLASS', 'PERSONAL', 'DEADLINE']).default('PERSONAL'),
}).refine(v => +v.endTime > +v.startTime, { message: 'End must be after start', path: ['endTime'] });
export const settingsInput = z.object({
  name: z.string().trim().min(1).max(120), locale: z.enum(['vi', 'en']),
  timezone: z.string().max(64).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  activeStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  activeEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  minBlockMinutes: z.number().int().min(15).max(120),
  travelMinutes: z.number().int().min(0).max(120), studyLocation: location,
  notificationsEnabled: z.boolean(),
}).refine(v => v.activeStartTime < v.activeEndTime && v.breakStartTime >= v.activeStartTime && v.breakStartTime < v.breakEndTime && v.breakEndTime <= v.activeEndTime, { message: 'Break must be within active hours', path: ['breakStartTime'] });
export const horizonInput = z.object({ fromDate: instant, toDate: instant }).refine(v => +v.toDate > +v.fromDate && +v.toDate - +v.fromDate <= 90 * 86_400_000, { message: 'Choose a range of at most 90 days' });
