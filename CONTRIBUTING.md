# 함께 업데이트하기

현재는 Windows 우선 MVP 0.1.0 단계다. 시작 전에 [작업 규칙](rules/rules.md), [실행 방법](README.md), [인수인계](docs/handoff.md)를 읽는다.

1. 개선 제안이나 버그를 이슈로 등록한다. 관련 C-/R-/G-/T- 번호가 있으면 함께 적는다.
2. 사용자 요청(2026-10-16)에 따라 내부 작업은 main에 직접 반영한다. 외부 기여자는 Fork/PR을 사용할 수 있다.
3. 변경 사항은 관련 기획·검증 문서와 CHANGELOG.md에 반영한다. 제안을 사용자 확정 요구로 임의 변경하지 않는다.
4. 변경 기록(외부 기여는 Pull Request)에 변경 이유와 검증 결과를 적는다. 실제로 시험하지 않은 항목은 미실행으로 표시한다.

공개 이슈·PR에 계정 정보, IP·접속 주소, 토큰, 페어링 코드, 원본 화면이나 터미널 내용을 올리지 않는다. 개인 환경은 Git 제외 경로인 local/에 기록한다.

프로젝트는 사용자가 선택한 [MIT](LICENSE) 라이선스다. 외부 코드를 가져오기 전 출처·버전·라이선스를 확인한다. 참고 제품 소스를 복사하지 않고 독립 구현했다. 의존성/출처는 [벤치마킹 기록](docs/benchmarks.md), 고지는 [라이선스 안내](docs/licenses.md)에 남긴다. MIT가 의존성의 원래 라이선스를 대체하지 않는다.

## 변경과 검증

- Node 24 LTS, .NET 10 SDK를 사용한다. `npm ci`로 잠금 파일을 따른다.
- `npm run check`, `npm run format:check`. UI 변경은 `npm run test:browser`와 화면 확인을 추가한다.
- 네이티브 변경은 Windows build와 `--self-test`. 캡처/수명주기는 잠금 해제 Windows에서 `npm run test:native`로 확인한다.
- 인증/소유권/CSRF/철회/입력 제한을 약화시키지 않는다. 통신 변경 시 서버·웹·네이티브·테스트를 함께 수정한다.
- DB 변경은 `user_version` 순차 마이그레이션으로 작성한다. 관리 CLI가 실행 중 서버의 세션을 초기화하면 안 된다.
- 결정은 `docs/decisions.md`, 규칙은 `rules/rules.md`, 결과는 `docs/validation.md`, 사용자 영향은 CHANGELOG에 기록한다.
- 사용자 정책 변경 전까지 main 직접 작업·커밋·푸시를 기본으로 한다. 원격 변경 통합과 검증을 유지하며 강제 푸시하지 않는다.
- 버전은 `npm run version:set -- X.Y.Z`로 동기화한다. [릴리즈 절차](docs/releases.md)에 따라 태그를 올린다. 검증/패키지 성공 후에만 GitHub Release를 공개한다.

## PR에 남길 내용

문제와 변경 후 동작, 영향, 검증 명령/결과, 미실행 항목과 이유, 관련 문서를 적는다. 개인 화면 대신 합성 데이터를 사용한다. 에이전트 ZIP은 Release/서버 artifacts로 제공하고 Git 소스에는 넣지 않는다. Actions 캐시/아티팩트 저장은 사용하지 않는다. 실제 OS 입력 검사는 [폐기 가능한 VM](docs/vm-validation.md)에서만 실행한다.
