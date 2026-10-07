import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, Task } from '../../apps/web/src/types';

// Let in-flight fixture reads finish before Playwright disposes their responses.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });

const asOf = '2026-09-14T05:00:00.000Z'; // Noon in the student timezone.
const task = (id: string, status: Task['status']): Task => ({ id, status, title: `Kiểm thử ${id}`, notes: '',
  location: null, deadline: '2026-09-20T15:00:00Z', durationMinutes: 60, priority: 'MEDIUM', isSplittable: true, isScheduled: false });

async function mockBootstrap(page: Page, customize: (data: Bootstrap) => void) {
  // This fixture replaces the entire agenda with a fixed server clock. Reuse
  // its initial real account response instead of starting redundant backend
  // reads on every simulated clock/week change (including during teardown).
  let base: Promise<Bootstrap> | undefined;
  await page.route('**/api/v1/bootstrap?*', async route => {
    base ??= route.fetch().then(response => response.json() as Promise<Bootstrap>);
    const data = structuredClone(await base);
    Object.assign(data, { events: [], blocks: [], tasks: [], suggestions: [], notifications: [], integrations: [], academicRecords: [],
      taskHistoryPage: { hasMore: false, nextCursor: null }, taskStats: { active: 0, completed: 0, cancelled: 0 },
      agendaOverview: { asOf, localDate: '2026-09-14', dayStart: '2026-09-13T17:00:00Z', dayEnd: '2026-09-14T17:00:00Z',
        limit: 12, today: { events: [], blocks: [] }, upcoming: { events: [], blocks: [] }, past: { events: [], blocks: [] } },
    });
    customize(data);
    await route.fulfill({ json: data });
  });
}

test('Today follows server time and counts past, current and upcoming activities even with a wrong device clock', async ({ page }, testInfo) => {
  const requestedWeeks: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/bootstrap') requestedWeeks.push(url.searchParams.get('fromDate') || '');
  });
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
  const today = page.locator('.dash-today');
  await expect(page.locator('.dashboard-pilot > .app-page-header')).toContainText('14/09/2026');
  await expect(today.getByText('3 hoạt động · 1 đã qua')).toBeVisible();
  await expect(today.getByRole('button', { name: /Buổi học đã qua.*Đã qua/ })).toHaveClass(/is-past/);
  await expect(today.getByRole('button', { name: /Buổi học đang diễn ra.*Đang diễn ra/ })).toHaveClass(/is-current/);
  await expect(today.getByRole('button', { name: /Buổi học tiếp theo.*Sắp tới/ })).toHaveClass(/is-upcoming/);
  await expect(today.getByRole('region', { name: 'Buổi sáng', exact: true }).locator('.dash-agenda-item')).toHaveCount(2);
  await expect(today.getByRole('region', { name: 'Trưa & chiều', exact: true }).locator('.dash-agenda-item')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('today-all-activities.png'), fullPage: true });
  // A subsequent device clock change must not move the user's selected date.
  await page.clock.setFixedTime(new Date('2035-01-01T00:00:00Z'));
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await expect(page.getByLabel('Chọn ngày xem lịch')).toHaveValue('2026-09-14');
  await page.getByRole('button', { name: 'Tuần trước', exact: true }).click();
  await expect.poll(() => requestedWeeks.at(-1)).toBe('2026-09-06T17:00:00.000Z');
  await page.goBack();
  await expect(page).toHaveURL(/#dashboard$/);
  await expect.poll(() => requestedWeeks.at(-1)).toBe('2026-09-13T17:00:00.000Z');
  await expect(page.getByRole('button', { name: 'Tải lại dữ liệu' })).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'Hôm nay 3', exact: true })).toBeVisible();
});

