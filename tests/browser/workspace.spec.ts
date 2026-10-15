import { test, expect, type Page } from '@playwright/test';
import { fixture, testPassword } from '../helpers.js';
import { mkdir } from 'node:fs/promises';

let runtime: Awaited<ReturnType<typeof fixture>>;
test.beforeEach(async () => {
  runtime = await fixture();
});
test.afterEach(async () => {
  await runtime.close();
});

async function signIn(page: Page) {
  await page.goto(runtime.config.origin);
  await page.getByLabel('계정', { exact: true }).fill(runtime.user.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(testPassword);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 기기', exact: true })).toBeVisible();
}

test('login, empty state, installation guide and logout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(runtime.config.origin);
  await mkdir('local/previews', { recursive: true });
  await page.screenshot({ path: 'local/previews/login.png', fullPage: true });
  await page.getByLabel('계정', { exact: true }).fill(runtime.user.username);
  await page.getByLabel('비밀번호', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('계정 또는 비밀번호');
  await page.getByLabel('비밀번호', { exact: true }).fill(testPassword);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByText('첫 번째 PC를 연결해 보세요')).toBeVisible();
  await page.getByRole('button', { name: '기기 연결', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(runtime.config.origin);
  await page.getByRole('button', { name: '설치 안내 닫기' }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 작업 공간에 로그인' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('device filtering, real WebSocket canvas rendering, keyboard and Korean text relay', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const registered = await runtime.agentLogin();
  const agent = runtime.agentSocket(registered.token);
  await agent.json();
  runtime.store.db
    .prepare('UPDATE devices SET name=? WHERE id=?')
    .run('Design workstation', registered.deviceId);
  runtime.store.registerDevice(runtime.user.id, 'office', 'Office PC', 'windows', '0.1.0');
  runtime.store.registerDevice(runtime.user.id, 'home', 'Home desktop', 'windows', '0.1.0');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Design workstation' })).toBeVisible();
  await page.screenshot({ path: 'local/previews/dashboard.png', fullPage: true });
  await page.getByRole('textbox', { name: '기기 검색' }).fill('Office');
  await expect(page.getByRole('heading', { name: 'Design workstation' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Office PC' })).toBeVisible();
  await page.getByRole('textbox', { name: '기기 검색' }).clear();
  await page.locator('.filter-tabs').getByRole('button', { name: '온라인' }).click();
  await expect(page.locator('.device-card')).toHaveCount(1);
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#194e7d';
    context.fillRect(0, 0, 800, 450);
    context.fillStyle = '#fff';
    context.font = '24px sans-serif';
    context.fillText('DeskLink transport test', 60, 200);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.getByRole('button', { name: '원격 연결', exact: true }).click();
  const start = await agent.json();
  expect(start.type).toBe('start');
  agent.send({ type: 'ready', sessionId: start.sessionId });
  agent.ws.send(Buffer.from(jpeg, 'base64'));
  const canvas = page.getByLabel('원격 Windows 화면. 클릭하면 키보드와 마우스로 조작합니다.');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBe(800);
  await canvas.focus();
  await canvas.click();
  await canvas.hover();
  await page.mouse.wheel(0, 120);
  await page.keyboard.press('a');
  await page.getByRole('button', { name: '문자열 입력' }).click();
  await page.getByLabel('한글 · 모바일 입력').fill('한글 abc 123 테스트');
  await page.getByRole('button', { name: '전송', exact: true }).click();
  await expect
    .poll(() =>
      agent.messages
        .filter((message) => !message.binary)
        .map((message) => JSON.parse(message.data.toString()))
        .some((message) => message.input?.text === '한글 abc 123 테스트'),
    )
    .toBe(true);
  const inputs = agent.messages
    .map((message) => JSON.parse(message.data.toString()))
    .filter((message) => message.type === 'input');
  expect(inputs.some((message) => message.input.code === 'KeyA' && message.input.down)).toBe(true);
  expect(inputs.some((message) => message.input.kind === 'button' && message.input.down)).toBe(
    true,
  );
  expect(
    inputs.some(
      (message) => message.input.kind === 'move' && Math.abs(message.input.x - 0.5) < 0.03,
    ),
  ).toBe(true);
  expect(
    inputs.some((message) => message.input.kind === 'wheel' && message.input.delta === -120),
  ).toBe(true);
  expect(inputs.some((message) => message.input.kind === 'release')).toBe(true);
  await page.getByRole('button', { name: '연결 종료', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 기기', exact: true })).toBeVisible();
  expect(runtime.store.session(start.sessionId)?.state).toBe('ended');
  expect(errors).toEqual([]);
});

test('mobile layout stays within viewport and installation dialog works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByText('첫 번째 PC를 연결해 보세요')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'local/previews/mobile.png', fullPage: true });
  await page.getByRole('button', { name: '기기 연결', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    await page
      .getByRole('dialog')
      .evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '연결 기록', exact: true }).click();
  await expect(page.getByText('웹 로그인', { exact: true })).toBeVisible();
});
