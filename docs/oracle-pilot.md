# Oracle Cloud 외부 접속 실험

2026-10-15 / 상태: 기존 Oracle VM에 테스트 배포 완료. 외부 HTTPS 로그인 및 합성 데이터 WSS 왕복 검증 완료. 실제 PC 화면·모바일 LTE/5G 수용 검증은 대기.
기준 코드: main `60b066a`, Windows 에이전트 릴리즈 `v0.1.0`.

## 현재 테스트 배포

- 기존 서비스와 분리한 `~/desklink-pilot`, 전용 Node 24, loopback 3230을 사용한다.
- `desklink-pilot.service`와 `desklink-preview.service`를 systemd 사용자 서비스로 등록했다. 기존 서버의 linger 설정이 이미 활성화돼 있다.
- 이미 설치된 cloudflared의 별도 사본으로 임시 HTTPS 터널을 사용한다. 신규 VM/유료 서비스/집 공유기 인바운드 포트는 만들지 않았다.
- 실제 경로는 Windows/브라우저 → Cloudflare → Oracle다. Oracle 직접 TLS 프록시안은 아직 적용하지 않았다. Cloudflare도 전송 경로의 신뢰 주체이며 P2P/종단 간 암호화가 아니다.
- 임시 주소는 `local/preview-url.txt`에 기록한다. 터널 재시작으로 주소가 바뀌면 서버 PUBLIC_ORIGIN을 갱신하고 서버를 재시작하므로 진행 중인 세션이 종료된다. 에이전트에도 새 주소를 입력해야 한다.
- 테스트 계정은 서버 DB에 해시로 저장하며 비밀번호 전달 파일은 Git 제외 경로에만 둔다. 공개 회원가입·기본 공용 비밀번호는 없다.
- Windows v0.1.0 ZIP을 GitHub Release에서 받아 manifest SHA256과 일치함을 확인하고 로컬에 압축 해제했다. GUI를 열었으며 사용자가 로그인·원격 허용 후 실제 화면 테스트를 시작한다.

재시작/중지:

```sh
systemctl --user status desklink-pilot desklink-preview
# 임시 주소는 출력 파일에서 확인 (공개 저장소에 붙이지 않음)
cat ~/desklink-pilot/local/preview-url.txt
# 테스트 종료: 원격 세션도 종료됨
systemctl --user stop desklink-preview desklink-pilot
# 자동 시작까지 해제할 때
systemctl --user disable desklink-preview desklink-pilot
```

Cloudflare Quick Tunnel은 임시 개발 테스트용이며 가용성 보장이 없다. 지속적인 영상 사용·고정 주소·비용/성능 평가는 Oracle 직접 HTTPS 또는 별도 운영 연결 방식으로 후속 검증한다. 아래 Caddy 설정은 대안 설계이며 현재 배포와 구분한다.

## 목적과 선택

사용자 요청에 따라 기존 Oracle VM에 웹/API/영상 중계 서버를 두는 방식을 먼저 시험한다. 성공 기준은 같은 Wi-Fi 연결이 아니라 휴대폰 LTE/5G 등 외부 인터넷에서 현재 Windows PC를 조작하는 것이다. LAN/loopback 검사는 원인 분석용이며 외부 접속 성공으로 집계하지 않는다.

```text
Windows 에이전트 ── HTTPS 로그인 / WSS 화면·입력 ──┐
                                               Oracle VM
외부 브라우저 ──── HTTPS 웹 / WSS 화면·입력 ──────┘
                                               TLS 프록시 :443
                                                    ↓
                                               Node :3000 (loopback)
                                                    ↓
                                               SQLite (영속 디스크)
```

두 클라이언트 모두 Oracle로 나가는 연결을 사용한다. 집 공유기에 인바운드 포트를 열 필요가 없다. 영상은 Oracle를 경유하며 P2P나 종단 간 암호화가 아니다. 현재 서버는 JPEG를 재인코딩하지 않고 전달하므로 GPU 서버는 필요하지 않다.

