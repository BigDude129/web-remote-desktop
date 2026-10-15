import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Command,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Laptop,
  LayoutGrid,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Monitor,
  Plus,
  Search,
  ShieldCheck,
  Signal,
  X,
} from 'lucide-react';
import { api, setCsrf } from './api.js';
import { Viewer } from './Viewer.js';
import type { AuditEvent, Device, RemoteSession, User } from '../shared/protocol.js';
import { APP_VERSION } from '../shared/version.js';
import { newerVersion, type AgentRelease } from '../shared/releases.js';

interface Login {
  user: User;
  csrfToken: string;
  expiresAt: number;
}
const relative = (time: number) => {
  const minutes = Math.floor((Date.now() - time) / 60_000);
  return minutes < 1
    ? '방금 전'
    : minutes < 60
      ? `${minutes}분 전`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}시간 전`
        : new Date(time).toLocaleDateString('ko-KR');
};
function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'light' : ''}`}>
      <span className="brand-symbol">
        <Link2 size={23} />
      </span>
      DeskLink<span className="brand-beta">PREVIEW</span>
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: (session: Login) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand light />
        <div className="login-copy">
          <span className="eyebrow">YOUR DESKTOP. ANYWHERE.</span>
          <h1>
            내 작업은,
            <br />
            어디서든
            <br />
            <span>이어집니다.</span>
          </h1>
          <p>
            브라우저 하나로 내 Windows PC에 연결하세요.
            <br />
            익숙한 화면과 작업이 그대로 기다립니다.
          </p>
          <div className="desktop-art" aria-hidden="true">
            <div className="art-orbit" />
            <div className="art-monitor">
              <div className="art-title">
                <i />
                <i />
                <i />
                <span>My workspace</span>
              </div>
              <div className="art-desktop">
                <div className="art-sidebar" />
                <div className="art-window">
                  <span />
                  <span />
                  <span />
                  <div />
                </div>
              </div>
            </div>
            <div className="art-connection">
              <i className="status-dot" /> 함께 연결되는 작업 공간
            </div>
          </div>
        </div>
        <div className="story-footer">
          <ShieldCheck size={16} /> 내 계정에 등록한 기기만 연결합니다.
        </div>
      </section>
      <section className="login-panel">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <span className="section-label">WELCOME BACK</span>
          <h2>내 작업 공간에 로그인</h2>
          <p className="muted">등록한 기기를 확인하고 원격으로 연결하세요.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                onLogin(
                  await api<Login>('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password }),
                  }),
                );
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="username">계정</label>
            <input
              id="username"
              autoComplete="username"
              placeholder="이메일 또는 계정 ID"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              maxLength={120}
            />
            <label htmlFor="password">비밀번호</label>
            <div className="password-input">
              <input
                id="password"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                maxLength={128}
              />
              <button
                type="button"
                aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  로그인 <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-note">
            <LockKeyhole size={18} />
            <div>
              <strong>초대된 계정으로 시작하세요</strong>
              <p>계정 발급과 접속 도움은 서버 운영자에게 문의하세요.</p>
            </div>
          </div>
        </div>
        <footer className="login-footer">
          <a href="/license" target="_blank" rel="noreferrer">
            DeskLink · MIT
          </a>
          <a href="/licenses" target="_blank" rel="noreferrer">
            오픈소스 고지
          </a>
          <span>나의 PC, 나의 작업 공간.</span>
        </footer>
      </section>
    </main>
  );
}

function AgentDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [release, setRelease] = useState<AgentRelease | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    api<AgentRelease>('/agent/distribution')
      .then(setRelease)
      .catch((error) => setError(error.message));
  }, []);
  return (
    <dialog ref={dialog} className="agent-dialog" onCancel={onClose}>
      <div className="dialog-top">
        <span className="dialog-icon">
          <Download size={25} />
        </span>
        <button className="icon-button" onClick={onClose} aria-label="설치 안내 닫기">
          <X size={20} />
        </button>
      </div>
      <span className="section-label">CONNECT YOUR PC</span>
      <h2>내 PC를 연결하세요</h2>
      <p className="muted">원격으로 사용할 Windows PC에서 한 번만 설정하세요.</p>
      <ol className="setup-steps">
        <li>
          <span>1</span>
          <div>
            <strong>Windows 에이전트 실행</strong>
            <p>패키지를 내려받아 압축을 풀고 DeskLink.Agent.exe를 실행하세요.</p>
            {release?.available ? (
              <>
                <a className="primary-button" href="/api/agent/download">
                  <ArrowDownToLine size={16} /> Windows x64 · v{release.version} 다운로드
                </a>
                <p>
                  {release.source === 'github'
                    ? release.stale
                      ? '최근 확인한 릴리즈 · 현재 업데이트 확인 불가'
                      : '최신 정식 릴리즈'
                    : '서버의 로컬 개발 빌드'}
                  {release.releaseUrl && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={release.releaseUrl} target="_blank" rel="noreferrer">
                        릴리즈 노트 ↗
                      </a>
                    </>
                  )}
                </p>
                {release.sha256 && (
                  <details className="checksum">
                    <summary>SHA-256 검증값</summary>
                    <code>{release.sha256}</code>
                  </details>
                )}
              </>
            ) : (
              <div className="setup-notice">
                {release === null
                  ? '패키지를 확인하는 중…'
                  : '아직 다운로드할 수 있는 에이전트가 없습니다. 서버 운영자에게 문의해 주세요.'}
              </div>
            )}
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>서버 주소 입력</strong>
            <p>에이전트에 아래 주소를 입력하세요.</p>
            <button
              className="copy-address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(location.origin);
                  setCopied(true);
                } catch {
                  setError('주소를 직접 복사해 주세요.');
                }
              }}
            >
              <code>{location.origin}</code>
              {copied ? <Check size={16} /> : '복사'}
            </button>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>로그인하고 원격 허용</strong>
            <p>
              웹과 같은 계정으로 로그인하세요. 에이전트가 활성화되면 기기 목록에 온라인으로
              나타납니다.
            </p>
          </div>
        </li>
      </ol>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="dialog-foot">
        <ShieldCheck size={18} />
        <p>
          에이전트에서 언제든 원격 허용을 중단할 수 있습니다. Windows 잠금 화면과 UAC 화면은 이번
          초안의 지원 범위에 포함되지 않습니다.
        </p>
      </div>
    </dialog>
  );
}

const activityLabel = (event: string) =>
  ({
    'web.login': '웹 로그인',
    'web.logout': '웹 로그아웃',
    'agent.online': '에이전트 연결',
    'agent.offline': '에이전트 오프라인',
    'session.started': '원격 연결 시작',
    'device.revoked': '기기 원격 허용 해제',
  })[event] ?? (event.startsWith('session.ended.') ? '원격 연결 종료' : event);

