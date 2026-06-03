# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-03 (사이클 N+83 — v1.29.0 + 진단 배포)
**작업 상태:** 진행 중 — iOS PWA 채팅 입력 버그 **진단 데이터 수집 단계**. 다음 세션에 로그 읽고 fix.

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