## 접속 후 먼저 확인할 사항

- VM의 Linux 배포판, CPU 아키텍처, RAM·디스크 여유, Node 24 지원 여부.
- 기존 서비스와 80/443/3000 포트 점유, 프록시·방화벽·백업 현황. 기존 설정을 덮어쓰지 않는다.
- 공인 IP, 인터넷 게이트웨이/라우팅, NSG 또는 보안 목록과 OS 방화벽.
- 사용할 도메인과 DNS 제어 가능 여부. 도메인이 없다면 인증서 발급 가능한 주소 방식을 별도로 정한다.
- OCI 리전·계정의 무료 전송량 적용 조건, 기존 월 사용량, 인스턴스 요금.

1인 파일럿 계획값은 여유 메모리 2GB 이상과 디스크 5GB 이상이다. 최소 사양 보장이나 유료 증설 요청이 아니며 실제 빌드/중계 부하로 판정한다. 확인한 기존 VM은 이 메모리 계획값보다 작고 다른 서비스를 운영 중이다. 로컬 웹 빌드 결과를 전송하고 Node 24를 기존 Node와 분리해 설치하는 경량 파일럿을 검토한다. 실제 수용 가능 여부는 제한된 자원으로 중계 부하를 측정해 판정한다. 개인 서버 상세는 local/environment.md에만 기록한다.

## 배포 구성안

Node 24와 의존성 설치 → 웹 빌드 → 운영 계정 생성 → 전용 OS 사용자로 서버 실행 → 기존 프록시에 HTTPS 사이트 추가 → 외부 접속 검증 순서다. 새 프록시가 필요하면 Caddy를 후보로 한다. 기존 Nginx/Caddy가 있다면 해당 설정에 통합한다.

운영 환경 예시 (실제 주소와 파일은 서버에서 설정, Git 제외):

```dotenv
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://remote.example.com
DATABASE_PATH=/var/lib/desklink/desklink.db
TRUST_PROXY=1
RELEASE_REPOSITORY=BigDude129/web-remote-desktop
```

프록시가 같은 VM의 loopback으로 접속할 때만 위 TRUST_PROXY 설정을 쓴다. 컨테이너 브리지 주소를 자동으로 신뢰한다고 가정하지 않는다. 현재 `npm start`가 tsx를 사용하므로 devDependencies를 제거한 `npm ci --omit=dev`로 설치하지 않는다. `npm ci` → `npm run check` 후 운영 실행한다.

Caddy를 새로 선택했을 때 사이트 블록의 최소 형태:

