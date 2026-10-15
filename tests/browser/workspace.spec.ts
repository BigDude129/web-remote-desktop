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

test('input failure keeps screen visible, pauses controls and allows explicit retry', async ({
  page,
}) => {
  const registered = await runtime.agentLogin();
  const agent = runtime.agentSocket(registered.token);
  await agent.json();
  await signIn(page);
  await page.getByRole('button', { name: '원격 연결', exact: true }).click();
  const start = await agent.json();
  agent.send({ type: 'ready', sessionId: start.sessionId, inputRecovery: true });
  const jpeg = await page.evaluate(() => {
    const target = document.createElement('canvas');
    target.width = 640;
    target.height = 360;
    return target.toDataURL('image/jpeg').split(',')[1];
  });
  agent.ws.send(Buffer.from(jpeg, 'base64'));
  const canvas = page.locator('canvas');
  await expect(canvas).not.toHaveClass('waiting-canvas');
  agent.send({
    type: 'warning',
    sessionId: start.sessionId,
    code: 'input_failed',
    operation: 'move',
    nativeError: 5,
  });
  await expect(page.getByRole('alert')).toContainText('화면은 계속 볼 수 있습니다');
  await expect(page.getByRole('heading', { name: '연결이 종료되었습니다' })).toHaveCount(0);
  await expect
    .poll(() =>
      agent.messages.some((item) => JSON.parse(item.data.toString()).input?.kind === 'release'),
    )
    .toBe(true);
  agent.messages.splice(0);
  await canvas.click();
  await page.getByRole('button', { name: '입력 다시 시도', exact: true }).click();
  await expect
    .poll(() =>
      agent.messages.some((item) => JSON.parse(item.data.toString()).input?.kind === 'resume'),
    )
    .toBe(true);
  const beforeRetry = agent.messages
    .map((item) => JSON.parse(item.data.toString()))
    .map((item) => item.input?.kind);
  expect(beforeRetry).not.toContain('button');
  expect(beforeRetry).not.toContain('move');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.click();
  await expect
    .poll(() =>
      agent.messages.some((item) => JSON.parse(item.data.toString()).input?.kind === 'button'),
    )
    .toBe(true);
});

test('held modifier survives normal pointer release and is released on blur', async ({ page }) => {
  const registered = await runtime.agentLogin();
  const agent = runtime.agentSocket(registered.token);
  await agent.json();
  await signIn(page);
  await page.getByRole('button', { name: '원격 연결', exact: true }).click();
  const start = await agent.json();
  agent.send({ type: 'ready', sessionId: start.sessionId });
  const jpeg = await page.evaluate(() => {
    const target = document.createElement('canvas');
    target.width = 800;
    target.height = 450;
    return target.toDataURL('image/jpeg').split(',')[1];
  });
  agent.ws.send(Buffer.from(jpeg, 'base64'));
  const canvas = page.getByLabel('원격 Windows 화면. 클릭하면 키보드와 마우스로 조작합니다.');
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await expect(canvas).not.toHaveClass('waiting-canvas');
  await canvas.focus();
  await page.keyboard.down('Control');
  await canvas.click();
  await canvas.click();
  await page.keyboard.up('Control');
  const inputs = () =>
    agent.messages
      .filter((item) => !item.binary)
      .map((item) => JSON.parse(item.data.toString()))
      .filter((item) => item.type === 'input')
      .map((item) => item.input);
  await expect
    .poll(() => inputs().some((input) => input.code === 'ControlLeft' && !input.down))
    .toBe(true);
  const events = inputs();
  const down = events.findIndex((input) => input.code === 'ControlLeft' && input.down);
  const up = events.findIndex((input) => input.code === 'ControlLeft' && !input.down);
  expect(down).toBeGreaterThanOrEqual(0);
  expect(events.slice(down + 1, up).filter((input) => input.kind === 'release')).toHaveLength(0);
  const beforeBlur = inputs().length;
  await page.keyboard.down('Control');
  await page.getByRole('button', { name: '문자열 입력' }).click();
  await expect
    .poll(() =>
      inputs()
        .slice(beforeBlur)
        .some((input) => input.kind === 'release'),
    )
    .toBe(true);
  await page.keyboard.up('Control');
  await page.getByRole('button', { name: '문자열 입력' }).click();
  await canvas.focus();
  await canvas.hover();
  const beforeLostCapture = inputs().length;
  await page.keyboard.down('Control');
  await canvas.evaluate((element) => {
    element.addEventListener(
      'gotpointercapture',
      (event) => {
        element.releasePointerCapture((event as PointerEvent).pointerId);
      },
      { once: true },
    );
  });
  await page.mouse.down();
  await page.mouse.move(750, 500);
  await page.mouse.move(760, 510);
  await expect
    .poll(() =>
      inputs()
        .slice(beforeLostCapture)
        .some((input) => input.kind === 'release'),
    )
    .toBe(true);
  await page.mouse.up();
  await page.keyboard.up('Control');
});
test('iPad Caps Lock maps to one complete Hangul toggle and can be disabled', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  });
  const registered = await runtime.agentLogin();
  const agent = runtime.agentSocket(registered.token);
  await agent.json();
  await signIn(page);
  await page.getByRole('button', { name: '원격 연결', exact: true }).click();
  const start = await agent.json();
  agent.send({ type: 'ready', sessionId: start.sessionId });
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await page.getByText('키보드 설정 · iPad 한/영', { exact: true }).click();
  const setting = page.getByLabel('Caps Lock을 원격 PC 한/영키로 사용');
  await expect(setting).toBeChecked();
  const keys = () =>
    agent.messages
      .map((item) => JSON.parse(item.data.toString()).input)
      .filter((input) => input?.kind === 'key');
  await canvas.dispatchEvent('keydown', { code: 'CapsLock', key: 'CapsLock' });
  await expect.poll(() => keys().length).toBe(2);
  expect(keys()).toEqual([
    { kind: 'key', code: 'Lang1', down: true },
    { kind: 'key', code: 'Lang1', down: false },
  ]);
  await canvas.dispatchEvent('keydown', { code: 'CapsLock', repeat: true });
  await canvas.dispatchEvent('keyup', { code: 'CapsLock' });
  // An ordinary key is a relay barrier for the negative repeat/keyup assertion.
  await canvas.dispatchEvent('keydown', { code: 'KeyA' });
  await expect.poll(() => keys().length).toBe(3);
  expect(keys()[2].code).toBe('KeyA');
  await setting.uncheck();
  await canvas.dispatchEvent('keydown', { code: 'CapsLock' });
  await canvas.dispatchEvent('keyup', { code: 'CapsLock' });
  await expect.poll(() => keys().length).toBe(5);
  expect(
    keys()
      .slice(-2)
      .map((input) => input.code),
  ).toEqual(['CapsLock', 'CapsLock']);
  expect(await page.evaluate(() => localStorage.getItem('desklink.capsAsHangul'))).toBe('false');
  await page.getByRole('button', { name: '문자열 입력' }).click();
  await page.getByLabel('한글 · 모바일 입력').dispatchEvent('keydown', { code: 'CapsLock' });
  await canvas.dispatchEvent('keydown', { code: 'KeyB' });
  await expect.poll(() => keys().length).toBe(6);
  expect(keys()[5].code).toBe('KeyB');
});
