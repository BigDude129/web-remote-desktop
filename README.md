# 웹 원격 데스크톱 기획

현재 단계: 기획 v0.2.0 / 2026-10-15. 실행 프로그램은 아직 설치·구현하지 않았다.

목표는 현재 Windows PC의 실제 작업 화면을 맥·아이패드·아이폰·안드로이드의 브라우저에서 조작하는 Jump Desktop 보완 수단이다.

- [구현 가능성·구조·비용·대안](docs/plan.md)
- [검증 계획과 버그 기록](docs/validation.md)
- [결정 기록](docs/decisions.md)
- [변경 이력](CHANGELOG.md)

추천 시작점은 Sunshine + 비공식 moonlight-web-stream의 로컬 검증이다. 제품 채택은 아직 확정하지 않았다. 한영 입력과 터치 조작을 실제 기기에서 확인한 뒤 기존 웹 클라이언트를 개선할지 결정한다.

## 변경 방법

1. 변경 사항에 해당하는 기획·검증 문서를 수정한다.
2. 확정 / 제안 / 미정 상태를 표시한다. 확정은 요구사항 확정을 뜻하며 구현 완료를 뜻하지 않는다.
3. 중요한 선택은 docs/decisions.md에 이유와 대안을 남긴다.
4. CHANGELOG.md에 날짜와 바뀐 ID를 적고 Git 커밋을 만든다.

예: `git add docs/plan.md CHANGELOG.md` 후 `git commit -m "docs: update Korean input requirements"`.

버전은 요구 범위가 늘어나면 0.2.0, 표현·오타만 고치면 0.1.1처럼 올린다. 배포 버전은 구현 시작 후 별도로 관리한다. Git은 로컬 이력이며 외부 백업이 아니다.

공동 작업은 [기여 안내](CONTRIBUTING.md)를 참고한다. 게임 지원 범위는 감독모드 화면 확인·연속경기 시작을 위한 수동 클릭이다.
