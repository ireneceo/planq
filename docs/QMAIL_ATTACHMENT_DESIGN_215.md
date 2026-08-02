# #215 Q Mail 첨부파일 (미리보기·다운로드) — 기술 설계서

- 작성: **Fable 설계 게이트** (claude-fable-5, 2026-08-02)
- 상태: 설계 확정 — 구현자는 이 문서 밖의 변경을 하지 않는다 (CLAUDE.md "설계에 없는 것 임의 추가 금지")
- 입력: Opus 증거 브리프(`scratchpad/215-evidence.md`) — **전 항목 실코드·실DB 로 재검증 완료** (아래 §0)

---

## 0. 브리프 검증 결과 — 정정 사항

브리프를 가설로 놓고 전부 재측정했다. 결과:

| 브리프 주장 | 판정 | 실측 |
|---|---|---|
| `is_inline` 사용처 = 모델1 + 쓰기1 + 읽기1, 프론트 0 | ✅ 정확 | grep 전 저장소 재확인. `emailImapCron.js:389`(쓰기) / `email_threads.js:418`(읽기) / `EmailAttachment.js:16`(정의) |
| 전체 3,221 / is_inline=1 2,114(66%) / file_id NULL 0 | ✅ 정확 | dev DB 재측정 일치 |
| 본문이 실제 cid 참조하는 건 **6건** | ✅ 수치 정확 / **⚠️ 구성 정정** | 꺾쇠 정규화 + 대소문자 무시 + LIKE(인용부호 무관) 재측정 = 6건. URL 인코딩 변형(`%40` 등) **0건**. 단 **6건 전부 `image/svg+xml`** (135KB×4, 663B×2, filename 'image'). 브리프의 "부가세 납부서 PDF" 류는 여기 없음 — 그 PDF 들은 **본문 미참조 = Content-ID 만 붙은 일반 첨부**가 맞다 (A 술어의 정당성 강화) |
| 메일 첨부 File 전건 vlevel=L3 | ✅ 정확 | 3,221/3,221 `vlevel='L3', visibility='L3'`. **개인 계정(id 32, irene@irenewp.com, owner_user_id=3) 소속 370건 포함** — F 누출 실재 |
| `att.related` 가 올바른 쓰기측 신호 | **❌ 각하** | mailparser 실코드 확인: `related=true` 는 "Content-ID 有 + 조상 중 multipart/related 존재"일 뿐 **본문 참조를 보장하지 않는다**. 더 결정적으로, **백필은 related 를 재계산할 수 없다** (원본 MIME 미보관) → 쓰기측과 백필의 술어가 갈라진다. §3 에서 술어를 하나로 통일해 정정 |
| (브리프 누락) | **⚠️ 신규 발견** | `emailImapCron.js:291-292` — 첨부 File 의 `uploader_id` 가 **무조건 `biz.owner_id`**. 개인 계정 첨부도 워크스페이스 오너 명의로 저장된다. dev 에선 biz 3 owner=user 3=계정 주인이라 우연히 일치하지만, **타인 개인 계정이면 L1 을 줘도 계정 주인이 자기 첨부를 못 보는** 구조적 결함. F 절단면에 포함 |
| rfc822-headers 974건 노출 | ✅ 정확 + 보강 | 974건 전부 `filename='attachment'` → 칩에 "attachment (N KB)" 로 노출 중. 추가로 `text/x-amp-html` 9건(Gmail AMP 대체 본문 파트)도 같은 계열 노이즈 |
| 발신 3곳은 is_inline 미지정 | ✅ 정확 | `email_threads.js:780, 904, 982` — 미지정 → default false. 쓰기측 교정 불필요 |
| 다운로드 경로 건전 | ✅ 정확 | `files.js:860` + `canAccessFileByLevel`(access_scope.js:404) 확인 |

---

## 1. 판정 요약 (A~H)

