import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, ScheduleBlock, Task, User } from '../../apps/web/src/types';
import { captureSpacingEvidence } from './helpers/spacing-capture';

const asOf = '2026-09-14T05:00:00.000Z';
const user: User = { id: 'student', name: 'Sinh viên UED', email: 'demo@example.test', isDemo: true, locale: 'vi', timezone: 'Asia/Ho_Chi_Minh', activeStartTime: '07:00', activeEndTime: '22:00', breakStartTime: '11:30', breakEndTime: '13:00', minBlockMinutes: 30, travelMinutes: 15, studyLocation: 'Thư viện UED', notificationsEnabled: true };
const task = (id: string, extras: Partial<Task> = {}): Task => ({ id, title: 'Hoàn thiện báo cáo học phần', notes: 'Rà lại phần kiểm thử.\nGiữ nguyên ghi chú.', deadline: '2026-09-15T15:00:45.123Z', durationMinutes: 120, priority: 'HIGH', status: 'PENDING', isScheduled: false, isSplittable: true, location: null, ...extras });
const scheduled = task('scheduled', { isScheduled: true });
const overdue = task('overdue', { title: 'Nộp bài SQL đã quá hạn', deadline: '2026-09-13T15:00:00Z', priority: 'LOW' });
const proposed = task('proposed', { title: 'Ôn TOEIC Part 5', deadline: '2026-09-16T04:00:00Z', priority: 'MEDIUM', durationMinutes: 60 });
const done = task('done', { title: 'Đọc tài liệu đã hoàn thành', status: 'COMPLETED' });
const sessions: ScheduleBlock[] = [
  { id: 'session-1', taskId: scheduled.id, startTime: '2026-09-14T07:00:00Z', endTime: '2026-09-14T08:00:00Z', status: 'SCHEDULED', location: 'Thư viện UED' },
  { id: 'session-2', taskId: scheduled.id, startTime: '2026-09-15T01:00:00Z', endTime: '2026-09-15T02:00:00Z', status: 'SCHEDULED', location: 'Phòng tự học' },
];
const sample = (): Bootstrap => ({ user, tasks: [proposed, scheduled, overdue, done], events: [], blocks: sessions, taskStats: { active: 3, completed: 9, cancelled: 0 }, taskHistoryPage: { hasMore: false, nextCursor: null }, suggestions: [{ id: 'proposal', kind: 'TASK_PLAN', status: 'PENDING', titleVi: 'Đề xuất TOEIC chưa xác nhận', titleEn: 'Pending TOEIC proposal', createdAt: asOf, expiresAt: '2026-09-20T15:00:00Z', payload: { blocks: [{ taskId: proposed.id, taskTitle: proposed.title, startTime: '2026-09-15T03:00:00Z', endTime: '2026-09-15T04:00:00Z' }] } }], notifications: [], integrations: [], academicRecords: [], agendaOverview: { asOf, localDate: '2026-09-14', dayStart: '2026-09-13T17:00:00Z', dayEnd: '2026-09-14T17:00:00Z', limit: 12, today: { events: [], blocks: [] }, upcoming: { events: [], blocks: [] }, past: { events: [], blocks: [] } } });

async function fixture(page: Page, data = sample()) {
  // UI-only fixture: no production state is modified and no extra demo accounts are created.
  await page.route('**/api/v1/auth/config', route => route.fulfill({ json: { demoEnabled: true, uedEnabled: true, microsoftEnabled: false } }));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ json: data }));
  await page.route('**/api/v1/tasks/*/schedule-blocks*', route => route.fulfill({ json: { blocks: route.request().url().includes('/scheduled/') ? sessions : [], hasFutureBlocks: true, page: { hasMore: false, nextCursor: null } } }));
  await page.goto('/#tasks');
  await expect(page.getByRole('heading', { name: 'Việc cần làm', exact: true })).toBeVisible();
}

