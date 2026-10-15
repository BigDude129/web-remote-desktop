# 협업 인수인계

2026-10-15 / MVP 0.1.0. 첫 구현은 사용자의 main 직접 커밋 요청에 따른다. 이후 작업은 브랜치/PR을 기본으로 한다.

## 시작 위치

1. README의 로컬 실행 → 계정 생성 → Windows agent 로그인으로 실제 기기를 연결한다.
2. rules/rules.md와 decisions의 D-006~012로 현재 확정 범위와 구현 선택을 확인한다.
3. architecture/protocol 문서로 auth, owner, session 수명주기를 파악한다.
4. validation의 자동 검사와 미검증 실기기를 구분한다. 자동 통과를 실제 게임/모바일 호환으로 확대 해석하지 않는다.
5. 버전업 시 releases 문서와 licenses 고지를 함께 갱신한다.

## 파일별 책임

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

릴리즈 조회는 공개 GitHub API에 의존하고 실패 시 상태를 표시한다. 캐시/로컬 패키지를 최신 확정판으로 오표시하지 않는다. 최초 릴리즈 전 API의 `not_published`는 정상이다. GitHub 권한이 준비되지 않았다면 로컬 커밋·패키지와 실제 원격 게시 완료 상태를 구분해 기록한다.
