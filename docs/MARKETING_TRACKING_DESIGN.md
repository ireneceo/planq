# 마케팅 측정 설계 — GTM · GA4 · Meta 픽셀 · Search Console (2026-10-17 초안)

> Irene 2026-10-17: *"이거 해야 하는 거 안한거 있어? 메타 픽셀, 구글 서치콘솔, GA4, GTM 설정.
> 이벤트는 사이트 구조에 맞게 설계하고 설계서도 남기고 발행·게시 전에는 목록 보여주고 승인"*
>
> 상태: **Fable 설계 판정 PASS(2026-10-17, 차단 3건 반영 — §9)** · 코드는 dev 에 구현 · **운영에서 켜는 것(GTM ID 입력)·처리방침 문구·GTM 게시는 Irene 승인 뒤**(§7·§5).

## 0. 지금 상태 (2026-10-17 실측)

| 항목 | 상태 | 근거 |
|---|---|---|
| GTM | **없음** | 소스·index.html 에 `googletagmanager` 0건 |
| GA4 | **없음** | `gtag`·`G-` 0건. 2026-09-21 에 «운영 CSP 를 풀어야 하고 쿠키 동의가 따라온다» 로 **일부러 안 했고**, 대신 쿠키 없는 자체 집계(`landing_visits`, 플랫폼 관리자 > 랜딩 방문)를 만들었다 |
| Meta 픽셀 | **없음** | `fbq`·`connect.facebook.net` 0건 |
| Search Console | **등록돼 있음**(2026-06-05 부터 sitemap 제출) · 소유확인 방식은 파일·meta 로는 없음(→ 도메인 DNS 로 보임, Irene 확인) | memory `project_landing_seo_setup` · index.html 에 `google-site-verification` 없음 |
| 네이버 서치어드바이저 | 완료(meta 소유확인·sitemap·rss) | index.html `naver-site-verification` |
| 가입 출처 | 있음 — 첫 방문 referrer origin·utm_source 를 가입 직후 한 번 서버에 | `services/firstTouch.ts` · `users.signup_source` |
| CSP | `script-src 'self' https://apis.google.com` — GTM·GA4·픽셀 스크립트가 **막힌다** | `scripts/apply-nginx-security-headers.sh` (= `middleware/security.js` 한 벌, 가드 `checkCsp`) |
| 개인정보처리방침 | «8. 쿠키 및 유사 기술» 두 줄뿐 — 분석·광고 도구, 국외 이전(Google·Meta) 언급 없음 | `locales/*/legal.json` |

**결론: 넷 중 Search Console 만 돼 있고, GTM·GA4·Meta 픽셀은 하나도 없다.**

## 1. 무엇을 재나 — 목표

1. 어디서 온 사람이 **가입·문의·진단**까지 가는가(채널별 전환율) — 지금은 가입 출처 한 칸뿐이라 «방문 → 전환» 사이가 비어 있다.
2. Meta 광고를 돌릴 때 **전환(가입·리드) 최적화와 리타게팅 대상**을 만들 수 있게.
3. Search Console 검색어 ↔ GA4 랜딩 성과를 한 화면(GA4 연결)에서.

## 2. 어디에서만 도나 — 범위 (가장 중요)

**랜딩(공개 소개) + 가입 화면만.** 그 밖에서는 스크립트를 **싣지도 않는다**.

| 싣는다 | 싣지 않는다 (이유) |
|---|---|
| `/` `/features/` `/details/` `/start/` `/pricing/` `/service/` `/service/diagnosis/` `/insights/**` `/guide/**`(위키) `/about/` `/contact/` `/app/` `/privacy` `/terms` (= `seo-pages.json` + 글 주소 — 랜딩 방문 집계와 **같은 목록**) · `/register` | 워크스페이스 앱 전부 — 고객사 업무 데이터(업무·고객명·메일 제목)가 DOM 에 있다. 제3자 스크립트는 DOM 을 읽을 수 있다 |
| | 로그인한 사람 — 우리 고객이 랜딩을 보는 것은 마케팅 방문이 아니다(자체 집계와 같은 규칙) |
| | 네이티브 앱(iOS·Android) — iOS 는 추적 시 ATT 동의창·App Store 개인정보 라벨 변경이 필요. 앱은 랜딩을 안 보여 준다(`NativeMarketingRedirect`) |
| | 공개 링크(`/public/*` 문서·청구서·서명 · `/c/*` 명함 · `/invite/*` · 게스트·예약 · 설문) — **우리 고객의 고객**이 보는 화면이다 |
| | `/login` — 기존 고객 |
| | **초대 가입**(`/register?redirect=/invite/…`) — 우리 고객의 팀원, 획득 아님. GTM 자체를 안 싣는다 |
| | dev.planq.kr — 운영 데이터에 시험 트래픽이 섞인다(관리자 설정 값이 서버별 DB 라 dev 는 비워 두면 자동으로 안 돈다, §6) |