test('Tasks show deadline order, true scheduling state, filters, responsive layout and accessible drawers', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await fixture(page);
  await expect(page.locator('.tasks-summary')).toContainText('Tổng toàn bộ lịch sử');
  await expect(page.locator('.tasks-summary article').nth(0).locator('strong')).toHaveText('3');
  await expect(page.locator('.tasks-summary article').nth(1).locator('strong')).toHaveText('2');
  await expect(page.locator('.tasks-summary article').nth(2).locator('strong')).toHaveText('9');
  await expect(page.locator('.tasks-row .tasks-copy>strong')).toHaveText([overdue.title, scheduled.title, proposed.title]);
  await expect(page.locator('.tasks-row').first()).toContainText('Quá hạn');
  await page.getByRole('button', { name: 'Đã xếp lịch', exact: true }).click();
  await expect(page.locator('.tasks-row')).toHaveCount(1);
  await expect(page.locator('.tasks-row')).toContainText(scheduled.title);
  await page.getByRole('button', { name: 'Cần làm', exact: true }).click();
  await page.getByLabel('Tìm công việc').fill('missing');
  await expect(page.getByText('Không có công việc phù hợp với bộ lọc.')).toBeVisible();
  await page.getByLabel('Tìm công việc').fill('');
  await page.getByLabel('Lọc độ ưu tiên').selectOption('LOW');
  await expect(page.locator('.tasks-row')).toHaveCount(1);
  await expect(page.locator('.tasks-row')).toContainText('Quá hạn');
  await page.getByLabel('Lọc độ ưu tiên').selectOption('all');
  for (const width of [1440, 768, 390, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.tasks-workspace button, .tasks-search-controls input, .tasks-search-controls select').evaluateAll(elements => elements.every(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    }))).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`tasks-${width}.png`), fullPage: true });
    await captureSpacingEvidence(page, info, `tasks-spacing-${width}`);
    const create = page.getByRole('button', { name: 'Thêm công việc', exact: true });
    await create.click();
    const drawer = page.getByRole('dialog', { name: 'Thêm công việc' });
    await expect(drawer).toBeFocused(); await drawer.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Tạo công việc' })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(drawer.getByRole('button', { name: 'Đóng / Close' })).toBeFocused();
    const splitLabel = drawer.locator('.task-split');
    expect(await splitLabel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    })).toBe(true);
    // The complete associated label, not only the 17px checkbox glyph, is a hit target.
    await splitLabel.locator('strong').click();
    await expect(drawer.getByRole('checkbox')).not.toBeChecked();
    await splitLabel.locator('strong').click();
    await expect(drawer.getByRole('checkbox')).toBeChecked();
    await drawer.getByRole('button', { name: '1,5 giờ', exact: true }).click();
    await expect(drawer.getByLabel('Thời lượng dự kiến')).toHaveValue('90');
    await drawer.locator('.task-drawer-body').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`task-create-${width}.png`), fullPage: false });
    await captureSpacingEvidence(page, info, `task-create-spacing-${width}`);
    await page.setViewportSize({ width, height: 500 });
    await drawer.getByLabel('Ghi chú', { exact: false }).scrollIntoViewIfNeeded();
    await expect.poll(() => drawer.locator('.task-drawer-body').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(drawer.getByRole('button', { name: 'Tạo công việc' })).toBeInViewport();
    await page.keyboard.press('Escape'); await expect(drawer).toBeHidden(); await expect(create).toBeFocused();
    await page.setViewportSize({ width, height: 900 });
    const row = page.getByRole('button', { name: new RegExp(scheduled.title) });
    await row.focus(); await row.press('Enter');
    const detail = page.getByRole('dialog', { name: scheduled.title });
    await expect(detail).toContainText('Đã xếp đủ 120/120 phút');
    await expect(detail.locator('.task-session-row')).toHaveCount(2);
    await expect(detail).toContainText('Phòng tự học');
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`task-detail-${width}.png`), fullPage: false });
    await captureSpacingEvidence(page, info, `task-detail-spacing-${width}`);
    await page.keyboard.press('Escape'); await expect(row).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await expect(page.locator('.tasks-completed')).toContainText('Đã hoàn thành');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('tasks-completed-overdue.png'), fullPage: true });
  await page.getByRole('button', { name: 'Đề xuất xếp lịch', exact: true }).click();
  await expect(page).toHaveURL(/#calendar\/suggestions$/);
  await expect(page.getByRole('button', { name: /Đề xuất TOEIC chưa xác nhận/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Task editor preserves untouched values, handles API errors and restores focus; Calendar uses task ID', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  const deadline = page.locator('.cal-kind-deadline').filter({ hasText: scheduled.title });
  await deadline.click();
  const detail = page.getByRole('dialog', { name: scheduled.title });
  await detail.getByRole('button', { name: 'Sửa công việc' }).click();
  const editor = page.getByRole('dialog', { name: 'Chỉnh sửa công việc' });
  await expect(editor.getByLabel('Địa điểm học')).toHaveValue('');
  await expect(editor.getByLabel('Ghi chú', { exact: false })).toHaveValue(scheduled.notes);
  await editor.getByLabel('Tên công việc').fill('Báo cáo đã sửa');
  let payload: Record<string, unknown> | null = null;
  await page.route('**/api/v1/tasks/scheduled', route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 409, json: { error: { code: 'UNSCHEDULE_FIRST' } } });
  });
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(editor.getByRole('alert')).toContainText('kể cả phiên đã qua');
  expect(payload).toEqual({ title: 'Báo cáo đã sửa', deadline: scheduled.deadline, durationMinutes: scheduled.durationMinutes, priority: scheduled.priority, location: null, notes: scheduled.notes, isSplittable: true });
  await expect(editor).toBeVisible(); await expect(editor.getByLabel('Tên công việc')).toHaveValue('Báo cáo đã sửa');
  await page.keyboard.press('Escape'); await expect(deadline).toBeFocused();
});

