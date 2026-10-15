import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, rejectedSocket, testPassword } from './helpers.js';
import { Store, digest } from '../server/store.js';

test('web authentication requires origin, protects cookies and rejects missing CSRF', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  assert.equal((await f.request('/devices')).status, 401);
  assert.equal(
    (
      await f.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  const login = await f.login();
  assert.match(login.response.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(login.response.headers.get('set-cookie')!, /SameSite=Strict/);
  assert.equal(login.data.user.username, f.user.username);
  assert.equal(
    (
      await f.request('/auth/logout', {
        method: 'POST',
        headers: { Cookie: login.cookie, Origin: f.config.origin },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/auth/logout', { method: 'POST', headers: login.headers })).status,
    204,
  );
  assert.equal((await f.request('/auth/me', { headers: login.headers })).status, 401);
  const stored = f.store.db.prepare('SELECT password_hash FROM users').get()!;
  assert.ok(!String(stored.password_hash).includes(testPassword));
});

test('devices, connection authorization and activity are isolated by owner', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const owner = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  await agent.json();
  await f.store.createUser('other@example.test', 'Other', testPassword);
  const other = await f.login('other@example.test');
  assert.equal(
    (await (await f.request('/devices', { headers: owner.headers })).json()).devices.length,
    1,
  );
  assert.equal(
    (await (await f.request('/devices', { headers: other.headers })).json()).devices.length,
    0,
  );
  assert.equal(
    (
      await f.request('/sessions', {
        method: 'POST',
        headers: other.headers,
        body: JSON.stringify({ deviceId: registered.deviceId }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(`/devices/${registered.deviceId}/revoke`, {
        method: 'POST',
        headers: other.headers,
      })
    ).status,
    404,
  );
  const activity = await (await f.request('/activity', { headers: other.headers })).json();
  assert.ok(
    activity.events.every((event: { deviceName: string | null }) => event.deviceName === null),
  );
});

test('authorized browser receives frames and relays validated Korean input; ending leaves agent online', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  assert.equal((await agent.json()).type, 'welcome');
  const response = await f.request('/sessions', {
    method: 'POST',
    headers: login.headers,
    body: JSON.stringify({ deviceId: registered.deviceId }),
  });
  assert.equal(response.status, 201);
  const { session } = await response.json();
  const viewer = f.viewerSocket(session.id, login.cookie);
  assert.equal((await agent.json()).type, 'start');
  agent.send({ type: 'ready', sessionId: session.id });
  assert.equal((await viewer.json()).type, 'ready');
  const fixtureFrame = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]); // Transport fixture; no image-decoder claim.
  agent.ws.send(fixtureFrame);
  assert.deepEqual(await viewer.next(true), fixtureFrame);
  const input = { kind: 'text', text: '한글 abc 123 🙂' };
  viewer.send(input);
  assert.deepEqual(await agent.json(), { type: 'input', sessionId: session.id, input });
  const closed = once(viewer.ws, 'close');
  assert.equal(
    (await f.request(`/sessions/${session.id}`, { method: 'DELETE', headers: login.headers }))
      .status,
    204,
  );
  assert.equal((await agent.json()).type, 'stop');
  await closed;
  assert.equal(f.hub.agents.size, 1);
  assert.equal(f.store.session(session.id)?.state, 'ended');
  const activity = await (await f.request('/activity', { headers: login.headers })).text();
  assert.ok(!activity.includes(input.text));
  assert.ok(!activity.includes(registered.token));
});

test('web logout terminates an active viewer and invalidates its socket authorization', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  await agent.json();
  const { session } = await (
    await f.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: registered.deviceId }),
    })
  ).json();
  const viewer = f.viewerSocket(session.id, login.cookie);
  await agent.json();
  agent.send({ type: 'ready', sessionId: session.id });
  await viewer.json();
  const closed = once(viewer.ws, 'close');
  await f.request('/auth/logout', { method: 'POST', headers: login.headers });
  assert.equal((await agent.json()).reason, 'web_logout');
  await closed;
  assert.equal(f.hub.agents.size, 1);
  assert.equal(
    await rejectedSocket(`${f.config.origin.replace('http', 'ws')}/ws/viewer/${session.id}`, {
      Cookie: login.cookie,
      Origin: f.config.origin,
    }),
    401,
  );
});

