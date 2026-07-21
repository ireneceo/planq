# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-21 15:00 (Opus 4.8, 1M)
**작업 상태:** #194 제품 공지/체인지로그 시스템 **운영 배포 완료** (commit `2650256`, Fable 게이트 PASS + 3점 실측). 다음 = #196 영어 전면 / #146 잔여.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업:** **#194 제품 공지/체인지로그 시스템 운영 배포 완료**(commit `2650256`, deploy Complete 206s). 콘텐츠 원천=help_articles(blog_category='updates') 단일, 신규 컬럼 users.whats_new_seen_at 1개. 노출 3면: ①랜딩 블로그 updates 탭+/changelog redirect ②인앱 사이드바 메가폰+새소식 DetailDrawer(미읽음 워터마크) ③critical 배너 기존 재사용(미구현). updates 는 wiki /categories·/articles·검색에서 격리. Fable 게이트 PASS(guard 3축·빌드 TS0·실HTTP 20/20·격리 3면·배포안전성). 운영 3점 실측 통과(PM2 fresh·청크해시 dev=운영 index-BQRTo2VK·백엔드 실호출 라이브). 운영 seed 실행 완료(updates cat id15 + welcome-whats-new). **⚠️ seed-changelog.js 는 deploy 스크립트에 없음 — 향후 재배포 시 운영 콘텐츠는 이미 있으므로 무관, 단 새 워크스페이스/운영 리셋 시 수동 재실행 필요(멱등).**

**바로 다음 작업:** **#196 영어 전면 + #146 잔여** — Fable 설계 게이트 착수했다 정지(Irene 취침). ⚠️ **실측 결과 #196 규모 작음(예상과 반대)**: 위키 42글·16카테고리 영어 100%, 랜딩 t() 밖 하드코딩 0. 전 앱 en/*.json 미번역 한국어 **단 2건** — ①`en/qmail.json` `translate.lang.ko`='한국어'→'Korean' ②`en/qnote.json` `startModal.priority.templateDownload` 영어문장 안 한국어 섞임. 그 외 empty en 은 한국어 조사/단위 suffix(건/명/월/마다) — 영어 UX 판단 필요(qbill overview.unit.count·qproject card.clientsCount/tasksUnit/canvas.tl.monthSuffix·qtask recur.everySuffix/weeklyReview.dept.peopleSuffix). recur.everySuffix 는 영어 어순 달라 template 검토. weeklyReview.workspace.delta.down 은 ko도 빈값(무시). **#146**: /features 캡처 이미지 0개(Opus 이미지 업로드 불가 → wikiScreenshot.js puppeteer 자동캡처 가능성 검토 or Irene) + 빠진 기능 대조 필요. **재개 시**: Fable 설계 게이트부터 다시(위 데이터 그대로 넘기면 빠름) → 구현 → Fable 검증.

**맥락 유지할 것:**
- ★ **CLAUDE.md 정책 변경**: 모든 기획/설계·구현검증·테스트검증 **무조건 Fable(model:fable) 게이트**. `/fable-검증` 커맨드 + Stop 훅(`fable-gate-stop.sh`) 강제. Opus 자체검증 완료보고 금지. 메모리 `feedback_fable_all_design_verification`.
- **#194 최종 설계안(승인 대기)**: 콘텐츠 원천=`help_articles(blog_category='updates')` 1개 / 노출 3면=①랜딩 블로그 updates 탭+/changelog redirect ②in-app 사이드바 메가폰+DetailDrawer "새 소식" 패널(미읽음=`users.whats_new_seen_at` 워터마크 1컬럼) ③critical만 기존 배너. push fan-out 없음(platformNotify는 admin·email 전용). MVP: 신규테이블0·신규컬럼1. wiki categories 응답에서 'updates' slug 제외 1줄 필수.
- **#126 후속(OAuth 대기)**: 개인 구글캘린더에 PlanQ 일정 쓰기 = OAuth `calendar.events` scope 필요(Irene: Google 검증 제출에 합산). 유출/IDOR는 이번에 봉합 완료.
- 미푸시: 로컬 9커밋 미푸시(배포는 rsync 모델이라 무관). origin 뒤처짐.

---

## 📦 이번 세션 작업 요약

- 🔴 시급 `a97c3cc` — 확인필요 "Access token required": 세션 만료 시 로그인 정리(apiFetch refresh 실패→planq:session-expired)
- 정책 `88651f6`·`1d177aa` — Fable 무조건 게이트 + 강제 인프라
- `03301df` #197 메일 번역 버튼 무반응 · `c4058ee` #193 캘린더 day→월 복귀버튼
- 🔒 `9a4df8b` #126 개인 일정 구글캘린더 유출/IDOR 봉합(보안, gcal push 4경로 isPrivateForGcal 게이트)
- `6c3ad7e` #192 메일 AI 초안 수정요청 refine · `c102aeb` #146 Q helper 도움말 검색 · `73445fd` #195 도움말 카테고리 Q File 브랜드화+sort 정리
- **전부 Fable 게이트 PASS + 운영 배포 완료**(3점 실측 + #195 운영 seed 반영)

**커밋:** `73445fd` fix(wiki): 도움말 카테고리 Q File 브랜드화 + sort 정리 (#195)

---

## 📂 다음 할 일 (우선순위)

1. **#194** 제품 공지/체인지로그 — Irene 승인 시 설계게이트 기반 구현(위 최종안). 신규 컬럼 `users.whats_new_seen_at`.
2. **#196** 영어 전면 — 랜딩·도움말 영어 미제공 전체 재검증(규모 큼, 한 사이클).
3. **#146 잔여** — /features ①캡처이미지(chrome 자동캡처 시도 or Irene) ②빠진 기능(목록 확인).
4. 운영 피드백: 남은 것 위 3건. #126 개인캘린더 쓰기·OAuth = Irene.

---

## 🔑 환경변수 / 인증 현황

- 운영 = 별도 서버 `irene@87.106.78.146`(planq.kr, port 3004, /opt/planq/backend, DB planq_prod_db). SSH passwordless 가능(피드백 read-only 조회·seed 실행에 사용).
- Google OAuth 검증 미완(Irene) — 캘린더 양방향·개인캘린더 쓰기·Gmail 원클릭 대기. `calendar.events` scope 합산 제안됨.
- Stripe SaaS 카드구독 키 미연결(Irene). Apple Team ID·APNs .p8 대기(Irene).

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트 (전 설계·검증 무조건)" · 메모리 `feedback_fable_all_design_verification`
- #194 설계: (이 파일 맥락 섹션) — 구현 착수 시 docs 설계문서화 권장
- 운영 피드백 조회: `ssh irene@87.106.78.146 "cd /opt/planq/backend && node -e '...feedback_items...'"` (read-only)
