# 내 명함 — 설계 (2026-10-17 · [Opus] 초안 → Fable 설계 판정 FAIL(차단 3) → 반영본)

## 0. Fable 설계 판정 반영 (2026-10-17)
- **차단1 색인 차단은 서버가 한다** — 사람·Googlebot·Yeti 는 nginx try_files 로 index.html 을 직접 받는다. → nginx `location ^~ /c/` 에
  `X-Robots-Tag: noindex, nofollow`(보안헤더 snippet 재포함·share bot 분기·no-cache 동일) · `ogMeta` 봇 분기에 `/c/<token>` 매치 + noindex ·
  robots.txt GPTBot/Google-Extended/ClaudeBot `Disallow: /c/`. 운영 nginx 적용은 배포 때(Irene — sudo).
- **차단2 보관 응답에 토큰 없음** — 받은 명함 응답 = `snapshot + memo + has_photo + source_alive + source_changed` 만.
  [원본 열기] = `GET /api/name-cards/saved/:id/open-link` 가 **누를 때** 공개 판정을 통과한 경우에만 `{url}` 하나를 준다(인증이 Bearer 헤더라 새 탭 302 는 쓸 수 없다 — 판정 시점·결과는 302 와 같다). 목록·상세 응답에는 토큰이 없다.
  [새로 받기] 도 같은 판정. 링크 새로 만들기 확인창: «이미 보관한 사람의 보관본은 그대로 남아요 — 정보를 거두려면 공개를 끄세요».
- **차단3 익명화 연결** — `accountAnonymize.anonymizeUser` 트랜잭션 안에서 두 표 destroy(남이 보관한 내 명함 = source_card_id SET NULL 로 남는다),
  사진 경로는 먼저 모으고 커밋 뒤 unlink. data-export 에 두 표. `ACCOUNT_DELETION_DESIGN.md` 한 줄.
- 비차단 반영: 표 이름 `name_cards`/`saved_name_cards`(계정 소유로 읽히게) · 공개 판정에 `name` 비어 있음·`email_verified_at IS NULL` → 404 ·
  모든 칸 제어문자/줄바꿈 제거(소개만 줄바꿈 허용, vCard 는 escape) · 외부 링크 `rel="nofollow noopener noreferrer ugc"` + 호스트 표기 · 소개 plain text ·
  레이트리밋 JSON 토큰 120/IP 240 · 사진 토큰 600 · vcf 토큰 60 · shareTokenCleanup·AASA 에 넣지 않음 · 복제 = 새 토큰+사진 복사+`' (복사)'` ·
  «바뀜» = 보관 행 `source_updated_at` vs 원본 `updated_at` · 실시간 `user:N` 신호 `namecard:changed` · prefill 역할 owner/admin/member · 탭 등록 3곳.
- **완료 검증(Fable) FAIL 1건 → 고침**: nginx 블록이 `try_files $uri /index.html` 이라 내부 이동으로 `location /` 가 응답해 X-Robots-Tag 가 버려졌다
  (Googlebot·Yeti UA 실측 헤더 없음). → `try_files /index.html =404;`(같은 location 에서 서빙) · 스크립트가 옛 블록을 갈아 끼운다 ·
  임시 nginx 대조군(옛 설정 헤더 없음 / 새 설정 헤더 있음) · 공개 화면 head 에 meta robots noindex(받침) · 배포 사전 점검이 운영 /c/ 헤더를 일반 UA 로 잰다(경고). dev nginx 재적용·실측됨(Googlebot·Yeti·일반 UA 모두 X-Robots-Tag noindex).
- 고객 계정: 메뉴(내 계정 칸)는 owner/member 만 보이지만 API·/me/cards 는 계정 것이라 고객도 쓸 수 있다(공개 페이지의 «보관» 뒤 «명함첩 보기» 로 들어간다) — 의도.
- 주소: 공개 `/c/:token` · API 인증 `/api/name-cards` · 무인증 `/api/name-cards/public/:token`.


> Irene 원문: *"내 계정에 내 명함 메뉴를 만들어줘. 그래서 명함에 필요한 정보들 들어가게 하고 자동으로 불러올 거 불러오고
> 채울거 채워주고. 수정도 되게 해주고. 명함은 종류마다 다르게 쓰게 추가할 수 있게 해주고. 직책이나 하는 일을 좀 바꿔야
> 하기도 하니까. 그리고 웹페이지에 제대로 나오게 해주고 링크랑 큐알 제공해줘. 명함마다 다르게. 사진도 넣으면 나오고
> 안넣으면 안나오고. 그리고 그 링크를 받은 사람은 다운받아서 저장도 하게 해줘. 명함 보관처럼."*