test('agent relogin preserves its device ID and revokes previous credentials', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const first = await f.agentLogin();
  const agent = f.agentSocket(first.token);
  await agent.json();
  const second = await f.agentLogin(first.installationId);
  assert.equal(second.deviceId, first.deviceId);
  assert.notEqual(second.token, first.token);
  assert.equal(f.store.auth(first.token, 'agent'), undefined);
  assert.equal((await agent.json()).type, 'revoked');
  assert.equal(
    await rejectedSocket(`${f.config.origin.replace('http', 'ws')}/ws/agent`, {
      Authorization: `Bearer ${first.token}`,
    }),
    401,
  );
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM devices').get()!.n, 1);
  const stored = f.store.db.prepare("SELECT hash FROM auth_sessions WHERE kind='agent'").get()!;
  assert.equal(stored.hash, digest(second.token));
});

test('revoking a device disconnects the agent, ends the viewer and requires fresh login', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  await agent.json();
  const { session } = await (
    await f.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: registered.deviceId }),
    })
  ).json();
  const viewer = f.viewerSocket(session.id, login.cookie);
  await agent.json();
  const closed = once(viewer.ws, 'close');
  await f.request(`/devices/${registered.deviceId}/revoke`, {
    method: 'POST',
    headers: login.headers,
  });
  assert.equal((await agent.json()).reason, 'device_revoked');
  await closed;
  assert.equal(f.store.auth(registered.token, 'agent'), undefined);
  assert.equal(f.hub.agents.size, 0);
});

test('offline and busy devices reject sessions, pending sessions time out', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const create = () =>
    f.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: registered.deviceId }),
    });
  assert.equal((await create()).status, 409);
  const agent = f.agentSocket(registered.token);
  await agent.json();
  const { session } = await (await create()).json();
  assert.equal((await create()).status, 409);
  f.store.db
    .prepare('UPDATE remote_sessions SET created_at=? WHERE id=?')
    .run(Date.now() - 31_000, session.id);
  assert.equal((await agent.json()).reason, 'connect_timeout');
  assert.equal(f.store.session(session.id)?.state, 'ended');
  assert.equal((await create()).status, 201);
});

test('WebSocket rejects cross-origin, cross-account, agent cookies and query tokens', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  await agent.json();
  const { session } = await (
    await f.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: registered.deviceId }),
    })
  ).json();
  const base = f.config.origin.replace('http', 'ws');
  assert.equal(
    await rejectedSocket(`${base}/ws/viewer/${session.id}`, {
      Cookie: login.cookie,
      Origin: 'https://evil.example',
    }),
    403,
  );
  assert.equal(await rejectedSocket(`${base}/ws/agent`, { Cookie: login.cookie }), 401);
  assert.equal(await rejectedSocket(`${base}/ws/agent?token=${registered.token}`, {}), 400);
  assert.equal(
    await rejectedSocket(`${base}/ws/agent`, {
      Authorization: `Bearer ${registered.token}`,
      Origin: f.config.origin,
    }),
    403,
  );
  await f.store.createUser('other@example.test', 'Other', testPassword);
  const other = await f.login('other@example.test');
  assert.equal(
    await rejectedSocket(`${base}/ws/viewer/${session.id}`, {
      Cookie: other.cookie,
      Origin: f.config.origin,
    }),
    401,
  );
});

