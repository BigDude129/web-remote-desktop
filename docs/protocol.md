# HTTP / WebSocket 규약 v1

2026-10-15 / 구현 기준: `server/app.ts`, `server/hub.ts`, `shared/protocol.ts`, `AgentClient.cs`.

UTF-8 JSON, HTTP 본문 최대 16 KiB. ID는 UUID, 시간은 Unix milliseconds. API는 `Cache-Control: no-store`. 실패는 `{ "error": "표시할 메시지" }`이며 비밀값/스택을 넣지 않는다.

## HTTP

웹 로그인/쓰기는 `Origin=PUBLIC_ORIGIN` 필수. HttpOnly `desklink_session` 쿠키와 로그인/me에서 받은 메모리의 `csrfToken`을 사용한다. 쓰기 헤더는 `X-CSRF-Token`이다. 네이티브 HTTP는 `X-DeskLink-Agent: 1`, 로그인 후 `Authorization: Bearer ...`이며 Origin을 거부한다. 토큰을 query string에 넣지 않는다.

| 메서드 / 경로 | 인증 | 요청 → 결과 |
|---|---|---|
| GET /healthz | 없음 | `{status:"ok"}` |
| POST /api/auth/login | Origin/제한 | `{username,password}` → `{user,csrfToken,expiresAt}` + 쿠키 |
| GET /api/auth/me | 웹 | `{user,csrfToken,expiresAt}` |
| POST /api/auth/logout | 웹+CSRF | 204; 해당 로그인 연결 종료 |
| POST /api/agent/login | native/제한 | 아래 등록 본문 → `{token,deviceId,expiresAt,protocolVersion:1}` |
| POST /api/agent/logout | native+Bearer | 204; agent/기기 연결 종료 |
| GET /api/devices | 웹 | `{devices:[Device]}`; 자기 소유 기기만 |
| POST /api/devices/:id/revoke | 웹+CSRF+소유권 | 204; agent 인증 폐기, 기기 기록 유지 |
| POST /api/sessions | 웹+CSRF+소유권 | `{deviceId}` → 201 `{session:{id,deviceId,state,expiresAt}}` |
| DELETE /api/sessions/:id | 웹+CSRF+소유권 | 204; 이미 종료된 소유 세션도 204 |
| GET /api/activity | 웹 | `{events:[{id,event,deviceName,createdAt}]}` 최신 50건 |
| GET /api/agent/releases/latest | 공개 | 공개 GitHub 최신 안정 릴리즈 메타데이터; 사용자 정보 없음 |
| GET /api/agent/distribution | 웹 | GitHub 최신 우선/검증된 local fallback; `{available,source,version,protocolVersion,sha256,size,assetName,downloadUrl,releaseUrl,checkedAt,stale,error}` |
| GET /api/agent/download | 웹 | GitHub 자산으로 302 또는 로컬 Windows ZIP; 없으면 404 |
| GET /license, /licenses | 공개 | 프로젝트 MIT / 생성된 제3자 원문 고지 (text/plain) |

`Device`: `{id,name,platform,agentVersion,lastSeen,createdAt,online,busy}`. 웹은 5초마다 갱신한다. 로그인한 기기라도 agent WS가 없으면 오프라인이다.

```json
{
  "username": "your-account",
  "password": "<entered at runtime>",
  "installationId": "<persistent random UUID>",
  "name": "My Windows PC",
  "platform": "windows",
  "agentVersion": "0.1.0",
  "protocolVersion": 1
}
```

오류 상태: 400 JSON/스키마, 401 로그인 실패/만료, 403 Origin/CSRF/클라이언트 종류 불일치, 404 없거나 다른 소유자, 409 오프라인/사용 중/소비된 세션, 413 본문 초과, 429 로그인 제한. 로그인은 웹+agent 합쳐 IP당 60초에 10회, 성공 포함. proxy 설정에 따라 여러 사용자가 같은 IP 제한을 공유할 수 있다.

## 에이전트 WebSocket

`/ws/agent`, Bearer 헤더, Origin 없음. 아래 JSON을 교환하며 binary는 현재 세션의 JPEG다. protocolVersion 불일치 시 종료한다.

