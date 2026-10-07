import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, CalendarEvent, Suggestion, Task } from '../../apps/web/src/types';

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });

const asOf = '2026-09-14T05:00:00.000Z';
const task: Task = { id: 'study-task', title: 'Báo cáo học phần', notes: 'Nộp qua cổng môn học', location: 'Thư viện UED', durationMinutes: 90, deadline: '2026-09-16T15:00:00Z', priority: 'HIGH', status: 'PENDING', isScheduled: false, isSplittable: true };
const event = (id: string, title: string, startTime: string, endTime: string, extras: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title, startTime, endTime, location: 'A5-203', source: 'MANUAL', eventType: 'PERSONAL', status: 'SCHEDULED', ...extras });
const plan: Suggestion = { id: 'test-plan', kind: 'TASK_PLAN', status: 'PENDING', titleVi: 'Đề xuất ôn tập tuần này', titleEn: 'Study plan this week', createdAt: asOf, expiresAt: '2026-09-20T15:00:00Z', payload: { blocks: [{ taskId: task.id, taskTitle: task.title, startTime: '2026-09-15T07:00:00Z', endTime: '2026-09-15T08:30:00Z', location: 'Thư viện UED' }] } };

async function fixture(page: Page) {
  await page.route('**/api/v1/bootstrap?*', async route => {
    const response = await route.fetch();
    const data = await response.json() as Bootstrap;
    Object.assign(data, {
      events: [
        event('ued', 'Cơ sở dữ liệu', '2026-09-14T00:00:00Z', '2026-09-14T02:30:00Z', { source: 'SCHOOL_PORTAL', eventType: 'CLASS' }),
        event('personal', 'Ca làm thêm', '2026-09-14T07:00:00Z', '2026-09-14T10:00:00Z'),
        event('early', 'Chuyến xe sớm', '2026-09-13T21:00:00Z', '2026-09-13T22:00:00Z'),
        event('late', 'Đón người thân', '2026-09-14T16:30:00Z', '2026-09-14T17:30:00Z'),
        event('legacy', 'Mốc lịch nguồn cũ', '2026-09-15T03:00:00Z', '2026-09-15T03:30:00Z', { eventType: 'DEADLINE' }),
      ],
      tasks: [task], blocks: [{ id: 'accepted', taskId: task.id, task, startTime: '2026-09-14T11:00:00Z', endTime: '2026-09-14T12:00:00Z', status: 'SCHEDULED', location: 'Thư viện UED' }],
      suggestions: [plan], taskStats: { active: 1, completed: 0, cancelled: 0 }, taskHistoryPage: { hasMore: false, nextCursor: null },
      notifications: [], integrations: [], academicRecords: [],
      agendaOverview: { asOf, localDate: '2026-09-14', dayStart: '2026-09-13T17:00:00Z', dayEnd: '2026-09-14T17:00:00Z', limit: 12, today: { events: [], blocks: [] }, upcoming: { events: [], blocks: [] }, past: { events: [], blocks: [] } },
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lịch tuần', exact: true })).toBeVisible();
  await expect(page.locator('.cal-item').first()).toBeVisible();
}

test('Calendar sources, dayparts, responsive week and accessible drawer', async ({ page }, info) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await fixture(page);
  const calendar = page.getByRole('region', { name: 'Lịch tuần', exact: true });
  await expect(calendar.getByRole('button', { name: /Lớp học UED.*Cơ sở dữ liệu/ })).toHaveCount(1);
  await expect(calendar.getByRole('button', { name: /Phiên tự học.*Báo cáo học phần/ })).toHaveCount(1);
  await expect(calendar.getByRole('button', { name: /Deadline · Công việc.*Báo cáo học phần/ })).toHaveCount(1);
  const monday = page.locator('[data-day="2026-09-14"]');
  await expect(monday.getByRole('region', { name: 'Ngoài khung giờ' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('[data-day="2026-09-15"]').getByRole('button', { name: /Đón người thân/ })).toHaveCount(1);
  await calendar.getByRole('button', { name: /Cơ sở dữ liệu/ }).click();
  const ued = page.getByRole('dialog', { name: 'Cơ sở dữ liệu' });
  await expect(ued).toContainText('Lịch học UED chỉ được xem');
  await expect(ued.getByRole('button', { name: /Chỉnh sửa|Hủy lịch|Khôi phục/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await calendar.getByRole('button', { name: /Mốc lịch nguồn cũ/ }).click();
  await expect(page.getByRole('dialog', { name: 'Mốc lịch nguồn cũ' }).getByRole('button', { name: 'Chỉnh sửa' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.route('**/api/v1/tasks/study-task/schedule-blocks*', route => route.fulfill({ json: { blocks: [], hasFutureBlocks: false, page: { hasMore: false, nextCursor: null } } }));
  await calendar.getByRole('button', { name: /Deadline · Công việc.*Báo cáo học phần/ }).click();
  const deadline = page.getByRole('dialog', { name: 'Báo cáo học phần' });
  await expect(deadline).toContainText('Deadline:');
  await deadline.getByRole('button', { name: 'Sửa công việc', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Chỉnh sửa công việc' })).toBeVisible();
  await page.keyboard.press('Escape');
  await calendar.getByRole('button', { name: /Lịch cá nhân.*Ca làm thêm/ }).click();
  await page.getByRole('dialog', { name: 'Ca làm thêm' }).getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Chỉnh sửa lịch cá nhân' }).getByLabel('Bắt đầu', { exact: true })).toHaveValue('2026-09-14T14:00');
  await page.keyboard.press('Escape');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(calendar).toHaveJSProperty('scrollLeft', 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`calendar-${width}.png`), fullPage: true });
    if (width < 1000) {
      await calendar.focus(); await calendar.press('ArrowRight');
      await expect.poll(() => calendar.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
    const create = page.getByRole('button', { name: 'Thêm lịch cá nhân', exact: true });
    await create.click();
    const drawer = page.getByRole('dialog', { name: 'Thêm lịch cá nhân' });
    await expect(drawer).toBeFocused();
    await drawer.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Lưu vào lịch' })).toBeFocused();
    await drawer.getByRole('button', { name: 'Lưu vào lịch' }).press('Tab');
    await expect(drawer.getByRole('button', { name: 'Đóng / Close' })).toBeFocused();
    await expect(drawer).toContainText('Lịch lặp hàng tuần chưa được hỗ trợ');
    await expect(drawer.getByRole('combobox')).toHaveCount(0);
    await expect(drawer.getByLabel('Deadline')).toHaveCount(0);
    // Fixed overlays are viewport-sized; full-page capture would show uncovered content below them.
    await page.screenshot({ path: info.outputPath(`event-drawer-${width}.png`), fullPage: false });
    if (width === 390) {
      await page.setViewportSize({ width, height: 500 });
      const body = drawer.locator('.event-drawer-body');
      const backgroundScroll = await page.evaluate(() => window.scrollY);
      await expect.poll(() => body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await drawer.getByLabel('Địa điểm', { exact: true }).scrollIntoViewIfNeeded();
      await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await expect(drawer.getByRole('button', { name: 'Lưu vào lịch' })).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
      await page.setViewportSize({ width, height: 900 });
    }
    await page.keyboard.press('Escape'); await expect(drawer).toBeHidden(); await expect(create).toBeFocused();
  }
  await page.getByRole('button', { name: 'Tuần sau' }).click();
  await expect(page.getByLabel('Chọn ngày xem lịch')).toHaveValue('2026-09-21');
  await page.getByRole('button', { name: 'Tuần trước' }).click();
  await expect(page.getByLabel('Chọn ngày xem lịch')).toHaveValue('2026-09-14');
  await page.getByLabel('Chọn ngày xem lịch').fill('2026-08-31');
  await expect(page.locator('[data-day="2026-09-06"]')).toBeVisible();
  await expect(calendar.locator('.cal-item')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('Planner review stays separate, handles conflict, rejects and disables expired or manual review', async ({ page }, info) => {
  await fixture(page);
  await page.getByRole('button', { name: /^Đề xuất xếp lịch/ }).click();
  await expect(page).toHaveURL(/#calendar\/suggestions$/);
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('button')).toHaveCount(6);
  await expect(nav.getByRole('button', { name: /Đề xuất/ })).toHaveCount(0);
  const row = page.getByRole('button', { name: /Đề xuất ôn tập tuần này/ });
  await expect(row).toContainText('1g 30p'); await expect(row).toContainText('14:00–15:30');
  await page.getByLabel('Tìm đề xuất').fill('Thư viện UED'); await expect(row).toBeVisible();
  await page.getByLabel('Tìm đề xuất').fill('');
  await page.screenshot({ path: info.outputPath('suggestions.png'), fullPage: true });
  await row.click();
  const review = page.getByRole('dialog', { name: plan.titleVi });
  await expect(review).toContainText('Chưa có phiên nào được thêm vào lịch');
  await page.screenshot({ path: info.outputPath('suggestion-review.png'), fullPage: false });
  await page.route('**/api/v1/suggestions/test-plan/accept', route => route.fulfill({ status: 409, json: { error: { code: 'SCHEDULE_CHANGED' } } }));
  await review.getByRole('button', { name: 'Thêm vào lịch', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('Lịch đã thay đổi');
  await expect(review.getByRole('button', { name: 'Thêm vào lịch', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quay lại lịch' }).click();
  await expect(page.locator('.cal-kind-study.cal-item')).toHaveCount(1);
  // Review guards must work even if the server has not yet rewritten PENDING to EXPIRED.
  await page.route('**/api/v1/bootstrap?*', async route => {
    const response = await route.fetch(); const data = await response.json() as Bootstrap;
    data.suggestions = [{ ...plan, expiresAt: '2000-01-01T00:00:00Z' }, { ...plan, id: 'manual', kind: 'EVENT_CHANGE', titleVi: 'Cần đối chiếu email', expiresAt: '2099-01-01T00:00:00Z', payload: { action: 'REVIEW', evidence: { subject: 'Lịch học cần kiểm tra' } } }];
    await route.fulfill({ response, json: data });
  });
  await page.getByRole('button', { name: 'Tải lại dữ liệu' }).click();
  await page.getByRole('button', { name: /^Đề xuất xếp lịch/ }).click();
  await page.getByRole('checkbox', { name: 'Hiện lịch sử' }).check();
  await page.getByRole('button', { name: /Đề xuất ôn tập tuần này/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Thêm vào lịch' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Cần đối chiếu email/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Thêm vào lịch|Áp dụng thay đổi/ })).toHaveCount(0);
  await page.route('**/api/v1/suggestions/manual/reject', route => route.fulfill({ json: { status: 'REJECTED' } }));
  await page.getByRole('dialog').getByRole('button', { name: 'Bỏ đề xuất' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Personal event saves once even when refresh fails; edit, cancel and restore use real API', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await page.getByLabel('Chọn ngày xem lịch').fill('2020-01-06');
  await expect(page.locator('.cal-viewport')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Thêm lịch cá nhân', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Thêm lịch cá nhân' });
  const title = `Ca làm kiểm thử ${Date.now()}`;
  await drawer.getByLabel('Tên sự kiện').fill(title);
  await drawer.getByLabel('Địa điểm', { exact: true }).fill('Quán cà phê');
  await drawer.getByLabel('Kết thúc', { exact: true }).fill('2020-01-06T08:00');
  await drawer.getByRole('button', { name: 'Lưu vào lịch' }).click();
  await expect(drawer.getByRole('alert')).toContainText('Giờ kết thúc phải sau');
  await drawer.getByLabel('Kết thúc', { exact: true }).fill('2020-01-06T10:00');
  let posts = 0; page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/v1/events')) posts++; });
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ status: 503, json: { error: { message: 'Test refresh failure' } } }));
  await drawer.getByRole('button', { name: 'Lưu vào lịch' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('Thao tác đã được lưu');
  expect(posts).toBe(1);
  await page.unroute('**/api/v1/bootstrap?*');
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  const item = page.locator('.cal-item').filter({ hasText: title });
  await item.click();
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Chỉnh sửa' }).click();
  await page.getByRole('dialog', { name: 'Chỉnh sửa lịch cá nhân' }).getByLabel('Tên sự kiện').fill(`${title} đã sửa`);
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(item).toContainText('đã sửa'); await item.click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy lịch' }).click();
  await expect(item).toHaveCount(0);
  await page.getByText('Lịch đã hủy trong tuần').click();
  await page.locator('.cal-cancelled').getByRole('button', { name: new RegExp(title) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Khôi phục lịch' }).click();
  await expect(item).toHaveCount(1);
});

test('Failed week load does not show stale week as an empty successful calendar and can retry', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/v1/bootstrap?*', route => route.fulfill({ status: 503, json: { error: { message: 'Test week unavailable' } } }));
  await page.getByRole('button', { name: 'Tuần sau' }).click();
  await expect(page.locator('.cal-load-error')).toContainText('Chưa tải được tuần đã chọn');
  await expect(page.locator('.cal-item')).toHaveCount(0);
  await page.unroute('**/api/v1/bootstrap?*');
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.cal-load-error')).toHaveCount(0);
  await expect(page.locator('.cal-viewport')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByLabel('Chọn ngày xem lịch')).toHaveValue('2026-09-21');
});
