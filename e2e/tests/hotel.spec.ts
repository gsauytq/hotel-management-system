import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const INITIAL_PASSWORD = process.env['HMS_E2E_ADMIN_INITIAL_PASSWORD'] ?? 'E2e#Init12345';
const ADMIN_PASSWORD = process.env['HMS_E2E_ADMIN_PASSWORD'] ?? 'E2e#Flow12345';
const ADMIN_USERNAME = 'admin';

function hotelDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    .slice(-8)
    .toUpperCase();
}

function uniquePhone(): string {
  return `139${Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, '0')}`;
}

async function loginUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

async function loginApi(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/v1/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(200);
}

interface Fixture {
  suffix: string;
  roomType: { id: number; name: string; code: string };
  rooms: Array<{ id: number; roomNumber: string }>;
  guest: { id: number; name: string };
}

async function createFixture(request: APIRequestContext, roomCount = 2): Promise<Fixture> {
  await loginApi(request);
  const suffix = uniqueSuffix();
  const code = `E2E${suffix}`;
  const roomTypeName = `E2E房型${suffix}`;

  const roomTypeResponse = await request.post('/api/v1/room-types', {
    data: { code, name: roomTypeName, basePrice: 200, capacity: 2 },
  });
  expect(roomTypeResponse.status(), await roomTypeResponse.text()).toBe(200);
  const roomType = (await roomTypeResponse.json()).data as Fixture['roomType'];

  const rooms: Fixture['rooms'] = [];
  for (let index = 1; index <= roomCount; index += 1) {
    const roomResponse = await request.post('/api/v1/rooms', {
      data: { roomNumber: `E${suffix}${index}`, roomTypeId: roomType.id },
    });
    expect(roomResponse.status(), await roomResponse.text()).toBe(200);
    rooms.push((await roomResponse.json()).data as Fixture['rooms'][number]);
  }

  const guestResponse = await request.post('/api/v1/guests', {
    data: {
      name: `E2E客人${suffix}`,
      phone: uniquePhone(),
      idType: 'ID_CARD',
      idNumber: `E2E${suffix}${Math.floor(Math.random() * 1000)}`,
    },
  });
  expect(guestResponse.status(), await guestResponse.text()).toBe(200);
  const guest = (await guestResponse.json()).data as Fixture['guest'];

  return { suffix, roomType, rooms, guest };
}

async function selectRemoteGuest(page: Page, dialogText: string, guestName: string): Promise<void> {
  const dialog = page.locator('.el-dialog').filter({ hasText: dialogText });
  const input = dialog.getByRole('combobox', { name: /客人/ });
  await input.click();
  await input.fill(guestName);
  await page.waitForTimeout(500);
  await page.locator('.el-select-dropdown__item').filter({ hasText: guestName }).first().click();
}

test('A-20 B：首登强制改密后可用新密码登录', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(ADMIN_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(INITIAL_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();

  await expect(page).toHaveURL(/\/change-password/, { timeout: 20_000 });
  await expect(page.getByText('首次登录必须修改初始密码')).toBeVisible();

  await page.locator('input[autocomplete="current-password"]').fill(INITIAL_PASSWORD);
  const newPasswordInputs = page.locator('input[autocomplete="new-password"]');
  await newPasswordInputs.nth(0).fill(ADMIN_PASSWORD);
  await newPasswordInputs.nth(1).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: '确认修改' }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await loginUi(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/rooms/, { timeout: 20_000 });
});