| 항목 | 판정 | 근거 한 줄 |
|---|---|---|
| **A** 표시 술어 | **채택** | 권위 = 본문 cid 참조. 단일 술어 `isEmbedded()` 를 읽기·쓰기·백필 3곳 공용. fail-open(의심되면 보여준다) |
| **B** 쓰기측 교정 | **채택 (브리프 안 수정)** | `!!att.related` 각하 → `isEmbedded(cid, parsed.html)` 로 통일. 컬럼 의미를 "본문 삽입(칩 숨김)"으로 단일화 |
| **C** 백필 | **채택** | A 로 표시는 즉시 정상이지만 컬럼이 거짓말하는 상태를 방치하지 않는다. 죽은 코드 활성화 없음을 §6 에서 증명 |
| **D** 미리보기 | **채택** | ImageLightbox 재사용 + **인증 blob→objectURL** (무인증 capability URL 각하 — §4). PDF = blob 새 탭 |
| **E** 다운로드 실패 무표시 | **채택** | 칩 옆 인라인 에러 4초 페이드. `apiFetch no-throw` 계열 봉합 |
| **F** 개인메일 프라이버시 | **채택** | 쓰기측 vlevel/visibility='L1' + **uploader_id=계정 주인**(신규 발견분) + 백필 370건. "자산 임의변경 금지"와의 긴장은 §4-3 에서 정면 판정 |
| **G** 반송헤더 노이즈 | **조건부 채택** | 읽기측 mime denylist 3종 + 쓰기측 File 생성 skip. **옛 974 File row 삭제는 각하** (사용자 가시 자산 삭제 — Irene 별도 승인 필요, 운영 cleanup 옵션으로만 기재) |
| **H** 본문 cid 이미지 | **조건부 채택 (범위 엄격 제한)** | A 채택의 논리적 귀결 — embedded 는 칩에서도 숨으므로 H 없으면 "어디에도 안 보이는" 구멍. sanitizer(#226)·guard CSS(#200) **무접촉** 치환 방식으로만. §5 |
| **I** 리스트 첨부 유무 표시 (원문 재확인으로 추가) | **채택** | #215 원문 "첨부파일 있고 없고도 알기 편하게" = 열기 전 인지. `is_inline` 컬럼(=술어 물질화 캐시) 기반 배치 집계 + **C 백필을 배포 세션 필수 단계로 격상**. §9 |

각하 목록 (각하도 설계 결정):
- **B의 `att.related` 신호** — 위 §0. 술어 분열 유발.
- **미리보기 무인증 capability URL** (task_attachments 선례 복제) — 세금계산서·부가세 납부서가 대상. §4-1.
- **G 옛 974 File row 삭제/soft-delete** — 기계 쓰레기지만 사용자 화면(Q File)에 이미 보이는 자산. memory `feedback_no_user_asset_mutation`. 신규 유입 차단 + 칩 숨김으로 실사용 피해는 0. 운영 정리는 Irene 승인 별건.
- **PDF.js 등 신규 뷰어 라이브러리 도입** — 브라우저 내장 PDF 뷰어(blob 새 탭)로 충분. 신규 의존성·번들 비용 불허.
- **H 의 blob: URL 방식** — sandbox iframe(allow-same-origin 없음 = opaque origin)에서 부모 blob URL 로드는 브라우저별 비보장. `data:` URI 로만 (§5).
- **SVG/HTML 첨부의 iframe·object 렌더** — XSS 표면. §4-2.

---

## 2. 절단면 (변경 지점 전체 — 이 목록 밖 변경 금지)

### 2-1. 백엔드

**[신규] `/opt/planq/dev-backend/services/emailAttachments.js`** — 단일 술어 모듈
```js
// #215 — 첨부 표시 술어 단일 원천. 읽기(email_threads 직렬화)·쓰기(emailImapCron)·백필 3곳 공용.
//   권위는 is_inline 컬럼이 아니라 "본문이 실제 cid 를 참조하는가".
//   오판정 시 안전 방향 = 보여준다 (첨부 소실 ≫ 로고 하나 더 노출).
function normalizeCid(contentId) { /* §3 규정대로 */ }
function isEmbedded(contentId, bodyHtml) { /* §3 규정대로 */ }
const NOISE_MIMES = new Set(['text/rfc822-headers', 'message/delivery-status', 'text/x-amp-html']);
function isNoiseAttachment(mime) { return NOISE_MIMES.has(String(mime || '').toLowerCase().split(';')[0].trim()); }
module.exports = { normalizeCid, isEmbedded, isNoiseAttachment, NOISE_MIMES };
```

**`/opt/planq/dev-backend/services/emailImapCron.js`**
- `:174 saveAttachmentAsFile({ businessId, fromEmail, att, accountUserId })`
  → 시그니처 변경: `saveAttachmentAsFile({ businessId, att, account, fallbackOwnerId })`
  - `const personal = !!account.owner_user_id;`
  - `uploader_id: account.owner_user_id || fallbackOwnerId || null` (**F — 신규 발견분 교정**)
  - `visibility: personal ? 'L1' : 'L3'`, **`vlevel: personal ? 'L1' : 'L3'`** (F — 권위 컬럼 쓰기측 명시. memory `feedback_dual_column_authority_write_side`)
  - **G**: `if (isNoiseAttachment(att.contentType)) return null;` — File 생성 skip (EmailAttachment row 는 유지, file_id=null → 데이터 보존 + 쿼터·Q File 오염 차단)
- `:374-391` 첨부 루프
  - `saveAttachmentAsFile` 호출부에 `account` 전달 (`accountUserId: ownerId` → `account, fallbackOwnerId: ownerId`)
  - `:389` **`is_inline: !!(att.cid || att.contentId)` → `is_inline: isEmbedded(att.contentId || att.cid, parsed.html)`** (B)
- 다른 쓰기 경로 없음 확인 완료: `EmailAttachment.create` 전 저장소 4곳 = cron 1 + 발신 3(default false, 옳음).

**`/opt/planq/dev-backend/routes/email_threads.js`** — GET detail (`:337-430`)
- `:418` 필터 교체 (A + G):
```js
attachments: (mj.attachments || [])
  .filter(a => !isEmbedded(a.content_id, mj.body_html) && !isNoiseAttachment(a.mime_type))
  .map(a => ({ id, file_id, file_name: a.filename, file_size: a.size_bytes, mime_type: a.mime_type })),
// #215-H — 본문 cid 로 삽입된 이미지의 해석 재료. 프론트가 인증 다운로드→data: 치환.
inline_images: (mj.attachments || [])
  .filter(a => a.file_id && String(a.mime_type || '').startsWith('image/') && isEmbedded(a.content_id, mj.body_html))
  .map(a => ({ file_id: a.file_id, content_id: a.content_id, mime_type: a.mime_type, size_bytes: a.size_bytes })),
```
- 이 라우트가 attachments 를 직렬화하는 **유일한** 읽기 지점임을 확인 완료 (grep). 미들웨어 체인(`authenticateToken + checkBusinessAccess + requireMenu('qmail','read')` + `accessibleAccountIds`) 무변경.

**[신규] `/opt/planq/dev-backend/scripts/backfill-215-email-attachments.js`** — C + F 통합 백필 (§6)

### 2-2. 프론트엔드

**`/opt/planq/dev-frontend/src/pages/QMail/MailPage.tsx`**
- `:209` `Message` 타입 — `inline_images?: Array<{ file_id: number; content_id: string | null; mime_type: string; size_bytes: number | null }>` 추가
- `:247 buildMailSrcDoc(id, html)` → `buildMailSrcDoc(id, html, cidMap?: Record<string, string>)` — sanitize **이후** 문자열 치환 (H, §5). guard CSS·resize 스크립트·base 주입 로직 무변경.
- `:1262 downloadAttachment` — E: `catch` 에서 `setAttachErr(prev => ({...prev, [attId]: true}))` + 4초 후 해제. 조용한 삼킴 제거.
- [신규 로직, MailPage 내부] `previewAttachment(m, a)`:
  - `image/*` + file_id → 그 메시지의 이미지 칩 전부를 인증 fetch(blob→objectURL) 후 `useImageLightbox().open(items, clickedIdx)`
  - `application/pdf` + file_id → blob→objectURL→새 탭. `isNativeApp()` 이면 새 탭 없이 바로 다운로드.
    **★ 설계 정정 (2026-08-02, 구현 게이트 FAIL 로 발견):** 초안은 `window.open(url,'_blank','noopener')` 의
    반환 null 을 팝업 차단 신호로 쓰라고 규정했으나, **`noopener` 를 주면 성공해도 항상 null 이 반환된다**(스펙).
    그대로 만들면 PDF 를 열 때마다 폴백이 같이 발화해 "새 탭 + 원치 않는 다운로드" 가 된다(Chromium 실측).
    → `window.open(url,'_blank')` 로 열고 핸들에서 `w.opener = null` 로 끊는다. blob URL 은 우리가 만든
    same-origin 자산이라 opener 노출 위험이 없다. 이때의 `!w` 만이 진짜 팝업 차단이다.
  - 그 외 → 기존 `downloadAttachment`
  - objectURL 캐시 `useRef<Map<number,string>>`; **revoke 시점**: activeId(스레드) 변경 시 + unmount 시 전량 revoke, PDF 새 탭용은 open 후 60초 지연 revoke
  - per-file 캡: 15MB 초과 이미지·PDF 는 미리보기 대신 다운로드 폴백 (size_bytes 로 사전 판정, fetch 전 차단)
- `:1929-1943` 칩 렌더 — 칩 본체 클릭=미리보기/다운로드 분기, 칩 우측에 다운로드 아이콘 버튼(이미지·PDF 만) 추가. `data-testid="mail-attach-chip"` / `"mail-attach-download"` (§17 네이밍 `{화면}-{동작}`)
- [신규 로직] H: detail 로드 후 `m.inline_images` 있는 메시지만 — 각 이미지 인증 fetch → `FileReader.readAsDataURL` → `msgCidData[m.id] = { [normalizedCid]: dataUri }` state → `buildMailSrcDoc` 재계산(srcDoc 교체 → iframe 재로드 → 기존 resize 스크립트가 높이 재보고). 캡: per-file 4MB, 메시지당 합계 10MB, 초과분은 skip(현상 유지 = broken img).

**`/opt/planq/dev-frontend/src/pages/QMail/MailPage.styles.ts`** (`:533-546` 인접)
- `AttachErr`(인라인 에러 텍스트, `role="status"`, #B91C1C 계열), 칩 내 다운로드 아이콘 버튼 스타일. 기존 `Attachment` 칩 스타일 위계 유지 — bespoke 신규 디자인 금지 (memory `feedback_copy_existing_design_not_bespoke`).

**i18n** — `/opt/planq/dev-frontend/public/locales/{ko,en}/qmail.json`
- `attachment.preview`(미리보기/Preview), `attachment.download`(내려받기/Download — 기존 t() 폴백 사용 중이면 키 박제), `attachment.downloadFailed`(내려받기에 실패했어요/Download failed), `attachment.tooLargePreview`(파일이 커서 바로 내려받아요/Too large to preview — downloading)
- `i18n.ts` ns 배열은 qmail 기등록 — 변경 없음.

### 2-3. 명시적 무변경 (경계 밖)

- `utils/sanitizeHtml.ts` — **한 글자도 건드리지 않는다** (#226 재발 차단의 제1 방어선)
- `buildMailSrcDoc` 의 guard CSS 블록(`:259-262`) — #200 보존
- `routes/files.js` download 라우트·`access_scope.js` — 무변경 (기존 게이트를 그대로 쓰는 것이 D 설계의 핵심)
- EmailAttachment 모델·DB 스키마 — **컬럼 추가·변경 없음** (마이그레이션 = 데이터 백필만)
- 발신 3경로(`email_threads.js:780/904/982`) — 무변경
- ImageLightbox / DetailDrawer / download.ts — 무변경 (소비만)

---

## 3. `isEmbedded` 술어 — 정확한 규정

```js
// 입력: contentId — email_attachments.content_id 원문 (예: '<f_mryqchgg0>', null 가능)
//       bodyHtml  — email_messages.body_html 원문 (null 가능)
// 출력: true = 본문에 삽입된 첨부 → 칩 목록에서 숨김 / false = 일반 첨부 → 표시
function normalizeCid(contentId) {
  if (!contentId) return '';
  return String(contentId).trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase();
}
function isEmbedded(contentId, bodyHtml) {
  const cid = normalizeCid(contentId);
  if (!cid || !bodyHtml) return false;                     // 판단 재료 없음 → 보여준다
  const body = String(bodyHtml).toLowerCase();
  if (body.indexOf('cid:' + cid) !== -1) return true;      // src="cid:x" / src='cid:x' / src=cid:x / url(cid:x) 전부 커버
  try {                                                     // URL 인코딩 변형 (dev 실측 0건이지만 방어)
    const enc = encodeURIComponent(cid);
    if (enc !== cid && body.indexOf('cid:' + enc) !== -1) return true;
  } catch { /* malformed — fail-open */ }
  return false;
}
```

경계 전수 규정:

| 경계 | 동작 | 근거 |
|---|---|---|
| `content_id` NULL/빈문자 | false (표시) | 판단 불가 → fail-open |
| `body_html` NULL (text-only 메일) | false (표시) | 본문이 못 그리는 첨부를 숨기면 소실 |
| 꺾쇠 `<x>` / 무꺾쇠 | 정규화로 동일 취급 | dev 실측: 2,114건 전건 꺾쇠 포함 저장 |
| 대소문자 | 양측 lowercase 비교 | RFC 상 cid 는 case-sensitive 지만, 오판정 방향이 "숨김→표시"가 되도록 관대 비교. false-positive(대소문자만 다른 cid 가 우연 일치→숨김)는 이론상 존재하나 같은 메일 안에서 대소문자만 다른 두 cid 는 실무상 0 |
| 인용부호 3형 (`"` `'` 무인용) | substring 검사라 무관 | 정규식 미사용 → **메타문자 이스케이프 문제 원천 소거** (cid 에 `.` `$` `+` 가 흔함) |
| URL 인코딩 (`%40` 등) | encodeURIComponent 변형 추가 검사 | dev 실측 0건, 방어적 |
| 같은 cid 다중 참조 | substring 1회 매치로 충분 | |
| 본문에 `cid:` 는 있는데 이 첨부와 불일치 | false (표시) | 첨부별 독립 판정. dev 실측: cid 보유 본문의 첨부 29건 중 6건만 매치 — 나머지 23건은 표시가 옳다 |
| is_inline 컬럼 값 | **참조하지 않는다** | 옛 2,114행이 백필 없이도 즉시 정상 표시되는 이유. 컬럼은 파생·참고용 (memory `feedback_derived_field_not_source_of_truth` 와 정합) |

**오판정 안전 방향 판정: fail-open(보여준다)이 옳다.** 근거 — false-negative(숨겨야 할 로고를 표시)의 비용은 칩 1개 노이즈, false-positive(보여야 할 세금계산서를 숨김)의 비용은 **문서 소실 = 이번 #215 그 자체**. 모든 불확실 분기는 false 로 떨어지게 설계했다.

**같은 술어의 3 착지점** (분열 금지):
1. 읽기 — `email_threads.js` detail 직렬화 필터
2. 쓰기 — `emailImapCron.js` `is_inline` 계산 (parsed.html 을 그대로 인자로)
3. 백필 — `backfill-215-email-attachments.js` 재계산

B 가 A 있이도 필요한 이유: ① 컬럼이 계속 거짓을 쓰면 미래의 어떤 신규 코드가 컬럼을 믿는 순간 같은 사고 재발 (memory `feedback_backfill_needs_write_side_fix` — 쓰기측 전 경로 먼저) ② 목록 화면에 "첨부 있음" 뱃지 등을 달 때 본문 로드 없이 컬럼으로 판정할 수 있는 기반.

---

## 4. 보안 결정

### 4-1. 미리보기 전달 방식 = **인증 blob → objectURL** (확정)

| 방식 | 판정 | 근거 |
|---|---|---|
| 무인증 capability URL (task_attachments `public/attach/:storedName` 선례 복제) | **각하** | 대상이 세금계산서·부가세 납부서·매입매출장. capability URL 은 로그 파일·브라우저 히스토리·프록시에 남고, 만료가 없다. 재무 문서에 "추측 불가"만으로는 부족. 선례가 있다는 것이 확대의 근거가 되지 않는다 |
| 신규 인증 preview 라우트 | 각하 | 기존 download 라우트가 이미 `authenticateToken + attachWorkspaceScope + canAccessFileByLevel` 전 게이트 통과 후 mime/Content-Disposition 을 준다. 신규 라우트 = 신규 보안 표면 + 권한 검사 중복 구현 위험. 불필요 |
| **apiFetch → blob → `URL.createObjectURL`** | **채택** | 신규 엔드포인트 0, 권한 게이트는 검증 완료된 기존 경로 그대로, URL 은 탭 수명 내 임시. F(L1) 백필 후에도 자동으로 같은 게이트를 탄다 |

### 4-2. SVG·HTML 첨부 렌더 정책

- **SVG**: `<img>` 컨텍스트로만 (ImageLightbox 는 `<img>` 렌더 — 스크립트 비실행 컨텍스트). `<iframe>`·`<object>`·직접 DOM 삽입 **금지**. H 의 data: 치환도 최종적으로 iframe 내 `<img src="data:image/svg+xml...">` — sandbox(allow-scripts 는 있으나 img 컨텍스트라 SVG 내 script 비실행) + opaque origin 이중 격리.
- **HTML/x-amp-html 첨부**: 렌더하지 않는다. text/html 첨부(9건)는 칩=다운로드만, text/x-amp-html 은 G denylist 로 숨김.
- **미리보기 대상 화이트리스트**: `image/*`(lightbox) + `application/pdf`(blob 새 탭, 브라우저 내장 뷰어 = 별도 origin sandbox). 그 외 전부 다운로드. mime 은 저장된 DB 값 기준 — 서버 download 응답의 Content-Type 도 같은 값이라 sniffing 불일치 없음.

### 4-3. F — 개인 메일 첨부 프라이버시 (판정 기준 + 회귀 긴장 정면 판정)

**판정 축**: `email_accounts.owner_user_id IS NOT NULL` = 개인 계정 (모델 주석 실확인: "NULL = 회사 공용, set = 개인(본인만 접근)"). 스레드·메시지는 이미 `accessibleAccountIds()` 가 이 축으로 격리 중 — **파일만 새는 반쪽 상태**다.

**쓰기측 (신규 수신)**: §2-1. vlevel+visibility 동시 'L1' 명시 + uploader_id=계정 주인. `canAccessFileByLevel` 실코드 확인 — L1 은 `uploader_id === userId` 만 통과하므로 **uploader 교정 없이는 L1 이 계정 주인 접근을 끊는다** (브리프 누락분, 이 설계의 필수 결합).

**백필 (옛 370건, 계정 32)**: "지금 보이던 파일이 갑자기 사라지는" 회귀 vs "사용자 자산 임의변경 금지" — 정면 판정:
- 이것은 자산 변경이 아니라 **보안 누출 봉합**이다. 메일 본문·스레드는 이미 본인 외 접근 불가인데 그 첨부만 워크스페이스 전 멤버의 Q File 에 노출 — 사용자(계정 주인)가 의도한 적 없는 상태다. memory `feedback_dual_column_authority_write_side` 가 기록한 실사고("개인파일 전멤버 노출 재발")와 동일 계열이며, 그 사고의 처방도 백필이었다.
- 파일 내용·이름·소속은 불변, **접근 범위만 메일과 정합**하게 좁힌다. 계정 주인에게는 계속 보인다.
- dev 실측: biz 3 owner=user 3=계정 32 주인 → uploader_id 변경 0건, vlevel/visibility 만 L3→L1 370건.
- 운영 적용 시 대상·건수를 dry-run 리포트로 먼저 뽑아 Irene 에게 보인 뒤 apply (운영 DB 백필은 어차피 고위험 게이트 절차 — CLAUDE.md Fable 게이트 3단).
- 조건: **회사 계정(owner_user_id NULL) 첨부는 절대 건드리지 않는다** (WHERE 절로 봉쇄, 검증 항목).

---

## 5. H — 본문 cid 이미지 위험 판정

**손댈 가치 판정: 있다 — 단, A 채택의 귀결로서만.** 6건이라는 숫자만 보면 각하감이지만:
1. A 술어가 embedded 첨부를 칩에서 숨기는 순간, 본문이 cid 를 못 그리면 그 첨부는 **어디에도 안 보인다**. A 와 H 는 논리적 한 몸이다.
2. 향후 유입 관점 — Apple Mail 인라인 스크린샷·서명 로고는 multipart/related+cid 의 일상 패턴. 지금 6건은 dev 표본이 작을 뿐이다.
3. 실측 정정: 6건 전부 SVG 로고 — "세금계산서가 안 보인다" 류의 위험은 H 와 무관 (그건 A 가 해결).

**#226/#200 무회귀 방식 (핵심 제약)**:
- `sanitizeHtml.ts` **무접촉**. `MAIL_URI_RE` 는 이미 `cid:` 를 통과시키므로 정화 결과에 cid 참조가 보존된다.
- 치환은 `buildMailSrcDoc` 안, **`sanitizeMailHtml(html)` 호출 이후의 순수 문자열 치환**: `safe.split('cid:' + cid).join(dataUri)` 형태(정규식 미사용, 대소문자 변형은 사전 소문자 스캔으로 원문 표기 추출 후 치환). guard CSS(#200 블록)·resize 스크립트·base 주입 앞단에서 수행, 그 로직들은 무변경.
- data: URI 는 `data:image/...` — MAIL_URI_RE 허용 패턴과 정합(재정화 없음이므로 사실상 무관하나 의미 정합 확인용).
- blob: URL 각하 — sandbox iframe(opaque origin)에서 부모 blob 로드는 브라우저별 비보장. data: 는 전 브라우저 보장.

**무회귀 증명 (구현 게이트에서 실행)**:
1. 고정 픽스처: `align="center"`·`width="600"`·`colspan="2"`·`height` 지정 img 를 포함한 실 메일 HTML(#226 재현 표본) → 변경 전/후 `buildMailSrcDoc` 출력 diff = **cid 치환 외 0 byte** (cidMap 미전달 시 완전 동일).
2. 실 메시지 회귀: msg 1376(biz 5, SVG cid 참조)·#226 당시 검증했던 실 운영 메일 1건 — 렌더 후 align/width 속성 수 grep 대조.
3. 반증: 치환 로직에 일부러 `sanitizeMailHtml` 앞 치환을 넣으면 픽스처 diff 검사가 FAIL 하는지 확인 (가드가 잡는 것 증명).

**실패 시 동작**: fetch 실패·캡 초과 → cidMap 에 미기재 → cid 원문 잔존 → broken img (현상 유지). 이때 칩에서도 숨겨져 있는 잔여 구멍은 수용한다(6건 전부 장식 SVG 실측, 재무 문서는 A 가 이미 칩으로 복원).

---

## 6. 마이그레이션·백필 절차

스키마 변경 **없음**. 데이터 백필만 — `scripts/backfill-215-email-attachments.js`, 두 파트:

**Part C — is_inline 재계산 (전 3,221행)**
```sql
-- 원리: is_inline := isEmbedded(content_id, body_html)  (JS 루프, 술어 모듈 require)
-- 예상: 2,114 → 6 만 1 유지, 2,108행 1→0. is_inline=0 행 중 0→1 은 0건 예상(관찰 항목)
UPDATE email_attachments SET is_inline = ? WHERE id = ?   -- raw SQL: updated_at 미변경 (Sequelize timestamps 우회)
```

**Part F — 개인 계정 첨부 L1 전환**
```sql
-- 대상: email_accounts.owner_user_id IS NOT NULL 계정의 스레드→메시지→첨부→file_id
UPDATE files SET vlevel='L1', visibility='L1', uploader_id=:acctOwner
 WHERE id IN (:ids) AND business_id=:biz          -- 멀티테넌트 명시
   AND vlevel='L3'                                 -- 멱등 가드: 이미 L1/사용자가 바꾼 값은 불변
-- dev 예상: 370행 (계정 32, biz 3). uploader_id 변경 0건 (이미 owner=3)
```

절차 규정:
1. **dry-run 기본** (`--apply` 없이는 카운트·대상 id 리포트만). apply 전 `backups/{TIMESTAMP}/215-affected.json` 에 대상 row 의 변경 전 값 전체 저장 (**롤백 경로** — 역방향 UPDATE 스크립트 동봉).
2. **멱등 실측 의무**: apply → 재실행 → **변경 0** 을 로그로 증명 (memory `feedback_mysql_json_key_reorder` — stringify 비교 함정 없음: 여기는 스칼라 컬럼뿐).
3. `updated_at` 보존: 양 파트 모두 raw SQL. Part F 는 `files.updated_at` 이 목록 정렬에 쓰일 수 있으므로 필수.
4. **죽은 코드 활성화 점검** (C 가 여는 표면): 백필 후 `is_inline` 을 읽는 코드는 **교체된 detail 필터 1곳뿐이며 그마저 술어로 대체됨** — grep 실측으로 재확인했다(§0). 즉 C 는 어떤 휴면 경로도 켜지 않는다. Part F 는 `fileListWhereByLevel` 의 L1 분기(기존 가동 코드)를 타게 되는데, 이는 의도된 효과 그 자체다.
5. **운영 적용 순서**: ① 코드 배포(A/B/D/E/G/H — 이 시점부터 표시 정상+신규 수신 정상) → ② dry-run 리포트 → ③ Irene 확인 → ④ apply → ⑤ 멱등 재실행 0건 확인 → ⑥ 표본 재조회. 코드가 먼저인 이유: 읽기 권위가 본문 참조라 백필 전에도 화면은 이미 옳고, 백필 전 새 수신이 옛 로직으로 쌓이는 것을 차단.

---

## 7. 검증 계획 (구현·테스트 게이트 = Fable 이 실행)

계정: `health-check@planq.kr` / `HealthCheck2026!` (biz 5, 73). 패턴: `node test-215.js` → 검증 후 삭제.

**실 HTTP 시나리오** (login → 호출 → 값 대조):
| # | 시나리오 | 기대 |
|---|---|---|
| 1 | att 1222(PDF, biz 5, 옛 is_inline=1) 소속 스레드 GET detail | `attachments` 에 **출현** (옛 데이터 sample 필수 — memory `feedback_legacy_data_sample_verify`) |
| 2 | msg 1376(biz 5, SVG cid 참조) GET detail | `attachments` 에 att 2008 **부재** + `inline_images` 에 file_id·content_id 존재 |
| 3 | rfc822-headers 974건 중 biz 5 표본 스레드 | 해당 칩 부재 (G) |
| 4 | GET `/api/files/5/{fid}/download` (att 1222 의 file) | 200 + application/pdf + 바이트 수 일치 (D 의 게이트 경로 생존) |
| 5 | health-check(biz 5) 토큰으로 GET `/api/files/3/{biz3 fid}/download` | 403/404 (멀티테넌트 격리) |
| 6 | 백필 후: biz 3 개인 파일 표본 — `canAccessFileByLevel(user 3, file)` = true / 타 사용자 스코프 = false (biz 3 에 제2 멤버 실계정 없으면 스크립트로 스코프 함수 실측) + `GET /api/files/3` 목록 쿼리 실행 | 소유자만 잔존 (F) — 회사 계정(14) 파일 L3 불변 SELECT 대조 |
| 7 | 경계: content_id NULL 첨부 1건 + body_html NULL(text-only) 메일 1건 | 둘 다 칩 표시 (fail-open) |
| 8 | 신규 수신 실검증: 계정 32 로 첨부 메일 자연 수신(IDLE) 후 File row | `vlevel='L1'` + uploader=3 + noise mime 이면 file_id NULL |

**반증 테스트** (memory `feedback_guard_must_be_falsified` — 되돌리면 FAIL 나는가):
- test-215.js 의 시나리오 1·2 는 **수정 전 코드에서 실행 시 FAIL** 임을 커밋 전에 실측한다 (git stash 로 원복→실행→FAIL 확인→재적용→PASS). #1 은 이미 현행 FAIL 이 실측된 상태.
- H 픽스처 diff 가드도 §5-3 반증 수행.

**UI/프론트**:
- 2탭 실시간(§16): 첨부 표시는 detail fetch 기반이라 신규 broadcast 불요 — 기존 `message:new` 경로 무변경 확인만.
- 미리보기: 이미지 칩 → lightbox 열림·Esc·백드롭 닫기 / PDF 칩 → 새 탭 blob / 15MB 초과 → 다운로드 폴백 / 다운로드 실패 시 인라인 에러 표시(네트워크 차단으로 재현).
- objectURL 누수: 스레드 3회 전환 후 `performance`/수동 확인으로 revoke 호출 확인 (코드 리뷰 + 로그).

**가드 3축 + 빌드**:
- `node scripts/health-check.js` / `node scripts/guard-invariants.js` (i18n·parity 래칫 포함 — 신규 키 ko/en 동시) / tenant 점검
- `cd /opt/planq/dev-frontend && npm run build` — run_in_background, heap 4096, **실 exit 0 + error TS 0** (tail 파이프 금지)

---

## 8. 리스크·누락 (Opus 브리프에 없던 것)

1. **uploader_id=biz.owner_id 결함** (§0 신규 발견) — F 를 vlevel 만 고치면 개인 계정 주인이 자기 첨부에서 차단되는 2차 사고. 이 설계는 uploader 교정을 F 의 필수 결합으로 박았다.
2. **A↔H 결합 구멍** — embedded 판정 + 본문 렌더 실패 시 첨부가 완전 소실. §5 에서 명시 수용(대상이 장식 SVG 뿐임을 실측)했고, 재무 문서류는 본문 미참조라 A 가 칩으로 복원하므로 실피해 0.
3. **forward 상호작용** — `startForward`(:1289) 가 `m.attachments.length` 를 세므로 G/A 필터 후 개수가 달라진다. 이는 옳은 방향(노이즈·본문 로고를 전달 첨부로 세지 않음)이며 forward 발송 자체는 `attachment_file_ids` 기반이라 무영향. 구현 시 별도 처리 불요 — 인지만.
4. ~~thread 목록 라우트는 첨부를 직렬화하지 않음 — 목록 뱃지류 신설은 이번 범위 밖~~ → **§9 로 채택 전환.** #215 운영 원문("첨부파일 있고 없고도 알기 편하게") 재확인 결과 리스트 첨부 표시는 요구사항 본문이다. C 백필로 컬럼이 정직해진 것이 §9 의 데이터 전제가 된다.
5. **G 신규 수신의 file_id NULL 칩** — denylist 로 칩 자체가 숨으므로 사용자 노출 없음. EmailAttachment row 는 남아 원본 재구성 가능성 보존.
6. **번들·성능** — 신규 의존성 0. H 의 data: URI 는 srcDoc 문자열을 키우지만 메시지당 10MB 캡 + 대상 메시지 1.2%(36/3,005) 라 무시 가능.
7. **미래 유입 경로** — Microsoft Graph 등 신규 메일 ingestion 이 생기면 `EmailAttachment.create` 시 반드시 `services/emailAttachments.isEmbedded` 를 쓰도록 이 문서를 참조할 것 (술어 분열 금지).

---

## 9. I — 리스트 첨부 유무 표시 (설계 증분, 2026-08-02)

**배경**: 운영 원문(#215, `planq_prod_db.feedback_items`) 재확인으로 드러난 요구 — "**첨부파일 있고 없고도 알기 편하게**" = 메일을 열기 전, 스레드 리스트에서 첨부 유무 인지. §8-4 의 "범위 밖" 판정을 철회하고 채택한다. A~H 구현(재게이트 PASS)은 무변경 — 이 절은 순수 증분이다.

### 9-1. 핵심 판정 — 리스트 술어 = `is_inline` 컬럼 (물질화 캐시), 백필은 배포 세션 필수로 격상

세 후보를 판정했다:

| 후보 | 판정 | 근거 |
|---|---|---|
| ① `is_inline=0` 기반 계수 | **채택** | B(쓰기)+C(백필) 이후 `is_inline` 은 **detail 과 동일한 술어 `isEmbedded` 의 물질화 캐시**다 (§3 의 3 착지점이 이걸 위해 설계됨). 리스트 클립 ↔ detail 칩이 **정의상 일치** — 클립 보고 열었는데 칩이 없는 배신이 구조적으로 불가능 |
| ② fail-open 계수 (`is_inline` 무시) | **각하** | dev 실측: content_id 보유 2,114건의 대부분이 뉴스레터 로고 PNG(2,078). 무시하면 **로고만 든 마케팅 메일 대부분에 클립이 뜬다** → 신호가 소음이 되어 "알기 편하게"라는 요구 자체가 죽는다. fail-open 원칙(§3)은 "문서 소실 방지"용이지 "신호 가치 파괴"까지 정당화하지 않는다 |
| ③ SQL 에서 body_html cid 참조 실시간 판정 | **각하** | 리스트 요청마다 첨부×본문 LIKE 스캔(뉴스레터 body 수백 KB × 페이지당 수백 첨부) — 목록은 최다 호출 라우트다. 캐시(①)가 정확히 이 비용을 없애려고 존재한다 |

**배포 순서 충돌의 해소 — §6-5 개정**: ① 채택의 대가는 백필 의존이다. 코드 배포~백필 사이 창에서 옛 2,114행이 뱃지 미표시(방향이 #215 의 죄와 동일)가 되므로:

> **§6-5 개정판**: C 백필은 "후속 데이터 정리"가 아니라 **리스트 표시의 데이터 전제**다. 운영 배포 시 ① dry-run 리포트·Irene 확인은 **배포 전** 완료(dev apply 실측 수치 — 2,108행 C + 370행 F — 로 갈음 가능) ② 배포 세션 안에서 **코드 반영 직후 즉시 `--apply` 실행 + 멱등 재실행 0건 확인**을 **배포 완료 조건**에 포함한다. 백필 미실행 상태로 세션을 끝내는 것은 부분 배포다 (memory `feedback_deploy_timeout_partial_state` 계열 — 반드시 완주).
>
> 순서가 "코드 먼저"인 이유: 코드 배포 후 창에서 유입되는 신규 메일은 **새 쓰기 로직(B)** 으로 기록되므로 잔여물이 없다. 역순(백필 먼저)이면 창의 유입분이 옛 로직으로 오염되어 재실행이 필요해진다. 남는 창은 "옛 스레드의 뱃지가 수 분간 안 뜸"뿐이며 백필 완주로 해소된다. dev 는 이미 apply 완료 — 리스트 라우트는 즉시 정확하다.

### 9-2. 응답 필드 — `attachment_count: number`

- boolean 이 아니라 **개수**로 내린다: SQL 비용 동일(COUNT), aria-label 에 개수 명시 가능, 향후 확장 여지. **화면에는 숫자를 그리지 않는다** — 좁은 행에서 클립 아이콘만 (Gmail 관례). 개수는 aria-label·title 로만.
- 집계 술어 = detail 칩 필터의 컬럼 판(§2-1 과 정합):
  `is_inline = 0 AND file_id IS NOT NULL AND mime ∉ NOISE_MIMES` (mime NULL 은 계수 — fail-open).
  `file_id IS NOT NULL` 인 이유: file 없는 칩은 detail 에서도 비활성이며, G 신규 노이즈 row 가 file_id NULL 로 남기 때문. 단 **legacy 노이즈 974건은 file_id 가 있으므로** mime 조건이 별도로 필요하다.

### 9-3. 절단면 (백엔드)

**`/opt/planq/dev-backend/routes/email_threads.js`** — 목록 라우트, 기존 배치 집계 선례(`:228-256` lastInbound/lastOut 패턴) 옆에 동일 패턴 추가:

```js
// #215-I — 첨부 유무 배치 집계. is_inline 은 isEmbedded 술어의 물질화 캐시(설계 §3·§9-1)
//   — B(쓰기)+C(백필)로 detail 칩 필터와 정의상 일치. N+1 없음 (threadIds 1 쿼리).
const attachCountByThread = new Map();
if (threadIds.length > 0) {
  const attRows = await sequelize.query(
    `SELECT em.thread_id, COUNT(*) AS cnt
       FROM email_attachments ea
       JOIN email_messages em ON em.id = ea.message_id
      WHERE em.business_id = :bid AND em.thread_id IN (:ids)
        AND ea.is_inline = 0
        AND ea.file_id IS NOT NULL
        AND (ea.mime_type IS NULL OR LOWER(ea.mime_type) NOT IN (:noise))
      GROUP BY em.thread_id`,
    { replacements: { bid: businessId, ids: threadIds, noise: [...NOISE_MIMES] }, type: sequelize.QueryTypes.SELECT }
  );
  for (const r of attRows) attachCountByThread.set(r.thread_id, Number(r.cnt) || 0);
}
```
- `NOISE_MIMES` 는 `services/emailAttachments.js` 에서 require (§2-1 모듈 — 목록/상세 denylist 분열 금지).
- `em.business_id = :bid` — 멀티테넌트 이중 잠금 (threadIds 가 이미 acctIds 스코프지만 belt-and-suspenders).
- 신규 인덱스 불요: `email_attachments_message`(message_id) + email_messages 의 thread_id 경로로 충분. 페이지당 스레드 ≤ limit 이라 상수 규모.
- `data = rows.map(...)` (`:258-290`) 반환 객체에 1줄: `attachment_count: attachCountByThread.get(obj.id) || 0,`

### 9-4. 절단면 (프론트엔드)

**`/opt/planq/dev-frontend/src/pages/QMail/MailPage.tsx`** — 순증 **약 +7줄** (현재 2,129 / 임계 2,210 — 여유 내):
- Thread 타입(`:182` 인접)에 `attachment_count: number;` 1줄
- 리스트 행 `ThreadRow1Right`(`:1580`) — **StarSpan 앞**에 클립 표시 (제목 줄을 안 먹어 좁은 행·모바일에 안전):
```tsx
{mt.attachment_count > 0 && (
  <ListClip
    role="img"
    data-testid="mail-thread-attach"
    aria-label={t('thread.attachments', { count: mt.attachment_count }) as string}
    title={t('thread.attachments', { count: mt.attachment_count }) as string}
  ><ClipIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></ClipIcon></ListClip>
)}
```
  (D 절단면에서 첨부 칩 SVG path 를 상수·공용 컴포넌트로 뽑았다면 그걸 재사용 — path 리터럴 2중화 금지.)

**`/opt/planq/dev-frontend/src/pages/QMail/MailPage.styles.ts`** — `ListClip` 신규 (기존 뱃지 위계와 동일 톤, bespoke 금지):
```ts
export const ListClip = styled.span`
  display: inline-flex; align-items: center; flex-shrink: 0;
  color: #94A3B8;                       /* ThreadTime 과 동일 slate — 정보성 아이콘, 강조 아님 */
  & > svg { width: 13px; height: 13px; }
`;
```
- 위치·형태 근거: 행은 이미 발신자/별표/시각(1행) + 제목(2행) + 프리뷰 + 상태칩들로 밀도가 높다. 클립은 **1행 우측 메타 영역**(별표 왼쪽)에 13px 회색 — UnreadDot·SentTag·FollowUpChip 등 기존 신호 위계(강조 칩은 하단, 메타는 우상단)와 충돌하지 않는다.
- 모바일(≤640px, #204 손본 영역): 클립은 `flex-shrink: 0` 13px+gap ≈ 17px 만 차지하고 제목 줄과 무관 — 발신자명(flex 축소 측)만 미세 축소. 검증 §9-6 에서 375px 실측.

**i18n** — `/opt/planq/dev-frontend/public/locales/{ko,en}/qmail.json`:
- ko: `"thread": { "attachments": "첨부 {{count}}개" }` / en: `"attachments_one": "{{count}} attachment"`, `"attachments_other": "{{count}} attachments"` (i18next plural). 가드 parity 래칫 통과 필수.

**실시간(§16)**: 신규 broadcast 불요 — attachment_count 는 리스트 응답에 실려 오고, 기존 `message:new` → silentLoad 경로가 갱신을 커버한다. 신규 socket 이벤트 추가 금지 (범위 밖).

**god-file 래칫 비상 지침**: I 의 MailPage.tsx 순증은 ~7줄로 여유(80줄) 내다. 만에 하나 A~H 잔여 조정과 합쳐 2,210 을 넘기면 — 래칫 baseline 갱신으로 도망가지 말고 — **리스트 행 블록(`:1560-1693` ThreadItem 전체)을 `src/pages/QMail/MailThreadRow.tsx` 로 추출**한다(props: `mt, active, unread, handled, folder, dismissingId` + 핸들러 5종. 부모 전달 props 는 memory `feedback_props_useMemo` 준수). 추출 경계는 이 블록으로 한정 — 다른 분리 임의 수행 금지.

### 9-5. 명시적 무변경 (I 의 경계)

- detail 라우트·A 술어·백필 스크립트 — 무변경 (I 는 소비자)
- 목록 화면에 개수 숫자·파일명·mime 아이콘 렌더 — 하지 않는다
- 신규 인덱스·스키마 변경 — 없음
- `folderWhere`·검색·페이지네이션 로직 — 무변경

### 9-6. 검증 계획 (I)

실 HTTP (`health-check@planq.kr`, biz 5 — test-215.js 에 시나리오 추가):
| # | 시나리오 | 기대 |
|---|---|---|
| I-1 | GET 목록(folder=all) → att 1222(옛 is_inline=1 PDF, 백필로 0) 소속 스레드 | `attachment_count ≥ 1` — **옛 데이터 sample** 이자 "#215 죄의 역전" 증명 |
| I-2 | 첨부가 embedded SVG 뿐인 스레드(msg 1376 소속 — SQL 로 사전 선별해 그 스레드의 전 첨부가 embedded/노이즈뿐임을 확인) | `attachment_count = 0` (클립 없음 — 신호 가치 보존) |
| I-3 | rfc822-headers(legacy, file_id 有)만 있는 스레드 | `attachment_count = 0` (mime denylist 가 legacy 974 를 잡는지) |
| I-4 | **정합 불변식**: 목록 표본 10개 스레드에 대해 `attachment_count` == 같은 스레드 GET detail 의 `attachments[]` 길이 합 | 전건 일치 — 컬럼 캐시가 술어에서 표류하면 여기서 깨진다 (드리프트 카나리) |
| I-5 | 경계: mime_type NULL 첨부 | 계수됨 (fail-open) |
| I-6 | 375px 뷰포트(하니스 mobile suite) — 클립 표시 행 | 시각 잘림·행 높이 변형 없음 (#204 회귀 없음) |

반증 (memory `feedback_guard_must_be_falsified`):
- I-1 은 **백필 revert 상태(is_inline=1 복원 표본 1행)에서 실행 시 FAIL** 임을 확인 — 백업 JSON 으로 att 1222 한 행만 역적용 → 테스트 FAIL → 재적용 → PASS (백필 의존성이 실재함을 증명).
- I-2 는 SQL 의 `is_inline=0` 조건을 뺀 변형으로 실행하면 FAIL(뉴스레터에 클립) — 커밋 전 1회 실측.

가드: `guard-invariants.js` 전 카테고리(i18n·parity·god-file 래칫 포함) + `health-check.js` + 프론트 빌드 실 exit 0.
