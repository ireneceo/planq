# PlanQ 세션 상태

**마지막 업데이트:** 2026-09-05 15:35 UTC
**작업 상태:** 완료 (working tree clean · 운영 배포 5회 · Fable 게이트 전부 통과)
**최근 커밋:** `4baee9f0`

---

## 오늘 운영에 나간 것 (배포 5회)

| 커밋 | 내용 |
|---|---|
| `9a6062ae` | Q docs 상세 **헤더 2줄** + ⋯ 메뉴 · 자동저장 억제 · 목록 날짜 이름 · 공개범위 기본값 |
| `70bdd775` | **유실 회귀 긴급 수정** — 툴바로만 한 편집이 통째로 사라졌다 |
| `05ba5d9f` | AI 가 써 준 글이 손대지 않으면 사라지던 것 |
| `784017ef` | 로그인→홈 링크 · 랜딩 상단 **앱 다운로드** · **zip 목록** · **새 탭에서 열기** · svg 폴백 · 메모 헛저장 |
| `395c53d5` | **#259 외부 프로젝트 열람 링크 1차** (`c13156ca` + Fable FAIL 1 수정) |

버전 `1.48.12` 유지(구별은 커밋).
**운영 ALTER 적용됨** — `guest_links.scope` ENUM 기본값 `conversation`. 기존 링크 1건 그대로 conversation.
(배포 **전에** 멱등 스크립트로 적용했다 — 코드가 먼저 뜨면 컬럼이 없어 500 이 난다.)

---

## 오늘의 사고 둘 — 둘 다 내가 냈고 Fable 이 잡았다

### ① 판정하려다 데이터를 잃었다 (`84df5200` → `70bdd775`)

"편집 버튼만 눌러도 자동저장이 나가 옛 글의 수정일이 오늘로 바뀐다" 를 고치면서
**`editor.isFocused` 로 "사람이 친 것" 을 가렸다.** TipTap 의 `focus()` 는 rAF 로 지연돼
툴바 mousedown 이 에디터를 blur 시킨 뒤 명령이 동기 dispatch 된다 → `onUpdate` 시점
`isFocused === false` → **툴바로만 한 편집(글머리기호·표·굵게·이미지)이 전부 유실.**
기존 문서 편집엔 저장 버튼이 없어 복구 경로도 없었다.

**내 검증이 거짓 통과한 이유:** `element.click()` 합성 클릭은 **mousedown 이 없다.**
Fable 이 `page.mouse.click` 으로 재서 잡았다.

**고침:** 판정을 없앴다. 비교는 언제나 하고 기준선만 바로잡는다 — 안 고친 본문의 두 표현
(서버본 · 에디터 정규화본) 중 어느 쪽과 같아도 "안 고침". 단 첫 저장 전까지만.

### ② 복사한 판정이 죽은 코드가 됐다 (`c13156ca` → `395c53d5`)

게스트 링크 발급의 fail-closed 3종을 대화방 라우트에서 프로젝트 라우트로 **복사**했는데,
프로젝트 쪽에서 "보관된 방" 분기가 **한 번도 실행되지 않았다** — 채널 조회가 `archived_at: null`
로만 찾고 없으면 새 방을 만들어서 판정에 도달하지 못했다.
결과: 멤버가 닫은 프로젝트에 링크가 **201** 로 나가고 **고객채널이 복제**됐다.

**고침:** 판정을 `services/guest_link.js` **한 함수**로(두 라우트가 같은 것을 부른다) ·
채널 조회가 보관된 방까지 보게 · 닫힌 프로젝트는 채널을 만들기 **전에** 409.

> 박제: `feedback_synthetic_click_has_no_mousedown` ·
> `feedback_dont_judge_user_input_fix_the_baseline` ·
> `feedback_comment_lies_predicate_drifts`(두 번째 사례 추가)

---

## Fable 판정 이력 (오늘)

