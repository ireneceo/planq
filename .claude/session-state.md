# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-02 (Opus 세션 — 멀티탭 설계/P0-A + 죽은투어 제거 + 비용폭탄 총점검·수정)
**작업 상태:** dev 코드 반영 · **운영 미배포** · **일부 Fable 게이트/검증 대기** · **pm2 dev 미재시작(비용수정)**

---

## 이번 세션 완료/진행 (2026-07-02 Opus)

### 1) 앱 내 멀티탭 (노션 방식, keep-alive) — 설계 + P0-A 착수
- **결정(Irene):** "처음부터 진짜 keep-alive", 데스크탑 전용(≥1025px), alive LRU 4개. 스탠스 = 정석 우선(유료고객 0, 운영 멈춰도 근본 리팩터 OK — memory [[feedback_orthodox_over_prod_stability]]).
- **설계문서: `docs/MULTITAB_DESIGN.md`** — Fable 2회 게이트 통과(반려 2회 → 수정). 핵심 확정:
  - §3 라우팅: **형제(sibling) MemoryRouter** (BrowserRouter 를 탭 조상으로 두지 않음). v1(중첩 Router)은 RR7.14 invariant throw → 폐기. **SSR PoC 6/0 실증**(형제는 통과, 중첩은 throw).
  - **🔴 chrome(MainLayout 사이드바·Toaster·RightDock·CueHelpDrawer·BuildVersionGuard)은 지금 useLocation/useNavigate 사용 → router-less zone 에서 throw.** P1-a 에서 **chrome 을 react-router 에서 떼어 TabStore 기반으로 리팩터** 필수(v1→v2 이동 비용). 이게 P1 최대 작업.
  - §11 heavy/light(merge=유지 / refetch=숨은탭 defer), Toaster 활성conv 판정 TabStore 단일화, 메모리 임계치(alive4 ≤400MB), 읽음 3중조건(useTabActive&&visible&&convopen).
- **P0-A 공유 소켓 서비스 — 완료:** `dev-frontend/src/services/socket.ts` 신규 + **io() 24곳→22파일 이관 완료**(getSocket/joinRoom/onSocket). connect_error 토큰갱신 중앙화, 토큰 가드+미인증 버퍼링(Fable 실버그 수정). `window.__planq_postsSocket` 전역싱글턴 제거. **빌드 EXIT0/TS0.** ⬜ 잔여: **브라우저 런타임 검증**(라이브 메시지·뱃지·WS=1 — 터미널 자동화 불가. 인브라우저 SPIKE 또는 Irene 2탭 확인으로 클로징).
- **P0-B(앱탭 활성 컨텍스트) / SPIKE(인브라우저 chrome+탭 무crash) / P1(chrome 리팩터+탭코어) = 미착수.** SPIKE 통과 기준 = "chrome + 형제 tab pane 동시 렌더 무crash"(현 SSR PoC 는 chrome 미포함이라 불충분).

### 2) 죽은 투어(FirstVisitTour) 제거 — 완료
- forceShow 트리거가 어디에도 없어 **영영 안 뜨던 죽은 코드** + HelpDot "투어 다시 보기" 죽은 링크. 컴포넌트 삭제 + 3페이지(Todo/QTask/QTalk) 사용 제거 + HelpDot `tourPageKey` prop 제거. **빌드 EXIT0.**
- HelpDot 본체(7페이지, 전부 제목 옆 일관)는 유지. "이상한 곳 ?" 은 특정 못 함 — Irene 이 위치 알려주면 추가 처리.