### 2-1. SPA 라서 생기는 누수 — 막아야 하는 세 길
랜딩에서 GTM 을 실은 뒤 사용자가 가입·로그인해 **같은 문서 안에서** 앱으로 넘어가면 스크립트는 메모리에 그대로 남는다.
- **GA4 향상된 측정 «브라우저 기록 변경 기반 페이지 변경»** 을 켜 두면 `/sale/45`·`/tasks?task=12` 같은 앱 주소가 GA4 로 간다 → **끈다.** 페이지뷰는 우리 코드가 허용 경로에서만 보낸다(`pq_page_view`).
- **Meta 픽셀은 기본으로 pushState 를 따라 PageView 를 보낸다** → `fbq.disablePushState = true` · `fbq('set','autoConfig',false,ID)`(자동 «버튼 클릭»·메타데이터 수집 끔).
- **주소에 토큰이 실린다** — `/register?redirect=/invite/<토큰>` 등. 보내는 `page_location` 은 우리가 **경로 + utm_* 만** 남긴 값으로 덮는다(GTM 변수 `DLV - page_location`). 픽셀은 주소를 스스로 읽으므로 `/register` 에 `redirect` 가 있으면 픽셀 이벤트를 보내지 않는다(초대 가입 = 획득 아님, §3).
- **태그를 실은 문서에서 범위 밖으로 나가면(로그인·앱 이동) 문서를 새로 읽는다**(`location.replace`) — 메모리에 남은 GTM·픽셀이 통째로 사라진다. Consent 철회를 순서에 기대는 것보다 확실하다(픽셀은 철회가 `init` 전이어야 확실 — Fable 비차단 지적). 태그를 안 실었으면 보통 SPA 이동 그대로.

## 3. 이벤트 설계 — 사이트 구조에 맞춘 것

**원칙**: ① dataLayer 이름은 `pq_` 로 시작(우리 이벤트임을 구분) · GTM 이 GA4 권장 이벤트 이름과 Meta 표준 이벤트로 옮긴다 ② **개인정보는 싣지 않는다**(이메일·이름·전화·회사명·문의 본문·진단 점수 원값 0) ③ 버튼 클릭은 «전환으로 가는 길» 만 — 모든 클릭을 재지 않는다 ④ 이벤트 하나 = 화면의 한 «성공» 지점(제출 버튼 누름이 아니라 **서버가 200 을 준 뒤**).

### 3-1. 퍼널 지도
```
검색·SNS·광고 ─▶ 랜딩(홈·기능·디테일·인사이트·위키) ─▶ 요금제 ─▶ 가입(체험 플랜 선택) ─▶ [앱: 측정 밖]
                         │                             └▶ 컨설팅(서비스) ─▶ 견적 문의
                         ├▶ 자가진단(시작 → 결과 → 결과 메일 받기)
                         ├▶ 문의하기
                         └▶ 앱 다운로드
```

### 3-2. 이벤트 표

