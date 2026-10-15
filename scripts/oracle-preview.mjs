// Temporary Oracle pilot URL. No credentials or screen data are logged.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const binary = process.env.DESKLINK_TUNNEL_BINARY;
if (!binary) throw new Error('DESKLINK_TUNNEL_BINARY is required.');
const port = Number(process.env.DESKLINK_PREVIEW_PORT ?? 3230);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.');
mkdirSync('local', { recursive: true, mode: 0o700 });
const child = spawn(binary, [
  'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`,
], { stdio: ['ignore', 'pipe', 'pipe'] });
let configured = false;
let output = '';
let failed = false;
function consume(chunk) {
  // Do not copy general tunnel diagnostics into application logs.
  output = (output + chunk.toString()).slice(-16000);
  const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
  if (configured || !url) return;
  configured = true;
  try {
    let env = readFileSync('.env', 'utf8');
    for (const [key, value] of Object.entries({
      HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: url, TRUST_PROXY: '1',
    })) {
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env}\n${key}=${value}\n`;
    }
    writeFileSync('.env.next', env, { mode: 0o600 });
    renameSync('.env.next', '.env');
    execFileSync('systemctl', ['--user', 'restart', 'desklink-pilot.service']);
    writeFileSync(join('local', 'preview-url.txt'), `${url}\n`, { mode: 0o600 });
    console.log('DeskLink temporary HTTPS origin configured.');
  } catch {
    failed = true;
    console.error('Could not configure pilot origin.');
    child.kill('SIGTERM');
  }
}
child.stdout.on('data', consume);
child.stderr.on('data', consume);
const timer = setTimeout(() => {
  if (!configured) {
    failed = true;
    console.error('Tunnel did not provide a URL within 90 seconds.');
    child.kill('SIGTERM');
  }
}, 90000);
timer.unref();
child.on('error', () => { console.error('Tunnel failed to start.'); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); process.exitCode = failed ? 1 : (code || 1); });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
