# 해외 접속을 막는 한국 메일 서버 — 한국 중계 경로 설계 (2026-11-17)

> Irene 2026-11-17: *"다른 앱에서는 연동 잘 되는데 이유가 뭐야? 다른 회사들 것도 이러면 어떻게 하는데?"* → B안(한국 중계 서버) «권고대로».
> 작성 [Opus] · 방 a0a49cdb · Fable 설계 검토 대상(외부 연결 경로·자격증명이 지나가는 길·DB 칸 추가).

## 1. 사실 (실측)
- PlanQ 서버는 독일(87.106.11.184 dev · 운영도 같은 해외 IDC). 메일 IMAP/SMTP 는 **사용자 기기가 아니라 PlanQ 서버가** 접속한다.
- gmate.co.kr: 메일 서버 1.234.54.22(SK브로드밴드, KR) 25·80·443·993·143·465·587 전부 연결 단계 타임아웃, 홈페이지 116.127.123.151 https 도 타임아웃.
  같은 시각 naver·daum·gabia·cafe24 https 200 → **우리 망 문제가 아니라 상대가 해외 IP 를 버린다**(11-16 Fable 원인 판정과 일치, 11-16~17 다섯 번 재측정 동일).
- 같은 계정이 Mac 메일·폰에서는 된다 = 한국 IP 에서 붙기 때문.
- 지금은 등록 시 `imap_unreachable`/`smtp_unreachable` 로 «호스팅 업체에 허용 요청» 안내만 한다(cfa9a637) — 고객마다 업체 협조가 필요해 확장 불가.

## 2. 목표 / 비목표
- 목표: 해외 접속을 막는 한국 메일 서버도 **고객이 아무것도 안 해도** 등록·수신(IDLE 포함)·발송이 된다.
- 목표: 지금 잘 되는 계정(Gmail·네이버·대부분)은 **경로가 바뀌지 않는다**(직접 연결 그대로).
- 비목표: 다른 외부 호출(웹훅·OAuth·AI)을 중계하지 않는다 — 메일 IMAP/SMTP 만.

## 3. 구조
```
PlanQ 서버(DE) ──(직접)──────────────────────────────▶ 메일 서버      ← 기본
PlanQ 서버(DE) ──SOCKS5(인증)──▶ 한국 중계(서울 VM) ──▶ 메일 서버      ← 직접이 «응답 없음» 일 때만
                 TLS 는 PlanQ↔메일 서버 끝-끝 (중계는 TCP 만 잇는다)
```
### 3-1. 중계 서버 (서울 리전 VM 1대, 월 $5 안팎 — AWS Lightsail 서울 또는 Vultr 서울)
- SOCKS5 (dante `sockd`), **사용자명/비밀번호 인증** + 방화벽에서 **PlanQ 운영·개발 서버 IP 만** 1080 허용.
- 나가는 쪽 제한: 목적지 포트 = 메일 포트(25 제외: 143·465·587·993·995)만 · 사설/예약 대역 거부(중계가 남의 내부망 스캐너가 되지 않게).
- 로그: 연결 시각·목적지·바이트만(내용 없음). 계정·비밀번호 없음.
- **먼저 확인할 위험**: 상대가 «해외» 가 아니라 «클라우드 대역» 을 막을 수도 있다 → VM 을 만든 직후 그 VM 에서 mail.gmate.co.kr:993 이 붙는지 재고, 안 붙으면 다른 업체(국내 호스팅 VPS) 로 바꾼다. **구현 완료 판정 전 필수 실측.**

### 3-2. PlanQ 코드 — 연결 경로는 한 곳 `services/mailRoute.js`
메일 연결을 만드는 곳이 5군데라(아래) 각자 분기를 넣으면 반드시 갈라진다 → 한 모듈이 «어느 길로» 를 정하고 소켓을 준다.