### 3) 🔴 비용폭탄 총점검 + 수정 — 대부분 완료 (Fable 게이트 대기)
- **3축 read-only 감사 완료**(AI/LLM · STT/임베딩 · 메일/푸시/저장소). Fable 계획검수 "수정후OK".
- **구현 완료(dev 코드, pm2 미재시작):** 신규 `dev-backend/middleware/costGuard.js`(perUserLimiter/perUserDaily/dailyCircuitBreaker/capText) +
  - **C2** task_estimations.js: estimate-preview·estimate/ai 멤버십 게이트(cross-tenant few-shot 유출 차단)+rate-limit 10/분·100/일+title 300캡
  - **C3** inquiries.js: IP 3/시간·10/일 limiter + 같은 from_email 24h 자동회신 dedup(스팸릴레이 차단)
  - **H-a** cue.js: getClientIp→req.ip(스푸핑 차단)+전역 2000/일 서킷브레이커. **H-b** tasks.js ai-create: rate-limit 6/분·60/일+can('use_cue') 게이트+prompt 4000캡. **H-c** cue.js help: rate-limit 10/분·150/일(qhelper 플랜게이트는 제품결정이라 안 걸음)
  - **H-d** share.js/posts.js: 수신자 ≤20 캡 + 발송 limiter 10/분·100/일. **H-e** message_attachments.js/task_attachments.js: `plan.fileSizeLimit` 유령함수 복구→`plan.can('upload_file')`+BusinessStorageUsage 집계+업로드 limiter. security.js 죽은 uploadLimiter 경로 제거.
  - **M-a** translation_service.js 입력 8000자 슬라이스. **L3** calendar.js 조회 기간 400일 캡.
  - **C1(부분)** q-note/routers/live.py: per-user 동시 STT 스트림 2 + 세션 4h 캡(인메모리). **카타스트로피($190×무제한 병렬 스트림) 차단.**
- 전 파일 구문검사 OK. **결정 박제:** 기존 첨부 bytes_used **백필 안 함**(지금부터 집계 — 유료고객 0이라 무의미+기존사용자 잠금 방지).
- ⬜ **Fable 구현 diff 게이트 = 이 세션 마지막에 실행 중이었음(agent 종료됨). 다음 섹션에서 재실행 필수** (커밋/배포 전). curl 로 공개라우트 검증(inquiries 4번째 429, help-public).
- ⬜ **남은 비용 항목(마이그레이션+Fable 재게이트 필요):** **C1 전체** — q-note 세션종료 실분(bytes/32000) `POST /api/internal/qnote/usage` 기록(멱등 qnote_usage_events 테이블 UNIQUE(session_id,segment_seq)+5분 flush) + `/ws/live` accept 전 internal `can('use_qnote')` hard-block + **create_session business_id 멤버십 검증(Node internal, JWT엔 role/business_id claim 없음)** + role 체크. **H-f** q-note 세션당 문서 20캡 + create_session/generate-keywords rate-limit. **M-c** OTP/초대 메일 per-user limiter.

---

## 다음 섹션 할 일 (우선순위)
1. **Fable 비용수정 diff 게이트 재실행** → 지적 반영 → pm2 restart planq-dev-backend → 공개라우트 curl 검증. (커밋/배포는 그 후, Irene /배포 명령 필요)
2. **C1 전체 STT 과금 시스템** (마이그레이션+internal endpoints+Fable 재게이트+Irene dev 실녹음 검증) — 최대 금전위험의 완결.
3. H-f q-note 문서캡 + M-c OTP limiter.
4. 멀티탭: P0-B(앱탭 컨텍스트) → 인브라우저 SPIKE(chrome+탭) → P1(chrome RR 탈피 리팩터 + 탭코어). docs/MULTITAB_DESIGN.md §13 순서.

## 미배포/미커밋 상태
- 운영(planq.kr) 배포 0 — Irene /배포 명령 대기. 이전 세션분(지식루프·메일fix·설정IA)도 여전히 미배포(origin push 도 안 됨).
- 이번 세션 변경 미커밋(idle autosave wip 만). /개발완료 루틴에서 처리.

## 함정/박제 (이번 세션)
- 멀티탭 chrome 은 반드시 router-less+TabStore (RR 훅 쓰면 throw). 형제 MemoryRouter 만 합법(중첩 X).
- 비용: plan.can('upload_file',{size,external}) 반환 {ok,reason,limit}. `plan.fileSizeLimit`은 유령함수(존재X). qhelper free 는 제품결정(플랜게이트 금지).
- q-note JWT payload 는 {userId,email} 뿐 — role/business_id 없음. q-note 권한/과금은 Node internal API 경유.

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