test('预订 -> 入住 -> 退房 -> 订单查询', async ({ page, request }) => {
  const fixture = await createFixture(request);
  await loginUi(page, ADMIN_USERNAME, ADMIN_PASSWORD);

  await page.goto('/bookings');
  await page.getByRole('button', { name: '创建预订' }).click();
  const createDialog = page.locator('.el-dialog').filter({ hasText: '创建预订' });
  await createDialog.waitFor();

  await selectRemoteGuest(page, '创建预订', fixture.guest.name);
  await createDialog.getByRole('combobox', { name: /房型/ }).click();
  await page
    .locator('.el-select-dropdown__item')
    .filter({ hasText: fixture.roomType.name })
    .first()
    .click();

  await createDialog.getByRole('combobox', { name: /入住日期/ }).fill(hotelDate(0));
  await page.keyboard.press('Enter');
  await createDialog.getByRole('combobox', { name: /退房日期/ }).fill(hotelDate(1));
  await page.keyboard.press('Enter');
  await createDialog.getByRole('button', { name: '创建预订' }).click();
  await expect(createDialog).toBeHidden({ timeout: 20_000 });

  await page.goto('/stays');
  const pendingRow = page.locator('.el-table__row').filter({ hasText: fixture.guest.name }).first();
  await expect(pendingRow).toBeVisible({ timeout: 20_000 });
  await pendingRow.getByRole('button', { name: '办理入住' }).click();

  const checkInDialog = page.locator('.el-dialog').filter({ hasText: '办理入住' });
  await checkInDialog.getByRole('combobox', { name: /分配房间/ }).click();
  await page
    .locator('.el-select-dropdown__item')
    .filter({ hasText: fixture.rooms[0]!.roomNumber })
    .first()
    .click();
  await checkInDialog.getByRole('button', { name: '确认入住' }).click();
  await page.locator('.el-message-box').getByRole('button', { name: '确认入住' }).click();
  await expect(page.getByText(/入住办理成功/)).toBeVisible({ timeout: 20_000 });

  const stayRow = page.locator('.el-table__row').filter({ hasText: fixture.guest.name }).first();
  await expect(stayRow).toBeVisible({ timeout: 20_000 });
  await stayRow.getByRole('button', { name: '退房' }).click();

  const checkoutDialog = page.locator('.el-dialog').filter({ hasText: '退房结算' });
  await checkoutDialog.locator('.el-select').click();
  await page.locator('.el-select-dropdown__item').filter({ hasText: '现金' }).first().click();
  await checkoutDialog.getByRole('button', { name: '确认退房' }).click();
  await page.locator('.el-message-box').getByRole('button', { name: '确认退房' }).click();
  await expect(page.getByText('退房结算成功').first()).toBeVisible({ timeout: 20_000 });

  await page.goto('/orders');
  await expect(page.getByText(fixture.guest.name).first()).toBeVisible({ timeout: 20_000 });
});

test('walk-in 直接入住', async ({ page, request }) => {
  const fixture = await createFixture(request, 1);
  await loginUi(page, ADMIN_USERNAME, ADMIN_PASSWORD);

  await page.goto('/stays');
  await page.getByRole('button', { name: '直接入住' }).click();
  const dialog = page.locator('.el-dialog').filter({ hasText: '直接入住' });
  await dialog.waitFor();

  await selectRemoteGuest(page, '直接入住', fixture.guest.name);
  await dialog.getByRole('combobox', { name: /房型/ }).click();
  await page
    .locator('.el-select-dropdown__item')
    .filter({ hasText: fixture.roomType.name })
    .first()
    .click();
  await dialog.getByRole('combobox', { name: /可分配房间/ }).click();
  await page
    .locator('.el-select-dropdown__item')
    .filter({ hasText: fixture.rooms[0]!.roomNumber })
    .first()
    .click();
  await dialog.getByRole('button', { name: '确认入住' }).click();
  await page.locator('.el-message-box').getByRole('button', { name: '确认入住' }).click();

  await expect(page.getByText(/入住办理成功/)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.el-table__row').filter({ hasText: fixture.guest.name }).first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('RECEPTIONIST 访问 ADMIN 页面 -> 403', async ({ page, request }) => {
  await loginApi(request);
  const suffix = uniqueSuffix().toLowerCase();
  const username = `e2e_rec_${suffix}`;
  const response = await request.post('/api/v1/users', {
    data: {
      username,
      password: 'Rec#Pass12345',
      displayName: 'E2E前台',
      role: 'RECEPTIONIST',
    },
  });
  expect(response.status(), await response.text()).toBe(200);

  await loginUi(page, username, 'Rec#Pass12345');
  await expect(page).toHaveURL(/\/rooms/, { timeout: 20_000 });
  await page.goto('/users');
  await expect(page).toHaveURL(/\/403/, { timeout: 20_000 });
  await expect(page.getByText(/无权限/).first()).toBeVisible();
});