| dataLayer `event` | 언제 (코드 위치) | 매개변수 | GA4 이벤트 | Meta 표준 이벤트 | 전환 표시 |
|---|---|---|---|---|---|
| `pq_page_view` | 허용 경로 진입·경로 변경(LandingLayout · RegisterPage) | `page_path`(정규화 `/x/`), `page_type`(home·features·details·start·pricing·service·diagnosis·insights_list·article·wiki·about·contact·app·legal·register), `page_location`(경로+utm 만), `page_title` | `page_view` | `PageView` | — |
| `pq_view_pricing` | `/pricing/` 진입 | — | `view_item_list` (item_list_name: plans) | `ViewContent` (content_name: pricing) | — |
| `pq_view_service` | `/service/` 진입 | — | `view_item` (item_name: consulting) | `ViewContent` (content_name: service) | — |
| `pq_cta_click` | 가입·요금제·컨설팅·문의·앱·진단으로 가는 링크(위임 리스너 한 곳이 링크 주소로 판정 — 링크마다 표시를 달지 않는다. 위치는 가장 가까운 `data-pq-cta` → 머리줄 `header` → 바닥 `footer` → `body`) | `cta_location`, `cta_target`(register·pricing·service·contact·app·diagnosis) | 커스텀 `cta_click` | — | — |
| `pq_signup_view` | `/register` 진입(초대 가입 제외) | `trial_plan`(starter·basic·pro) | `begin_sign_up`(커스텀) | **보내지 않음**(§9 Q4) | — |
| `pq_sign_up` | 가입 성공(§3-3) | `method`(email·google·apple), `trial_plan` | `sign_up` (권장) | `CompleteRegistration` + `StartTrial`(value 0, currency KRW) | **GA4 주요 이벤트 · Meta 최적화 대상** |
| `pq_lead` | 문의 폼 서버 200 (`ContactPage`) | `lead_type`(contact·quote), `contact_reason`(sales·support·partnership… — 고른 칸 값, 본문 아님) | `generate_lead` (권장) | `Lead` | **주요 이벤트** |
| `pq_diagnosis_start` | 자가진단 [시작] | — | `diagnosis_start`(커스텀) | — | — |
| `pq_diagnosis_complete` | 결과 화면 도달(서버 200) | `industry`, `team_size`(고른 칸 값), `weakest_layer` | `diagnosis_complete`(커스텀) | — (이메일 없음 → Lead 아님) | — |
| `pq_diagnosis_email` | 결과 메일 받기 서버 200 | — | `generate_lead` (lead_type: diagnosis) | `Lead` | **주요 이벤트** |
| `pq_app_download` | `/app/` 의 스토어·설치파일 링크 | `platform`(ios·android·mac·windows) | `app_download`(커스텀) | — | — |
| (결제) `purchase` | **측정하지 않음 — 1단계** | | | | 결제는 로그인 뒤 앱 안(§2 범위 밖). 2단계 = 서버 전송(§8) |

### 3-3. 가입 성공을 어디서 잡나 (구멍이 있다)
- 이메일 가입: `RegisterPage` 가 `/api/auth/register` 200 을 받은 직후, 앱으로 이동하기 **전**에 push → 범위 안.
- 구글·애플 가입: 공급자로 나갔다가 서버가 **바로 `/inbox`(앱)** 로 보낸다(`oauth/core.buildRedirectTarget`) — 신규인지 화면이 모른다. 앱 안이라 스크립트를 실을 수 없다.
- 이미 «로그인 뒤 한 번» 문이 있다 — `SignupSourceReporter`(App 루트) → `POST /api/landing-visits/signup-source`(가입 24시간 안·한 번만, 서버가 판정). **이메일·구글·애플 세 길이 모두 지나는 유일한 곳**이다.
- **결정(Fable D)**: `oauth/finish.js` 가 이미 아는 `isNewUser` 를 쓴다 — 신규 ∧ 초대 아님 ∧ 돌아갈 곳 없음이면 `/register?done=1&method=google|apple` 로 보낸다. 이메일 가입도 성공하면 같은 «가입 완료» 처리를 지난다. 그 자리에서 `pq_sign_up` 을 한 번(브라우저 표식으로 중복 차단) 보내고 앱으로 간다(태그를 실었으면 문서 새로 읽기). **«로그인한 사람 제외» 규칙의 유일한 예외가 이 가입 완료 순간**이다 — 처리방침 문장도 «회원가입 완료 화면까지» 로 쓴다.
- 서버 전송(Measurement Protocol·Conversions API)은 2단계(결제)와 함께.

### 3-4. 보내지 않는 것 (명시)
이메일·이름·전화·회사명(해시 포함 — Meta «자동 고급 매칭» 끔) · 문의 본문 · 진단 문항별 점수 · 워크스페이스·사용자 id · 초대 토큰 · 앱 안 주소 · 검색어(사이트 안 검색).

## 4. 동의 (쿠키·국외 이전)

