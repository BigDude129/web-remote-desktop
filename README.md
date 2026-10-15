# DeskLink · 웹 원격 데스크톱

웹 로그인 → 내 기기 목록 → Windows 에이전트 연결 → 현재 PC 화면 제어까지 이어지는 초기 MVP입니다. 애플리케이션 **0.1.0**, 기획 **v0.3.0** / 2026-10-15.

Windows의 현재 콘솔을 공유합니다. Microsoft RDP 프로토콜 구현은 아니며 RDP/Guacamole 어댑터는 확장 후보입니다. 기존 Jump Desktop 보완, 한영 입력, 모바일 조작 목표는 유지합니다.

## 구현 범위

- 웹 로그인/로그아웃, 사용자별 SQLite 기기 목록, 온라인·오프라인·사용 중 상태, 검색과 연결 기록
- Windows GUI 에이전트: 같은 계정으로 로그인하고 원격 허용, 중단/로그아웃, 일시적 장애 시 재접속
- 브라우저 원격 화면, 마우스 이동/버튼/드래그/휠, 키보드, 한영 키, 한글 완성 문자열 전송
- 에이전트 다운로드, 기기 원격 허용 해제, 세션 만료/철회, 단일 제어자 정책
- 비밀번호 scrypt 해시, 서버 토큰 해시 저장, HttpOnly 쿠키, CSRF/Origin 검사, 로그인 제한, 입력 검증, 감사 이벤트

첫 전송은 기본 모니터 JPEG, 최대 1600×900, 목표 5 FPS, 서버 WebSocket 중계입니다. **영상은 서버를 경유**하며 종단 간 암호화/P2P가 아닙니다. HTTPS 환경에서는 각 연결에 TLS가 적용됩니다. 오디오, 파일 전송, 클립보드 동기화, 다중 모니터, Windows 서비스, 잠금/UAC 화면, Microsoft RDP 호환, 고성능 게임 스트리밍은 미구현입니다. 실제 Safari·iPhone·iPad·Android의 입력 호환성은 미검증입니다.

## 로컬 실행

필수: Node.js 24 LTS, npm. 에이전트를 소스에서 빌드하려면 Windows와 .NET 10 SDK가 필요합니다.

```powershell
npm ci
Copy-Item .env.example .env
npm run user:add
npm run build
npm start
```

`user:add`는 터미널에서 계정, 표시 이름, 12~128자 비밀번호를 입력받습니다. 비밀번호 입력은 표시하지 않으며 기본 계정/공개 회원가입은 없습니다. 서버 실행 중에도 계정을 추가할 수 있습니다. 비밀번호를 명령 인수나 공개 문서에 쓰지 마세요.

브라우저에서 **http://localhost:3000**에 접속합니다. `PUBLIC_ORIGIN`과 브라우저 주소가 정확히 같아야 합니다. `127.0.0.1`로 접속하려면 `.env`의 `PUBLIC_ORIGIN`도 바꾸세요. 기본 HTTP는 loopback으로만 허용됩니다.

```powershell
# Windows 에이전트 빌드/실행
dotnet build agent/DeskLink.Agent -c Release
dotnet run --project agent/DeskLink.Agent -c Release

# .NET이 없는 Windows x64 PC에도 전달할 수 있는 패키지 생성
./scripts/package-agent.ps1
```

에이전트에 서버 주소와 웹과 같은 계정, 기기 이름을 입력하고 **로그인하고 원격 허용**을 누릅니다. 브라우저의 기기 목록은 5초마다 갱신됩니다. 온라인 기기의 **원격 연결**을 누르면 화면을 제어할 수 있습니다. 화면 클릭 후 물리 키보드를 사용하거나 **문자열 입력**에서 한글 문장을 완성해 전송하세요.

패키지는 `artifacts/DeskLink.Agent-0.1.0-win-x64.zip`과 `agent-release.json`, `SHA256SUMS.txt`로 생성됩니다. 웹은 최신 GitHub 안정 릴리즈를 우선 제공하고, 없으면 검증된 로컬 개발 패키지를 구분해 제공합니다. 에이전트는 로그인 후 또는 **업데이트 확인**으로 새 버전을 안내합니다. 바이너리는 소스에 커밋하지 않습니다. 현재 패키지는 코드 서명 전 개발 빌드이며 Windows 보호 기능을 해제하는 절차는 제공하지 않습니다.

