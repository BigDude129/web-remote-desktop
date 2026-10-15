import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store, type Auth, type DeviceRow } from './store.js';
import { Hub, webToken } from './hub.js';
import type { Config } from './config.js';
import { ReleaseService } from './releases.js';

const credentials = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(128),
});
const agentLogin = credentials
  .extend({
    installationId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    platform: z.literal('windows'),
    agentVersion: z.string().max(30),
    protocolVersion: z.literal(1),
  })
  .strict();

export function createApplication(config: Config) {
  const store = new Store(config.databasePath);
  store.db
    .prepare(
      "UPDATE remote_sessions SET state='ended', ended_at=?, end_reason='server_restart' WHERE ended_at IS NULL",
    )
    .run(Date.now());
  const app = express();
  const server = createServer(app);
  const hub = new Hub(store, config, server);
  const releases = new ReleaseService(config.releaseRepository);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (config.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  // Bounded, process-local protection. A shared limiter is required before scaling out.
  const attempts = new Map<string, { count: number; until: number }>();
  function loginLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.ip ?? 'unknown';
    let record = attempts.get(key);
    if (!record) {
      if (attempts.size >= 10_000) {
        res.status(429).json({ error: '잠시 후 다시 시도하세요.' });
        return;
      }
      record = { count: 0, until: now + 60_000 };
      attempts.set(key, record);
    }
    if (++record.count > 10) {
      res
        .set('Retry-After', String(Math.ceil((record.until - now) / 1000)))
        .status(429)
        .json({ error: '로그인 시도가 많습니다. 1분 뒤 다시 시도하세요.' });
      return;
    }
    next();
  }
  function requireOrigin(req: Request, res: Response, next: NextFunction) {
    if (req.headers.origin !== config.origin) {
      res.status(403).json({ error: '허용되지 않은 출처입니다.' });
      return;
    }
    next();
  }
  function nativeOnly(req: Request, res: Response, next: NextFunction) {
    if (req.headers.origin || req.get('X-DeskLink-Agent') !== '1') {
      res.status(403).json({ error: '에이전트 요청만 허용됩니다.' });
      return;
    }
    next();
  }
  function requireWeb(req: Request, res: Response, next: NextFunction) {
    const auth = store.auth(webToken(req), 'web');
    if (!auth) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== config.origin || req.get('X-CSRF-Token') !== auth.csrf)
    ) {
      res.status(403).json({ error: '인증 확인에 실패했습니다. 새로 로그인하세요.' });
      return;
    }
    res.locals.auth = auth;
    next();
  }
  function requireAgent(req: Request, res: Response, next: NextFunction) {
    const auth = store.auth(req.headers.authorization?.replace(/^Bearer /, ''), 'agent');
    if (!auth) {
      res.status(401).json({ error: '에이전트 로그인이 필요합니다.' });
      return;
    }
    res.locals.auth = auth;
    next();
  }
  const authOf = (res: Response) => res.locals.auth as Auth;

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/login', requireOrigin, loginLimit, async (req, res) => {
    const input = credentials.strict().parse(req.body);
    const user = await store.verify(input.username, input.password);
    if (!user) {
      res.status(401).json({ error: '계정 또는 비밀번호를 확인하세요.' });
      return;
    }
    const previous = store.auth(webToken(req), 'web');
    if (previous) {
      hub.revokeWeb(previous.hash);
      store.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(previous.hash);
    }
    const session = store.issueAuth(user.id, 'web', config.webTtlMs);
    res.cookie('desklink_session', session.token, {
      httpOnly: true,
      secure: config.secure,
      sameSite: 'strict',
      path: '/',
      maxAge: config.webTtlMs,
    });
    store.audit(user.id, 'web.login');
    res.json({ user, csrfToken: session.csrf, expiresAt: session.expiresAt });
  });
  app.get('/api/auth/me', requireWeb, (_req, res) => {
    const auth = authOf(res);
    res.json({
      user: { id: auth.id, username: auth.username, name: auth.name },
      csrfToken: auth.csrf,
      expiresAt: auth.expiresAt,
    });
  });
  app.post('/api/auth/logout', requireWeb, (_req, res) => {
    const auth = authOf(res);
    hub.revokeWeb(auth.hash);
    store.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(auth.hash);
    store.audit(auth.id, 'web.logout');
    res.clearCookie('desklink_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secure,
    });
    res.status(204).end();
  });
  app.post('/api/agent/login', nativeOnly, loginLimit, async (req, res) => {
    const input = agentLogin.parse(req.body);
    const user = await store.verify(input.username, input.password);
    if (!user) {
      res.status(401).json({ error: '계정 또는 비밀번호를 확인하세요.' });
      return;
    }
    const device = store.registerDevice(
      user.id,
      input.installationId,
      input.name,
      input.platform,
      input.agentVersion,
    );
    hub.disconnectAgent(device.id, 'agent_replaced');
    store.db.prepare("DELETE FROM auth_sessions WHERE device_id=? AND kind='agent'").run(device.id);
    const auth = store.issueAuth(user.id, 'agent', config.agentTtlMs, device.id);
    res.json({
      token: auth.token,
      deviceId: device.id,
      expiresAt: auth.expiresAt,
      protocolVersion: 1,
    });
  });
  app.post('/api/agent/logout', nativeOnly, requireAgent, (_req, res) => {
    const auth = authOf(res);
    hub.disconnectAgent(auth.deviceId!, 'agent_logout');
    store.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(auth.hash);
    res.status(204).end();
  });
  app.get('/api/devices', requireWeb, (_req, res) => {
    const devices = store.db
      .prepare('SELECT * FROM devices WHERE owner_id=? ORDER BY name COLLATE NOCASE')
      .all(authOf(res).id) as unknown as DeviceRow[];
    res.json({
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        agentVersion: device.agent_version,
        lastSeen: device.last_seen,
        createdAt: device.created_at,
        online: hub.agents.has(device.id),
        busy: !!store.db
          .prepare('SELECT id FROM remote_sessions WHERE device_id=? AND ended_at IS NULL')
          .get(device.id),
      })),
    });
  });
  app.post('/api/devices/:id/revoke', requireWeb, (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const auth = authOf(res);
    if (!store.device(id, auth.id)) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    hub.disconnectAgent(id, 'device_revoked');
    store.db.prepare("DELETE FROM auth_sessions WHERE device_id=? AND kind='agent'").run(id);
    store.audit(auth.id, 'device.revoked', id);
    res.status(204).end();
  });
  app.post('/api/sessions', requireWeb, (req, res) => {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).strict().parse(req.body);
    const result = hub.createSession(authOf(res), deviceId);
    if (result.error) {
      res.status(result.status!).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  });
  app.delete('/api/sessions/:id', requireWeb, (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const auth = authOf(res);
    const session = store.session(id);
    if (!session || session.owner_id !== auth.id) {
      res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
      return;
    }
    hub.end(id, 'user_ended');
    res.status(204).end();
  });
  app.get('/api/activity', requireWeb, (_req, res) => {
    res.json({
      events: store.db
        .prepare(
          `SELECT a.id, a.event, d.name AS deviceName, a.created_at AS createdAt
      FROM audit_events a LEFT JOIN devices d ON a.device_id=d.id WHERE a.owner_id=? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 50`,
        )
        .all(authOf(res).id),
    });
  });
  app.get('/api/agent/releases/latest', async (_req, res) => res.json(await releases.latest()));
  app.get('/api/agent/distribution', requireWeb, async (_req, res) =>
    res.json(await releases.distribution()),
  );
  app.get('/api/agent/download', requireWeb, async (_req, res) => {
    const release = await releases.distribution();
    if (!release.available) {
      res.status(404).json({ error: '다운로드 가능한 에이전트가 없습니다.' });
      return;
    }
    if (release.source === 'github') {
      res.redirect(302, release.downloadUrl!);
      return;
    }
    res.download(releases.localPath(release), release.assetName!);
  });
  app.get('/license', (_req, res) => res.type('text/plain').sendFile(resolve('LICENSE')));
  app.get('/licenses', (_req, res) => {
    const file = resolve('THIRD-PARTY-NOTICES.txt');
    if (!existsSync(file)) {
      res.status(503).type('text/plain').send('Run npm run licenses.');
      return;
    }
    res.type('text/plain').sendFile(file);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API를 찾을 수 없습니다.' }));
  app.use(express.static(resolve('dist/web')));
  app.get('/{*path}', (_req, res) => {
    const index = resolve('dist/web/index.html');
    if (!existsSync(index)) {
      res.status(503).send('Run npm run build before starting the server.');
      return;
    }
    res.set('Cache-Control', 'no-cache').sendFile(index);
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      res.status(400).json({ error: '요청 형식을 확인하세요.' });
      return;
    }
    if ((error as { status?: number })?.status === 413) {
      res.status(413).json({ error: '요청이 너무 큽니다.' });
      return;
    }
    console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: '서버에서 요청을 처리하지 못했습니다.' });
  });
  return {
    app,
    server,
    store,
    hub,
    async close() {
      hub.close();
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
      });
      store.close();
    },
  };
}