| 방향 | 메시지 |
|---|---|
| 서버 → agent | `{type:"welcome",protocolVersion:1,deviceId}` |
| 서버 → agent | `{type:"start",sessionId,viewer:"표시 이름"}` |
| agent → 서버 | `{type:"ready",sessionId}` |
| agent → 서버 | binary JPEG (active 동안만) |
| 서버 → agent | `{type:"input",sessionId,input:RemoteInput}` |
| 서버 → agent | `{type:"stop",sessionId,reason}` |
| 서버 → agent | `{type:"revoked",reason}` 후 close |
| agent → 서버 | `{type:"error",sessionId,code}` |

error code: `capture_failed`, `desktop_unavailable`, `input_failed`. stop/단절 시 캡처와 키·버튼을 해제한다. revoked는 자동 재로그인하지 않는다. 캡처 종료를 기다린 뒤 다음 세션을 시작하여 이전 frame이 새 ready 뒤에 섞이지 않게 한다.

## 브라우저 WebSocket

`/ws/viewer/:sessionId`, 생성에 사용한 웹 쿠키+정확한 Origin. query string은 거부한다. HTTP 세션 생성 후 30초 안에 1회 attach한다. 같은 사용자라도 다른 로그인으로 attach할 수 없다.

서버 → 웹: `{type:"ready"}`, binary JPEG, `{type:"ended",reason}`. 웹 → 서버는 아래 입력 자체다. 쉘/파일 실행 기능은 없다.

```ts
type RemoteInput =
  | { kind: 'move'; x: number; y: number } // 각각 0..1
  | { kind: 'button'; button: 'left' | 'right' | 'middle'; down: boolean }
  | { kind: 'wheel'; delta: number } // 정수 -1200..1200, 양수 위
  | { kind: 'key'; code: string; down: boolean } // 명시적 allowlist
  | { kind: 'text'; text: string } // 1..2000 UTF-16 units
  | { kind: 'release' };
```

키 목록은 `shared/protocol.ts`의 `keyCodes`, 네이티브는 `NativeDesktop.Key`를 함께 갱신한다. 키 반복을 허용한다. 문자열은 Unicode down/up 쌍이며 OS 클립보드를 변경하지 않는다. 미지정 속성, 범위 밖 좌표, 미지원 키, binary viewer 입력을 거부한다.

정상적인 pointer-up은 해당 마우스 버튼만 해제하고, 계속 누르고 있는 Ctrl/Shift/Alt는 유지한다. 포커스 상실, pointer cancel, 버튼을 누른 상태에서의 예기치 않은 pointer capture 상실에는 `release`로 모든 입력을 해제한다. 메시지 형식과 protocolVersion은 동일하다.

## 상한과 종료

- WS hard cap 2 MiB; agent JSON 4,096자, viewer JSON 16,384자 이내 + 필드별 스키마 상한.
- viewer 입력 초당 240개, agent frame 초당 15개 상한(에이전트 목표 5). 웹 move 약 40Hz.
- viewer 대기량 2 MiB 이상이면 frame drop; agent 입력 대기량 256 KiB 초과 시 세션 종료.
- 양쪽 15초 ping/pong, 무응답 감지 약 30초 이내. 인증/세션 만료는 1초 점검.
- 종료 코드: `user_ended`, `web_logout`, `agent_logout`, `agent_disconnected`, `viewer_disconnected`, `viewer_timeout`, `device_revoked`, `agent_replaced`, `auth_expired`, `session_expired`, `connect_timeout`, `invalid_input`, `invalid_frame`, `invalid_agent_message`, `agent_slow`, `server_shutdown`, `server_restart` 및 capture/input 오류.

규약 변경 시 서버, 웹, 에이전트, 통합 테스트, 이 문서/CHANGELOG를 함께 갱신한다. 호환성이 깨지면 protocolVersion을 올리고 구버전 거부/업그레이드를 명시한다.

릴리즈 cache/실패/fallback/무결성 의미는 [릴리즈 절차](releases.md)에 기록한다. 공개 릴리즈 조회는 로그인이나 캡처 활성화를 요구하지 않는다. 웹과 agent의 인증 토큰은 GitHub로 전송하지 않는다.