| 대상 | 판정 |
|---|---|
| `84df5200` 자동저장 억제 | **FAIL** — 툴바 편집 유실(F1) · AI 문서 유실(F2) |
| `70bdd775` 재수정 | **PASS** 15/15. "판정을 없앤" 설계 선택도 맞다고 확인 |
| `c13156ca` 외부 열람 링크 1차 | **FAIL** — 닫힌/보관 프로젝트 fail-open + 설계 편차 D1~D4 |
| `395c53d5` 재수정 | **PASS** — 배포 가능 |

---

## Irene 몫으로 남은 것

- **안드로이드 앱 다운로드가 아직 안 된다** — 운영 `platform_settings.app_android_url` 이 **null**.
  Play 프로덕션(또는 공개 테스트) 승격 후 스토어 주소(`https://play.google.com/store/apps/details?id=app.planq`)를
  주면 관리자 설정에 넣는다. 상단 메뉴 "앱 다운로드" 진입로는 이미 운영에 나가 있다.
- **iOS 배포 범위** 결정 — TestFlight 유지 vs App Store 정식
- **"문서가 갑자기 워크스페이스 공개로 되어 있다" 는 어느 화면이었나** — 운영 `posts#44` 는
  `vlevel='L1'` 그대로이고 dev 의 목록·상세·모달 모두 "나만" 으로 나온다(재현 실패).
  라벨 기본값은 '확인 필요' 로 바꿔 두었으니, 등급이 빠지는 경로였다면 이제 그렇게 드러난다.

## 다음 사이클 후보

- **외부 열람 링크 2차** — 문서·파일 탭 + 보안등급 잠금 + `auth-check`.
  무인증 본문이 처음 나가는 지점이라 **별도 Fable 게이트**(양성·음성 대조군 필수, 설계 §10).
  Fable 권고: 계정 요청 배너를 프로젝트 화면에도 이때 함께 붙일 것 ·
  "닫힌 프로젝트의 **기존** 링크를 계속 열어둘지" 정책 결정.
- **Q Sale #381 · #382** — 게스트 영업 대화 · 전화 녹음 → Q Note 정리
- **#259 답글** — 1차가 배포됐는데 신고자 장부에 답글 0건(닫으려면 답을 먼저)
- 운영 옛 프론트 청크 16,000여 개 정리(위험 낮음, 디스크만)

---

## 오늘 만진 주요 파일

**백엔드**
`routes/{guest,guest_admin,projects}.js` · `services/{guest_link,project_channel}.js` ·
`models/GuestLink.js` · `scripts/migrate-guest-link-scope.js`(신규)

**프론트**
`components/Docs/{PostsPage,PostEditor}.tsx` · `components/Common/OverflowMenu.tsx`(신규) ·
`components/QTalk/GuestLinkButton.tsx` · `pages/Guest/{GuestConversationPage,GuestChatPanel,GuestProjectPage}.tsx`
(뒤 둘 신규) · `pages/QProject/{DocsTab,ProjectShareLinkButton,QProjectDetailPage}.tsx` ·
`pages/QProject/docs/PreviewArea.tsx` · `pages/QNote/MemoView.tsx` · `pages/Login/LoginPage.tsx` ·
`pages/Register/RegisterPage.tsx` · `components/Landing/LandingLayout.tsx` ·
`utils/zipList.ts`(신규) · `services/files.ts` · `public/robots.txt` · locales ko/en

**문서·설정**
`CLAUDE.md`(상세 액션 줄 표준) · `dev-frontend/UI_DESIGN_GUIDE.md` · `DEVELOPMENT_PLAN.md` ·
`docs/dev-status/next.json` · `scripts/schema-snapshot.json` · `dev-frontend/package.json`
(빌드 heap 4096 → **5120** — tsc 가 OOM 으로 반복해 죽었다. 8192 는 이 서버에서 abort)

---

## 복구 방법

```
이전 세션 이어서 작업하고 싶어. /opt/planq/.claude/session-state.md 읽어줘.
```
