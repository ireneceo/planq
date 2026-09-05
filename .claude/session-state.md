# PlanQ 세션 상태

**마지막 업데이트:** 2026-09-05 15:50 UTC
**작업 상태:** 완료 (`/개발완료` 처리) · 운영 배포 5회 · 가드 3축 통과 · Fable 게이트 4회
**최근 커밋:** `b0c0fef2` (푸시 완료) · 백업 `/opt/planq/backups/dev-daily/20260905/`

---

## ⚠️ 미완 — Fable 사후 게이트 (한도로 못 돌았다)

오늘 배포분 중 **두 커밋이 Fable 게이트를 안 거쳤다**(제 자체 검증만):
- `05ba5d9f` AI 시드 보존 · `784017ef` 랜딩·파일·메모(zip·열기 버튼·메모 헛저장)

사후 게이트를 걸었으나 **Fable 세션 한도(429)로 중단**(16:20 UTC 이후 재시도 가능).
게이트 지문 검사는 **커밋 뒤라 초록**이다 — "변경 없음" 은 "검증했음" 이 아니다.

**다음 세션에서 먼저 할 것:** `/fable-검증` 으로 위 두 커밋 사후 게이트.

기다리는 동안 **내가 직접 반증한 것**(Fable 게이트를 대체하지 않는다 — 오늘 내 검증이 이미 한 번
거짓 통과했다. 다만 같은 항목을 두 번 재는 낭비는 줄이라고 남긴다):

| 반증 | 방법 | 결과 |
|---|---|---|
| 메모 **툴바 전용 편집**(오늘 유실과 같은 계열) | `page.mouse.click` 진짜 마우스 | ✅ DOM 변경 + **서버에 bulletList 저장** |
| 메모 열기만 / 다른 메모로 이동 후 방치 | 쓰기 요청 카운트 | ✅ 둘 다 **0건**(헛저장 없음) |
| zip **손상·zip 아님·빈 파일** | 3종 픽스처 업로드 후 실화면 | ✅ 각각 **"왜 못 읽는지"** 표시 · pageerror 0 |
| zip **CP949 한글 파일명** | UTF-8 플래그 없는 zip 직접 생성 | ✅ 이름 안 깨지고 목록 표시 |
| "열기" 술어가 서버와 갈라졌나 | 서버 `isSafeInline` 과 프론트 `canOpenInNewTab` 을 **같은 입력 17종**으로 대조 | ✅ **17/17 일치**(확장자와 mime 이 어긋난 업로드 2종 포함) · Drive 는 외부 뷰어 |
| AI 시드 보존 / 빈 문서·템플릿 대조군 | 실브라우저(AI 응답만 가로챔) | ✅ 남음(draft) / 안 쌓임 |

**Fable 이 아직 안 본 것:** zip64·20MB 상한 실측 · `/app` 페이지가 안드로이드에서 보여주는
빈 상태 문구가 정직한지 · 팝업 차단 시 다운로드 폴백 · 로그인/회원가입 홈 링크의 폰 폭 동작.

---

## ⛳ 다음 세션 지시 (Irene, 2026-09-05)

> **"다음 섹션에 Q sale 빼고 다 해. 제발 그만 남겨."**

