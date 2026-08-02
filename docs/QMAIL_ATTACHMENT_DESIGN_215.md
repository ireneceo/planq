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
  - `application/pdf` + file_id → blob→objectURL→`window.open(url, '_blank', 'noopener')`; 반환 null(팝업 차단) 또는 `isNativeApp()` 이면 `downloadBlob` 폴백
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
4. **thread 목록 라우트는 첨부를 직렬화하지 않음** (grep 실측) — 목록 뱃지류 신설은 이번 범위 밖. C 백필로 컬럼이 정직해졌으므로 향후 필요 시 컬럼 기반 확장이 가능해진 상태.
5. **G 신규 수신의 file_id NULL 칩** — denylist 로 칩 자체가 숨으므로 사용자 노출 없음. EmailAttachment row 는 남아 원본 재구성 가능성 보존.
6. **번들·성능** — 신규 의존성 0. H 의 data: URI 는 srcDoc 문자열을 키우지만 메시지당 10MB 캡 + 대상 메시지 1.2%(36/3,005) 라 무시 가능.
7. **미래 유입 경로** — Microsoft Graph 등 신규 메일 ingestion 이 생기면 `EmailAttachment.create` 시 반드시 `services/emailAttachments.isEmbedded` 를 쓰도록 이 문서를 참조할 것 (술어 분열 금지).
