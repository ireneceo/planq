# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-04 (사이클 N+84 작업 중 — dev 검증 완료, 운영 미배포)
**작업 상태:** dev 에 2건 반영 — ① iOS 채팅 fix(데이터 기반, Irene 실기기 확인 대기) ② Q Task "Cue에게 말하기" 바(API 13/13 검증). **운영 미배포** — /배포 명령 대기.

---

## ★ 이번 세션 완료 (dev only, 미배포)

### ① iOS PWA 채팅 입력 phantom-scroll fix — 데이터 기반
- **원인 확정(VVDIAG 실측):** iOS 가 입력 focus 시 document 를 키보드 높이만큼 phantom scroll → `window.scrollY/visualViewport.offsetTop=376` (정상 focus 는 0). position:fixed body 가 못 되돌려 콘텐츠 위로 밀림+아래 여백.
- **fix(`main.tsx`):** visualViewport resize/scroll/focus 마다 모바일에서 `scrollY≠0||offsetTop≠0` 이면 `window.scrollTo(0,0)` 강제 정렬. + 키보드 판정 stale innerHeight → 안정 기준 높이.
- **진단 인프라 유지 중**(ViewportDebug + `/api/diag/vv`) — Irene dev PWA 테스트 → dev VVDIAG 로 `off/sY=0` 데이터 확인 후 제거 예정.
- **다음:** Irene 아이폰에서 dev.planq.kr (홈화면추가 standalone) Q Talk 입력란 탭 → 정상 확인 → 진단 제거 → /배포.
- 메모리 [[feedback_mobile_chat_input_offsettop]] 갱신 필요(offsetTop translate 가설 폐기, scrollTo(0,0) 가 정답).

### ② Q Task "Cue에게 말하기" 바 (신규 기능)
- 캐주얼 한마디 → Cue 가 업무로 정리 → 인라인 미리보기 → [추가]. 모달 아님(제자리). 상단 상시 바.
- 신규: `components/QTask/CueTaskBar.tsx` + `AiCandidateCard.tsx`(모달과 공유 추출, DRY). QTaskPage 마운트(week/all/workspace-tasks 탭).
- 백엔드 재사용: `/api/tasks/ai-create`(+/confirm). **신규 `mode:'quick'`** — 한마디=1업무 (나열 시만 다중). planner buildSystemPrompt + 라우트.
- i18n ko/en `ai.bar.*` + `ai.itemDays`(기존 누락).
- **검증 13/13** — quick 1개 / 나열 5개 / 빈 400 / DB저장·격리 / cleanup. socket task:new 로 실시간 반영(기존).

---

## ★★★ 다음 세션 최우선 — iOS 채팅 입력 버그 진단 로그 읽기 ★★★

**상황:** iPhone 홈화면 설치 PWA(standalone)에서 채팅 입력란 탭하면 "위로 올라가 사라지고 아래 여백". 대시보드 알림배너도 같은 증상. offsetTop 보정 fix(추측) 2번 실패 → **추측 중단, 실측 수집으로 전환**.

**진단 인프라 (운영 라이브):**
- `components/Common/ViewportDebug.tsx` — Irene(irene@irenewp.com) 한정 오버레이 + `/api/diag/vv` 로 viewport 실측 자동 POST. MainLayout 에 전역 마운트(모든 페이지).
- `server.js` `POST /api/diag/vv` → `console.log('[VVDIAG]', ...)`. 인증 없음(임시).
- POST 시점: 페이지 진입(load) + 입력란 focus 후 0/150/400/800ms. payload: {ev, ms, path, iH, vvH, off, sY, kb, vvh, listTop, act}

**다음 세션 할 일 (순서):**
1. Irene 가 운영 PWA 에서 대시보드 + 채팅 입력란 탭을 했다면 로그가 쌓임. 읽기:
   ```
   ssh irene@87.106.78.146 "pm2 logs planq-prod-backend --lines 300 --nostream | grep VVDIAG"
   ```
2. 분석 포인트: focus 후 **vvH 가 줄어드나**(키보드 인식) / **off·sY 가 튀나**(viewport 밀림) / **kb 가 1 되나**(플래그) / **listTop 변하나**(리스트 스크롤). path 로 대시보드 vs 채팅 구분.
3. 진단 결론 → **진짜 fix 작성** (추측 금지, 데이터 기반).
4. fix 후 **진단 인프라 전부 제거:** ViewportDebug.tsx 삭제 + MainLayout import/mount 제거 + server.js `/api/diag/vv` 제거 + ChatPanel `data-msglist` 속성 제거.
5. dev 검증 → /배포 → Irene 모바일 재확인.

**관련 메모리:** [[feedback_mobile_chat_input_offsettop]] (offsetTop 가설 — 이 환경선 안 맞았음, 갱신 필요), [[feedback_no_image_requests]], [[feedback_pwa_push_user_environment]].
**핵심 코드:** main.tsx(--vvh sync), index.css(html/body/#root position:fixed height:var(--vvh)), MainLayout.tsx(LayoutContainer/MainContent), ChatPanel.tsx(InputBar/MessageList).

---

## 이번 세션 완료 (전부 운영 라이브)
- **v1.29.0** — Q Mail inbound 트리아지 / 모바일 채팅 fix(미해결, 진단중) / 고객 첫 응대 보완 / 고객 정기 구독청구(ClientSubscription)
- **알림 배너 모바일 반응형 fix** — PushPromptBanner 5컬럼 grid → flex-wrap (닫기 우상단 고정). ★ Irene 모바일 확인하면 정상일 것
- recurring_invoice 잠재버그 2건 fix (sequelize import / created_by notNull)

## 다음 할 일 (채팅 버그 이후 후보)
- 결제 자동화: PortOne 빌링키 / 팝빌 세금계산서 (외부 계정·키 필요)
- 고객 온보딩 심화: 프로필 입력 / 온보딩 가이드 / 일괄 초대
- ⏳ Google OAuth 검증 제출 (Irene 액션)

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / 3003 · prod: planq.kr / 87.106.78.146 / 3004 (v1.29.0)
- PM2: planq-dev-backend·planq-qnote (dev) / planq-prod-backend·planq-prod-qnote (prod)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘. 채팅 버그 진단 로그부터 읽자.`