| 연결 지점 | 파일 | 바꾸는 방법 |
|---|---|---|
| 등록 검사 IMAP | `services/email_credentials.verifyImapCredentials` | `mailRoute.withRoute()` 로 감싸 직접→중계 |
| 등록 검사 SMTP | `services/email_credentials.verifySmtpCredentials` | 같은 |
| 수신 cron·IDLE | `services/emailImapCron.buildImapConfig`(2곳 connect) | config 에 `socket` 주입(중계일 때) |
| [연결 테스트] | `routes/email_accounts.js` POST `/:id/test` | 같은 |
| 발송 | `services/emailSend.buildTransport` | nodemailer `getSocket` 옵션(중계일 때) |

- 판정 순서(계정별): 저장된 길(`email_accounts.connect_route` — `direct`|`relay`|NULL=모름)이 있으면 그 길 먼저.
  모름·직접 실패 원인이 **응답 없음(isUnreachable — 기존 판정 함수 그대로)** 일 때만 중계로 한 번 더. 인증 실패·주소 없음·거절(ECONNREFUSED)은 중계로 넘기지 않는다(같은 결과라 시간만 쓴다).
  중계에서 성공하면 `relay` 로 저장 → 다음부터 바로 중계. 중계로도 응답 없음이면 지금 안내(`*_unreachable`) 그대로.
  `relay` 계정은 하루 한 번 직접을 다시 시도해 풀렸으면 `direct` 로 되돌린다(상대가 허용해 주면 중계에서 빠짐).
- 등록 전(계정 행이 없을 때)은 저장 없이 같은 순서로 시도하고, 생성 시 성공한 길을 같이 저장한다.
- **목적지 검사(netGuard)는 그대로 PlanQ 쪽에서** 한다 — DNS 를 PlanQ 가 풀어 검사한 **IP 로** SOCKS CONNECT 를 보낸다(중계가 따로 풀면 검사와 실제가 달라진다). TLS servername 은 원래 호스트 이름.
- 직접 연결 타임아웃: 등록 검사는 지금 10초 → 직접 8초 + 중계 10초(화면 대기 최악 ~20초, 등록 버튼은 이미 «저장 중…»).
- 중계 설정: `.env` `MAIL_RELAY_URL=socks5://user:pass@host:1080` 하나. 없으면 지금과 똑같이 동작(직접만).
- IMAP 라이브러리(node-imap 0.8)는 `config.socket` 을 받지만 그 소켓에 `connect()` 를 다시 부른다 → SOCKS 로 이미 이어진 소켓의 `connect` 를 «바로 connect 이벤트만 내는» 함수로 바꿔 넘긴다(라이브러리 패치 아님, 넘기는 소켓 한 개만). SMTP 는 nodemailer 공식 `getSocket`.
- 의존성: `socks`(이미 node_modules 에 간접 설치 2.8.7) 를 직접 의존성으로.

### 3-3. DB
- `email_accounts.connect_route` ENUM('direct','relay') NULL · `connect_route_checked_at` DATETIME NULL. 운영 `migrate-mail-connect-route.js`(멱등, 배포 슬롯, 코드보다 먼저). 응답에는 `connect_route` 만(비밀 아님).

### 3-4. 화면
- 계정 목록에 중계 계정은 작은 표시 «한국 경유» (ko) / «via Korea relay» (en) + 툴팁 «이 메일 서버는 해외 접속을 막아 한국 중계 서버를 거쳐 연결해요». 그 밖의 화면 변화 없음.
- `*_unreachable` 문구: 중계가 설정돼 있으면 «한국 중계로도 응답이 없어요 — 주소·포트를 확인하거나 호스팅 업체에 문의해 주세요» 로(중계가 없을 때만 지금 문구).