test('Tasks support empty states, failed refresh, partial session progress and retry without false totals', async ({ page }) => {
  const data = sample(); data.tasks = []; data.blocks = []; data.taskStats = { active: 0, completed: 0, cancelled: 0 };
  await fixture(page, data);
  await expect(page.getByText('Chưa có công việc nào.')).toBeVisible();
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await expect(page.getByText('Chưa có công việc hoàn thành trong danh sách đã tải.')).toBeVisible();
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }));
  await page.getByRole('button', { name: 'Tải lại dữ liệu' }).click();
  await expect(page.locator('.tasks-load-error')).toBeVisible();
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ json: sample() }));
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await page.getByRole('button', { name: 'Cần làm', exact: true }).click();
  let attempts = 0;
  await page.route('**/api/v1/tasks/scheduled/schedule-blocks*', route => {
    const next = new URL(route.request().url()).searchParams.has('cursor');
    if (next && attempts++ === 0) return route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } });
    return route.fulfill({ json: { blocks: [sessions[next ? 1 : 0]], hasFutureBlocks: true, page: { hasMore: !next, nextCursor: next ? null : 'next-page' } } });
  });
  await page.getByRole('button', { name: new RegExp(scheduled.title) }).click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('Chưa phải tổng đầy đủ');
  await expect(detail.getByText('Đã xếp đủ 120/120 phút')).toHaveCount(0);
  await detail.getByRole('button', { name: 'Tải thêm phiên học' }).click();
  await expect(detail.getByRole('alert')).toBeVisible();
  await detail.getByRole('button', { name: 'Thử lại' }).click();
  await expect(detail).toContainText('Đã xếp đủ 120/120 phút');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: new RegExp(proposed.title) }).click();
  await expect(page.getByRole('dialog')).toContainText('Chưa có phiên học được lưu.');
  await expect(page.getByRole('dialog').locator('.task-session-row')).toHaveCount(0);
});

