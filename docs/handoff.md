# 협업 인수인계

2026-10-16 / MVP 0.1.1. 사용자 요청으로 기존 작업을 main에 통합했다. 이후에도 별도 요청 전까지 새 브랜치 없이 main에서 직접 작업·커밋·푸시한다(RULE-022).

## 시작 위치

1. README의 로컬 실행 → 계정 생성 → Windows agent 로그인으로 실제 기기를 연결한다.
2. rules/rules.md와 decisions의 D-006~016으로 현재 확정 범위와 구현 선택을 확인한다.
3. architecture/protocol 문서로 auth, owner, session 수명주기를 파악한다.
4. validation의 자동 검사와 미검증 실기기를 구분한다. 자동 통과를 실제 게임/모바일 호환으로 확대 해석하지 않는다.
5. 버전업 시 releases 문서와 licenses 고지를 함께 갱신한다.
6. VM 설치·실제 입력 검증은 vm-validation.md를 따른다. 로컬 빌드/물리 PC 실행 거부 확인과 실제 VM 합격을 구분한다.

2026-10-15 `7bb10c2`의 [GitHub CI](https://github.com/BigDude129/web-remote-desktop/actions/runs/38677845353)가 서버 18개·브라우저 4개·실제 Windows VM 11개 검사를 통과했다. 최초 VM 실행의 최소화 창 로그아웃 검사 실패와 수정 내역은 validation/vm-validation에 보존했다. 아래 실기기·네트워크·운영 기능은 이 VM 검사와 별도로 남은 작업이다.

## 파일별 책임

2026-10-15 후속 웹 변경: 사용자 요청으로 main을 먼저 pull한 뒤 전체 글자를 확대했다. `web/styles.css`의 공통 rem 크기와 RULE-021을 기준으로 이후 화면도 작성한다. 본문/입력/주요 버튼 16px, 보조 글자 14px는 기본 브라우저 글자 16px 기준이며 모바일에서도 축소하지 않는다. 원격 canvas 내용은 호스트 화면 그대로다. 서버 검사 18개, 브라우저 검사 4개와 54개 화면/크기 조합 확인을 통과했으며 자세한 조건은 validation의 웹 글자 확대 항목에 있다. 이 후속 변경도 사용자의 명시적 main 커밋·푸시 요청에 따른다.

| 영역 | 주요 파일 | 변경 시 함께 볼 곳 |
|---|---|---|
| 계정/DB | server/store.ts, create-user.ts | schema version, auth 통합 테스트 |
| HTTP/쿠키/CSRF | server/app.ts, config.ts | protocol, server.test.ts |
| 온라인/원격 수명주기 | server/hub.ts | AgentClient, Viewer, native-smoke |
| 입력 규약 | shared/protocol.ts | NativeDesktop.Key/Apply, Viewer |
| 웹 UX | web/App.tsx, Viewer.tsx, styles.css | Playwright, 모바일 레이아웃 |
| Windows | AgentForm, AgentClient, NativeDesktop | self-test, Integration 프로젝트 |
| 릴리즈 | server/releases.ts, scripts/, ci.yml | releases.test.ts, version props, releases 문서 |
| 고지 | LICENSE, generate-notices, package-agent | docs/licenses, 배포 ZIP 내용 |
| VM 실제 제어 검사 | tests/vm-e2e.ts, DeskLink.DesktopProbe | vm-validation, 실제 Actions summary, publish-release |

## 후속 작업 제안

| 우선순위 | 작업 | 수용 기준 |
|---|---|---|
| P0 | 실기기 입력 검증 | 메모장/Terminal에서 한글·수정·modifier·마우스·휠, 끊김 후 키 해제 확인 |
| P0 | MFA/계정 폐기/비밀번호 재설정 | 자격증명 교체 시 모든 로그인/원격 연결 철회; 외부 공개 전 완료 |
| P0 | HTTPS 배포 경계 | 실제 reverse proxy에서 Origin/쿠키/WSS/로그 노출/만료 검증 |
| P1 | 모바일 터치 | iPhone/iPad/Android 실기기, 두 손가락 wheel/회전/화면 키보드 검사 |
| P1 | 호스트 화면 상태 | DPI 변경, 모니터 꺼짐, HDR, 다중 화면; 명확한 실패 및 복구 |
| P1 | 고성능 엔진 어댑터 | WebRTC/Sunshine/Guacamole 비교 실험; 서버 트래픽·지연 수치로 결정 |
| P1 | 서명된 배포/업데이트 | 게시자 서명, 다운로드 hash, 롤백, 설치기 및 실제 업데이트 검사 |
| P2 | 조직/역할/감사 보존 | 소유권 모델 유지하면서 공유 권한, retention, 조회/삭제 운영 정의 |

계정별 개인 기기 제어가 현재 권한 모델이다. 관리자 권한으로 모든 사용자의 기기를 나열/제어하는 경로를 임의로 추가하지 않는다. 사용자 Windows 보안 설정/UAC를 낮추는 방식으로 기능을 구현하지 않는다.

## 알려진 제한

단일 Node/SQLite, 서버 경유 JPEG, 기본 모니터, 최대 30분 세션, 앱 로그인 8h/12h. 서비스/시작 프로그램/무인 로그온 없음. 터치 두 손가락/오디오/파일/클립보드/커서 동기화/관리자 앱/잠금 화면 미지원. 원격 포커스는 사용자가 지정한다. 외부 네트워크 연결률/성능/Safari 호환을 아직 측정하지 않았다.

릴리즈 조회는 공개 GitHub API에 의존하고 실패 시 상태를 표시한다. 캐시/로컬 패키지를 최신 확정판으로 오표시하지 않는다. v0.1.0은 공개 게시 후 웹의 실제 ZIP 다운로드/hash/라이선스 고지까지 검증했다. 이후 게시 상태는 Release/API로 확인하며 로컬 커밋·패키지와 원격 게시 완료 상태를 구분한다. 운영 서버 배포와 실제 사용자 계정 생성은 별도다.