## 4. 보안 — Fable 판단 필요
1. **인증서 검증**: 지금 IMAP 은 `tlsOptions.rejectUnauthorized:false`(모든 경로). 직접 경로에선 «인터넷 중간자» 위험이었는데, 중계 경로에선 **중계 서버를 장악한 사람이 TLS 를 가로채 비밀번호를 볼 수 있다.**
   제안: 중계 경로에서는 `rejectUnauthorized:true` + `servername=호스트`. 인증서가 깨진 한국 서버는 중계 경로가 실패 → 안내 «메일 서버 보안 인증서 문제». (직접 경로는 이번에 안 바꿈 — 기존 계정 깨짐 방지.) 이 판단이 맞는가?
2. 143/587 STARTTLS: SMTP 는 `requireTLS` 가 이미 켜짐. IMAP `imap_tls=false`(143 평문) 계정은 중계 경로 **금지**(평문 비밀번호가 중계를 지나지 않게) — 이 계정은 직접만.
3. 중계 자격(`MAIL_RELAY_URL`)은 운영 .env(600/640), 로그·응답에 안 남김.
4. 중계 서버 방화벽(PlanQ IP만)·목적지 포트 제한·사설 대역 거부.

## 5. 검증 계획
- 개발: 우리 서버 로컬에 시험 SOCKS(127.0.0.1, 인증) → `MAIL_RELAY_URL` 로 연결 → Gmail 계정이 **중계 경로로** 등록·수신·발송 되는지(강제 플래그 `MAIL_RELAY_FORCE=1` 개발 전용) · 직접 계정은 경로 불변(`connect_route=direct`) · 중계 꺼짐(.env 없음) = 지금과 바이트 단위 동일 동작.
- 대조군: 중계 인증 틀림 → `*_unreachable` 그대로(조용히 직접으로 새지 않음) · netGuard 차단 주소는 중계로도 차단.
- 실서버: 서울 VM 생성 후 VM 에서 gmate 993 TCP 성공 확인 → 운영 반영 후 gmate 계정 등록 성공.

## 6. 순서
1. Fable 설계 검토 → 반영
2. Irene: 서울 VM 1대 만들기(외부 서비스 — «직접 할 일» 카드) · 우리 SSH 키 등록 · IP 알려 주기
3. VM 에서 gmate 실측(안 되면 업체 바꾸기) → dante 설치·방화벽(이 방이 SSH 로)
4. 코드 구현 + 개발 검증(로컬 SOCKS) — 2와 병렬
5. Fable 완료 검증(외부 연결 경로·자격) → 다음 배포

