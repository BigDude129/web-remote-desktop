# 벤치마킹과 의존성

확인: 2026-10-15. 공식 문서의 구조를 참고했으며 아래 제품 소스를 복사/번들하지 않았다. 제품 설명은 설치·성능 실측 결과가 아니다.

| 제품 | 참고한 구조 | 이번 구현에 반영 | 후속 검토 |
|---|---|---|---|
| [Apache Guacamole](https://guacamole.apache.org/doc/gug/guacamole-architecture.html) | 웹 인증/뷰어와 guacd의 프로토콜 변환 분리 | 관리 API와 캡처·입력 agent 분리 | 실제 RDP 호환이 필요할 때 guacd 어댑터 |
| [MeshCentral](https://docs.meshcentral.com/) | 웹 관리, 기기 agent, 브라우저↔agent 연결 | 사용자별 기기 목록, outbound agent, 상태와 중계 | 고성능/관리 기능 비교 |
| [RustDesk](https://rustdesk.com/docs/en/self-host/) | rendezvous/ID와 relay 분리, 직결 실패 시 중계 | 향후 연결 협상과 미디어 경로 분리 기준 | P2P/TURN 및 비용 최적화 |

현재 MVP는 콘솔 JPEG+WebSocket을 직접 구현했다. RDP의 별도 세션/잠금 동작이 현재 화면을 이어 쓰려는 목적과 다른 점을 고려했다. 이것은 기존 Sunshine 검증이 불필요하다는 결정이 아니라 관리/로그인 구조부터 실행해 보기 위한 선택이다. 고성능 엔진 후보와 초기 계획은 [기획](plan.md)에 보존한다.

## 선택한 개발 환경

| 구성 | 검증한 버전 | 사용 근거 |
|---|---|---|
| Node.js | 24.20.0 | 기존 개발 환경, 내장 node:sqlite, HTTP/WS 구현 |
| .NET SDK | 10.0.402 | Windows Forms, ClientWebSocket, Windows native interop |
| .NET self-contained runtime | 패키지 manifest/고지에 실제 버전 기록 | 개발 PC 외 Windows x64에서도 SDK 없이 실행 |

## 직접 npm 의존성

아래는 설치된 package.json에서 확인한 값이다. 정확한 전이 의존성은 package-lock.json, 원문 고지는 `npm run licenses`로 재생성한다.

| 패키지 | 버전 | 라이선스 | 출처 |
|---|---|---|---|
| express | 5.3.0 | MIT | https://github.com/expressjs/express |
| ws | 8.22.0 | MIT | https://github.com/websockets/ws |
| react / react-dom | 19.3.1 | MIT | https://github.com/react/react |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| lucide-react | 1.57.0 | ISC | https://github.com/lucide-icons/lucide |
| vite | 7.3.7 | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | 5.2.0 | MIT | https://github.com/vitejs/vite-plugin-react |
| typescript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| tsx | 4.23.15 | MIT | https://github.com/privatenumber/tsx |
| @playwright/test | 1.64.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| prettier | 3.9.10 | MIT | https://github.com/prettier/prettier |
| @types/express / node / react / react-dom / ws | 5.0.6 / 24.19.2 / 19.3.0 / 19.3.0 / 8.18.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

최초 v0.1.0 CI는 v4 action을 SHA로 고정해 검증했다. 실행 중 나타난 Node 20 지원 종료 경고에 따라 main은 아래 공식 릴리즈의 `action.yml`에서 Node 24 실행 엔진을 확인하고 SHA를 갱신했다. 정확한 SHA와 캐시 비활성화 설정은 `.github/workflows/ci.yml`에 있다. 의존성 업데이트 때 버전, 취약점 검사, 원문 고지를 함께 확인한다. 초기 `npm audit`는 발견 0건이었으며 향후 상태를 보장하지 않는다.

| CI 도구 | 버전 | 라이선스 | 공식 출처 |
|---|---|---|---|
| actions/checkout | 7.0.1 | MIT | https://github.com/actions/checkout/releases/tag/v7.0.1 |
| actions/setup-node | 7.1.0 | MIT | https://github.com/actions/setup-node/releases/tag/v7.1.0 |
| actions/setup-dotnet | 6.0.0 | MIT | https://github.com/actions/setup-dotnet/releases/tag/v6.0.0 |

## 로컬 검증 도구

CI 문법 검증에 [actionlint 1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)를 사용했다. 라이선스는 MIT이며 저작권은 rhysd에게 있다. 공식 Windows amd64 ZIP의 SHA-256을 GitHub Release API의 digest와 대조했다(`6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`). 원문 고지와 도구는 Git 제외 경로 `local/tools/`에 보관하며 제품이나 에이전트 패키지에 포함하지 않는다.
