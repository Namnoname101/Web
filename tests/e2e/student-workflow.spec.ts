import { expect, test } from '@playwright/test';

interface BootstrapState {
  tasks: Array<{ id: string; title: string; isScheduled: boolean }>;
  blocks: Array<{ taskId: string; startTime: string; endTime: string }>;
  agendaOverview?: { dayStart: string };
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
  await expect(page.getByRole('button', { name: 'Công việc' })).toBeVisible();

  await page.getByRole('button', { name: 'Công việc' }).click();
  await expect(page.getByRole('heading', { name: 'Danh sách công việc' })).toBeVisible();

  const title = `E2E ôn tập ${Date.now()}`;
  await page.getByRole('button', { name: 'Thêm công việc' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'Thêm việc cần làm' });
  await taskDialog.getByLabel('Tên công việc').fill(title);
  await taskDialog.getByLabel('Thời lượng (phút)').fill('30');
  await taskDialog.getByLabel('Độ ưu tiên').selectOption('HIGH');
  await taskDialog.getByRole('button', { name: 'Tạo công việc' }).click();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();

  const createdState = await bootstrap(page);
  const task = createdState.tasks.find(item => item.title === title);
  expect(task).toBeTruthy();
  expect(task?.isScheduled).toBe(false);
  expect(createdState.blocks.some(block => block.taskId === task?.id)).toBe(false);

  await page.getByRole('button', { name: 'Gợi ý xếp lịch' }).click();
  const planDialog = page.getByRole('dialog', { name: 'Tìm thời gian cho điều quan trọng' });
  await planDialog.getByRole('button', { name: 'Tạo đề xuất' }).click();

  const reviewDialog = page.getByRole('dialog', { name: 'Đề xuất sắp xếp công việc' });
  await expect(reviewDialog.getByText(title)).toBeVisible();
  const proposedState = await bootstrap(page);
  expect(proposedState.tasks.find(item => item.id === task?.id)?.isScheduled).toBe(false);
  expect(proposedState.blocks.some(block => block.taskId === task?.id)).toBe(false);

  await reviewDialog.getByRole('button', { name: 'Chấp nhận đề xuất' }).click();
  await expect(reviewDialog).toBeHidden();
  const acceptedState = await bootstrap(page);
  expect(acceptedState.tasks.find(item => item.id === task?.id)?.isScheduled).toBe(true);
  const minutes = acceptedState.blocks
    .filter(block => block.taskId === task?.id)
    .reduce((sum, block) => sum + (Date.parse(block.endTime) - Date.parse(block.startTime)) / 60_000, 0);
  expect(minutes).toBe(30);

  await page.getByRole('button', { name: 'VI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();
});

test('student workspace fits a 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByRole('heading', { name: /Một ngày/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lịch trình hôm nay' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Hôm nay/ })).toBeVisible();
  await page.getByRole('tab', { name: /^Sắp tới/ }).click();
  await expect(page.getByRole('tab', { name: /^Sắp tới/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /^Đã qua/ }).click();
  await expect(page.getByRole('tab', { name: /^Đã qua/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Mở menu' }).click();
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lịch của tôi' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('an activity that ended earlier today remains in Today and Past', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Khám phá bản demo' }).click();
  await expect(page.getByRole('heading', { name: 'Lịch trình hôm nay' })).toBeVisible();
  const state = await bootstrap(page);
  const dayStart = Date.parse(state.agendaOverview!.dayStart);
  const endTime = new Date(Date.now() - 60_000);
  const startTime = new Date(Math.max(dayStart, +endTime - 30 * 60_000));
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
  const weeklyAgenda = page.locator('.weekly-agenda-panel');
  await expect(weeklyAgenda.getByText('1 hoạt động · 1 đã qua')).toBeVisible();
  const weeklyPastActivity = weeklyAgenda.getByRole('button', { name: new RegExp(`${title}.*Đã qua`) });
  await expect(weeklyPastActivity).toBeVisible();
  await expect(weeklyPastActivity).toHaveClass(/is-past/);
  await expect(page.locator('.today-agenda-panel').getByRole('button', { name: new RegExp(`${title}.*Đã qua`) })).toBeVisible();
  await page.getByRole('tab', { name: /^Đã qua/ }).click();
  await expect(page.locator('.today-agenda-panel').getByRole('button', { name: new RegExp(`${title}.*Đã qua`) })).toBeVisible();
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
  const calendarPastActivity = page.locator('.calendar-panel').getByRole('button', { name: new RegExp(`${title}.*Đã qua`) });
  await expect(calendarPastActivity).toBeVisible();
  await expect(calendarPastActivity).toHaveClass(/is-past/);
});
