import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { chromium, expect, type Browser, type Locator } from '@playwright/test';
import { fixture, testPassword } from './helpers.js';
import { manifestSchema } from '../server/releases.js';
import { APP_VERSION } from '../shared/version.js';

const execute = promisify(execFile);
const pause = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
const dotnet = existsSync('local/dotnet/dotnet.exe')
  ? resolve('local/dotnet/dotnet.exe')
  : 'dotnet';
const probeDll = resolve(
  'agent/DeskLink.DesktopProbe/bin/Release/net10.0-windows/DeskLink.DesktopProbe.dll',
);
interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface State {
  foreground: boolean;
  screen: { width: number; height: number };
  editor: Rectangle;
  button: Rectangle;
  pad: Rectangle;
  marker: Rectangle;
  text: string;
  clicks: number;
  wheel: number;
  dragDistance: number;
  controlDown: boolean;
  leftButtonDown: boolean;
}

class Probe {
  private process: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor() {
    this.process = spawn(dotnet, [probeDll], { windowsHide: true });
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      try {
        const response = JSON.parse(line);
        const waiter = this.pending.get(response.id);
        if (!waiter) return;
        this.pending.delete(response.id);
        clearTimeout(waiter.timer);
        if (response.ok) waiter.resolve(response.result);
        else waiter.reject(new Error(`Desktop probe: ${response.error}`));
      } catch {
        this.rejectAll(new Error('Invalid desktop probe response'));
      }
    });
    // Do not forward command payloads or native application logs to Actions.
    this.process.stderr.resume();
    this.process.on('error', () => this.rejectAll(new Error('Desktop probe failed to start')));
    this.process.on('exit', () => this.rejectAll(new Error('Desktop probe exited')));
  }
  private rejectAll(error: Error) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
  command<T = State>(op: string, fields: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`Desktop probe timed out: ${op}`));
        },
        op === 'start-agent' ? 50_000 : 10_000,
      );
      this.pending.set(id, { resolve: (value) => resolveCommand(value as T), reject, timer });
      this.process.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n');
    });
  }
  async close() {
    if (this.process.exitCode !== null) return;
    try {
      await this.command('shutdown');
    } catch {
      /* EOF also closes the owned agent. */
    }
    this.process.stdin.end();
    for (let attempt = 0; attempt < 30 && this.process.exitCode === null; attempt++)
      await pause(200);
    if (this.process.exitCode === null && this.process.pid) {
      await execute('taskkill.exe', ['/PID', String(this.process.pid), '/T', '/F'], {
        windowsHide: true,
      });
      throw new Error('Owned desktop test processes required forced cleanup.');
    }
  }
}

