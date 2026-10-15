import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');

export interface Config {
  host: string;
  port: number;
  origin: string;
  databasePath: string;
  secure: boolean;
  trustProxy: boolean;
  webTtlMs: number;
  agentTtlMs: number;
  remoteTtlMs: number;
  releaseRepository: string;
}

export function readConfig(): Config {
  const origin = new URL(process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000');
  const host = process.env.HOST ?? '127.0.0.1';
  const loopback = (value: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(value);
  if (origin.origin !== origin.href.replace(/\/$/, '') || origin.username || origin.password) {
    throw new Error('PUBLIC_ORIGIN must contain only scheme, host and port.');
  }
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Use an HTTP(S) origin.');
  if (origin.protocol === 'http:' && (!loopback(origin.hostname) || !loopback(host))) {
    throw new Error('Non-loopback connections require an HTTPS PUBLIC_ORIGIN.');
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return {
    host,
    port,
    origin: origin.origin,
    secure: origin.protocol === 'https:',
    databasePath: process.env.DATABASE_PATH ?? 'local/desklink.db',
    trustProxy: process.env.TRUST_PROXY === '1',
    webTtlMs: 8 * 60 * 60 * 1000,
    agentTtlMs: 12 * 60 * 60 * 1000,
    remoteTtlMs: 30 * 60 * 1000,
    releaseRepository: process.env.RELEASE_REPOSITORY ?? 'BigDude129/web-remote-desktop',
  };
}
