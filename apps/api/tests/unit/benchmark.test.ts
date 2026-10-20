import { describe, it } from 'vitest';
import { buildPlan, type PlanningSettings, type PlanningTask, type Interval } from '../../src/modules/scheduling/planner.js';
import { performance } from 'perf_hooks';

const user: PlanningSettings = {
  activeStartTime: '07:00',
  activeEndTime: '22:00',
  breakStartTime: '11:30',
  breakEndTime: '13:00',
  timezone: 'Asia/Ho_Chi_Minh',
  minBlockMinutes: 30,
  travelMinutes: 15,
};

const baseDate = '2026-10-20';
const from = new Date(`${baseDate}T07:00:00+07:00`);
const to = new Date(`${baseDate}T22:00:00+07:00`);

const occupied: Interval[] = [
  { startTime: new Date(`${baseDate}T07:00:00+07:00`), endTime: new Date(`${baseDate}T09:30:00+07:00`), location: 'UED_Room_A' },
  { startTime: new Date(`${baseDate}T14:00:00+07:00`), endTime: new Date(`${baseDate}T16:00:00+07:00`), location: 'UED_Room_B' },
];

function generateTasks(count: number): PlanningTask[] {
  const priorities: Array<'HIGH' | 'MEDIUM' | 'LOW'> = ['HIGH', 'MEDIUM', 'LOW'];
  const tasks: PlanningTask[] = [];
  for (let i = 1; i <= count; i++) {
    tasks.push({
      id: `task-${i}`,
      title: `Nhiệm vụ ${i}`,
      durationMinutes: 30 + (i % 3) * 30,
      deadline: new Date(`${baseDate}T21:30:00+07:00`),
      priority: priorities[i % 3],
      isSplittable: i % 2 === 0,
      createdAt: new Date(),
      location: i % 2 === 0 ? 'Home' : 'Library',
    });
  }
  return tasks;
}

describe('Benchmark thực nghiệm thuật toán buildPlan', () => {
  it('đo đạc hiệu năng với 5, 10, 20, 50 tasks', () => {
    const testCounts = [5, 10, 20, 50];
    console.log('\n--- KET QUA THUC NGHIEM THUAT TOAN BUILDPLAN ---');
    for (const count of testCounts) {
      const tasks = generateTasks(count);
      const iterations = 50;
      const start = performance.now();
      let totalBlocks = 0;
      let unscheduledCount = 0;

      for (let i = 0; i < iterations; i++) {
        const res = buildPlan({ user, from, to, tasks, occupied, existingBlocks: [] });
        if (i === 0) {
          totalBlocks = res.blocks.length;
          unscheduledCount = res.unscheduled.length;
        }
      }
      const duration = (performance.now() - start) / iterations;
      const successRate = (((count - unscheduledCount) / count) * 100).toFixed(1);
      console.log(`[SL Task: ${count}] -> Thoi gian xu ly: ${duration.toFixed(3)} ms | Blocks tao thanh: ${totalBlocks} | Khong xep duoc: ${unscheduledCount} | Ti le thanh cong: ${successRate}%`);
    }
    console.log('-------------------------------------------------\n');
  });
});