## 1. 무엇을 만드나 (요구 → 기능)
| 요구 | 기능 |
|---|---|
| 내 계정에 메뉴 | 사이드바 «내 계정» 아래 **내 명함** (`/me/cards`) — 탭 «내 명함 / 받은 명함» |
| 필요한 정보·자동으로 불러오기 | 명함 만들 때 «어느 워크스페이스 정보로 채울지» 고르면 계정·워크스페이스 프로필·회사 정보로 칸을 채운다. 이후 «다시 불러오기» 버튼(빈 칸만 채움 / 덮어쓰기 확인) |
| 수정 | 칸마다 자동저장(AutoSaveField) |
| 종류마다 여러 장 | 명함 = 여러 장(최대 20). 장마다 «명함 이름»(예: 워프로랩 대표용·강의용) + 직책·하는 일·연락처를 따로 |
| 웹페이지 | 공개 페이지 `/c/:token` — 폰 우선 명함 화면, 링크 미리보기(OG) |
| 링크·QR 명함마다 | 장마다 고유 토큰 → 링크 복사 · QR(PNG 내려받기) |
| 사진 있으면 나오고 없으면 안 나오고 | 장마다 사진(선택). 없으면 자리 자체를 그리지 않는다(이니셜 아바타도 안 그림) |
| 받은 사람이 저장 | 공개 페이지 [연락처에 저장](.vcf — 폰 주소록) · 로그인 상태면 [내 명함첩에 보관] → «받은 명함» 탭 |

## 2. 소유와 범위 — 명함은 **계정의 것**이다
- 워크스페이스 데이터가 아니다(프로필 사진과 같은 축 — `routes/users.js` 아바타 주석). 워크스페이스를 떠나도 명함은 남는다.
- `source_business_id` 는 **채워 넣을 때 쓴 출처 표시**일 뿐 권한·범위가 아니다. 불러오기는 **지금 내가 멤버인 워크스페이스**만(`business_members.removed_at IS NULL`, 고객 역할 제외 — 고객은 그 워크스페이스 회사 정보로 명함을 만들 이유가 없다).
- 칸 값은 **명함 자신의 값**이다(라이브 연결 아님). 직책을 장마다 바꾸려는 요구라 연결하면 안 된다. 워크스페이스 정보가 바뀌어도 명함은 그대로 — «다시 불러오기» 로만 갱신.

## 3. DB (새 표 2)
### `name_cards`
| 칸 | 형 | 비고 |
|---|---|---|
| id | INT PK | |
| user_id | INT FK users, idx | 주인 |
| label | VARCHAR(60) NOT NULL | 명함 이름(나만 봄) |
| source_business_id | INT NULL | 채울 때 쓴 워크스페이스(표시용) |
| name / name_en | VARCHAR(100) | 표시 이름 |
| job_title | VARCHAR(100) | 직책 |
| department | VARCHAR(100) | 부서·팀 |
| company | VARCHAR(150) | 회사·브랜드 |
| intro | VARCHAR(500) | 하는 일·소개 |
| mobile / phone / fax | VARCHAR(40) | |
| email | VARCHAR(150) | |
| website | VARCHAR(300) | https?:// 만 |
| address | VARCHAR(300) | |
| links | JSON | `[{label,url}]` 최대 6, https?:// 만 |
| accent_color | VARCHAR(7) | `#RRGGBB` 화이트리스트 형식 |
| has_photo / photo_ver | BOOL / INT | 파일은 `uploads/cards/c{id}.jpg` |
| public_token | VARCHAR(32) UNIQUE | 22자 base64url(16바이트 난수) |
| is_public | BOOL default true | 끄면 링크 즉시 404 |
| sort_order | INT | |
| created_at / updated_at | | 지우기 = 행 삭제 + 사진 삭제(하드). 받은 사람 보관본은 스냅샷이라 남는다 |

### `saved_name_cards` (받은 명함)
| 칸 | 비고 |
|---|---|
| id, user_id(보관한 사람, idx) | |
| source_card_id NULL (ON DELETE SET NULL) | UNIQUE(user_id, source_card_id) — 같은 명함 두 번 보관 안 함(두 번째는 갱신) |
| snapshot JSON | 공개 응답과 **같은 화이트리스트**(§5) 그대로 |
| has_photo | 사진은 `uploads/cards/saved/s{id}.jpg` 로 복사(원본이 지워져도 보관본은 남는다) |
| memo VARCHAR(500) | 받은 곳·메모(나만) |
| saved_at / updated_at | |
- 원본이 살아 있고 공개면 «받은 명함» 목록에 «바뀐 내용이 있어요 · 새로 받기» (스냅샷 지문 ≠ 현재 공개 응답 지문). 자동 갱신은 하지 않는다(주인이 링크를 끈 뒤에도 내가 받은 정보는 내 것이다 — 종이 명함과 같다).

