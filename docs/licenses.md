# 라이선스와 오픈소스 고지

2026-10-15 사용자가 MIT를 선택했다. 프로젝트 자체 소스와 문서는 [LICENSE](../LICENSE)의 MIT 조건으로 제공한다. 저작권 표기는 `2026 BigDude129 and DeskLink contributors`다. 제3자 구성 요소의 별도 조건과 저작권은 그대로 유지한다.

MIT는 사용·수정·배포를 허용하며 저작권/허가문 보존과 보증 부인을 포함한다. 정확한 조건은 [MIT 원문](../LICENSE)을 따른다. 참고한 공식 원문: [Open Source Initiative](https://opensource.org/license/mit).

## 웹과 서버

`npm run licenses` 및 `npm run build`는 설치된 직접/전이 npm 패키지의 이름·버전·license·출처와 실제 LICENSE/COPYING/NOTICE 파일을 `THIRD-PARTY-NOTICES.txt`로 모은다. `/license`는 프로젝트 MIT, `/licenses`는 생성한 고지를 제공한다. 로그인 화면과 작업 공간에서 접근할 수 있다.

생성 고지는 OS별 optional dependency 구성이 달라질 수 있어 Git에서 제외하고 배포 환경의 `npm ci` 후 생성한다. 빌드 도구 의존성도 포함해 출처를 보존한다. 모든 OS의 설치되지 않은 optional 패키지를 포함했다는 뜻은 아니다. 배포 시 원문 LICENSE가 없는 패키지는 표시된 upstream 출처를 검토한다. 고지 파일을 삭제한 채 배포하지 않는다.

직접 사용한 패키지는 [벤치마킹/의존성 표](benchmarks.md), 전체 버전 고정은 [package-lock.json](../package-lock.json)에서 확인한다. React/Express/ws/Zod/Vite 등은 MIT, lucide-react는 ISC, TypeScript/Playwright는 Apache-2.0이며 패키지의 원문이 기준이다.

## Windows 에이전트

패키징은 실제 `project.assets.json`에 기록된 .NETCore/WindowsDesktop runtime pack 버전을 찾아 해당 NuGet 패키지의 LICENSE와 THIRD-PARTY-NOTICES를 포함한다. 고지를 찾지 못하면 ZIP 생성을 실패시킨다.

ZIP 포함 파일: `DeskLink.Agent.exe`, `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt`, `README.txt`. 에이전트 GUI에서도 라이선스/고지 파일을 열 수 있다. 이 ZIP은 .NET runtime을 포함하며 그 구성 요소의 원래 라이선스/고지를 함께 배포해야 한다.

참고 제품 Guacamole/MeshCentral/RustDesk/Sunshine의 소스나 바이너리를 이번 배포에 포함하지 않았다. 향후 통합/재배포 시 별도 라이선스 검토와 고지 갱신이 필요하다.
