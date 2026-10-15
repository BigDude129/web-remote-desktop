import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fixture, testPassword } from './helpers.js';

if (process.platform !== 'win32')
  throw new Error('The native smoke test requires an unlocked Windows desktop.');
const dotnet = process.env.DOTNET_EXECUTABLE ?? 'dotnet';
const runtime = await fixture();
const child = spawn(
  dotnet,
  [
    resolve(
      'agent/DeskLink.Agent.Integration/bin/Release/net10.0-windows/DeskLink.Agent.Integration.dll',
    ),
  ],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);
const exited = once(child, 'exit');
let logs = '';
child.stdout.on('data', (data: Buffer) => {
  logs += data.toString();
});
child.stderr.on('data', () => {});
try {
  child.stdin.write(
    JSON.stringify({
      origin: runtime.config.origin,
      username: runtime.user.username,
      password: testPassword,
    }) + '\n',
  );
  const deadline = Date.now() + 10_000;
  while (!logs.includes('ONLINE')) {
    if (Date.now() > deadline || child.exitCode !== null)
      throw new Error('Native agent did not come online.');
    await new Promise((done) => setTimeout(done, 100));
  }
  const login = await runtime.login();
  const { devices } = await (await runtime.request('/devices', { headers: login.headers })).json();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].online, true);
  const { session } = await (
    await runtime.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: devices[0].id }),
    })
  ).json();
  const viewer = runtime.viewerSocket(session.id, login.cookie);
  assert.equal((await viewer.json()).type, 'ready');
  const frame = await viewer.next(true);
  assert.equal(frame[0], 0xff);
  assert.equal(frame[1], 0xd8);
  // No screenshot is saved and no pointer/key input touches the user's desktop.
  viewer.send({ kind: 'release' });
  await runtime.request(`/sessions/${session.id}`, { method: 'DELETE', headers: login.headers });
  // A second session verifies stop/start does not abort the agent control socket.
  const { session: second } = await (
    await runtime.request('/sessions', {
      method: 'POST',
      headers: login.headers,
      body: JSON.stringify({ deviceId: devices[0].id }),
    })
  ).json();
  const secondViewer = runtime.viewerSocket(second.id, login.cookie);
  assert.equal((await secondViewer.json()).type, 'ready');
  await secondViewer.next(true);
  child.stdin.write('STOP\n');
  const [code] = await exited;
  assert.equal(code, 0);
  assert.equal(runtime.hub.agents.size, 0);
  assert.equal(runtime.store.session(second.id)?.state, 'ended');
  console.log(
    'PASS: real Windows agent login → live JPEG relay → stop/reconnect → agent logout. Frames stayed in memory; no OS input injected.',
  );
} finally {
  if (child.exitCode === null) child.kill();
  await runtime.close();
}