## 4. 화면
- **/me/cards** `PageShell` (제목 «내 명함», 우측 [+ 명함 추가]) · `segmentedToggle` «내 명함 n / 받은 명함 n» (URL `?tab=saved`).
- 내 명함: 카드 미리보기 그리드(공개 페이지와 **같은 컴포넌트** `CardFace` 를 축소해서 씀) · 카드 아래 [링크 복사] [QR] [편집] ⋯(공개 끄기/켜기·링크 새로 만들기·복제·삭제). 순서는 ⋯ «앞으로/뒤로»(끌기는 안 함).
- [+ 명함 추가] → `StandardModal`: 명함 이름 + «채울 정보» 고르기(워크스페이스 목록 · «빈 명함») → 만들고 바로 편집 드로어.
- 편집 = `DetailDrawer`(URL `?card=:id`): 위에 미리보기 · 사진(올리기/바꾸기/지우기) · 칸들(AutoSaveField) · [다시 불러오기](출처 고르기 → 빈 칸만 채우기 / 모두 덮어쓰기 확인) · 공개 스위치 · 강조색 6개 고르기 · «이 정보는 링크를 받은 누구에게나 보입니다» 안내.
- QR = `StandardModal`: QR(클라이언트 `qrcode`) · 링크 · [링크 복사] [QR 이미지 내려받기(PNG)].
- 받은 명함: 행 목록(사진·이름·회사·직책·보관일) · 검색 · 누르면 `DetailDrawer`(같은 `CardFace` · 메모 AutoSave · [연락처에 저장 .vcf] · [새로 받기](바뀐 경우) · [원본 열기](살아 있으면) · ⋯ 삭제).
- **공개 페이지 /c/:token**(로그인 불필요, `pages/Public/PublicCardPage`): 가운데 카드 — 사진(있을 때만, 원형) · 이름 · 직책·부서 · 회사 · 소개 · 연락 줄(전화 `tel:` · 문자 · 메일 `mailto:` · 웹 · 주소→지도 검색 링크 · 링크들) · [연락처에 저장](주) · [내 명함첩에 보관](로그인 상태면 바로, 아니면 로그인 후 돌아오기 `?redirect=`) · 맨 아래 작게 «PlanQ 로 만든 명함». 없는/꺼진 명함 → «명함을 찾을 수 없어요» 한 화면(존재 여부 구분 안 함).
- i18n 네임스페이스 `cards`(ko/en). 3폭(390/820/1440) 실측.

## 5. 공개 응답 — 화이트리스트
`cardPublicView(card)` 한 함수: `name, name_en, job_title, department, company, intro, mobile, phone, fax, email, website, address, links, accent_color, has_photo, photo_ver, updated_at`.
**싣지 않는 것**: id·user_id·source_business_id·label(나만 보는 이름)·sort_order·토큰 자체.
받은 명함 스냅샷도 이 함수 출력을 그대로 저장한다(두 벌이 갈라지지 않게).

## 6. 라우트
### 인증 `/api/cards` (routes/business_cards.js — 본인 것만, 모든 조회 `where: { user_id: req.user.id }`)
- `GET /` 내 명함 목록 · `POST /` 만들기 `{label, source_business_id?}` (출처는 내가 멤버인지 검사 후 채움) · `PATCH /:id` 칸 하나 이상(정규화·검증 `services/businessCard.normalizeFields`) · `DELETE /:id`
- `GET /prefill-sources` 내가 멤버(owner/admin/member)인 워크스페이스 목록 · `GET /prefill?business_id=` 채울 값 미리보기(같은 검사)
- `POST /:id/photo` (multer 메모리 8MB → sharp `rotate()` → 600×600 cover → jpeg q85, 메타데이터 제거 — **위치정보(EXIF GPS) 제거가 목적**) · `DELETE /:id/photo` · `GET /:id/photo`(본인)
- `POST /:id/rotate-token` 링크 새로 만들기(옛 링크·인쇄된 QR 죽음 — 확인창이 말한다) · `POST /:id/duplicate` · `POST /reorder {ids}`
- 받은 명함: `GET /saved` · `POST /saved {token}`(공개 판정 같은 함수로 열린 것만, 이미 있으면 스냅샷 갱신) · `PATCH /saved/:id {memo}` · `POST /saved/:id/refresh` · `DELETE /saved/:id` · `GET /saved/:id/photo` · `GET /saved/:id/vcf`
- 감사: 명함은 개인 표시 데이터라 AuditLog 생략(`// audit-exempt`, 아바타 선례). 공개 켜기/끄기·토큰 회전만 AuditLog(`card.publish`·`card.rotate_token`) — 공개 범위 변경이라.
### 무인증 `/api/cards/public/:token` (routes/business_cards_public.js)
- `GET /:token` 공개 응답 · `GET /:token/photo` · `GET /:token/vcf`
- 열림 판정 **`services/businessCard.resolvePublicCard(token)` 한 함수**: 토큰 형식(22자 base64url) → 행 존재 ∧ `is_public` ∧ 주인 계정 `status='active'` ∧ `anonymized_at IS NULL` ∧ 탈퇴 예정 아님. 하나라도 아니면 **404 같은 응답**.
- 레이트리밋: 토큰 키 분당 120 + IP 분당 60(survey 선례) · `Cache-Control: no-store`(사진은 `private, max-age=300` + `?v=photo_ver`) · `X-Robots-Tag: noindex, nofollow`.
- OG(`middleware/ogMeta.js` 공유 봇 + `routes/og.js`): 제목 «이름 · 직책 · 회사», 설명 = 소개 앞 120자. 같은 판정 함수. 꺼진 명함은 기본 OG. 사진은 OG 이미지로 쓰지 않는다(크롤러 캐시에 얼굴이 박제되는 것을 주인이 회수할 수 없다).
- 공개 페이지 HTML 에 `<meta name="robots" content="noindex">`(SPA 에서 Helmet 대신 문서 head 조작) — 개인 연락처가 검색에 뜨지 않게.

