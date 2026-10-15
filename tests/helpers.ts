import { once } from 'node:events';
import { WebSocket, type RawData } from 'ws';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApplication } from '../server/app.js';
import type { Config } from '../server/config.js';

export const testPassword = 'Test-only-password-327!';
export async function fixture(overrides: Partial<Config> = {}) {
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    origin: 'http://127.0.0.1',
    secure: false,
    trustProxy: false,
    databasePath: ':memory:',
    webTtlMs: 60_000,
    agentTtlMs: 60_000,
    remoteTtlMs: 60_000,
    releaseRepository: '',
    ...overrides,
  };
  const runtime = createApplication(config);
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  config.origin = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const request = (path: string, options: RequestInit = {}) =>
    fetch(`${config.origin}/api${path}`, options);
  const user = await runtime.store.createUser('owner@example.test', '테스트 사용자', testPassword);
  async function login(username = user.username) {
    const response = await request('/auth/login', {
      method: 'POST',
      headers: { Origin: config.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: testPassword }),
    });
    const data = await response.json();
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    return {
      cookie,
      headers: {
        Cookie: cookie,
        Origin: config.origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': data.csrfToken,
      },
      data,
      response,
    };
  }
  async function agentLogin(installationId = randomUUID()) {
    const response = await request('/agent/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DeskLink-Agent': '1' },
      body: JSON.stringify({
        username: user.username,
        password: testPassword,
        installationId,
        name: 'Test workstation',
        platform: 'windows',
        agentVersion: '0.1.0',
        protocolVersion: 1,
      }),
    });
    return { ...((await response.json()) as { token: string; deviceId: string }), installationId };
  }
  function agentSocket(token: string) {
    return new Inbox(
      new WebSocket(`${config.origin.replace('http', 'ws')}/ws/agent`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }
  function viewerSocket(id: string, cookie: string, origin = config.origin, autoPong = true) {
    return new Inbox(
      new WebSocket(`${config.origin.replace('http', 'ws')}/ws/viewer/${id}`, {
        headers: { Cookie: cookie, Origin: origin },
        autoPong,
      }),
    );
  }
  return { ...runtime, config, user, request, login, agentLogin, agentSocket, viewerSocket };
}

export class Inbox {
  messages: { data: Buffer; binary: boolean }[] = [];
  private waiters: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data: RawData, binary) => {
      this.messages.push({ data: Buffer.from(data as Buffer), binary });
      for (const wake of this.waiters.splice(0)) wake();
    });
    ws.on('error', () => {});
  }
  async next(binary = false): Promise<Buffer> {
    const deadline = Date.now() + 5000;
    while (true) {
      const index = this.messages.findIndex((message) => message.binary === binary);
      if (index >= 0) return this.messages.splice(index, 1)[0].data;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('Timed out waiting for a WebSocket message');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== wake);
          reject(new Error('Timed out waiting for message'));
        }, left);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.push(wake);
      });
    }
  }
  async json() {
    return JSON.parse((await this.next()).toString());
  }
  send(message: object) {
    this.ws.send(JSON.stringify(message));
  }
}

export async function rejectedSocket(url: string, headers: Record<string, string>) {
  const ws = new WebSocket(url, { headers });
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Upgrade did not fail'));
    }, 3000);
    ws.on('unexpected-response', (_req, response) => {
      clearTimeout(timer);
      response.resume();
      ws.terminate();
      resolve(response.statusCode!);
    });
    ws.on('open', () => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error('Unexpected successful upgrade'));
    });
    ws.on('error', () => {});
  });
}