test('malformed remote input stops the session without forwarding arbitrary messages', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  await agent.json();
  const { session } = await (
    await f.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: registered.deviceId }),
    })
  ).json();
  const viewer = f.viewerSocket(session.id, login.cookie);
  await agent.json();
  agent.send({ type: 'ready', sessionId: session.id });
  await viewer.json();
  viewer.send({ kind: 'move', x: 2, y: 0, command: 'forbidden' });
  assert.deepEqual(await agent.json(), {
    type: 'stop',
    sessionId: session.id,
    reason: 'invalid_input',
  });
  assert.equal(f.hub.agents.size, 1);
});

test('web and agent expiration closes active sessions without a new HTTP request', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.login();
  const registered = await f.agentLogin();
  const agent = f.agentSocket(registered.token);
  await agent.json();
  const { session } = await (
    await f.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: registered.deviceId }),
    })
  ).json();
  const viewer = f.viewerSocket(session.id, login.cookie);
  await agent.json();
  agent.send({ type: 'ready', sessionId: session.id });
  await viewer.json();
  const closed = once(viewer.ws, 'close');
  f.store.db.prepare("UPDATE auth_sessions SET expires_at=? WHERE kind='web'").run(Date.now() - 1);
  assert.equal((await agent.json()).reason, 'auth_expired');
  await closed;
  f.store.db
    .prepare("UPDATE auth_sessions SET expires_at=? WHERE kind='agent'")
    .run(Date.now() - 1);
  assert.equal((await agent.json()).type, 'revoked');
  assert.equal(f.hub.agents.size, 0);
});

test('login abuse is bounded and malformed JSON returns a safe validation error', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const headers = { Origin: f.config.origin, 'Content-Type': 'application/json' };
  assert.equal(
    (await f.request('/auth/login', { method: 'POST', headers, body: '{' })).status,
    400,
  );
  for (let i = 0; i < 10; i++)
    await f.request('/auth/login', { method: 'POST', headers, body: '{}' });
  const response = await f.request('/auth/login', { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('retry-after'));
});

test(
  'silent viewer network loss is detected by heartbeat and releases its agent',
  { timeout: 35_000 },
  async (t) => {
    const f = await fixture();
    t.after(() => f.close());
    const login = await f.login();
    const registered = await f.agentLogin();
    const agent = f.agentSocket(registered.token);
    await agent.json();
    const { session } = await (
      await f.request('/sessions', {
        method: 'POST',
        headers: login.headers,
        body: JSON.stringify({ deviceId: registered.deviceId }),
      })
    ).json();
    const viewer = f.viewerSocket(session.id, login.cookie, f.config.origin, false);
    await agent.json();
    agent.send({ type: 'ready', sessionId: session.id });
    await viewer.json();
    await once(viewer.ws, 'close');
    assert.equal((await agent.json()).reason, 'viewer_timeout');
    assert.equal(f.store.session(session.id)?.state, 'ended');
    assert.equal(f.hub.agents.size, 1);
  },
);

test('SQLite survives restarts and account CLI does not terminate sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desklink-'));
  try {
    const path = join(directory, 'test.db');
    const store = new Store(path);
    const user = await store.createUser('owner', 'Owner', testPassword);
    const device = store.registerDevice(user.id, 'test-install', 'PC', 'windows', '0.1.0');
    store.db
      .prepare('INSERT INTO remote_sessions VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
      .run('session', user.id, device.id, 'hash', 'active', Date.now(), Date.now() + 10000);
    const cliStore = new Store(path);
    assert.equal(cliStore.session('session')?.state, 'active');
    cliStore.close();
    store.close();
    const again = new Store(path);
    assert.equal((await again.verify('owner', testPassword))?.id, user.id);
    assert.equal(again.device(device.id, user.id)?.name, 'PC');
    again.close();
  } finally {
    // Only remove the exact test-owned temporary directory created above.
    assert.equal(join(tmpdir(), directory.slice(tmpdir().length).replace(/^[\\/]/, '')), directory);
    assert.ok(directory.startsWith(join(tmpdir(), 'desklink-')));
    await rm(directory, { recursive: true, force: true });
  }
});
