import { fromZonedTime } from 'date-fns-tz';
import { hash } from '../../../lib/crypto.js';
import { ApiError } from '../../../lib/errors.js';
import type { UedRecord, UedWeekRange } from './adapter.js';

/** UED period times explicitly supplied and confirmed by the project owner.
 * Never derive a bell schedule from credit hours or another university. */
export const UED_PERIOD_TIMES: Record<number, readonly [string, string]> = {
  1: ['07:00','07:50'], 2: ['07:50','08:40'], 3: ['08:45','09:35'],
  4: ['09:40','10:30'], 5: ['10:35','11:25'], 6: ['11:25','12:15'],
  7: ['13:00','13:50'], 8: ['13:50','14:40'], 9: ['14:45','15:35'],
  10: ['15:40','16:30'], 11: ['16:35','17:25'], 12: ['17:25','18:15'],
};

export function decodeMask(mask: string, maximum: number): number[] {
  const chars = [...mask.replace(/\s/g,'')];
  if (!chars.length || chars.length > maximum || chars.some((c,i) => !['−','-','–','_'].includes(c) && c !== String((i+1)%10))) throw new ApiError(502,'UED_INVALID_TIMETABLE_MASK');
  return chars.flatMap((c,i)=>/^\d$/.test(c)?[i+1]:[]);
}

/** A single source row can recur in several non-consecutive teaching weeks.
 * Exact dates come from the portal's weekly selector; unknown periods fail
 * closed instead of becoming fabricated midnight or all-day events. */
export function expandTimetable(records: UedRecord[], weekRanges: UedWeekRange[], timezone: string): UedRecord[] {
  const result: UedRecord[] = [];
  const seen = new Set<string>();
  for (const record of records.filter(r=>r.pageKey==='timetable')) {
    const fields=record.fields;
    const weekday = fields.weekday === 'Chủ nhật' ? 7 : Number(fields.weekday)-1;
    if (!Number.isInteger(weekday) || weekday<1 || weekday>7) throw new ApiError(502,'UED_INVALID_WEEKDAY');
    const periods=decodeMask(fields.periods,15);
    const weeks=decodeMask(fields.weeks,60);
    if (periods.some(p=>!UED_PERIOD_TIMES[p])) throw new ApiError(502,'UED_PERIOD_TIMES_REQUIRED');
    const groups:number[][]=[];
    for(const period of periods) {
      const last=groups.at(-1);
      // Noon is never an internal class break; represent separate morning/afternoon blocks.
      if(last && last.at(-1)===period-1 && period!==7) last.push(period); else groups.push([period]);
    }
    for(const week of weeks) {
      const range=weekRanges.find(w=>w.week===week);
      if(!range) throw new ApiError(502,'UED_WEEK_MAPPING_FAILED');
      const monday = new Date(`${range.startsOn}T12:00:00Z`);
      if(monday.getUTCDay()!==1) throw new ApiError(502,'UED_WEEK_MAPPING_FAILED');
      const date=new Date(+monday+(weekday-1)*86_400_000).toISOString().slice(0,10);
      if(date>range.endsOn) throw new ApiError(502,'UED_WEEK_MAPPING_FAILED');
      for(const [groupIndex, group] of groups.entries()) {
        const first=group[0], last=group.at(-1)!;
        // A time/period correction must update the same occurrence, not create
        // a second class beside the old one. Course + group + date + segment
        // position is the strongest stable identity exposed by this portal.
        // If two source rows make it ambiguous, seen below fails the sync closed.
        const externalId=hash(`ued-class:${record.term?.academicYear}:${record.term?.semester}:${fields.courseCode}:${fields.group}:${date}:${groupIndex}`);
        if(seen.has(externalId)) throw new ApiError(502,'UED_DUPLICATE_MEETING');
        seen.add(externalId);
        result.push({...record,externalId,fields:{...fields,date,periodRange:`${first}–${last}`},schedule:{
          externalId,title:record.title,
          startTime:fromZonedTime(`${date}T${UED_PERIOD_TIMES[first][0]}:00`,timezone).toISOString(),
          endTime:fromZonedTime(`${date}T${UED_PERIOD_TIMES[last][1]}:00`,timezone).toISOString(),
          location:fields.location||null,eventType:'CLASS',cancelled:false,
        }});
      }
    }
  }
  return result;
}