**Q Sale(#381·#382)만 빼고 남은 것 전부 끝낸다.** 순서:

1. **외부 프로젝트 열람 링크 2차** — 문서·파일 탭 + 보안등급 잠금 + `auth-check`.
   설계 `docs/PROJECT_EXTERNAL_VIEW_DESIGN.md` §8 두 번째 줄이 그대로 범위다(§12-Q1 승인 완료).
   **무인증으로 문서 본문이 처음 나가는 지점 → 별도 Fable 게이트**(양성·음성 대조군 필수, §10).
   Fable 이 1차 게이트에서 남긴 2차 숙제 둘:
   - 계정 요청 배너를 프로젝트 화면에도 붙일 것(문서 잠금 시트가 같은 `account-request` 라우트를 쓴다)
   - **닫힌 프로젝트의 *기존* 링크를 계속 열어둘지** 정책 결정("closed 면 발급도 막는다" 와 짝 맞추기)
   - 승인 조건이던 **헤더 globe 칩**(§7.3)은 1차에서 teal 점으로 넣었다 — 2차에서 문구까지 확인
2. **#259 답글** — 1차가 배포됐는데 신고 장부에 답글 0건. 답 없이 닫지 않는다(닫으려면 답이 먼저).
3. **운영 옛 프론트 청크 정리** — 16,000여 개 누적. 위험 낮음(디스크).
4. (남으면) 안드로이드 스토어 주소가 오면 `platform_settings.app_android_url` 반영.

---

## 이번 세션에 완료한 것 (배포 5회)

| 커밋 | 내용 | Fable |
|---|---|---|
| `9a6062ae` | Q docs 상세 **헤더 2줄** + ⋯ 메뉴 · 자동저장 억제 · 목록 날짜 이름 · 공개범위 기본값 | FAIL(유실) |
| `70bdd775` | **유실 회귀 긴급 수정** — 툴바로만 한 편집이 사라졌다 | **PASS** 15/15 |
| `05ba5d9f` | AI 가 써 준 글이 손대지 않으면 사라지던 것 | 사후 게이트 |
| `784017ef` | 로그인→홈 링크 · 랜딩 **앱 다운로드** · **zip 목록** · **새 탭에서 열기** · svg 폴백 · 메모 헛저장 | 사후 게이트 |
| `c13156ca`→`395c53d5` | **#259 외부 프로젝트 열람 링크 1차** (FAIL 1 수정 포함) | FAIL → **PASS** |

**운영 ALTER 적용됨** — `guest_links.scope` ENUM 기본값 `conversation`(기존 링크 1건 그대로).
배포 **전에** 멱등 스크립트로 적용했다 — 코드가 먼저 뜨면 컬럼이 없어 500 이 난다.
**운영 위키 갱신** — `project-external-view-link` 아티클 추가(ko/en), `seed-wiki-content.js` 운영 실행 완료.

---

## 이번 세션의 사고 둘 — 둘 다 내가 냈고 Fable 이 잡았다

### ① 판정하려다 데이터를 잃었다 (`84df5200` → `70bdd775`)
`editor.isFocused` 로 "사람이 친 것" 을 가렸는데, TipTap 의 `focus()` 는 rAF 로 지연된다.
툴바 mousedown 이 blur 시킨 뒤 명령이 동기 dispatch → `onUpdate` 시점 `isFocused === false` →
**툴바로만 한 편집이 전부 유실.** 기존 문서 편집엔 저장 버튼이 없어 복구 경로도 없었다.
내 검증이 통과한 이유: `element.click()` 합성 클릭은 **mousedown 이 없다.**
→ 판정을 없앴다. 비교는 언제나 하고 **기준선만** 바로잡는다(안 고친 본문의 두 표현 중 어느 쪽과 같아도 "안 고침", 첫 저장 전까지).

### ② 복사한 판정이 죽은 코드가 됐다 (`c13156ca` → `395c53d5`)
발급 fail-closed 3종을 복사했더니 프로젝트 쪽에서 "보관된 방" 분기가 **한 번도 실행되지 않았다** —
채널 조회가 보관된 방을 안 봐서 판정에 도달하지 못했다. 결과: 닫은 프로젝트에 **201 + 고객채널 복제**.
→ 판정을 한 함수로(두 라우트가 같은 것을 부른다) · 채널 조회가 보관까지 · 닫힌 프로젝트는 생성 전에 409.

> 박제: `feedback_synthetic_click_has_no_mousedown` ·
> `feedback_dont_judge_user_input_fix_the_baseline` · `feedback_comment_lies_predicate_drifts`(2번째 사례)

---

## Irene 몫으로 남은 것

- **안드로이드 앱 다운로드가 아직 안 된다** — 운영 `platform_settings.app_android_url` 이 **null**.
  Play 프로덕션(또는 공개 테스트) 승격 후 `https://play.google.com/store/apps/details?id=app.planq` 를
  주면 관리자 설정에 넣는다. 상단 메뉴 "앱 다운로드" 진입로는 이미 운영에 나가 있다.
- **iOS 배포 범위** — TestFlight 유지 vs App Store 정식
- **"문서가 갑자기 워크스페이스 공개로 되어 있다" 는 어느 화면이었나** — 운영 `posts#44` 는
  `vlevel='L1'` 그대로이고 목록·상세·모달 모두 "나만" 으로 나온다(재현 실패). 라벨 기본값을
  '확인 필요' 로 바꿔 두었으니, 등급이 빠지는 경로였다면 이제 그렇게 드러난다.
- (참고) 운영 `posts#44` 의 수정일은 8/5 23:54 로 되돌려 두었다. 변경 기록의 오늘자 v1 은 남아 있다 —
  지울지는 미결.

---

## 이번 세션에 만진 주요 파일

**백엔드** `routes/{guest,guest_admin,projects}.js` · `services/{guest_link,project_channel}.js` ·
`models/GuestLink.js` · `scripts/migrate-guest-link-scope.js`(신규) · `seed-wiki-content.js`

**프론트** `components/Docs/{PostsPage,PostEditor}.tsx` · `components/Common/OverflowMenu.tsx`(신규) ·
`components/QTalk/GuestLinkButton.tsx` · `components/Landing/LandingLayout.tsx` ·
`pages/Guest/{GuestConversationPage,GuestChatPanel,GuestProjectPage}.tsx`(뒤 둘 신규) ·
`pages/QProject/{DocsTab,ProjectShareLinkButton,QProjectDetailPage}.tsx` · `pages/QProject/docs/PreviewArea.tsx` ·
`pages/QNote/MemoView.tsx` · `pages/Login/LoginPage.tsx` · `pages/Register/RegisterPage.tsx` ·
`utils/zipList.ts`(신규) · `services/files.ts` · `public/robots.txt` · locales ko/en

**문서** `CLAUDE.md`(상세 액션 줄 표준 · guest_links.scope) · `dev-frontend/UI_DESIGN_GUIDE.md` §2.3 ·
`docs/FILE_SYSTEM_DESIGN.md` §7.0(미리보기·열기 매트릭스) · `DEVELOPMENT_PLAN.md` ·
`docs/dev-status/next.json` · `scripts/schema-snapshot.json` ·
`dev-frontend/package.json`(빌드 heap 4096 → **5120**, tsc OOM. 8192 는 이 서버에서 abort)

---

## 복구 방법

```
이전 세션 이어서 작업하고 싶어. /opt/planq/.claude/session-state.md 읽어줘.
```