GA4(`_ga`)·Meta(`_fbp`) 는 쿠키를 쓰고, 데이터가 미국(Google·Meta)으로 간다. 지금 처리방침은 이걸 말하지 않는다.
선택지(§9 Q1):
- **결정(Fable K2 변형)**: 한국 방문자(브라우저 언어 `ko` 또는 시간대 `Asia/Seoul`) = 기본 켜짐 + 첫 방문 띠(«설정»으로 끄기). 그 밖(영어 랜딩의 EU 포함) = **«허용» 전에는 GTM 을 싣지 않는다**(opt-in). 지역 판정은 우리 코드가 한다(GTM 지역별 기본값은 GTM 을 먼저 실어야 해서 «거부=안 실음» 과 모순). 분석·광고 두 칸, 광고만 끄면 GTM 은 싣되 Consent Mode `ad_storage/ad_user_data/ad_personalization=denied` + Meta 태그는 `ads_allowed` 조건.
- (검토했던 안)
- **K1 고지 + 거부(한국 관행)**: 처리방침에 도구·목적·보관·국외 이전·거부 방법을 적고, 랜딩 바닥에 «쿠키 설정» 링크(분석/광고 끄기). 기본 켜짐.
- **K2 첫 방문 띠 배너(거부 가능, 기본 켜짐)** + Consent Mode v2. EEA·영국·스위스는 기본 꺼짐(지역별 기본값) — 영어 랜딩이 있어 유럽 방문이 있을 수 있다.
- **K3 모두 사전 동의(opt-in)**: 배너에서 «허용» 전엔 아무것도 안 실음. 데이터가 크게 준다(국내 B2B 랜딩에서 보통 30~60% 손실).

어느 쪽이든: 동의 상태는 `localStorage`(`planq:consent` = `{analytics, ads, at, v}`) 한 곳 · 바닥 «쿠키 설정» 은 항상 · 거부하면 GTM 자체를 안 싣는다(GA4 cookieless ping 도 안 보냄 — 단순하게).

## 5. 처리방침 변경 (승인 목록에 포함)
«8. 쿠키 및 유사 기술» 을 늘리고, «3. 제3자 제공 및 국외 이전» 에 두 줄:
- Google LLC(미국) — Google Analytics 4·Tag Manager: 방문 페이지·유입 경로·기기/브라우저 정보·쿠키 식별자, 목적: 방문 통계, 보관: **이벤트 데이터 14개월(GA4 보존 설정), 집계 통계는 Google 보존 정책**
- Meta Platforms, Inc.(미국) — Meta 픽셀: 방문 페이지·전환 이벤트·쿠키 식별자, 목적: 광고 성과 측정·맞춤형 광고, 보관 Meta 정책
- 자체 방문 집계 한 줄(지금도 돌고 있는데 처리방침에 없다): «공개 소개 페이지 방문 수를 세기 위해 접속 정보로 하루마다 바뀌는 비밀값을 섞은 일방향 값을 만들어 그날의 중복만 가리며, IP·브라우저 정보는 저장하지 않습니다»
- 범위 문장: «공개 소개 페이지와 회원가입 화면(가입 완료 순간 포함)에서만 · 로그인 후 서비스 화면·공유 링크·앱에서는 사용하지 않습니다» — **코드(§2)와 한 줄씩 대조**(memory `feedback_copy_must_match_code_line_by_line`).
- **버전은 올리지 않는다**(Fable Q5 — 회원 데이터 처리 변경이 아니다). 대신 처리방침에 개정일·변경 이력 1행 + **시행 7일 전 사이트 공지**(PIPA §30).
- ★ 이 문구는 **승인 전에는 legal.json 에 넣지 않는다** — 코드만 배포되고 ID 가 비어 있으면 아무것도 안 돌므로 지금 처리방침이 사실이다. 순서: 승인 → 문구 반영·배포 → 공지 7일 → 운영 ID 입력.

## 6. 구현 (코드 — dev)

