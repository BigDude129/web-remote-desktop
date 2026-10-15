# 버전업과 최신 에이전트 배포

2026-10-15 / D-012 / 초기 버전 0.1.0. 브라우저 설치 안내와 에이전트 업데이트 확인은 같은 공개 GitHub Release 정보를 사용한다.

## 버전 규칙

`package.json.version`이 기준이다. `npm run version:set -- X.Y.Z`는 package.json, package-lock.json, `agent/Directory.Build.props`를 함께 갱신한다. 다운그레이드/같은 버전/잘못된 SemVer를 거부한다. 에이전트는 어셈블리 버전, 웹/서버는 package.json에서 읽는다. Windows manifest의 assemblyIdentity 1.0.0.0은 호환성 manifest ID이며 제품 버전으로 표시하지 않는다.

- patch: 호환 가능한 버그 수정
- minor: 기능 추가, 호환 가능한 규약 확장
- major: 호환 불가능한 변경. protocolVersion과 서버/agent 동시 업그레이드 계획도 필요

현재 릴리즈 채널은 안정 SemVer만 지원한다. 알파/베타 채널과 prerelease 자동 업데이트는 후속 기능이다. v0.x는 기능 제약이 있는 초기 제품이며 GitHub latest 배포 채널과 제품 완성도는 별개다.

## 릴리즈 순서

```powershell
npm run version:set -- 0.1.1
# CHANGELOG.md와 docs/releases/v0.1.1.md 작성
npm run check
npm run test:browser
dotnet build agent/DeskLink.Agent -c Release
dotnet agent/DeskLink.Agent/bin/Release/net10.0-windows/DeskLink.Agent.dll --self-test
./scripts/package-agent.ps1
# 일반 협업에서는 변경을 PR로 main에 반영한 뒤 아래 태그 생성
git tag -a v0.1.1 -m "DeskLink v0.1.1"
git push origin v0.1.1
```

태그는 릴리즈하려는 검증된 main 커밋에 생성한다. 서버/웹 체크가 태그와 코드 버전 일치를 검사한다. workflow는 Ubuntu의 서버/웹/브라우저 테스트와 Windows의 build/self-test/패키지를 완료해야 게시 job을 실행한다.

게시 job은 SHA256을 검사한 뒤 draft Release를 만들고 아래 자산을 모두 올린 다음 공개/latest로 지정한다. 실패하면 불완전한 draft가 latest로 노출되지 않는다. 재실행은 같은 draft만 갱신하며 이미 공개된 릴리즈를 덮어쓰지 않는다. 릴리즈 노트 파일이 없으면 게시를 실패시킨다.

- `DeskLink.Agent-X.Y.Z-win-x64.zip`
- `agent-release.json`: version, protocolVersion, platform, assetName, sha256, size
- `SHA256SUMS.txt`

ZIP에는 자체 포함 EXE와 프로젝트 MIT/사용 runtime pack 고지/업데이트 실행 안내가 포함된다. 서명된 설치기/자동 파일 교체는 아직 제공하지 않는다. GitHub Actions artifact 보존은 7일, 정식 배포는 Release 자산을 사용한다.

## 서버의 최신 버전 조회

`.env`의 `RELEASE_REPOSITORY=BigDude129/web-remote-desktop`을 사용한다. 빈 값이면 외부 조회를 끄고 로컬 패키지만 제공한다. 공개 저장소 조회에는 토큰을 사용하지 않는다. 조회 대상 API는 GitHub releases/latest로 고정하고 다운로드 URL도 해당 저장소의 정확한 HTTPS tag/asset 경로인지 검증한다.

성공 캐시는 5분, 실패 재시도는 1분, 요청 timeout은 8초. 동시 조회는 하나로 합친다. 최근 정상 결과가 있는데 네트워크가 끊기면 `stale=true`로 표시한다. draft/prerelease, tag-manifest 버전/크기 불일치, 잘못된 SHA256 형식, 다른 호스트 자산을 거부한다.

| API | 인증 | 의미 |
|---|---|---|
| GET /api/agent/releases/latest | 없음 | 공개 릴리즈 메타데이터만; 사용자/기기/토큰 없음 |
| GET /api/agent/distribution | 웹 로그인 | 최신 GitHub 릴리즈 우선, 없으면 검증된 로컬 개발 패키지 |
| GET /api/agent/download | 웹 로그인 | 릴리즈 자산으로 302 또는 로컬 검증 ZIP 응답 |

응답의 `available`, `source`, `version`, `protocolVersion`, `assetName`, `sha256`, `size`, `releaseUrl`, `downloadUrl`, `checkedAt`, `stale`, `error`를 사용한다. 공개 릴리즈는 원래 공개 자산이므로 GitHub 직접 다운로드에는 DeskLink 로그인이 필요하지 않다. 웹/API의 로그인은 개인 기기 제어를 보호하는 경계다.

로컬 fallback은 `artifacts/agent-release.json`과 versioned ZIP을 읽고 파일 크기 및 실제 SHA256을 검증한다. 경로 순회를 허용하지 않는다. 파일이 바뀌면 재검증한다. 로컬 빌드를 '최신 정식 릴리즈'로 표시하지 않는다.

## 사용자의 업데이트

에이전트는 로그인 성공 후 자동으로 최신 버전을 확인하고 **업데이트 확인** 버튼도 제공한다. 현재보다 높은 버전이 있으면 GitHub Release 페이지를 여는 링크를 표시한다. 원격 세션을 끝내고 기존 에이전트를 종료한 뒤 새 ZIP을 풀어 실행한다. 설치 ID는 사용자 프로필에 남으므로 같은 계정으로 로그인하면 기존 기기 ID를 이어 쓴다. 비밀번호/토큰을 업데이트 요청으로 보내지 않는다.

PowerShell 검증 예:

```powershell
Get-FileHash -Algorithm SHA256 ./DeskLink.Agent-0.1.0-win-x64.zip
# 같은 릴리즈의 SHA256SUMS.txt와 비교
```

SHA256은 무결성 확인값이며 게시자 코드 서명을 대체하지 않는다. 서버는 릴리즈 메타데이터를 검사하지만 브라우저가 내려받은 ZIP의 해시를 대신 계산하지 않는다. 자동 설치기를 만들 때는 서명 검증, 다운로드 후 hash 검사, 실행 중 종료/롤백, 강제 다운그레이드 방지를 추가한다.

문제 있는 버전은 파일을 덮지 않고 수정 버전을 발행한다. 긴급 롤백은 이미 검증된 이전 릴리즈를 GitHub latest로 지정하고 이유를 릴리즈 노트/결정 기록에 남긴다. agent는 더 낮은 버전으로 자동 설치하지 않는다. 서버 DB 복원은 별도의 백업/마이그레이션 절차다.