async function until<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  label: string,
  timeout = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await pause(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

const checks: { name: string; passed: boolean; milliseconds: number }[] = [];
let phase = 'VM preflight';
async function check<T>(name: string, operation: () => Promise<T>): Promise<T> {
  phase = name;
  const start = Date.now();
  try {
    const result = await operation();
    checks.push({ name, passed: true, milliseconds: Date.now() - start });
    console.log(`PASS: ${name}`);
    return result;
  } catch (error) {
    checks.push({ name, passed: false, milliseconds: Date.now() - start });
    throw error;
  }
}

const reportDirectory = resolve('local/vm-e2e');
await mkdir(reportDirectory, { recursive: true });
let runtime: Awaited<ReturnType<typeof fixture>> | undefined;
let browser: Browser | undefined;
let probe: Probe | undefined;
let error: string | undefined;
let environment: unknown;
let packageHash: string | undefined;
try {
  await check('Disposable Windows VM and interactive session', async () => {
    assert.equal(process.platform, 'win32', 'A disposable Windows VM is required.');
    assert.equal(
      process.env.DESKLINK_VM_TEST,
      '1',
      'Set DESKLINK_VM_TEST=1 inside the disposable VM only.',
    );
    const { stdout } = await execute(dotnet, [probeDll, '--preflight'], { windowsHide: true });
    environment = JSON.parse(stdout);
    assert.equal((environment as { allowed: boolean }).allowed, true);
  });
  const installed = await mkdtemp(join(reportDirectory, 'run-'));
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile('artifacts/agent-release.json', 'utf8')),
  );
  assert.equal(manifest.version, APP_VERSION);
  runtime = await fixture({ webTtlMs: 600_000, agentTtlMs: 600_000, remoteTtlMs: 600_000 });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.name));
  await check('Web sign-in and authenticated agent download', async () => {
    await page.goto(runtime!.config.origin);
    await page.getByLabel('계정', { exact: true }).fill(runtime!.user.username);
    await page.getByLabel('비밀번호', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page.getByRole('heading', { name: '내 기기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '기기 연결', exact: true }).click();
    const downloadReady = page.waitForEvent('download');
    await page
      .getByRole('link', { name: `Windows x64 · v${APP_VERSION} 다운로드`, exact: true })
      .click();
    const download = await downloadReady;
    assert.equal(download.suggestedFilename(), manifest.assetName);
    const archive = join(installed, manifest.assetName);
    await download.saveAs(archive);
    const bytes = await readFile(archive);
    packageHash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(packageHash, manifest.sha256);
    assert.equal(bytes.length, manifest.size);
    await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:DESKLINK_TEST_ARCHIVE -DestinationPath $env:DESKLINK_TEST_INSTALL -ErrorAction Stop',
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          DESKLINK_TEST_ARCHIVE: archive,
          DESKLINK_TEST_INSTALL: join(installed, 'agent'),
        },
      },
    );
    assert.match(await readFile(join(installed, 'agent/LICENSE.txt'), 'utf8'), /MIT License/);
    assert.match(
      await readFile(join(installed, 'agent/THIRD-PARTY-NOTICES.txt'), 'utf8'),
      /Microsoft\.NETCore\.App\.Runtime/,
    );
    await page.getByRole('button', { name: '설치 안내 닫기' }).click();
  });

  probe = new Probe();
  const state = () => probe!.command('state');
  await check('Installed agent GUI sign-in and online device', async () => {
    await probe!.command('start-agent', {
      path: join(installed, 'agent/DeskLink.Agent.exe'),
      origin: runtime!.config.origin,
      username: runtime!.user.username,
      password: testPassword,
    });
    await until(
      async () => runtime!.hub.agents.size,
      (count) => count === 1,
      'agent online',
    );
    await expect(page.getByRole('heading', { name: 'Windows VM validation' })).toBeVisible({
      timeout: 20_000,
    });
    assert.equal(
      runtime!.store.db.prepare('SELECT agent_version FROM devices').get()?.agent_version,
      APP_VERSION,
    );
    await probe!.command('focus');
    await until(state, (value) => value.foreground, 'owned probe foreground');
  });

  const canvas = page.getByLabel('원격 Windows 화면. 클릭하면 키보드와 마우스로 조작합니다.');
  async function position(target: Rectangle, x = 0.5, y = 0.5) {
    const snapshot = await state();
    assert.equal(snapshot.foreground, true, 'Input target must remain the owned test window.');
    const box = await canvas.boundingBox();
    assert.ok(box);
    return {
      x: ((target.x + target.width * x) / snapshot.screen.width) * box.width,
      y: ((target.y + target.height * y) / snapshot.screen.height) * box.height,
    };
  }
  async function click(target: Rectangle) {
    await canvas.click({ position: await position(target) });
  }
  async function markerVisible(target: Locator) {
    const snapshot = await state();
    return target.evaluate((element, reference) => {
      const frame = element as HTMLCanvasElement;
      const x = Math.floor(
        ((reference.marker.x + reference.marker.width / 2) / reference.screen.width) * frame.width,
      );
      const y = Math.floor(
        ((reference.marker.y + reference.marker.height / 2) / reference.screen.height) *
          frame.height,
      );
      const color = frame.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return (
        Math.abs(color[0] - 22) < 25 &&
        Math.abs(color[1] - 167) < 25 &&
        Math.abs(color[2] - 123) < 25
      );
    }, snapshot);
  }
  await check('Real Windows screen rendered in web canvas', async () => {
    await page.getByRole('button', { name: '원격 연결', exact: true }).click();
    await expect(canvas).toBeVisible();
    await until(() => markerVisible(canvas), Boolean, 'native screen color marker');
  });
  await check('Remote pointer click reaches native button', async () => {
    await click((await state()).button);
    await until(state, (value) => value.clicks === 1, 'native click');
  });
  await check('Physical key codes and edit shortcuts reach native text box', async () => {
    await click((await state()).editor);
    await page.keyboard.type('abc123', { delay: 40 });
    await until(state, (value) => value.text === 'abc123', 'native ASCII typing');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await until(state, (value) => value.text === '', 'select all and backspace');
  });
  await check('Korean completed text reaches native text box', async () => {
    await page.getByRole('button', { name: '문자열 입력' }).click();
    await page.getByLabel('한글 · 모바일 입력').fill('한글 원격 입력 123');
    await page.getByRole('button', { name: '전송', exact: true }).click();
    await until(state, (value) => value.text === '한글 원격 입력 123', 'native Korean text');
    await page.getByRole('button', { name: '문자열 입력' }).click();
  });
  await check('Wheel and drag reach native input surface', async () => {
    const pad = (await state()).pad;
    await click(pad);
    await page.mouse.wheel(0, 120);
    await until(state, (value) => value.wheel === -120, 'native wheel');
    const start = await position(pad, 0.2, 0.3);
    const end = await position(pad, 0.8, 0.7);
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 10 });
    await page.mouse.up();
    await until(
      state,
      (value) => value.dragDistance > 40 && !value.leftButtonDown,
      'native drag and release',
    );
  });
  await check('Ctrl stays held across a pointer click and releases on blur', async () => {
    await click((await state()).editor);
    await page.keyboard.down('Control');
    await until(state, (value) => value.controlDown, 'native control down');
    await click((await state()).button);
    await pause(400);
    assert.equal(
      (await state()).controlDown,
      true,
      'A normal mouse-up must not release a held modifier.',
    );
    await page.getByRole('button', { name: '문자열 입력' }).click();
    await until(state, (value) => !value.controlDown, 'blur releases native modifier');
    await page.keyboard.up('Control');
    await page.getByRole('button', { name: '문자열 입력' }).click();
  });
  await check('Viewer ends and the same agent supports another real session', async () => {
    await page.getByRole('button', { name: '연결 종료', exact: true }).click();
    await expect(page.getByRole('heading', { name: '내 기기', exact: true })).toBeVisible();
    await until(
      async () =>
        runtime!.store.db
          .prepare('SELECT COUNT(*) AS n FROM remote_sessions WHERE ended_at IS NULL')
          .get()?.n,
      (count) => count === 0,
      'first session ended',
    );
    await page.getByRole('button', { name: '원격 연결', exact: true }).click();
    await until(() => markerVisible(canvas), Boolean, 'second native screen');
  });
  await check('Agent GUI sign-out stops remote control and releases input', async () => {
    await click((await state()).editor);
    await page.keyboard.down('Control');
    await until(state, (value) => value.controlDown, 'modifier held before agent logout');
    await probe!.command('sign-out-agent');
    await expect(page.getByRole('heading', { name: '연결이 종료되었습니다' })).toBeVisible({
      timeout: 10_000,
    });
    await until(
      state,
      (value) => !value.controlDown && !value.leftButtonDown,
      'logout input release',
    );
    await page.keyboard.up('Control');
    assert.equal(runtime!.hub.agents.size, 0);
    assert.equal(
      runtime!.store.db
        .prepare('SELECT COUNT(*) AS n FROM remote_sessions WHERE ended_at IS NULL')
        .get()?.n,
      0,
    );
    assert.deepEqual(browserErrors, []);
  });
} catch (failure) {
  error =
    failure instanceof Error ? `${failure.name}: ${failure.message}` : 'Unknown validation error';
  error = error.replaceAll(testPassword, '[redacted]').slice(0, 1500);
  console.error(`FAIL: ${phase}\n${error}`);
  process.exitCode = 1;
} finally {
  // Close the agent before terminating the test surface, including on failed input assertions.
  for (const close of [() => probe?.close(), () => browser?.close(), () => runtime?.close()]) {
    try {
      await close();
    } catch {
      error ??= 'Validation process cleanup failed.';
      process.exitCode = 1;
    }
  }
  const report = {
    version: APP_VERSION,
    commit: process.env.GITHUB_SHA ?? null,
    run: process.env.GITHUB_RUN_ID ?? null,
    environment,
    packageHash,
    passed: !error,
    phase,
    error,
    checks,
  };
  await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = checks.map(
      (item) => `| ${item.passed ? 'PASS' : 'FAIL'} | ${item.name} | ${item.milliseconds} ms |`,
    );
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Windows VM desktop verification\n\nVersion: ${APP_VERSION}\n\n| Result | Check | Time |\n|---|---|---|\n${rows.join('\n')}\n\nOverall: ${error ? 'FAILED' : 'PASSED'}\n`,
      { flag: 'a' },
    );
  }
}