| 무엇 | 어디 |
|---|---|
| 컨테이너 ID 보관 | `platform_settings.gtm_container_id`(VARCHAR 20, `GTM-` 모양만 — 비우면 꺼짐) — **서버별 DB** 라 dev 는 비워 두면 안 돈다. 플랫폼 관리자 > 플랫폼 설정에서 입력 = «켜는 스위치». 운영 `migrate-marketing-tags.js`(멱등, 배포 슬롯) |
| 공개 읽기 | 기존 무인증 `GET /api/platform/info` 에 `gtm_container_id` 한 칸(새 라우트 없음 — Fable Q6). 비밀값 아님(GTM ID 는 원래 페이지 소스에 보이는 값) |
| 싣기·판정 한 곳 | `services/marketingTags.ts` — `isTrackablePath(path)`(랜딩 집계와 같은 목록) · 로그인/네이티브/동의 확인 · `loadGtm()` 한 번 · `track(event, params)` · 경로가 범위 밖으로 나가면 정지 |
| 부르는 곳 | `LandingLayout`(페이지뷰·CTA 위임 리스너·동의 띠·바닥 «쿠키 설정») · `RegisterPage`(가입 시작·가입 완료) · `ContactPage` · `DiagnosisPage` · `DownloadAppPage` · `oauth/finish.js`(신규 가입 착지) |
| CSP | `script-src` + `https://www.googletagmanager.com https://connect.facebook.net` · `img-src` 은 이미 `https:` · `connect-src` 이미 `https:` · `frame-src` + `https://www.googletagmanager.com`(GTM noscript — 안 쓰면 생략). **nginx 스니펫 + `security.js` 같이**(가드 checkCsp). dev·운영 nginx 적용은 sudo → Irene |
| 인라인 스크립트 | 쓰지 않는다(CSP `unsafe-inline` 없음) — GTM 부트스트랩을 우리 모듈에서 `script` 요소로 붙인다. **GTM 안 «맞춤 HTML» 태그는 CSP 에 막힌다** → Meta 픽셀은 GTM 갤러리 템플릿(«Facebook Pixel» by facebookarchive) 으로 넣는다 |
| 회귀 | `--suite marketingtags`: 허용 경로에서만 GTM 요청 · 로그인/앱 경로/공개 링크/네이티브에선 0 · 거부 시 0 · 범위 밖 이동 후 push 0 · `page_location` 에 토큰 없음 · 양성 대조군(범위 판정을 «항상 참» 으로 → 앱 경로 요청이 잡힘) |

## 7. GTM 컨테이너 — **게시 전 승인 목록** (Irene 승인 후 게시)

**변수**: `DLV - page_path` · `DLV - page_type` · `DLV - page_location` · `DLV - page_title` · `DLV - cta_location` · `DLV - cta_target` · `DLV - method` · `DLV - trial_plan` · `DLV - lead_type` · `DLV - contact_reason` · `DLV - industry` · `DLV - team_size` · `DLV - weakest_layer` · `DLV - platform` · 상수 `GA4 측정 ID` · 상수 `Meta 픽셀 ID`

**트리거**(전부 «맞춤 이벤트» — 클릭·기록 변경 자동 트리거 없음): `pq_page_view` · `pq_view_pricing` · `pq_view_service` · `pq_cta_click` · `pq_signup_view` · `pq_sign_up` · `pq_lead` · `pq_diagnosis_start` · `pq_diagnosis_complete` · `pq_diagnosis_email` · `pq_app_download`

**태그**
| 태그 | 종류 | 트리거 | 설정 |
|---|---|---|---|
| GA4 - 구성 | Google 태그 | 초기화(모든 페이지) | `send_page_view: false` · `page_location` = DLV · 사용자 ID 없음 |
| GA4 - page_view | GA4 이벤트 | pq_page_view | page_location·page_title·page_type |
| GA4 - sign_up | GA4 이벤트 | pq_sign_up | method·trial_plan |
| GA4 - generate_lead | GA4 이벤트 | pq_lead · pq_diagnosis_email | lead_type·contact_reason |
| GA4 - 그 밖 커스텀 6 | GA4 이벤트 | 각 트리거 | 위 표 매개변수 |
| Meta - 기본 | Facebook Pixel 템플릿 | 초기화 | 자동 구성 끔 · pushState 끔 · 고급 매칭 끔 |
| Meta - PageView | 〃 | pq_page_view | |
| Meta - CompleteRegistration·StartTrial | 〃 | pq_sign_up | value 0 KRW |
| Meta - Lead | 〃 | pq_lead · pq_diagnosis_email | |
| Meta - ViewContent | 〃 | pq_view_pricing · pq_view_service | |

