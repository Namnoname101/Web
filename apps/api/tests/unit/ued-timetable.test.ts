import { describe, expect, it } from 'vitest';
import { decodeMask, expandTimetable } from '../../src/modules/integrations/ued/timetable.js';
import type { UedRecord } from '../../src/modules/integrations/ued/adapter.js';

const record:UedRecord={externalId:'row',pageKey:'timetable',category:'SCHEDULE',title:'Example class',term:{academicYear:'2025',semester:'2'},fields:{weekday:'2',courseCode:'COURSE',group:'01',periods:'−−−−−−−−−012−−−',weeks:'1−3',location:'A101'}};
const weeks=[{week:1,startsOn:'2025-12-29',endsOn:'2026-01-04',label:'Week 1'},{week:3,startsOn:'2026-01-12',endsOn:'2026-01-18',label:'Week 3'}];
describe('UED period/week expansion',()=>{
  it.each([
    [1, '00:00', '00:50'], [2, '00:50', '01:40'], [3, '01:45', '02:35'],
    [4, '02:40', '03:30'], [5, '03:35', '04:25'], [6, '04:25', '05:15'],
    [7, '06:00', '06:50'], [8, '06:50', '07:40'], [9, '07:45', '08:35'],
    [10, '08:40', '09:30'], [11, '09:35', '10:25'], [12, '10:25', '11:15'],
  ])('uses the user-confirmed clock boundaries for period %s', (period, start, end) => {
    const mask = Array.from({ length: 15 }, (_, index) => index + 1 === period ? String(period % 10) : '−').join('');
    const [event] = expandTimetable([{ ...record, fields: { ...record.fields, periods: mask, weeks: '1' } }], weeks, 'Asia/Ho_Chi_Minh');
    expect(event.schedule).toMatchObject({
      startTime: `2025-12-29T${start}:00.000Z`,
      endTime: `2025-12-29T${end}:00.000Z`,
    });
  });
  it('reads tenth/eleventh/twelfth positions and keeps a New Year week date',()=>{
    const events=expandTimetable([record],weeks,'Asia/Ho_Chi_Minh');
    expect(events.map(e=>[e.schedule?.startTime,e.schedule?.endTime])).toEqual([
      ['2025-12-29T08:40:00.000Z','2025-12-29T11:15:00.000Z'],
      ['2026-01-12T08:40:00.000Z','2026-01-12T11:15:00.000Z'],
    ]);
  });
  it('maps Sunday and preserves internal small breaks',()=>{
    const [event]=expandTimetable([{...record,fields:{...record.fields,weekday:'Chủ nhật',periods:'123−−−−−−−−−−−−',weeks:'1'}}],weeks,'Asia/Ho_Chi_Minh');
    expect(event.schedule).toMatchObject({startTime:'2026-01-04T00:00:00.000Z',endTime:'2026-01-04T02:35:00.000Z'});
  });
  it('does not merge separated periods or morning across lunch',()=>{
    expect(expandTimetable([{...record,fields:{...record.fields,periods:'1−3−−67−−−−−−−−',weeks:'1'}}],weeks,'Asia/Ho_Chi_Minh')).toHaveLength(4);
  });
  it('preserves the exact noon gap even when periods six and seven are adjacent in the mask', () => {
    const events = expandTimetable([{ ...record, fields: { ...record.fields, periods: '−−−−−67−−−−−−−−', weeks: '1' } }], weeks, 'Asia/Ho_Chi_Minh');
    expect(events.map(event => [event.schedule?.startTime, event.schedule?.endTime])).toEqual([
      ['2025-12-29T04:25:00.000Z', '2025-12-29T05:15:00.000Z'],
      ['2025-12-29T06:00:00.000Z', '2025-12-29T06:50:00.000Z'],
    ]);
  });
  it('decodes rollover week digits by position, tolerates spacing, and leaves absent weeks empty', () => {
    expect(decodeMask(' − − − − − − − − − 0 − − − − − − − − − 0 ', 60)).toEqual([10, 20]);
    expect(expandTimetable([{ ...record, fields: { ...record.fields, weeks: '−−−' } }], weeks, 'Asia/Ho_Chi_Minh')).toEqual([]);
    expect(() => decodeMask('−−−−−−−−−1', 60)).toThrow('UED_INVALID_TIMETABLE_MASK');
  });
  it('rejects duplicate meetings and contradictory weekday/week ranges', () => {
    expect(() => expandTimetable([record, record], weeks, 'Asia/Ho_Chi_Minh')).toThrow('UED_DUPLICATE_MEETING');
    expect(() => expandTimetable([{ ...record, fields: { ...record.fields, weekday: '1' } }], weeks, 'Asia/Ho_Chi_Minh')).toThrow('UED_INVALID_WEEKDAY');
    expect(() => expandTimetable([record], [{ ...weeks[0], startsOn: '2025-12-30' }, weeks[1]], 'Asia/Ho_Chi_Minh')).toThrow('UED_WEEK_MAPPING_FAILED');
    expect(() => expandTimetable([{ ...record, fields: { ...record.fields, weekday: '8' } }], [{ ...weeks[0], endsOn: '2026-01-03' }, weeks[1]], 'Asia/Ho_Chi_Minh')).toThrow('UED_WEEK_MAPPING_FAILED');
  });
  it('rejects unknown period clock times and missing week dates',()=>{
    expect(()=>expandTimetable([{...record,fields:{...record.fields,periods:'−−−−−−−−−−−−3−−'}}],weeks,'Asia/Ho_Chi_Minh')).toThrow('UED_PERIOD_TIMES_REQUIRED');
    expect(()=>expandTimetable([record],weeks.slice(0,1),'Asia/Ho_Chi_Minh')).toThrow('UED_WEEK_MAPPING_FAILED');
    expect(()=>decodeMask('12X',15)).toThrow();
  });
  it('keeps occurrence identity on room changes and semester-import retries',()=>{
    const original=expandTimetable([record],weeks,'Asia/Ho_Chi_Minh');
    const changed=expandTimetable([{...record,fields:{...record.fields,location:'B202'}}],weeks,'Asia/Ho_Chi_Minh');
    expect(changed.map(e=>e.externalId)).toEqual(original.map(e=>e.externalId));
  });
  it('keeps occurrence identity when UED corrects the starting period', () => {
    const original = expandTimetable([{ ...record, fields: { ...record.fields, periods: '−234−−−−−−−−−−−', weeks: '1' } }], weeks, 'Asia/Ho_Chi_Minh');
    const corrected = expandTimetable([{ ...record, fields: { ...record.fields, periods: '−−345−−−−−−−−−−', weeks: '1' } }], weeks, 'Asia/Ho_Chi_Minh');
    expect(corrected[0].externalId).toBe(original[0].externalId);
    expect(corrected[0].schedule?.startTime).not.toBe(original[0].schedule?.startTime);
  });
});