## 7. Fable 설계 검토 (2026-11-17 · DESIGN-FIX → 아래 7건 반영해 구현)
1. **중계 장애 ≠ 메일 서버 무응답** — `mailRoute` 가 SOCKS 결과를 셋으로: 중계 접속·인증 실패 = `relay_unavailable`(계정 `last_error`·백오프·사용자 안내에 넣지 않음 → 관리자 운영 알림 1건 + 다음 tick 재시도) / 대상 무응답(Host·Network unreachable·TTL) = `*_unreachable` / 거절 = `*_connect_failed`. dante 가 대상 타임아웃에 주는 코드는 VM 실측으로 매핑.
2. **일시 장애로 중계로 새지 않게** — `google_oauth` 계정은 중계 금지 · `direct` 계정은 연속 3회 응답 없음 뒤에만 중계 시도(NULL 만 즉시) · 하루 한 번 직접 재확인은 cron 이 TCP 연결만 따로(IDLE 안 끊음).
3. **IDLE 재연결 폭주 방지** — 중계 경로 재연결에 지터 + 중계 동시 연결 상한 · dante `timeout.io` 가 장시간 IDLE 을 안 끊는지 30분 실측.
4. **netGuard 가 검사한 주소를 돌려준다**(`{ok, addresses}`) — 중계는 그 IP 로만 CONNECT(도메인 ATYP 금지) · IPv4 우선 · 검사와 연결 사이 DNS 재해석 없음.
5. **평문·검증** — 중계 경로 `rejectUnauthorized:true` + `servername` · `imap_tls=false`(autotls 없음 = 완전 평문) 중계 금지 · `smtp_tls===false` 중계 금지 · 중계 포트 집합은 `mailRoute` 한 곳(143·465·587·993·995)에 정의하고 dante 규칙과 같게.
6. **구현 전 실측** — VM 에서 gmate TCP + 인증서 검증(`openssl s_client -verify_return_error -servername`). 인증서가 실패하면 `false` 로 낮추지 않고 «등록 시 지문 고정(TOFU)» 여부를 다시 Fable 결정.
7. **`MAIL_RELAY_FORCE` 는 `NODE_ENV=development` 에서만** 읽는다 · 개발·운영 중계 계정 분리.
- 소켓: node-imap 은 `tls:true` 에서만 중계(5번) → 넘기는 소켓의 `connect()` 는 «아무것도 안 함» 으로 충분 · `imap` 0.8.19 정확히 고정 + 회귀 시험 · 실패 경로 `destroy`. SMTP 는 `getSocket → {connection}`(nodemailer 내장 proxy 금지 — 중계가 이름을 풀게 됨).
- DB 칸 유지 · 쓰기는 조건부 UPDATE(`WHERE connect_route <=> 이전값`).
- 등록 대기: SMTP 는 IMAP 이 성공한 길부터 → 최악 시간을 재서 nginx 타임아웃 안인지 확인.
- 완료 검증: 중계 꺼짐 = 기존 동작 · 중계 죽임 → `relay_unavailable`(계정 오류 0 · 직접으로 안 샘) · 직접 1회 실패로 relay 전환 안 됨 · OAuth·평문 계정 중계 시도 0 · 잘못된 인증서 중계 거절 · netGuard 차단 IP CONNECT 0(중계 로그) · IDLE 30분 + 중계 재시작 뒤 분산 재연결 · `MAIL_RELAY_URL` 로그·응답 미노출 · 3분 tick 소요 전후 비교.
- 선택: SOCKS 비밀번호는 평문이라 실질 통제는 IP 허용 목록 — 여유 되면 WireGuard/stunnel.

## 8. Fable 완료 검증 (2026-11-17 · 코드 f255e762)
- **VERDICT: PASS — 운영 .env 에 `MAIL_RELAY_URL` 이 없는(꺼진) 채 배포.** 옛/새 코드 대조 9건 같음 · 마이그레이션 멱등 · 실HTTP · 켜진 경로 로컬 시험 재현 · 차단 IP CONNECT 0 · 중계 TLS authorized · 중계 죽임 뒤 계정 오류 0.
- 켜기 전 차단 A(고침): 보내기 검사가 받기 direct 계정에서도 중계로 넘어가 초록을 내고 실제 발송은 직접이라 실패 → `mailRoute.smtpRouteFor` 한 함수로 검사·발송이 같은 길(받기 길이 relay 일 때만 보내기도 중계).
- 권고 반영: B 연속 3회 + 첫 실패로부터 10분 이상 · C 하루 재확인 tick 당 3개 · F 배포 사전 점검(아래 줄이 없으면서 운영 .env 에 MAIL_RELAY_URL 이 있으면 멈춤) · E 0행이면 로그 안 남김.
- 남은 것(서울 VM 후 재검증): dante 무응답 코드 매핑 · IDLE 30분 + 중계 재시작 분산 · 중계 로그 · gmate 인증서 · 등록 최악 대기 · A 수정분. 비차단 D(재확인이 TCP 만 봄)는 그때 같이 본다.
- 운영에서 켜도 된다는 판정을 받으면 여기에 줄 맨 앞이 `RELAY-PROD-OK:` 이고 뒤에 날짜·판정을 적은 줄을 남긴다(줄 맨 앞일 때만 인정) — 그 전까지는 배포 스크립트가 운영 .env 의 MAIL_RELAY_URL 을 막는다.