**GA4 속성 설정**: 향상된 측정 «페이지 변경(기록)» 끔 · «양식 상호작용» 끔(폼 필드 이름이 간다) · «사이트 검색» 끔 · 데이터 보관 14개월 · Google 신호 끔 · 주요 이벤트: sign_up·generate_lead · 내부 트래픽(사무실 IP) 제외 · Search Console 연결.
**Meta 이벤트 관리자**: 자동 고급 매칭 끔 · 핵심 이벤트 설정(AEM) — CompleteRegistration·Lead · 도메인 확인 planq.kr.
**Consent**: GA4·Meta 태그 모두 «추가 동의 확인» — GA4 = `analytics_storage`, Meta = `ad_storage`(우리 코드가 GTM 을 싣기 전에 `consent default` 를 넣는다).
**향상된 측정 «아웃바운드 클릭·파일 다운로드»** 끔(`pq_app_download` 와 이중 집계).

**Irene 입력 항목**(코드가 정할 수 없는 값): GTM 컨테이너 ID · GA4 측정 ID · Meta 픽셀 ID · Meta 도메인 확인 방법(DNS TXT 권장) · GA4 내부 트래픽 IP · Search Console 속성 종류(도메인/URL) 확인 · GA4 ↔ Search Console 연결.

## 8. 2단계 (이번에 안 함)
첫 결제(`purchase`·`Subscribe`)·OAuth 가입을 서버에서 GA4 Measurement Protocol + Meta Conversions API 로 — 비밀키 2개(암호화 보관)·외부 발송 로그·`_ga`/`_fbp` 연결이 필요. 1단계 데이터가 2~3주 쌓인 뒤.

## 9. Fable 판정 (2026-10-17 PASS — 차단 3건 반영)
Q1 K2 변형(한국 기본 켜짐·그 밖 opt-in, 지역 판정은 우리 코드) · Q2 §2 그대로 + 초대 가입은 GTM 안 실음 · Q3 D(가입 완료 착지 한 곳) · Q4 Meta 로 중간 이벤트 안 보냄(GA4 `begin_sign_up` 만) · Q5 버전 안 올림, 개정일·공지 7일 · Q6 platform_settings + 기존 `/api/platform/info`.
차단(반영됨): ①EU 기본 꺼짐 ↔ «거부=안 실음» 모순 → 지역 판정을 우리 코드로 ②«보관 14개월» 문구 + 자체 집계 해시 누락 → §5 ③범위 문장 ↔ 가입 완료 예외 → §5 문장에 담음.

### Fable 완료 검증 (2026-10-17) — FAIL 2건 → 고침 → 재판정 2026-10-18 **PASS**(상황판 Fable 대기 재시도, 비차단은 docs/FABLE_GATE_QUEUE.md)
1. 이메일 가입이 `/register?redirect=/c/<토큰>` 에서도 가입 완료 처리로 GTM 을 실을 수 있었다(픽셀이 주소를 읽어 토큰 유출 + 돌아갈 곳 회귀)
   → RegisterPage 술어를 `!inviteToken && !redirectParam`(서버 finish 와 같은 술어)로 · `ensureLoaded` 가 범위 밖 주소·`redirect` 있는 주소에서 거절(마지막 방어선).
2. 공유 링크(`/public/tasks|files|calendar/<토큰>`)의 «홈으로» 문서 이동이 referrer 로 토큰을 실었다
   → 그 링크에 `rel="noreferrer"` · 태그를 실을 때 같은 사이트 referrer 는 출처만 남김(`document.referrer` 덮기, 밖 referrer 는 그대로).
자체 검증: e2e marketingtags 15/15(⑨ referrer 대조군 — 태그 없는 /login 에선 토큰째 보임 → 실린 /features 에선 출처만 · ⑩ redirect 실린 가입 완료 → GTM 요청 0) · build EXIT 0 · guard 73/74(종전) · health 88/88.
비차단(기록): 기존 사용자가 `/register?done=1` 을 손으로 치면 가짜 전환 1건(브라우저당 1회) · ID 비어 있어도 OAuth 신규는 `/register?done=1` 을 잠깐 지난다 · 픽셀 pushState·autoConfig 끄기는 GTM 게시 목록(§7)에서 확인.
알게 된 별개 결함: `/register?redirect=/invite/<잘못된 토큰>` 이 화면을 멈춘다(dev·운영 같음, JS 아님 — 디버거로 멈춰 지지 않음). 이 일과 무관 — 따로 고친다.

### (옛) Fable 에 물은 것
- Q1 동의 모델: K1 / K2 / K3
- Q2 범위: §2 표가 맞나(특히 `/register` 포함, `/login`·공개 링크 제외)
- Q3 가입 전환: A / B / C
- Q4 `begin_sign_up`·`InitiateCheckout` 같은 중간 이벤트를 Meta 로 보낼지
- Q5 처리방침 버전 올림 여부
- Q6 ID 보관: platform_settings + 공개 라우트 vs 빌드 상수 + 호스트 판정

