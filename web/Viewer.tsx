import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Expand, Keyboard, Monitor, Send, X } from 'lucide-react';
import { keyCodes, type Device, type RemoteInput, type RemoteSession } from '../shared/protocol.js';

const reasons: Record<string, string> = {
  agent_disconnected: '에이전트 연결이 끊겼습니다.',
  agent_logout: '에이전트에서 로그아웃했습니다.',
  device_revoked: '기기의 원격 허용이 해제되었습니다.',
  auth_expired: '로그인 시간이 만료되었습니다.',
  session_expired: '30분 세션이 종료되었습니다. 다시 연결할 수 있습니다.',
  desktop_unavailable: 'Windows 화면이 잠겼거나 현재 데스크톱에 접근할 수 없습니다.',
  capture_failed: 'Windows 화면을 캡처하지 못했습니다.',
  input_failed: 'Windows에서 입력을 처리하지 못했습니다.',
  connect_timeout: '에이전트의 응답 시간이 초과되었습니다.',
  server_shutdown: '서버가 종료되었습니다.',
  viewer_timeout: '브라우저 연결 응답 시간이 초과되었습니다. 다시 연결해 주세요.',
  agent_replaced: '에이전트가 다시 로그인했습니다.',
  user_ended: '연결을 종료했습니다.',
};