test('UED is the only real login shown even when Microsoft integration is configured', async ({ page }) => {
  await page.route('**/api/v1/auth/config', route => route.fulfill({ json: { uedEnabled: true, microsoftEnabled: true, demoEnabled: true } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Đăng nhập bằng mã sinh viên' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Khám phá bản demo' })).toBeVisible();
  await expect(page.locator('a[href="/api/v1/auth/microsoft/start"]')).toHaveCount(0);
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
  await expect(page.locator('.dash-stats').getByText(/567 đã hoàn thành/)).toBeVisible();
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

test('six main navigation items keep planner review nested under Calendar including old bookmarks', async ({ page }, testInfo) => {
  await mockBootstrap(page, () => {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('button')).toHaveCount(6);
  await expect(nav.getByRole('button', { name: /Đề xuất|Suggestions/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Hôm nay 0', exact: true })).toBeVisible();
  await expect(page.locator('.dash-today').getByText('Chưa có lịch', { exact: true })).toHaveCount(3);
  await expect(page.locator('.dash-next')).toContainText('Chưa có lịch sắp tới');
  await expect(page.locator('.dash-planner')).toContainText('0 đề xuất tự học đang chờ xác nhận');
  await page.screenshot({ path: testInfo.outputPath('dashboard-empty.png'), fullPage: true });

  await page.locator('.dashboard-pilot > .app-page-header').getByRole('button', { name: 'Gợi ý xếp lịch' }).click();
  await expect(page).toHaveURL(/#calendar\/suggestions$/);
  await expect(nav.getByRole('button', { name: 'Lịch của tôi' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('checkbox', { name: 'Hiện lịch sử' })).toBeVisible();
  for (const hash of ['calendar/suggestions', 'suggestions']) {
    await page.goto(`/#${hash}`);
    await expect(page.getByRole('checkbox', { name: 'Hiện lịch sử' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Lịch của tôi' })).toHaveAttribute('aria-current', 'page');
  }
  for (const [label, hash] of [
    ['Tổng quan', 'dashboard'], ['Lịch của tôi', 'calendar'], ['Công việc', 'tasks'],
    ['Thông báo', 'notifications'], ['Kết nối dữ liệu', 'integrations'], ['Cài đặt', 'settings'],
  ]) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  const skip = page.getByRole('link', { name: 'Đến nội dung chính' });
  await skip.focus(); await skip.press('Enter');
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('UED classes stay read-only while personal events keep their existing editor', async ({ page }) => {
  await mockBootstrap(page, data => {
    data.events = [
      { id: 'ued-class', title: 'Lớp cố định UED', source: 'SCHOOL_PORTAL', eventType: 'CLASS',
        startTime: '2026-09-14T06:00:00Z', endTime: '2026-09-14T07:00:00Z', location: 'B3-301', status: 'SCHEDULED' },
      { id: 'personal-event', title: 'Lịch cá nhân có thể sửa', source: 'MANUAL', eventType: 'PERSONAL',
        startTime: '2026-09-14T08:00:00Z', endTime: '2026-09-14T09:00:00Z', location: null, status: 'SCHEDULED' },
    ];
    data.agendaOverview.today.events = data.events;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  const today = page.locator('.dash-today');
  await expect(today.getByText('Lớp UED · Chỉ xem', { exact: true })).toBeVisible();
  await today.getByRole('button', { name: /Lớp cố định UED/ }).click();
  const fixed = page.getByRole('dialog', { name: 'Lớp cố định UED' });
  await expect(fixed).toBeVisible();
  await expect(fixed.getByRole('button', { name: /Chỉnh sửa|Đã hoàn thành|Hủy sự kiện|Khôi phục lịch/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(fixed).toBeHidden();

  await today.getByRole('button', { name: /Lịch cá nhân có thể sửa/ }).click();
  await page.getByRole('dialog', { name: 'Lịch cá nhân có thể sửa' }).getByRole('button', { name: 'Chỉnh sửa' }).click();
  const editor = page.getByRole('dialog', { name: 'Chỉnh sửa lịch cá nhân' });
  await expect(editor.getByLabel('Bắt đầu', { exact: true })).toHaveValue('2026-09-14T15:00');
  await expect(editor.getByLabel('Kết thúc', { exact: true })).toHaveValue('2026-09-14T16:00');
  await expect(editor.getByLabel('Deadline', { exact: true })).toHaveCount(0);
});

test('long real-shaped content wraps at mobile, tablet and desktop without losing activity types', async ({ page }, testInfo) => {
  const title = 'Bài tập nhóm và báo cáo học phần '.repeat(6).trim();
  const location = `Phòng_${'B301'.repeat(35)}`;
  await mockBootstrap(page, data => {
    const active = { ...task('long-title', 'PENDING'), title, isScheduled: true, deadline: '2026-09-15T05:00:00Z' };
    data.user.name = 'Nguyễn Thị Sinh Viên Kiểm Thử Tên Hiển Thị Dài';
    data.tasks = [active]; data.taskStats.active = 1;
    const event = { id: 'long-event', title, location, eventType: 'CLASS' as const, source: 'SCHOOL_PORTAL', status: 'SCHEDULED' as const,
      startTime: '2026-09-14T06:00:00Z', endTime: '2026-09-14T07:00:00Z' };
    const session = { id: 'accepted-session', taskId: active.id, task: active, location: null, status: 'SCHEDULED' as const,
      startTime: '2026-09-14T11:00:00Z', endTime: '2026-09-14T12:00:00Z' };
    data.events = [event]; data.blocks = [session];
    data.agendaOverview.today.events = [event]; data.agendaOverview.today.blocks = [session];
    data.suggestions = [{ id: 'pending-only', kind: 'TASK_PLAN', status: 'PENDING', titleVi: 'Kế hoạch chưa xác nhận', titleEn: 'Unconfirmed plan',
      createdAt: asOf, expiresAt: '2026-09-21T05:00:00Z', payload: { blocks: [{ taskId: active.id, startTime: '2026-09-14T13:00:00Z', endTime: '2026-09-14T14:00:00Z' }] } }];
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByRole('tab', { name: 'Hôm nay 2', exact: true })).toBeVisible();
  await expect(page.locator('.dash-today .dash-agenda-item')).toHaveCount(2);
  await expect(page.locator('.dash-today').getByText('Phiên tự học', { exact: true })).toBeVisible();
  await expect(page.locator('.dash-today').getByText('Lớp UED · Chỉ xem', { exact: true })).toBeVisible();
  await expect(page.locator('.dash-planner')).toContainText('1 đề xuất tự học đang chờ xác nhận');
  await expect(page.locator('.dash-stats .dash-stat').filter({ has: page.getByRole('heading', { name: 'Tự học tuần này' }) }).locator('strong')).toHaveText('1g');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-long-content-${width}.png`), fullPage: true });
  }
});
