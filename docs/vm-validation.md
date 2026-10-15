# 가상 PC 설치와 실제 웹 제어 검증

2026-10-15 / D-013·014 / RULE-018·019. 사용자는 1차 main 푸시 후 가상 PC에서 agent를 설치하고 실제 웹 동작을 점검한 뒤 수정·커밋·푸시를 이어가도록 요청했다.

## 실행 경계

GitHub Actions `windows-2025`는 Windows Server 기반 가상 머신이다. 이 환경의 검사 통과는 일반 사용자 Windows 11, UAC, 잠금 화면, 실제 모바일/NAT/인터넷 성능까지 검증했다는 뜻이 아니다. [GitHub 러너 문서](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)는 Windows 러너가 관리자 권한/UAC 비활성 환경임을 설명한다. 프로젝트는 사용자 PC의 UAC나 보안 설정을 변경하지 않는다.

`DeskLink.DesktopProbe`는 VM 모델과 대화형 세션, `DESKLINK_VM_TEST=1`을 모두 확인한 뒤 창을 연다. 물리 작업 PC에서는 거부한다. 화면이 없으면 검사 실패로 처리하고 skip 성공으로 바꾸지 않는다. Windows GUI 검사에 관한 [Microsoft 안내](https://learn.microsoft.com/en-us/windows/apps/develop/ai-assisted/testing)도 참고한다.

## 실제 실행 경로

1. Ubuntu에서 서버 통합/브라우저 검사를 완료한다.
2. Windows VM에서 소스를 빌드하고 self-contained agent ZIP/manifest/SHA256을 만든다.
3. 임시 메모리 DB와 테스트 계정으로 실제 서버를 실행한다. 외부 공개나 방화벽 변경은 없다.
4. 실제 Chromium으로 웹 로그인 → 기기 연결 안내 → ZIP 다운로드를 수행한다. 다운로드 바이트의 SHA256, 크기, 버전, MIT/.NET 고지를 확인한다.
5. 새 디렉터리에 ZIP을 풀고 그 안의 `DeskLink.Agent.exe`를 실행한다. 테스트 호스트로 대체하지 않는다. UI Automation으로 실제 로그인 폼을 채우고 원격 허용 버튼을 누른다. 비밀번호를 실행 인수에 넣지 않는다.
6. 별도 테스트 창을 전경에 놓고, 웹 원격 뷰어에서 실제 Windows 캡처의 색상 표식을 확인한다.
7. 브라우저 입력 → 서버 → 설치된 agent → Win32 입력 → 테스트 창의 결과를 확인한다.
8. 세션 종료/재연결과 agent GUI 로그아웃을 검사한 뒤 시작한 프로세스를 닫는다.

테스트 창은 텍스트·클릭·휠·드래그·키 상태를 관측한다. 프로덕션 agent의 입력 함수를 호출해 결과를 대신 만들지 않는다. 브라우저는 headless로 실행하여 원격 대상 Windows 창의 포커스를 빼앗지 않는다. 서버/브라우저/agent는 같은 VM 안에서 loopback으로 통신하므로 HTTPS reverse proxy나 NAT 검사는 별도로 필요하다.

## 합격 기준

| 검사 | 실제 관측 결과 |
|---|---|
| 웹 설치 경로 | 로그인 후 내려받은 ZIP이 manifest의 hash/크기/버전과 일치 |
| agent 등록 | 배포 EXE의 GUI 로그인 이후 소유 기기가 온라인으로 표시 |
| 화면 | Windows 테스트 창의 색상 표식이 브라우저 canvas에 나타남 |
| 마우스 | 웹에서 버튼 위치 클릭 후 Windows Click 이벤트 증가 |
| 키보드 | Windows TextBox의 ASCII 입력 및 Ctrl+A/Backspace 결과 일치 |
| 한글 | 웹 완성 문자열이 Windows TextBox에서 동일하게 관측 |
| 휠/드래그 | 실제 Windows wheel delta와 drag 거리 증가, 버튼 해제 |
| modifier | 정상 클릭 중 Ctrl 유지, 웹 blur 시 Windows Ctrl 해제 |
| 재접속 | 첫 세션 종료 후 같은 agent의 두 번째 실제 화면 수신 |
| agent 중단 | 실제 GUI 로그아웃 후 웹 종료 표시, 세션/온라인 해제, 눌린 입력 해제 |

## 자체 VM에서 재현

Windows VM의 잠금 해제된 대화형 세션에서 Node 24와 .NET 10 SDK를 준비한다. 개인 데이터가 없는 폐기 가능한 VM만 사용한다.

```powershell
npm ci
npm run build
./scripts/package-agent.ps1
dotnet build agent/DeskLink.DesktopProbe -c Release
npx playwright install chromium
$env:DESKLINK_VM_TEST='1'
npm run test:vm
```

결과는 `local/vm-e2e/report.json`, 설치물은 `local/vm-e2e/run-*/`에 남으며 Git에서 제외된다. CI는 job summary와 로그에 각 검사 결과를 남긴다. 비밀번호/토큰/원본 화면을 업로드하지 않고 Actions 캐시/아티팩트도 생성하지 않는다. VM 종료 시 임시 설치물과 계정 상태가 폐기된다. 보고서의 성공 여부·commit·version·packageHash가 배포 대상과 일치해야 릴리즈 스크립트가 게시한다.

## 현재 확인 상태

2026-10-15 쓰기 권한 부여 후 `fce4226`까지 main 푸시를 완료했다. [첫 실행 38677256982](https://github.com/BigDude129/web-remote-desktop/actions/runs/38677256982)의 Windows VM에서 사전 조건, 웹 로그인/ZIP 다운로드·해시, 설치된 agent GUI 로그인, 실제 화면, 클릭, 영문/편집 단축키, 한글, 휠/드래그, Ctrl 유지/blur 해제, 재연결 10개 검사가 통과했다. 마지막 agent GUI 로그아웃을 최소화 상태에서 호출하자 테스트 도구가 `InvalidOperationException`으로 실패했다. 제품 로그아웃 결과를 검증하기 전에 중단됐으므로 전체 결과는 실패다.

후속 수정은 소유 agent의 창 handle을 시작 시 보관하고 로그아웃 호출 전에 창을 복원한다. 오류에는 입력값이나 화면 대신 고정된 단계 이름을 추가했다. 수정 후 아래 실제 VM 재검증을 수행했으며 릴리즈 차단 조건은 유지했다. 로컬 도구 빌드/타입 검사와 물리 PC 실행 거부는 별도로 통과했다.

[재검증 38677845353](https://github.com/BigDude129/web-remote-desktop/actions/runs/38677845353), 커밋 `7bb10c2b8a1d8ff2d32ec600579f0ab4f7f820de`: 2026-10-15 03:48 UTC에 11개 검사가 모두 통과했다. 러너는 Windows Server 2025 / 이미지 `windows-2025-vs2026`이다. 마지막 GUI 로그아웃은 웹 종료 표시와 기기 오프라인, 활성 세션 제거, Windows 입력 해제를 실제로 확인했다. 서버 18개/브라우저 4개 검사도 같은 실행에서 통과했다.

이 main 실행에서만 검증한 ZIP의 SHA-256은 `ea34a523e04e4559d1a8d5e634053bb7efa2635bdbeaa0541dc7cdb3fd9319ae`이다. 릴리즈 태그는 별도 Windows VM에서 패키지를 다시 만들고 동일한 11개 검사를 통과한 파일을 게시한다. ZIP 생성 시각 등이 달라질 수 있으므로 공개 릴리즈의 최종 hash는 해당 `agent-release.json`/`SHA256SUMS.txt`로 확인한다.

[태그 실행 38678276170](https://github.com/BigDude129/web-remote-desktop/actions/runs/38678276170)도 서버/브라우저/Windows VM 검사를 모두 통과하고 [v0.1.0](https://github.com/BigDude129/web-remote-desktop/releases/tag/v0.1.0)을 공개/latest로 게시했다. 최종 ZIP은 `DeskLink.Agent-0.1.0-win-x64.zip`, 47,414,661바이트, SHA-256 `7b109c1778eb97c9777a76dc4b6331a57134d8ea2fc4d0a2d1d763563c469c27`이다. ZIP, `agent-release.json`, `SHA256SUMS.txt` 3개 자산이 공개되어 있다.

게시 후 2026-10-15 03:55 UTC에 별도 임시 서버/계정과 실제 Chromium으로 웹 로그인 → 기기 연결 → 공개 ZIP 다운로드를 다시 수행했다. latest API가 `source=github`, `version=0.1.0`, `stale=false`를 반환하고 실제 다운로드의 크기/hash가 manifest 및 GitHub asset digest와 일치했다. 내려받은 ZIP에서 프로젝트 MIT와 .NETCore/WindowsDesktop 원문 고지도 확인했다. 이 후속 검사는 공개 배포 경로 검증이며 물리 PC에서 원격 입력을 실행하지 않았다. 다운로드와 보고서는 Git 제외 경로 `local/release-verification/`에 둔다.

공개 저장소의 표준 러너 실행 시간은 [GitHub 과금 안내](https://docs.github.com/en/billing/concepts/product-billing/github-actions)에 따라 무료다. 계정 차단/저장공간/결제 상태는 별도 조건이며 여기서 확인한 것으로 간주하지 않는다. 비공개 전환 시 workflow는 실행을 건너뛰며 비용 정책 재검토가 필요하다.