```caddyfile
remote.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

이는 적용 전 예시다. 실제 도메인, 기존 포트 점유, 인증서 발급 조건을 확인한 뒤 검증·반영한다. Caddy는 WebSocket 프록시와 자동 HTTPS를 지원한다. 443/TCP를 열고 80/TCP는 선택한 인증서 검증/리다이렉트 구성에 맞춘다. 3000과 DB는 외부에 공개하지 않는다. SSH는 기존 관리 경로를 유지한다.

전용 서비스 사용자, systemd 재시작 정책, 소유자만 읽는 환경 파일, DB 영속 경로를 사용한다. 코드 릴리즈 경로와 DB를 분리하고 교체 전 서버를 정상 종료하여 DB를 백업한다. 실패 시 이전 코드·호환 DB로 복귀한다. 실제 설치 경로와 서비스 설정은 VM 확인 후 확정한다.

현재 앱의 MFA와 계정 재설정은 미구현이다. 외부 접속 파일럿과 상시 운영 완료를 구분하고, 공개 범위·인증 보완을 결정한다. 웹 전용 SSO를 붙여 에이전트의 인증 API/WSS 연결을 막지 않도록 양쪽 경로를 함께 검증한다.

## 트래픽 판단

Oracle 공식 VCN 요금 페이지는 월 첫 10TB 아웃바운드 무료를 안내한다. 현재 계정·리전과 다른 서비스 사용량을 확인하기 전 비용 0원을 확정하지 않는다. 유료 인스턴스·스토리지 비용은 전송량과 별개다.

현재 JPEG 방식은 고정 비트레이트가 아니다. 가정값 5 FPS에서 프레임당 평균 100KB라면 약 4Mbps/1.8GB·시간, 300KB라면 약 12Mbps/5.4GB·시간이다. 하루 2시간 × 30일이면 약 108GB 또는 324GB다. 십진 단위이며 TLS/프로토콜 오버헤드는 제외한다. 측정값이나 상한이 아니다. 화면 내용에 따라 달라진다.

10분 원격 세션 동안 서버 송신 바이트와 접속 기기의 수신량을 측정해 1시간·월 사용량으로 환산한다. 기존 서버 트래픽과 구분하고 OCI 계정 집계와 대조한다. 프레임/FPS 제한은 월 비용 상한이 아니다. 현재 누적 사용량 차단 기능은 없으며 예산 알림도 자동 과금 차단을 보장하지 않는다.

## 외부망 합격 기준

1. 유효한 HTTPS 주소가 외부 브라우저에서 열리고 로그인/로그아웃이 정상이다.
2. Windows 에이전트가 동일 주소로 로그인하고 WSS 연결이 유지된다.
3. Wi-Fi를 끈 휴대폰에서 현재 PC 화면 확인과 클릭이 성공한다.
4. 감독모드 연속경기 시작, 한글 입력, 터미널 이전 출력 탐색을 각각 기록한다. 두 손가락 스크롤은 현재 미구현이므로 성공으로 처리하지 않는다.
5. 10분 전송량·지연·서버 자원 사용을 측정한다. 외부 Wi-Fi에서도 반복한다.
6. 세션 철회와 서버 재시작 후 복구를 확인한다. PC 잠금/재부팅 뒤 무인 복구는 현재 지원하지 않으므로 별도 미완료로 남긴다.

현재 원격 세션 30분, 에이전트 인증 12시간 제한도 유지된다. 파일럿 성공은 '언제든 무인 접속 완성'을 의미하지 않는다.

## 출처 (2026-10-15 확인)

- Oracle 전송 요금: https://www.oracle.com/cloud/networking/virtual-cloud-network/pricing/
- OCI 공개 서브넷: https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/scenarioa.htm
- Caddy WebSocket 프록시: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy HTTPS: https://caddyserver.com/docs/automatic-https
- Cloudflare 임시 터널: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

## 2026-10-16 실행 상태 재확인

SSH 읽기 전용 검사에서 desklink-pilot 및 desklink-preview 사용자 서비스가 모두 active였고 서버 package.json 버전은 0.1.1이었다. 상단 0.1.0은 최초 배포 기준 기록이다. 저장소 main 통합과 서버 파일 배포는 별개이며 이번에는 서버 재시작·재배포를 수행하지 않았다.

## 2026-10-16 main 통합본 배포 완료

사용자 요청으로 검증 완료한 main 4d44771의 서버/웹을 기존 Oracle 파일럿에 배포했다. 의존성 잠금 파일 SHA-256이 같아 재설치는 생략했다. 이전 코드와 정지 상태의 SQLite DB를 서버 local/의 시각별 백업에 보존하고 앱 서비스만 재시작했다. 터널 서비스와 기존 주소는 유지했다. 서버 local/deployed-commit.txt에 배포 소스 전체 SHA를 기록했다.

외부 HTTPS health, 비로그인 기기 조회 차단, 로그인과 Secure/HttpOnly 쿠키, 합성 화면·입력 WSS 왕복, 세션 종료·로그아웃을 검증했다. 외부 HTML의 JS/CSS 경로와 자산 SHA-256이 로컬 검증 빌드와 일치했다. 합성 기기는 삭제했고 두 서비스가 active임을 재확인했다. 실제 PC/iPad 입력 재시험이나 신규 Windows Release 게시는 수행하지 않았다.
