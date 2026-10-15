import { randomUUID } from 'node:crypto';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { inputSchema, MAX_FRAME_BYTES } from '../shared/protocol.js';
import { Store, type Auth } from './store.js';
import type { Config } from './config.js';

interface AgentPeer {
  ws: WebSocket;
  auth: Auth;
  alive: boolean;
  frameWindow: number;
  frames: number;
}
interface ViewerPeer {
  ws: WebSocket;
  auth: Auth;
  window: number;
  inputs: number;
  alive: boolean;
}
const agentMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), sessionId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('error'),
      sessionId: z.string().uuid(),
      code: z.enum(['capture_failed', 'desktop_unavailable', 'input_failed']),
    })
    .strict(),
]);

export function webToken(request: IncomingMessage) {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('desklink_session='))
    ?.slice(17);
}

export class Hub {
  readonly agents = new Map<string, AgentPeer>();
  readonly viewers = new Map<string, ViewerPeer>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
  });
  private readonly timer: NodeJS.Timeout;
  private tick = 0;
  private closed = false;

  constructor(
    private store: Store,
    private config: Config,
    server: Server,
  ) {
    server.on('upgrade', (request, socket, head) => {
      socket.on('error', () => {});
      try {
        const url = new URL(request.url ?? '/', config.origin);
        if (url.search) return this.reject(socket, 400);
        if (url.pathname === '/ws/agent') {
          if (request.headers.origin) return this.reject(socket, 403);
          const auth = store.auth(request.headers.authorization?.replace(/^Bearer /, ''), 'agent');
          if (!auth?.deviceId) return this.reject(socket, 401);
          this.wss.handleUpgrade(request, socket, head, (ws) => this.attachAgent(ws, auth));
          return;
        }
        const match = /^\/ws\/viewer\/([0-9a-f-]{36})$/.exec(url.pathname);
        if (!match || request.headers.origin !== config.origin) return this.reject(socket, 403);
        const auth = store.auth(webToken(request), 'web');
        const session = store.session(match[1]);
        if (!auth || !session || session.owner_id !== auth.id || session.auth_hash !== auth.hash)
          return this.reject(socket, 401);
        if (
          session.state !== 'pending' ||
          session.expires_at <= Date.now() ||
          Date.now() - session.created_at > 30_000 ||
          !this.agents.has(session.device_id)
        )
          return this.reject(socket, 409);
        this.wss.handleUpgrade(request, socket, head, (ws) =>
          this.attachViewer(ws, auth, session.id, session.device_id),
        );
      } catch {
        this.reject(socket, 400);
      }
    });
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
  }

  private reject(socket: Duplex, status: number) {
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  private send(ws: WebSocket, data: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  private attachAgent(ws: WebSocket, auth: Auth) {
    const id = auth.deviceId!;
    this.disconnectAgent(id, 'agent_replaced');
    const peer: AgentPeer = { ws, auth, alive: true, frameWindow: Date.now(), frames: 0 };
    this.agents.set(id, peer);
    this.store.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(Date.now(), id);
    this.store.audit(auth.id, 'agent.online', id);
    this.send(ws, { type: 'welcome', protocolVersion: 1, deviceId: id });
    ws.on('pong', () => {
      peer.alive = true;
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', (data, binary) => {
      if (this.closed) return;
      if (this.agents.get(id) !== peer) return;
      if (!this.store.authByHash(auth.hash, 'agent')) {
        this.disconnectAgent(id, 'auth_expired');
        return;
      }
      const session = this.store.db
        .prepare('SELECT id, state FROM remote_sessions WHERE device_id=? AND ended_at IS NULL')
        .get(id) as { id: string; state: string } | undefined;
      if (!session) return;
      if (binary) {
        if (session.state !== 'active') return;
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (
          frame.length < 4 ||
          frame[0] !== 0xff ||
          frame[1] !== 0xd8 ||
          frame.at(-2) !== 0xff ||
          frame.at(-1) !== 0xd9
        ) {
          this.end(session.id, 'invalid_frame');
          return;
        }
        if (Date.now() - peer.frameWindow >= 1000) {
          peer.frameWindow = Date.now();
          peer.frames = 0;
        }
        if (++peer.frames > 15) return;
        const viewer = this.viewers.get(session.id)?.ws;
        if (viewer?.readyState === WebSocket.OPEN && viewer.bufferedAmount < MAX_FRAME_BYTES)
          viewer.send(frame, { binary: true });
        return;
      }
      try {
        if (data.toString().length > 4096) throw new Error('Too large');
        const message = agentMessage.parse(JSON.parse(data.toString()));
        if (message.sessionId !== session.id) return;
        if (message.type === 'error') {
          this.end(session.id, message.code);
          return;
        }
        if (session.state !== 'connecting') return;
        this.store.db
          .prepare("UPDATE remote_sessions SET state='active' WHERE id=?")
          .run(session.id);
        const viewer = this.viewers.get(session.id);
        if (viewer) this.send(viewer.ws, { type: 'ready' });
      } catch {
        this.end(session.id, 'invalid_agent_message');
      }
    });
    ws.on('close', () => {
      if (this.agents.get(id) === peer) {
        this.agents.delete(id);
        this.endDeviceSessions(id, 'agent_disconnected');
        this.store.audit(auth.id, 'agent.offline', id);
      }
    });
  }

  private attachViewer(ws: WebSocket, auth: Auth, id: string, deviceId: string) {
    const agent = this.agents.get(deviceId);
    if (!agent || this.store.session(id)?.state !== 'pending') {
      ws.close(1008, 'unavailable');
      return;
    }
    this.store.db.prepare("UPDATE remote_sessions SET state='connecting' WHERE id=?").run(id);
    const peer: ViewerPeer = { ws, auth, window: Date.now(), inputs: 0, alive: true };
    this.viewers.set(id, peer);
    this.send(agent.ws, { type: 'start', sessionId: id, viewer: auth.name });
    this.store.audit(auth.id, 'session.started', deviceId);
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => {
      peer.alive = true;
    });
    ws.on('message', (data, binary) => {
      if (this.closed) return;
      if (!this.store.authByHash(auth.hash, 'web')) {
        this.end(id, 'auth_expired');
        return;
      }
      if (!this.store.authByHash(agent.auth.hash, 'agent')) {
        this.end(id, 'auth_expired');
        return;
      }
      const session = this.store.session(id);
      if (!session || session.state !== 'active') return;
      if (session.expires_at <= Date.now()) {
        this.end(id, 'session_expired');
        return;
      }
      if (Date.now() - peer.window >= 1000) {
        peer.window = Date.now();
        peer.inputs = 0;
      }
      if (binary || data.toString().length > 16_384 || ++peer.inputs > 240) {
        this.end(id, 'invalid_input');
        return;
      }
      try {
        const input = inputSchema.parse(JSON.parse(data.toString()));
        if (agent.ws.bufferedAmount > 256 * 1024) {
          this.end(id, 'agent_slow');
          return;
        }
        this.send(agent.ws, { type: 'input', sessionId: id, input });
      } catch {
        this.end(id, 'invalid_input');
      }
    });
    ws.on('close', () => this.end(id, 'viewer_disconnected'));
  }

  createSession(auth: Auth, deviceId: string) {
    if (!this.store.device(deviceId, auth.id))
      return { error: '기기를 찾을 수 없습니다.', status: 404 };
    if (!this.agents.has(deviceId)) return { error: '에이전트가 오프라인입니다.', status: 409 };
    if (
      this.store.db
        .prepare('SELECT id FROM remote_sessions WHERE device_id=? AND ended_at IS NULL')
        .get(deviceId)
    )
      return { error: '이미 연결 중인 기기입니다.', status: 409 };
    const id = randomUUID();
    const expiresAt = Date.now() + this.config.remoteTtlMs;
    this.store.db
      .prepare('INSERT INTO remote_sessions VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
      .run(id, auth.id, deviceId, auth.hash, 'pending', Date.now(), expiresAt);
    return { session: { id, deviceId, state: 'pending', expiresAt } };
  }

  end(id: string, reason: string) {
    if (this.closed) return;
    const session = this.store.session(id);
    if (!session || session.ended_at !== null) return;
    this.store.db
      .prepare("UPDATE remote_sessions SET state='ended', ended_at=?, end_reason=? WHERE id=?")
      .run(Date.now(), reason, id);
    const agent = this.agents.get(session.device_id);
    if (agent) this.send(agent.ws, { type: 'stop', sessionId: id, reason });
    const viewer = this.viewers.get(id);
    this.viewers.delete(id);
    if (viewer) {
      this.send(viewer.ws, { type: 'ended', reason });
      viewer.ws.close(1000, reason);
      const timeout = setTimeout(() => viewer.ws.terminate(), 1000);
      timeout.unref();
    }
    this.store.audit(session.owner_id, `session.ended.${reason}`, session.device_id);
  }

  endDeviceSessions(id: string, reason: string) {
    for (const row of this.store.db
      .prepare('SELECT id FROM remote_sessions WHERE device_id=? AND ended_at IS NULL')
      .all(id))
      this.end(row.id as string, reason);
  }

  disconnectAgent(id: string, reason: string) {
    this.endDeviceSessions(id, reason);
    const peer = this.agents.get(id);
    if (peer) {
      this.agents.delete(id);
      this.send(peer.ws, { type: 'revoked', reason });
      peer.ws.close(1000, reason);
      const timeout = setTimeout(() => peer.ws.terminate(), 1000);
      timeout.unref();
      this.store.audit(peer.auth.id, 'agent.offline', id);
    }
  }

  revokeWeb(hash: string) {
    for (const row of this.store.db
      .prepare('SELECT id FROM remote_sessions WHERE auth_hash=? AND ended_at IS NULL')
      .all(hash))
      this.end(row.id as string, 'web_logout');
  }

  private sweep() {
    const now = Date.now();
    for (const row of this.store.db
      .prepare('SELECT id FROM remote_sessions WHERE ended_at IS NULL')
      .all()) {
      const session = this.store.session(row.id as string)!;
      if (session.expires_at <= now) this.end(session.id, 'session_expired');
      else if (session.state !== 'active' && now - session.created_at > 30_000)
        this.end(session.id, 'connect_timeout');
      else if (!this.store.authByHash(session.auth_hash, 'web'))
        this.end(session.id, 'auth_expired');
    }
    for (const [id, peer] of this.agents) {
      if (!this.store.authByHash(peer.auth.hash, 'agent')) this.disconnectAgent(id, 'auth_expired');
    }
    if (++this.tick % 15 !== 0) return;
    for (const [id, peer] of this.viewers) {
      if (!peer.alive) {
        this.end(id, 'viewer_timeout');
        peer.ws.terminate();
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
    for (const [id, peer] of this.agents) {
      if (!peer.alive) {
        peer.ws.terminate();
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
      this.store.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(now, id);
    }
    this.store.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
  }

  close() {
    if (this.closed) return;
    clearInterval(this.timer);
    for (const id of this.agents.keys()) this.disconnectAgent(id, 'server_shutdown');
    this.closed = true;
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}