에이전트 로그인은 최대 12시간, 웹 로그인은 8시간, 원격 세션은 30분입니다. 웹 로그아웃은 해당 웹 로그인으로 생성한 연결을 끊습니다. 기기의 원격 접근 자체를 막으려면 웹의 **이 기기 원격 허용 해제** 또는 에이전트의 **중단 / 로그아웃**을 사용합니다. 기기 재연결에는 다시 에이전트 로그인이 필요합니다.

## 개발과 검증

```powershell
npm run check              # 타입 검사 + 웹 빌드 + 서버 통합 테스트
npx playwright install chromium
npm run test:browser       # 로그인/기기/중계/모바일 레이아웃
dotnet build agent/DeskLink.Agent -c Release
dotnet agent/DeskLink.Agent/bin/Release/net10.0-windows/DeskLink.Agent.dll --self-test

# 잠금 해제된 Windows에서 실제 에이전트↔서버 화면 중계 검사
dotnet build agent/DeskLink.Agent.Integration -c Release
npm run test:native

npm run format:check
```

`test:native`는 테스트 계정과 임시 서버를 사용합니다. 화면은 메모리에서만 처리하고 실제 키/마우스 입력을 주입하지 않습니다. 브라우저 테스트의 화면과 계정은 합성 데이터입니다. UI 검증 결과는 `local/previews/`, 실패 추적은 `test-results/`에 저장되며 Git에서 제외됩니다. `npm run dev`는 서버 소스만 감시합니다. 웹 변경 후에는 `npm run build`가 필요합니다.

검증 범위와 미실행 실기기 시나리오는 [검증 기록](docs/validation.md)을 확인하세요. 입력 이벤트 생성·중계 통과와 대상 앱에서의 실제 입력 성공은 별개입니다.

## 구조와 협업

```text
web/                         React 웹 로그인, 기기 목록, 원격 뷰어
server/                      Express API, 인증, SQLite, WebSocket 중계
shared/                      입력 메시지 스키마와 공유 타입
agent/DeskLink.Agent/         .NET 10 Windows GUI, 캡처, SendInput
agent/DeskLink.Agent.Integration/  실제 에이전트 통합 테스트 호스트
tests/                       API/중계/브라우저/네이티브 검증
scripts/                     Windows 패키지 생성
rules/rules.md               신규 작업 규칙의 기준 문서
docs/                        설계, 결정, 통신 규약, 검증, 인수인계
local/, artifacts/           개인 환경·DB·도구·생성물 (Git 제외)
```

- [작업 규칙](rules/rules.md), [기여 안내](CONTRIBUTING.md), [변경 이력](CHANGELOG.md)
- [아키텍처와 보안 경계](docs/architecture.md), [HTTP/WebSocket 규약](docs/protocol.md)
- [기획과 벤치마킹](docs/plan.md), [결정 기록](docs/decisions.md), [참고 제품·의존성](docs/benchmarks.md)
- [협업 인수인계와 다음 작업](docs/handoff.md), [검증 기록](docs/validation.md)
- [MIT 및 제3자 라이선스 고지](docs/licenses.md), [버전업·최신 에이전트 릴리즈](docs/releases.md)

프로젝트는 사용자 선택에 따라 [MIT](LICENSE)입니다. 웹은 `/license`와 `/licenses`, 에이전트 ZIP은 `LICENSE.txt`와 `THIRD-PARTY-NOTICES.txt`로 원문 고지를 제공합니다. 고지는 `npm run licenses`/빌드와 에이전트 패키징 시 생성됩니다.

버전업은 `npm run version:set -- X.Y.Z` → 변경/릴리즈 노트 → 검사 → main 반영 → `vX.Y.Z` 태그 푸시 순서입니다. CI가 서버/웹/Windows 검증을 통과한 뒤 ZIP/SHA256/manifest를 GitHub Release에 게시합니다. 최신 릴리즈 조회 저장소는 `.env`의 `RELEASE_REPOSITORY`로 지정하며, 빈 값은 로컬 패키지만 제공합니다.

운영 서버 배포와 인터넷 공개는 이번 작업에 포함하지 않았습니다. HTTPS reverse proxy, MFA, 계정 수명주기, 운영 감사 보존, 업데이트 서명을 갖춘 뒤 외부 공개 범위를 검토합니다. DB/토큰/원본 화면/개인 접속 정보를 공개 저장소에 올리지 않습니다.