export function Viewer({
  device,
  session,
  onClose,
}: {
  device: Device;
  session: RemoteSession;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const active = useRef(false);
  const inputBlocked = useRef(false);
  const [inputWarning, setInputWarning] = useState('');
  const [status, setStatus] = useState('에이전트에 연결하는 중…');
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const lastMove = useRef(0);
  const pressedPointer = useRef<number | null>(null);

  function send(input: RemoteInput) {
    if (inputBlocked.current && input.kind !== 'release' && input.kind !== 'resume') return false;
    if (
      active.current &&
      ws.current?.readyState === WebSocket.OPEN &&
      ws.current.bufferedAmount < 64 * 1024
    ) {
      ws.current.send(JSON.stringify(input));
      return true;
    }
    return false;
  }
  const release = () => {
    pressedPointer.current = null;
    send({ kind: 'release' });
  };

  useEffect(() => {
    let disposed = false;
    let decoding = false;
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/viewer/${session.id}`,
    );
    ws.current = socket;
    socket.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          active.current = true;
          setReady(true);
          setStatus('연결됨 · 화면을 클릭해 조작하세요');
        }
        if (message.type === 'warning' && message.code === 'input_failed') {
          inputBlocked.current = true;
          release();
          setInputWarning(
            `Windows가 입력을 거부했습니다 (${message.operation} / ${message.nativeError}). 화면은 계속 볼 수 있습니다. 대상 앱을 확인한 뒤 입력을 다시 시도하세요.`,
          );
          setStatus('연결됨 · 입력 일시 중지');
        }
        if (message.type === 'ended') {
          active.current = false;
          setReady(false);
          setEnded(true);
          setStatus(reasons[message.reason] ?? '원격 연결이 종료되었습니다.');
        }
        return;
      }
      if (decoding || disposed) return;
      decoding = true;
      try {
        const bitmap = await createImageBitmap(event.data as Blob);
        const target = canvas.current;
        if (!disposed && target && active.current) {
          if (target.width !== bitmap.width) target.width = bitmap.width;
          if (target.height !== bitmap.height) target.height = bitmap.height;
          target.getContext('2d')?.drawImage(bitmap, 0, 0);
          setHasFrame(true);
        }
        bitmap.close();
      } catch {
        if (!disposed) setStatus('화면을 읽지 못했습니다. 다시 연결해 주세요.');
      } finally {
        decoding = false;
      }
    };
    socket.onerror = () => {
      if (!disposed) setStatus('원격 연결을 열지 못했습니다.');
    };
    socket.onclose = () => {
      active.current = false;
      if (!disposed) {
        setReady(false);
        setEnded(true);
        setStatus((current) =>
          current.startsWith('연결됨') || current.startsWith('에이전트')
            ? '원격 연결이 종료되었습니다.'
            : current,
        );
      }
    };
    const blur = () => release();
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      release();
      active.current = false;
      socket.close();
      ws.current = null;
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [session.id]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      send({
        kind: 'wheel',
        delta: Math.max(
          -1200,
          Math.min(1200, Math.round(-event.deltaY * (event.deltaMode === 1 ? 30 : 1))),
        ),
      });
    };
    target.addEventListener('wheel', wheel, { passive: false });
    return () => target.removeEventListener('wheel', wheel);
  }, []);

  function position(event: React.PointerEvent<HTMLCanvasElement>, force = false) {
    if (!force && performance.now() - lastMove.current < 25) return;
    lastMove.current = performance.now();
    const rect = event.currentTarget.getBoundingClientRect();
    send({
      kind: 'move',
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    });
  }
  function key(event: React.KeyboardEvent, down: boolean) {
    if (event.nativeEvent.isComposing || event.code === 'Process') return;
    if (keyCodes.includes(event.code as (typeof keyCodes)[number])) {
      event.preventDefault();
      send({ kind: 'key', code: event.code, down });
    }
  }
  function special(code: string) {
    send({ kind: 'key', code, down: true });
    send({ kind: 'key', code, down: false });
  }

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <button className="icon-button" onClick={onClose} aria-label="기기 목록으로 돌아가기">
          <ArrowLeft size={20} />
        </button>
        <Monitor size={20} />
        <div>
          <strong>{device.name}</strong>
          <small role="status">{status}</small>
        </div>
        <div className="viewer-actions">
          <button className="subtle-button" onClick={() => setShowText(!showText)}>
            <Keyboard size={16} /> 문자열 입력
          </button>
          <button
            className="icon-button"
            aria-label="전체 화면"
            onClick={() => {
              surface.current
                ?.requestFullscreen?.()
                .catch(() => setStatus('이 브라우저에서는 전체 화면을 사용할 수 없습니다.'));
            }}
          >
            <Expand size={18} />
          </button>
          <button className="danger-button" onClick={onClose}>
            <X size={16} /> 연결 종료
          </button>
        </div>
      </header>
      {inputWarning && !ended && (
        <div className="input-warning" role="alert">
          <span>{inputWarning}</span>
          <button
            className="subtle-button"
            disabled={!ready}
            onClick={() => {
              if (!send({ kind: 'resume' })) return;
              inputBlocked.current = false;
              setInputWarning('');
              setStatus('연결됨 · 입력 재시도');
            }}
          >
            입력 다시 시도
          </button>
        </div>
      )}
      <div className="remote-surface" ref={surface}>
        <canvas
          ref={canvas}
          width={1280}
          height={720}
          tabIndex={ready ? 0 : -1}
          aria-label="원격 Windows 화면. 클릭하면 키보드와 마우스로 조작합니다."
          className={hasFrame ? '' : 'waiting-canvas'}
          onBlur={release}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => key(event, true)}
          onKeyUp={(event) => key(event, false)}
          onPointerMove={(event) => position(event)}
          onPointerDown={(event) => {
            if (!ready) return;
            event.preventDefault();
            event.currentTarget.focus();
            pressedPointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            position(event, true);
            send({
              kind: 'button',
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
              down: true,
            });
          }}
          onPointerUp={(event) => {
            position(event, true);
            send({
              kind: 'button',
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
              down: false,
            });
            pressedPointer.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={release}
          onLostPointerCapture={(event) => {
            if (pressedPointer.current === event.pointerId) release();
          }}
        />
        {(!hasFrame || ended) && (
          <div className="screen-message">
            <Monitor size={40} />
            <h2>{ended ? '연결이 종료되었습니다' : '내 PC 화면을 가져오고 있어요'}</h2>
            <p>{status}</p>
            {ended && (
              <button className="primary-button" onClick={onClose}>
                기기 목록으로
              </button>
            )}
          </div>
        )}
      </div>
      {showText && (
        <form
          className="text-send"
          onSubmit={(event) => {
            event.preventDefault();
            if (text) {
              send({ kind: 'text', text });
              setText('');
            }
          }}
        >
          <label htmlFor="remote-text">한글 · 모바일 입력</label>
          <input
            id="remote-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            placeholder="여기서 문장을 완성한 뒤 전송하세요"
          />
          <button className="primary-button" disabled={!ready || !text}>
            <Send size={16} /> 전송
          </button>
        </form>
      )}
      <footer className="viewer-footer">
        <span>
          <i className={ready ? 'status-dot' : 'status-dot offline'} />{' '}
          {ready ? '원격 제어 활성' : '원격 제어 중지'} · 최대 30분
        </span>
        <div>
          {['Escape', 'Tab', 'PageUp', 'PageDown', 'Lang1'].map((code) => (
            <button disabled={!ready} key={code} onClick={() => special(code)}>
              {code === 'Lang1' ? '한/영' : code === 'Escape' ? 'Esc' : code}
            </button>
          ))}
        </div>
        <span>기본 화면 · JPEG 5 FPS</span>
      </footer>
    </div>
  );
}
