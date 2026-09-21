import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, Task } from '../../apps/web/src/types';

const asOf = '2026-09-14T05:00:00.000Z'; // Noon in the student timezone.
const task = (id: string, status: Task['status']): Task => ({ id, status, title: `Kiểm thử ${id}`, notes: '',
  location: null, deadline: '2026-09-20T15:00:00Z', durationMinutes: 60, priority: 'MEDIUM', isSplittable: true, isScheduled: false });

async function mockBootstrap(page: Page, customize: (data: Bootstrap) => void) {
  await page.route('**/api/v1/bootstrap?*', async route => {
    const response = await route.fetch();
    const data = await response.json() as Bootstrap;
    Object.assign(data, { events: [], blocks: [], tasks: [], suggestions: [],
      taskHistoryPage: { hasMore: false, nextCursor: null }, taskStats: { active: 0, completed: 0, cancelled: 0 },
      agendaOverview: { asOf, localDate: '2026-09-14', dayStart: '2026-09-13T17:00:00Z', dayEnd: '2026-09-14T17:00:00Z',
        limit: 12, today: { events: [], blocks: [] }, upcoming: { events: [], blocks: [] }, past: { events: [], blocks: [] } },
    });
    customize(data);
    await route.fulfill({ response, json: data });
  });
}

test('Today follows server time and counts past, current and upcoming activities even with a wrong device clock', async ({ page }, testInfo) => {
  await mockBootstrap(page, data => {
    const events = [
      { id: 'past', title: 'Buổi học đã qua', startTime: '2026-09-14T03:00:00Z', endTime: '2026-09-14T04:00:00Z' },
      { id: 'current', title: 'Buổi học đang diễn ra', startTime: '2026-09-14T04:30:00Z', endTime: '2026-09-14T05:30:00Z' },
      { id: 'next', title: 'Buổi học tiếp theo', startTime: '2026-09-14T06:00:00Z', endTime: '2026-09-14T07:00:00Z' },
    ].map(item => ({ ...item, location: null, eventType: 'CLASS' as const, status: 'SCHEDULED' as const, source: 'MANUAL' }));
    data.events = events; data.agendaOverview.today.events = events;
  });
  await page.clock.setFixedTime(new Date('2001-01-01T00:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByRole('tab', { name: 'Hôm nay 3', exact: true })).toBeVisible();
  const weekly = page.locator('.weekly-agenda-panel');
  await expect(weekly.locator('.agenda-date-label')).toContainText('Hôm nay · 14/09');
  await expect(weekly.getByText('3 hoạt động · 1 đã qua')).toBeVisible();
  await expect(weekly.getByRole('button', { name: /Buổi học đã qua.*Đã qua/ })).toHaveClass(/is-past/);
  await expect(weekly.getByRole('button', { name: /Buổi học đang diễn ra.*Đang diễn ra/ })).toHaveClass(/is-current/);
  await expect(weekly.getByRole('button', { name: /Buổi học tiếp theo.*Sắp tới/ })).toHaveClass(/is-upcoming/);
  await page.screenshot({ path: testInfo.outputPath('today-all-activities.png'), fullPage: true });
  // A subsequent device clock change must not move the user's selected date.
  await page.clock.setFixedTime(new Date('2035-01-01T00:00:00Z'));
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await expect(page.getByLabel('Chọn ngày xem lịch')).toHaveValue('2026-09-14');
});

test('expanded history survives refresh and sessions have independent pagination with retry', async ({ page }) => {
  const recent = task('recent', 'COMPLETED'), older = task('older', 'COMPLETED'), active = task('active', 'PENDING');
  await mockBootstrap(page, data => {
    data.tasks = [active, recent]; data.taskStats = { active: 1, completed: 567, cancelled: 0 };
    data.taskHistoryPage = { hasMore: true, nextCursor: 'older-page' };
  });
  await page.route('**/api/v1/tasks/history?*', route => route.fulfill({ json: { tasks: [recent, older], page: { hasMore: false, nextCursor: null } } }));
  let nextAttempts = 0;
  await page.route('**/api/v1/tasks/*/schedule-blocks*', route => {
    const next = new URL(route.request().url()).searchParams.has('cursor');
    if (next && nextAttempts++ === 0) return route.fulfill({ status: 503, json: { error: { message: 'Test temporary failure' } } });
    const blocks = next ? [{ id: 'older-session', taskId: active.id, startTime: '2026-09-12T03:00:00Z', endTime: '2026-09-12T04:00:00Z', status: 'SCHEDULED' }]
      : [{ id: 'future-session', taskId: active.id, startTime: '2026-09-16T03:00:00Z', endTime: '2026-09-16T04:00:00Z', status: 'SCHEDULED' }];
    return route.fulfill({ json: { blocks, hasFutureBlocks: true, page: { hasMore: !next, nextCursor: next ? null : 'next-session' } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByText('567 việc đã hoàn thành', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await page.getByRole('button', { name: 'Tải thêm lịch sử công việc' }).click();
  await expect(page.getByRole('button', { name: /Kiểm thử older/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tải lại dữ liệu' }).click();
  await expect(page.getByRole('button', { name: /Kiểm thử older/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kiểm thử recent/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Tải thêm lịch sử công việc' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cần làm', exact: true }).click();
  await page.getByRole('button', { name: /Kiểm thử active/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Kiểm thử active' });
  await expect(dialog.getByRole('button', { name: 'Bỏ lịch tương lai' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Tải thêm phiên học' }).click();
  await dialog.getByRole('button', { name: 'Thử lại' }).click();
  await expect(dialog.getByText('Đã qua', { exact: true })).toBeVisible();
  await expect(dialog.locator('.task-sessions')).toContainText('12/09/2026');
  await expect(dialog.getByRole('button', { name: 'Tải thêm phiên học' })).toHaveCount(0);
});
