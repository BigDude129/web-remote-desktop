import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { User } from '../shared/protocol.js';

const derive = promisify(scrypt);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export interface Auth extends User {
  hash: string;
  kind: 'web' | 'agent';
  deviceId: string | null;
  expiresAt: number;
  csrf: string;
}
export interface DeviceRow {
  id: string;
  owner_id: string;
  name: string;
  platform: string;
  agent_version: string;
  last_seen: number;
  created_at: number;
}
export interface SessionRow {
  id: string;
  owner_id: string;
  device_id: string;
  auth_hash: string;
  state: string;
  created_at: number;
  expires_at: number;
  ended_at: number | null;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const schemaVersion = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (schemaVersion.user_version > 1)
      throw new Error('Database schema is newer than this server.');
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), installation_id TEXT NOT NULL,
        name TEXT NOT NULL, platform TEXT NOT NULL, agent_version TEXT NOT NULL,
        last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE(owner_id, installation_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS auth_sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
        device_id TEXT REFERENCES devices(id), expires_at INTEGER NOT NULL, csrf TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS remote_sessions (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), device_id TEXT NOT NULL REFERENCES devices(id),
        auth_hash TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, ended_at INTEGER, end_reason TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_controller ON remote_sessions(device_id) WHERE ended_at IS NULL;
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), device_id TEXT REFERENCES devices(id),
        event TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
  }

  async createUser(username: string, name: string, password: string): Promise<User> {
    if (password.length < 12 || password.length > 128)
      throw new Error('Password must be 12–128 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = (await derive(password, salt, 64)) as Buffer;
    const user = { id: randomUUID(), username: username.trim().toLowerCase(), name };
    this.db
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.username, name, `${salt}:${key.toString('hex')}`, Date.now());
    return user;
  }

  async verify(username: string, password: string): Promise<User | undefined> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username=?')
      .get(username.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
    const [salt, expected] = (row?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(
      ':',
    );
    const actual = (await derive(password, salt, 64)) as Buffer;
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), actual) || !row) return;
    return { id: row.id, username: row.username, name: row.name };
  }

  issueAuth(userId: string, kind: Auth['kind'], ttl: number, deviceId: string | null = null) {
    const token = newToken();
    const csrf = newToken();
    const expiresAt = Date.now() + ttl;
    this.db
      .prepare('INSERT INTO auth_sessions VALUES (?, ?, ?, ?, ?, ?)')
      .run(digest(token), userId, kind, deviceId, expiresAt, csrf);
    return { token, csrf, expiresAt };
  }

  auth(token: string | undefined, kind: Auth['kind']): Auth | undefined {
    if (!token || token.length > 128) return;
    return this.authByHash(digest(token), kind);
  }

  authByHash(hash: string, kind: Auth['kind']): Auth | undefined {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.name, a.hash, a.kind, a.device_id AS deviceId,
      a.expires_at AS expiresAt, a.csrf FROM auth_sessions a JOIN users u ON u.id=a.user_id
      WHERE a.hash=? AND a.kind=? AND a.expires_at>?`,
      )
      .get(hash, kind, Date.now()) as Auth | undefined;
  }

  registerDevice(
    userId: string,
    installationId: string,
    name: string,
    platform: string,
    version: string,
  ): DeviceRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, installation_id) DO UPDATE SET name=excluded.name,
      platform=excluded.platform, agent_version=excluded.agent_version, last_seen=excluded.last_seen`,
      )
      .run(randomUUID(), userId, installationId, name, platform, version, now, now);
    return this.db
      .prepare('SELECT * FROM devices WHERE owner_id=? AND installation_id=?')
      .get(userId, installationId) as unknown as DeviceRow;
  }

  device(id: string, userId: string): DeviceRow | undefined {
    return this.db
      .prepare('SELECT * FROM devices WHERE id=? AND owner_id=?')
      .get(id, userId) as unknown as DeviceRow | undefined;
  }

  session(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM remote_sessions WHERE id=?').get(id) as unknown as
      SessionRow | undefined;
  }

  audit(ownerId: string, event: string, deviceId: string | null = null) {
    this.db
      .prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), ownerId, deviceId, event, Date.now());
  }

  close() {
    this.db.close();
  }
}