## 10. 승인 받을 목록 (Irene) — 이것이 승인되기 전에는 게시·발행하지 않는다

### 10-1. 처리방침 문구 (legal.json ko/en — 승인 뒤 반영)
**8. 쿠키 및 유사 기술** (지금 두 줄 → 바꿀 글)
> 회사는 로그인 유지·보안을 위해 필수 쿠키를 사용합니다.
> 공개 소개 페이지와 회원가입 화면(가입 완료 순간 포함)에서는 방문 통계와 광고 성과 측정을 위해 아래 도구를 사용합니다. 로그인 후 서비스 화면·공유 링크·모바일 앱에서는 사용하지 않습니다.
> - Google Analytics 4·Google 태그 관리자(Google LLC): 방문한 페이지·유입 경로·기기와 브라우저 정보·쿠키 식별자 / 목적: 방문 통계 / 보관: 이벤트 데이터 14개월, 집계 통계는 Google 보존 정책
> - Meta 픽셀(Meta Platforms, Inc.): 방문한 페이지·가입과 문의 같은 전환·쿠키 식별자 / 목적: 광고 성과 측정과 맞춤형 광고 / 보관: Meta 정책
> - 자체 방문 집계: 방문 수를 세기 위해 접속 정보에 하루마다 바뀌는 비밀값을 섞은 일방향 값으로 그날의 중복만 가리며, IP·브라우저 정보는 저장하지 않습니다.
> 한국 밖에서 접속하면 허용하기 전에는 위 두 도구를 싣지 않습니다. 사이트 하단 «쿠키 설정»에서 언제든 끄거나 켤 수 있고, 브라우저 설정으로 쿠키를 거부할 수도 있습니다. 이름·이메일·전화번호·문의 내용은 이 도구들로 보내지 않습니다.

**3. 제3자 제공 및 국외 이전** — 항목 두 줄 추가
> - Google LLC(미국) — Google Analytics 4·태그 관리자: 위 8조의 정보, 공개 소개 페이지 방문 시 전송, 보관 이벤트 데이터 14개월
> - Meta Platforms, Inc.(미국) — Meta 픽셀: 위 8조의 정보, 공개 소개 페이지 방문 시 전송, 보관 Meta 정책
> - 거부 방법: 하단 «쿠키 설정»에서 끄면 전송되지 않습니다.

**개정**: 최종 개정일·시행일 갱신 + 변경 이력 1행. `privacy_version` 은 올리지 않는다(재동의 창 없음).
★ 처리방침 10조가 «시행 7일 전 서비스 공지 **및 이메일**로 안내» 를 약속한다 — 공지 띠(관리자 공지)와 **전 회원 메일 발송**이 따라온다(외부 발송 — 별도 승인).

### 10-2. GTM 컨테이너 — §7 표 그대로 (변수 16 · 트리거 11 · 태그 GA4 6종 + Meta 5종, 맞춤 HTML 0)
### 10-3. GA4 속성 설정 — §7 «GA4 속성 설정» 줄
### 10-4. Meta 이벤트 관리자 설정 — §7 «Meta 이벤트 관리자» 줄
### 10-5. 운영 켜는 순서
1. 승인 → 10-1 문구 반영(dev) → 배포(코드·마이그레이션은 이미 이번 묶음)
2. 운영·dev nginx CSP 적용(`sudo bash scripts/apply-nginx-security-headers.sh` — Irene)
3. 처리방침 개정 공지 7일(공지 띠 + 메일)
4. GTM 컨테이너 게시 → 운영 관리자 > 플랫폼 설정 > «마케팅 측정» 에 GTM ID 입력(= 켜기)
5. GTM 미리보기(Tag Assistant)로 이벤트 11종 확인 → GA4 실시간·Meta 테스트 이벤트 확인

### 10-6. dev 상태 (2026-10-17)
dev `gtm_container_id = GTM-PLANQDEV`(가짜 ID — 띠·쿠키 설정을 화면에서 보려고). dev nginx CSP 가 GTM 을 막고 가짜 ID 라 실제로는 아무것도 안 간다. 끄려면 관리자 화면에서 비운다.