export function App() {
  const [login, setLogin] = useState<Login | null>(null);
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [latest, setLatest] = useState<AgentRelease | null>(null);
  const [tab, setTab] = useState<'devices' | 'activity'>('devices');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState('');
  const [remote, setRemote] = useState<{ device: Device; session: RemoteSession } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  function acceptLogin(data: Login) {
    setCsrf(data.csrfToken);
    setLogin(data);
    setError('');
  }
  useEffect(() => {
    let alive = true;
    api<Login>('/auth/me')
      .then((data) => {
        if (alive) acceptLogin(data);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    const unauthorized = () => {
      setLogin(null);
      setRemote(null);
      setDevices([]);
      setFresh(false);
      setCsrf('');
    };
    window.addEventListener('desklink:unauthorized', unauthorized);
    return () => {
      alive = false;
      window.removeEventListener('desklink:unauthorized', unauthorized);
    };
  }, []);

  useEffect(() => {
    if (!login) return;
    let alive = true;
    let running = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const [deviceData, activityData, releaseData] = await Promise.all([
          api<{ devices: Device[] }>('/devices', { signal: controller.signal }),
          api<{ events: AuditEvent[] }>('/activity', { signal: controller.signal }),
          api<AgentRelease>('/agent/releases/latest', { signal: controller.signal }).catch(
            () => null,
          ),
        ]);
        if (alive) {
          setDevices(deviceData.devices);
          setEvents(activityData.events);
          setLatest(releaseData);
          setFresh(true);
          setUpdatedAt(Date.now());
        }
      } catch (error) {
        if (alive) {
          setFresh(false);
          setError((error as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [login]);

  async function connect(device: Device) {
    setBusy(device.id);
    setError('');
    try {
      const data = await api<{ session: RemoteSession }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ deviceId: device.id }),
      });
      setRemote({ device, session: data.session });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function closeRemote() {
    const current = remote;
    setRemote(null);
    if (current) {
      try {
        await api(`/sessions/${current.session.id}`, { method: 'DELETE' });
      } catch (error) {
        setError((error as Error).message);
      }
    }
  }
  async function revoke(device: Device) {
    setBusy(device.id);
    try {
      await api(`/devices/${device.id}/revoke`, { method: 'POST' });
      setDevices((items) =>
        items.map((item) =>
          item.id === device.id ? { ...item, online: false, busy: false } : item,
        ),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (loading)
    return (
      <div className="loading-page">
        <Brand />
        <LoaderCircle className="spin" />
        <p>작업 공간을 준비하고 있어요.</p>
      </div>
    );
  if (!login) return <LoginPage onLogin={acceptLogin} />;
  if (remote)
    return (
      <Viewer device={remote.device} session={remote.session} onClose={() => void closeRemote()} />
    );

  const online = devices.filter((device) => device.online).length;
  const filtered = devices.filter(
    (device) =>
      device.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'online' ? device.online : !device.online)),
  );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand light />
        <div className="workspace-label">개인 워크스페이스</div>
        <nav aria-label="메인 메뉴">
          <button className={tab === 'devices' ? 'selected' : ''} onClick={() => setTab('devices')}>
            <LayoutGrid size={19} /> 내 기기 <span>{devices.length}</span>
          </button>
          <button
            className={tab === 'activity' ? 'selected' : ''}
            onClick={() => setTab('activity')}
          >
            <Activity size={19} /> 연결 기록
          </button>
          <button onClick={() => setDialog(true)}>
            <ArrowDownToLine size={19} /> 에이전트 설치
          </button>
        </nav>
        <div className="sidebar-help">
          <div className="help-symbol">
            <Globe2 size={24} />
          </div>
          <strong>
            새로운 PC에서도
            <br />
            하던 작업 그대로.
          </strong>
          <p>
            에이전트를 설치하고
            <br />내 작업 공간을 넓혀보세요.
          </p>
          <button onClick={() => setDialog(true)}>
            기기 연결 안내 <ArrowRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className={fresh ? 'status-dot' : 'status-dot offline'} />{' '}
          {fresh ? '서버에 연결됨' : '서버 상태 확인 중'}
          <small>DeskLink v{APP_VERSION} · Preview</small>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span>워크스페이스</span>
            <ChevronRight size={14} />
            <strong>{tab === 'devices' ? '내 기기' : '연결 기록'}</strong>
          </div>
          <div className="account">
            <span className="avatar">{login.user.name.slice(0, 1)}</span>
            <div>
              <strong>{login.user.name}</strong>
              <small>개인 계정</small>
            </div>
            <button
              className="icon-button"
              aria-label="로그아웃"
              disabled={busy === 'logout'}
              onClick={async () => {
                setBusy('logout');
                try {
                  await api('/auth/logout', { method: 'POST' });
                  setLogin(null);
                  setCsrf('');
                  setDevices([]);
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="dashboard">
          <div className="page-heading">
            <div>
              <span className="section-label">MY WORKSPACE</span>
              <h1>{tab === 'devices' ? '내 기기' : '연결 기록'}</h1>
              <p className="muted">
                {tab === 'devices'
                  ? '익숙한 작업 공간으로, 어디서든 연결하세요.'
                  : '내 계정의 로그인과 원격 연결 이력을 확인하세요.'}
              </p>
            </div>
            <button className="primary-button" onClick={() => setDialog(true)}>
              <Plus size={18} /> 기기 연결
            </button>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button className="icon-button" onClick={() => setError('')} aria-label="오류 닫기">
                <X size={16} />
              </button>
            </div>
          )}
          {tab === 'devices' ? (
            <>
              <section className="welcome-banner">
                <div>
                  <span className="banner-kicker">
                    <i className="status-dot" /> CONNECT TO YOUR EVERYDAY
                  </span>
                  <h2>어디서든, 내 PC 그대로.</h2>
                  <p>
                    온라인 기기를 선택하면 지금 하던 작업이 이어집니다.
                    <br />
                    모든 연결은 로그인한 내 계정 안에서 이루어집니다.
                  </p>
                  <button onClick={() => setDialog(true)}>
                    처음 연결하시나요? <ArrowRight size={15} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="mini-monitor">
                    <span />
                    <div>
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                  <div className="mini-link">
                    <Link2 size={24} />
                  </div>
                  <div className="mini-laptop">
                    <span />
                    <div />
                  </div>
                  <div className="art-dot one" />
                  <div className="art-dot two" />
                </div>
              </section>
              <section className="stats" aria-label="기기 현황">
                <div>
                  <span className="stat-icon blue">
                    <Monitor size={20} />
                  </span>
                  <div>
                    <span>전체 기기</span>
                    <strong>
                      {devices.length}
                      <small>대</small>
                    </strong>
                  </div>
                  <small>내 계정에 등록됨</small>
                </div>
                <div>
                  <span className="stat-icon green">
                    <Signal size={20} />
                  </span>
                  <div>
                    <span>온라인</span>
                    <strong>
                      {fresh ? online : '—'}
                      <small>대</small>
                    </strong>
                  </div>
                  <small>{fresh ? '연결할 수 있는 기기' : '상태 확인 필요'}</small>
                </div>
                <div>
                  <span className="stat-icon gray">
                    <Laptop size={20} />
                  </span>
                  <div>
                    <span>오프라인</span>
                    <strong>
                      {fresh ? devices.length - online : '—'}
                      <small>대</small>
                    </strong>
                  </div>
                  <small>에이전트 로그인 필요</small>
                </div>
              </section>
              <section className="device-section">
                <div className="list-heading">
                  <div className="filter-tabs">
                    {[
                      ['all', '전체 기기', devices.length],
                      ['online', '온라인', online],
                      ['offline', '오프라인', devices.length - online],
                    ].map(([value, label, count]) => (
                      <button
                        key={value}
                        className={filter === value ? 'active' : ''}
                        onClick={() => setFilter(String(value))}
                      >
                        {label}
                        <span>{count}</span>
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="기기 검색"
                      placeholder="기기 이름으로 검색"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                </div>
                {filtered.length ? (
                  <div className="device-grid">
                    {filtered.map((device) => (
                      <article className="device-card" key={device.id}>
                        <div className="card-top">
                          <span className="pc-icon">
                            <Monitor size={27} />
                          </span>
                          <span
                            className={`device-status ${fresh && device.online ? 'online' : ''}`}
                          >
                            <i
                              className={`status-dot ${fresh && device.online ? '' : 'offline'}`}
                            />
                            {!fresh
                              ? '상태 미확인'
                              : device.busy
                                ? '연결 중'
                                : device.online
                                  ? '온라인'
                                  : '오프라인'}
                          </span>
                        </div>
                        <h3>{device.name}</h3>
                        <p className="device-platform">
                          Windows <span>·</span> Agent {device.agentVersion}
                        </p>
                        {latest?.available &&
                          latest.version &&
                          newerVersion(latest.version, device.agentVersion) && (
                            <button className="agent-update" onClick={() => setDialog(true)}>
                              v{latest.version} 업데이트 안내 <ArrowRight size={12} />
                            </button>
                          )}
                        <div className="device-detail">
                          <span>마지막 연결</span>
                          <span>
                            {fresh && device.online ? '현재 활성' : relative(device.lastSeen)}
                          </span>
                        </div>
                        <button
                          className={device.online ? 'connect-button' : 'connect-button disabled'}
                          disabled={!fresh || !device.online || device.busy || !!busy}
                          onClick={() => void connect(device)}
                        >
                          {busy === device.id ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <>
                              <Monitor size={16} />
                              {device.busy
                                ? '다른 세션에서 연결 중'
                                : device.online
                                  ? '원격 연결'
                                  : '에이전트 오프라인'}
                              <ArrowRight size={15} />
                            </>
                          )}
                        </button>
                        {
                          <button
                            className="revoke-button"
                            disabled={!!busy}
                            onClick={() => void revoke(device)}
                          >
                            이 기기 원격 허용 해제
                          </button>
                        }
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <Monitor size={46} />
                      <span>
                        <Plus size={17} />
                      </span>
                    </div>
                    <h3>
                      {devices.length
                        ? '조건에 맞는 기기가 없습니다'
                        : '첫 번째 PC를 연결해 보세요'}
                    </h3>
                    <p>
                      {devices.length
                        ? '검색어나 상태 필터를 바꿔보세요.'
                        : 'Windows PC에서 에이전트에 로그인하면 여기에 나타납니다.'}
                    </p>
                    {!devices.length && (
                      <button className="subtle-button" onClick={() => setDialog(true)}>
                        에이전트 설치 안내 <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )}
              </section>
              <div className="dashboard-foot">
                <span>
                  <ShieldCheck size={15} /> 내 계정에 등록된 기기만 표시됩니다.
                </span>
                <span>
                  {updatedAt
                    ? `${new Date(updatedAt).toLocaleTimeString('ko-KR')} 업데이트 · 5초마다 확인`
                    : '서버에서 기기 목록을 가져오는 중'}
                </span>
              </div>
            </>
          ) : (
            <section className="activity-panel">
              <div className="activity-title">
                <h2>최근 활동</h2>
                <span>최신 50건</span>
              </div>
              {events.length ? (
                events.map((event) => (
                  <div className="activity-row" key={event.id}>
                    <span className="activity-symbol">
                      <Activity size={18} />
                    </span>
                    <div>
                      <strong>{activityLabel(event.event)}</strong>
                      <small>{event.deviceName ?? '내 계정'}</small>
                    </div>
                    <time dateTime={new Date(event.createdAt).toISOString()}>
                      {new Date(event.createdAt).toLocaleString('ko-KR')}
                    </time>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <Activity size={34} />
                  <h3>아직 연결 기록이 없습니다</h3>
                  <p>로그인과 원격 연결 활동이 여기에 기록됩니다.</p>
                </div>
              )}
            </section>
          )}
          <div className="preview-note">
            <CircleHelp size={16} />
            <span>
              현재 콘솔을 공유하는 Windows MVP입니다. 잠금 화면, 오디오, 파일 전송은 후속 단계에서
              지원합니다.
            </span>
            <a href="/license" target="_blank" rel="noreferrer">
              MIT
            </a>
            <a href="/licenses" target="_blank" rel="noreferrer">
              오픈소스 고지
            </a>
            <Command size={16} />
          </div>
        </main>
      </div>
      {dialog && <AgentDialog onClose={() => setDialog(false)} />}
    </div>
  );
}
