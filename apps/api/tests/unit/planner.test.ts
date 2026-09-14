import { describe, expect, it } from 'vitest';
import { allowedWindows, buildPlan, conflicts, type PlanningSettings, type PlanningTask } from '../../src/modules/scheduling/planner.js';

const at = (time: string) => new Date(`2030-09-12T${time}:00+07:00`);
const user: PlanningSettings = { activeStartTime: '07:00', activeEndTime: '22:00', breakStartTime: '11:30', breakEndTime: '13:00', timezone: 'Asia/Ho_Chi_Minh', minBlockMinutes: 30, travelMinutes: 0 };
const task = (id: string, durationMinutes: number, extra: Partial<PlanningTask> = {}): PlanningTask => ({ id, title: id, durationMinutes, deadline: at('22:00'), priority: 'MEDIUM', isSplittable: true, createdAt: at('06:00'), ...extra });
const plan = (tasks: PlanningTask[], options: Partial<Parameters<typeof buildPlan>[0]> = {}) => buildPlan({ user, from: at('07:00'), to: at('22:00'), tasks, occupied: [], existingBlocks: [], ...options });
const range = (start: string, end: string, location: string | null = null) => ({ startTime: at(start), endTime: at(end), location });

describe('student-controlled scheduling invariants', () => {
  it('excludes the break and outside active hours in the student timezone', () => {
    expect(allowedWindows(user, at('00:00'), at('23:59'))).toEqual([range('07:00', '11:30'), range('13:00', '22:00')].map(({ location, ...r }) => r));
  });
  it('clips occupied intervals crossing the horizon and break', () => {
    const result = plan([task('a', 180)], { occupied: [range('06:00','08:00'), range('10:00','14:00')] });
    expect(result.blocks.map(b => [b.startTime,b.endTime])).toEqual([[at('08:00'),at('10:00')],[at('14:00'),at('15:00')]]);
  });
  it('uses HIGH then MEDIUM then LOW and earliest deadline within each group', () => {
    const result = plan([task('low',30,{priority:'LOW',deadline:at('10:00')}),task('h2',30,{priority:'HIGH'}),task('m',30),task('h1',30,{priority:'HIGH',deadline:at('10:00')})]);
    expect(result.blocks.map(b => b.taskId)).toEqual(['h1','h2','m','low']);
  });
  it('does not commit an incomplete task and lets a smaller task use the gap', () => {
    const result = plan([task('large',90,{priority:'HIGH'}), task('small',30)], { to: at('08:00') });
    expect(result.blocks.map(b => b.taskId)).toEqual(['small']);
    expect(result.unscheduled[0]).toMatchObject({taskId:'large',reason:'INSUFFICIENT_TIME'});
  });
  it('splits 70 as 40+30 instead of producing a 10-minute tail', () => {
    const result = plan([task('a',70)], { to: at('10:00'), occupied: [range('08:00','09:00')] });
    expect(result.blocks.map(b => (+b.endTime-+b.startTime)/60000)).toEqual([40,30]);
  });
  it('honors a custom minimum and never places work after deadline', () => {
    const result = plan([task('a',30,{deadline:at('07:30')}), task('short',15,{deadline:at('07:45')})], { user:{...user,minBlockMinutes:15} });
    expect(result.blocks.map(b => b.endTime)).toEqual([at('07:30'),at('07:45')]);
  });
  it('keeps unsplittable tasks whole and fills the earlier small gap', () => {
    const result = plan([task('large',90,{priority:'HIGH',isSplittable:false}),task('small',30)], { to:at('10:30'),occupied:[range('07:30','09:00')] });
    expect(result.blocks.map(b => [b.taskId,b.startTime])).toEqual([['small',at('07:00')],['large',at('09:00')]]);
  });
  it('respects all existing allocations including blocks outside the horizon', () => {
    const result = plan([task('a',90)], { existingBlocks:[{...range('05:00','06:00'),taskId:'a'}] });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].endTime).toEqual(at('07:30'));
  });
  it('reserves travel time, omitting it only for known matching locations', () => {
    const result = plan([task('a',30,{location:'Library'})], { user:{...user,travelMinutes:15},occupied:[range('07:00','08:00','Building A')] });
    expect(result.blocks[0].startTime).toEqual(at('08:15'));
    const same = plan([task('a',30,{location:' library '})], { user:{...user,travelMinutes:15},occupied:[range('07:00','08:00','Library')] });
    expect(same.blocks[0].startTime).toEqual(at('08:00'));
    expect(conflicts(range('07:00','08:00'),range('08:00','09:00'),15)).toBe(true);
  });
  it('keeps split pieces acceptance-safe across a break shorter than the travel buffer', () => {
    const shortBreak = { ...user, activeEndTime:'10:00', breakStartTime:'08:00', breakEndTime:'08:05', travelMinutes:15 };
    const unknown = plan([task('unknown',120)], { user:shortBreak, to:at('10:00') });
    expect(unknown.blocks.map(b => [b.startTime,b.endTime])).toEqual([
      [at('07:00'),at('08:00')], [at('08:15'),at('09:15')],
    ]);
    expect(conflicts(unknown.blocks[0], unknown.blocks[1], shortBreak.travelMinutes)).toBe(false);

    const known = plan([task('known',120,{location:'Library'})], { user:shortBreak, to:at('10:00') });
    expect(known.blocks.map(b => [b.startTime,b.endTime])).toEqual([
      [at('07:00'),at('08:00')], [at('08:05'),at('09:05')],
    ]);
    expect(conflicts(known.blocks[0], known.blocks[1], shortBreak.travelMinutes)).toBe(false);
  });
  it('rounds the start inward and cannot allocate past the clipped end', () => {
    const result = plan([task('a',30)],{from:new Date(+at('07:00')+1000),to:at('07:31')});
    expect(result.blocks[0].startTime).toEqual(at('07:01'));
    expect(result.blocks[0].endTime).toEqual(at('07:31'));
  });
  it('rejects invalid settings and nonexistent DST wall times', () => {
    expect(()=>allowedWindows({...user,breakEndTime:'23:00'},at('07:00'),at('22:00'))).toThrow();
    expect(()=>allowedWindows({...user,timezone:'America/New_York',activeStartTime:'02:30'},new Date('2030-03-10T00:00:00-05:00'),new Date('2030-03-11T00:00:00-04:00'))).toThrow('NONEXISTENT_LOCAL_TIME');
  });
  it('never mutates input occupied intervals or tasks', () => {
    const tasks=[task('a',60)], occupied=[range('08:00','09:00')];
    const before=JSON.stringify({tasks,occupied}); plan(tasks,{occupied});
    expect(JSON.stringify({tasks,occupied})).toBe(before);
  });
});
