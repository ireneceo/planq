# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-21 10:35 (Opus 4.8, 1M)
**작업 상태:** 중단 (이어서 재개 예정) — 운영 피드백 버그·기능 6건 배포 완료, #194 설계안 승인 대기

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업:** 운영 피드백 처리분 9커밋 운영 배포 완료(`73445fd`까지, Complete 197s, 3점 실측 통과). #195 운영 카테고리 seed(`node seed-wiki-content.js --categories-only`)까지 반영 확인(운영 qfile="Q File (파일·자료)").

**바로 다음 작업:** **#194 제품 공지/체인지로그 시스템** — 설계 자문(Fable) 완료, Irene 승인 시 구현. 그다음 **#196 영어 전면** + **#146 잔여**(/features 캡처·빠진 기능).

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