test('Task create, edit, completion and reopening use real APIs; refresh failure never duplicates a save', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm công việc', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Thêm công việc' });
  const title = `Task CRUD ${Date.now()}`;
  await editor.getByLabel('Tên công việc').fill(title);
  await editor.getByLabel('Ghi chú', { exact: false }).fill('  Ghi chú giữ nguyên\nDòng thứ hai  ');
  await editor.getByLabel('Địa điểm học').fill('');
  await editor.getByRole('button', { name: '30 phút', exact: true }).click();
  await editor.getByLabel('Độ ưu tiên').selectOption('LOW');
  await editor.getByRole('checkbox').uncheck();
  const actualDeadline = await editor.getByRole('textbox', { name: /^Deadline/ }).inputValue();
  await editor.getByRole('textbox', { name: /^Deadline/ }).fill('2020-01-01T10:00');
  await editor.getByRole('button', { name: 'Tạo công việc' }).click();
  await expect(editor.getByRole('alert')).toContainText('Deadline đã qua');
  await editor.getByRole('textbox', { name: /^Deadline/ }).fill(actualDeadline);
  let writes = 0;
  await page.route('**/api/v1/tasks', route => {
    writes++;
    return route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } });
  });
  await editor.getByRole('button', { name: 'Tạo công việc' }).click();
  await expect(editor.getByRole('alert')).toContainText('Máy chủ chưa xử lý');
  await expect(editor.getByLabel('Tên công việc')).toHaveValue(title);
  await page.unroute('**/api/v1/tasks');
  const created = page.waitForResponse(response => response.url().endsWith('/api/v1/tasks') && response.request().method() === 'POST' && response.status() === 201);
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ status: 503, json: { error: { message: 'Refresh failure' } } }));
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/v1/tasks')) writes++; });
  await editor.getByRole('button', { name: 'Tạo công việc' }).click();
  const saved = await (await created).json() as Task;
  expect(saved).toMatchObject({ title, durationMinutes: 30, priority: 'LOW', location: null, notes: '  Ghi chú giữ nguyên\nDòng thứ hai  ', isSplittable: false, isScheduled: false });
  await expect(editor).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('Công việc đã được lưu');
  expect(writes).toBe(2); // one rejected request, one successful write
  await page.unroute('**/api/v1/bootstrap?*');
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  const row = page.locator('.tasks-row').filter({ hasText: title }); await row.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sửa công việc' }).click();
  const edit = page.getByRole('dialog', { name: 'Chỉnh sửa công việc' });
  await expect(edit.getByLabel('Địa điểm học')).toHaveValue('');
  await expect(edit.getByRole('checkbox')).not.toBeChecked();
  await edit.getByLabel('Tên công việc').fill(`${title} sửa`);
  await edit.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(row).toContainText(`${title} sửa`);
  await row.click(); await page.getByRole('dialog').getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await expect(row).toContainText('Đã hoàn thành');
  await row.click(); await page.getByRole('dialog').getByRole('button', { name: 'Mở lại công việc' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Cần làm', exact: true }).click();
  await expect(row).toContainText('Chưa xếp đủ lịch');
  await row.click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy công việc', exact: true }).click();
  await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await expect(row).toContainText('Đã hủy');
});

test('Reopening an older task from Calendar updates global counts even when refresh fails', async ({ page }) => {
  const older = task('older-calendar-task', { title: 'Công việc cũ ngoài trang lịch sử đã tải', status: 'COMPLETED' });
  const historicalBlock: ScheduleBlock = {
    id: 'older-calendar-session', taskId: older.id, task: older,
    startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T02:00:00Z',
    status: 'COMPLETED', location: 'Thư viện UED',
  };
  const data = sample();
  // This task is deliberately available only through the Calendar's nested
  // session relation, while taskStats still counts the complete history.
  data.blocks = [...data.blocks, historicalBlock];
  data.taskHistoryPage = { hasMore: true, nextCursor: 'older-history-page' };
  expect(data.tasks.some(value => value.id === older.id)).toBe(false);
  await fixture(page, data);
  await expect(page.locator('.tasks-summary article').nth(0).locator('strong')).toHaveText('3');
  await expect(page.locator('.tasks-summary article').nth(2).locator('strong')).toHaveText('9');
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await page.locator('.cal-kind-deadline').filter({ hasText: older.title }).click();
  const detail = page.getByRole('dialog', { name: older.title });
  await expect(detail).toContainText('Đã hoàn thành');
  let writes = 0;
  await page.route('**/api/v1/tasks/older-calendar-task/status', route => {
    writes++;
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({ status: 'PENDING' });
    return route.fulfill({ json: { ...older, status: 'PENDING', isScheduled: false } });
  });
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ status: 503, json: { error: { message: 'Refresh failure' } } }));
  await detail.getByRole('button', { name: 'Mở lại công việc' }).click();
  await expect(detail).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('Công việc đã được lưu');
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(page.locator('.tasks-row').filter({ hasText: older.title })).toContainText('Chưa xếp đủ lịch');
  await expect(page.locator('.tasks-summary article').nth(0).locator('strong')).toHaveText('4');
  await expect(page.locator('.tasks-summary article').nth(2).locator('strong')).toHaveText('8');
  expect(writes).toBe(1);
});
