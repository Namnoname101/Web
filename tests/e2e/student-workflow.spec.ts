import { expect, test } from '@playwright/test';

interface BootstrapState {
  tasks: Array<{ id: string; title: string; isScheduled: boolean }>;
  blocks: Array<{ taskId: string; startTime: string; endTime: string }>;
  agendaOverview?: { dayStart: string; asOf: string };
}

async function bootstrap(page: import('@playwright/test').Page): Promise<BootstrapState> {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/bootstrap');
    if (!response.ok) throw new Error(`Bootstrap failed with ${response.status}`);
    return response.json();
  });
}

test('student reviews an automatic plan before it changes the calendar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByRole('button', { name: 'Công việc', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Việc cần làm', exact: true })).toBeVisible();

  const title = `E2E ôn tập ${Date.now()}`;
  await page.getByRole('button', { name: 'Thêm công việc' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'Thêm công việc' });
  await taskDialog.getByLabel('Tên công việc').fill(title);
  await taskDialog.getByLabel('Thời lượng dự kiến').fill('30');
  await taskDialog.getByLabel('Độ ưu tiên').selectOption('HIGH');
  await taskDialog.getByRole('button', { name: 'Tạo công việc' }).click();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();

  const createdState = await bootstrap(page);
  const task = createdState.tasks.find(item => item.title === title);
  expect(task).toBeTruthy();
  expect(task?.isScheduled).toBe(false);
  expect(createdState.blocks.some(block => block.taskId === task?.id)).toBe(false);

  await page.getByRole('button', { name: 'Đề xuất xếp lịch' }).click();
  await page.getByRole('button', { name: 'Tạo đề xuất mới' }).click();
  const planDialog = page.getByRole('dialog', { name: 'Tạo đề xuất lịch' });
  await planDialog.getByRole('button', { name: 'Tạo đề xuất' }).click();

  const reviewDialog = page.getByRole('dialog', { name: 'Đề xuất sắp xếp công việc' });
  await expect(reviewDialog.getByText(title)).toBeVisible();
  const proposedState = await bootstrap(page);
  expect(proposedState.tasks.find(item => item.id === task?.id)?.isScheduled).toBe(false);
  expect(proposedState.blocks.some(block => block.taskId === task?.id)).toBe(false);

  await reviewDialog.getByRole('button', { name: 'Thêm vào lịch' }).click();
  await expect(reviewDialog).toBeHidden();
  const acceptedState = await bootstrap(page);
  expect(acceptedState.tasks.find(item => item.id === task?.id)?.isScheduled).toBe(true);
  const minutes = acceptedState.blocks
    .filter(block => block.taskId === task?.id)
    .reduce((sum, block) => sum + (Date.parse(block.endTime) - Date.parse(block.startTime)) / 60_000, 0);
  expect(minutes).toBe(30);

  await page.getByRole('button', { name: 'VI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
});

for (const width of [390, 768, 1440]) test(`student workspace fits a ${width}px viewport with keyboard navigation`, async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /của bạn$/ })).toBeVisible();
  await expect(page.locator('.dash-today').getByRole('heading', { name: 'Lịch hôm nay' })).toBeVisible();
  const todayTab = page.getByRole('tab', { name: /^Hôm nay/ });
  await expect(todayTab).toBeVisible();
  await todayTab.focus();
  await todayTab.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Sắp tới/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /^Sắp tới/ }).press('End');
  await expect(page.getByRole('tab', { name: /^Đã qua/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /^Đã qua/ }).press('Home');
  await expect(todayTab).toBeFocused();
  await expect(todayTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: true });
  if (width <= 780) {
    const openMenu = page.getByRole('button', { name: 'Mở menu' });
    await openMenu.click();
    const sidebar = page.getByRole('complementary', { name: 'Menu ứng dụng' });
    const closeMenu = sidebar.getByRole('button', { name: 'Đóng menu' });
    await expect(closeMenu).toBeFocused();
    await closeMenu.press('Shift+Tab');
    await expect(sidebar.getByRole('button', { name: 'Đăng xuất' })).toBeFocused();
    await sidebar.getByRole('button', { name: 'Đăng xuất' }).press('Tab');
    await expect(closeMenu).toBeFocused();
    await closeMenu.press('Escape');
    await expect(openMenu).toBeFocused();
    await expect(openMenu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toHaveCount(0);
    await openMenu.click();
  }
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lịch tuần', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('an activity that ended earlier today remains in Today and Past', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.locator('.dash-today').getByRole('heading', { name: 'Lịch hôm nay' })).toBeVisible();
  let state = await bootstrap(page);
  // At exact midnight wait for a positive overlap, using server time instead
  // of skipping the regression or trusting the machine running the browser.
  await expect.poll(async () => {
    state = await bootstrap(page);
    return Date.parse(state.agendaOverview!.asOf) > Date.parse(state.agendaOverview!.dayStart);
  }).toBe(true);
  const endTime = new Date(state.agendaOverview!.asOf);
  const startTime = new Date(+endTime - 30 * 60_000);
  expect(+endTime).toBeGreaterThan(+startTime);

  const title = `Lịch đã qua hôm nay ${Date.now()}`;
  await page.evaluate(async ({ title, startTime, endTime }) => {
    const response = await fetch('/api/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, startTime, endTime, eventType: 'PERSONAL' }),
    });
    if (!response.ok) throw new Error(`Create event failed with ${response.status}`);
  }, { title, startTime: startTime.toISOString(), endTime: endTime.toISOString() });

  await page.getByRole('button', { name: 'Tải lại dữ liệu' }).click();
  await expect(page.getByRole('tab', { name: /^Hôm nay 1$/ })).toBeVisible();
  const today = page.locator('.dash-today');
  await expect(today.getByText('1 hoạt động · 1 đã qua')).toBeVisible();
  const pastActivity = today.getByRole('button', { name: new RegExp(`${title}.*Đã qua`) });
  await expect(pastActivity).toBeVisible();
  await expect(pastActivity).toHaveClass(/is-past/);
  await page.getByRole('tab', { name: /^Đã qua/ }).click();
  await expect(today.getByRole('button', { name: new RegExp(`${title}.*Đã qua`) })).toBeVisible();
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  const calendarPastActivity = page.locator('.calendar-panel').getByRole('button', { name: new RegExp(`${title}.*Đã qua`) });
  await expect(calendarPastActivity).toBeVisible();
  await expect(calendarPastActivity).toHaveClass(/is-past/);
});