## 7. vCard
`services/businessCard.toVcard(view, photoBuf, url)` — vCard 3.0: `N`·`FN`·`ORG`(회사;부서)·`TITLE`·`TEL;TYPE=CELL`·`TEL;TYPE=WORK`·`TEL;TYPE=FAX`·`EMAIL;TYPE=INTERNET`·`URL`(웹사이트)·`URL`(명함 링크)·`ADR;TYPE=WORK`·`NOTE`(소개)·`PHOTO;ENCODING=b;TYPE=JPEG`. 값 escape(`\\ , ; \n`) · CRLF · 75옥텟 접기. 파일명 RFC 5987(`이름.vcf`). iOS 사파리는 .vcf 를 열면 «연락처 추가» 화면.

## 8. 계정 생명주기
- 탈퇴·익명화: 공개 판정이 계정 상태를 보므로 즉시 404. 익명화 배치가 명함 행·사진도 지운다(`services/accountDeletion` 류에 한 줄 — 확인 후 연결).
- GDPR 내보내기(`/admin/users/:id/data-export`)에 명함·받은 명함 포함.

## 9. 한도·비용
- 명함 20장/계정 · 받은 명함 2,000/계정 · 사진 업로드 `perUserDaily('card-photo', {perMin:10, perDay:100})` · 보관 `perUserDaily('card-save', {perMin:30, perDay:500})`.
- 사진은 워크스페이스 스토리지·쿼터와 무관(계정 것 — 아바타 선례). 장당 ~60KB.

## 10. 운영 적용
- `dev-backend/scripts/migrate-business-cards.js`(멱등 CREATE TABLE IF NOT EXISTS 2 · 배포 슬롯 등록) — 코드보다 먼저.
- nginx `location ^~ /c/` 추가(위 0절 차단1) — 운영 반영은 배포 때 Irene(sudo).

## 11. 하지 않는 것(이번)
- 종이 명함 인쇄용 PDF · 명함 디자인 템플릿 여러 종(강조색만) · 회사 로고(워크스페이스 로고 복사는 다음 — 지금은 사진 1장) · 열람 통계 · 명함 촬영 OCR · 받은 명함을 Q sale 고객으로 보내기(다음 후보).

## 12. 검증 계획
- 실HTTP: 만들기(출처 채움 값 = DB 원본) · PATCH 저장→재조회 · 남의 명함 PATCH/DELETE/사진 404 · 내가 멤버 아닌 워크스페이스로 채우기 403 · 공개 GET 화이트리스트(키 집합 정확히) · 공개 끄기 → 404 · 토큰 회전 → 옛 토큰 404 · 계정 정지 → 404 · 잘못된 토큰 형식 404 · vcf 파싱(필드·사진) · 사진 EXIF GPS 제거(exiftool/sharp metadata) · 보관 → 스냅샷 = 공개 응답 · 원본 삭제 → 보관본 남음·사진 남음 · 같은 명함 두 번 보관 = 1행.
- 화면 3폭: 관리 화면·드로어·QR 모달·공개 페이지(사진 있음/없음 — 없음일 때 사진 자리 0px) · 넘침 0.
- 가드: build EXIT 0 · guard-invariants · health-check(secrets — 공개 응답에 토큰·id 없음).
