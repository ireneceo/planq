# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-11
**작업 상태:** 완료 — v1.5.5 운영 라이브
**버전:** v1.5.5 운영 라이브 (commit `2f379ee`, deploy 125s)

---

## 진행 중인 작업
- 없음
- lua 의 모바일 반응형 7 파일 (PageShell, QCalendar, QProject + i18n) 은 working tree 미커밋 — lua 마무리 대기 (다음 사이클에서 통합)

---

## 완료된 작업 (이번 세션 — 사이클 N+8 + N+8 hotfix)

### v1.5.4 (commit `c962c5f`)
1. **refresh_token rolling renewal** (`routes/auth.js`)
   - cookie maxAge 를 successorRow.expires_at 기준 → 7일 갱신 (점진 감소 회귀 fix)
2. **LeftPanel 모바일 Unread/별표 일관** (`pages/QTalk/LeftPanel.tsx`)
   - Unread ChatBody 밖 → ChatRow 직접 자식, align-self:center
3. **AI 라벨 분기 통일** (Drawer + InlineAddBox + Panel mode)
   - 값 있으면 'AI 다시' / 없으면 'AI 추천' + i18n ko/en
4. **TodoList 인박스 액션버튼 제거** — drawer 단일 진입점

### v1.5.5 hotfix (commit `04fc7e0` + `af9a1d8` + `5fe6db9` + `2f379ee`)

5. **인박스 reviewer pending fix** (`routes/dashboard.js`)
   - "내가 컨펌자 (pending)" 분기 task.status 필터 `NOT IN (completed,canceled)`
     → `IN (reviewing, revision_requested)` 좁힘
   - 운영 task#4 "튜토리얼 생성(퀵타임플레이어로)" 같은 케이스: in_progress 인데
     reviewer.state='pending' 잔존만으로 인박스에 "승인 대기" 잘못 노출되던
     회귀 차단. QTaskPage panelCounts.review 분기와 일관 (단일 진실 원천)

6. **Q Talk 채팅방 ⋮ 메뉴** (`LeftPanel.tsx` + `QTalkPage.tsx`)
   - ChatRow 에 ⋮ MenuBtn + Popover 추가 — 보관·프로젝트 분리 2 액션
   - 데스크탑 hover-only, 모바일 상시 노출
   - canManage = workspace_owner || platform_admin 만 노출
   - ConfirmDialog 후 실행, 옵티미스틱 list 갱신
   - i18n ko/en `left.menu.*` + `left.confirm.archive/unlink.*` 14 키

7. **멤버 카운트 정합성** (`services/plan.js`)
   - getUsage().members + add_member 가드: `removed_at IS NULL` + `role != 'ai'`
   - "8/5 = 160%" 회귀 fix (basic plan biz 의 AI + 실제 7 카운트 회귀)
   - UsageWarningCard: 초과 시 빨간 톤, Pct cap "100%+", `(N 초과)` 라벨
   - LimitReachedDialog: "이번 달 사용량 자세히 보기 →" 인라인 링크
   - PlanSettings: `#usage` 앵커

8. **docs 박제** (`docs/SHARE_PREVIEW_POLICY.md` + `docs/SURVEY_SYSTEM_DESIGN.md`)
   - 공유 미리보기 권한·노출·디자인 매트릭스 (4 페이지 공통 + 30년차 평가 + 보강 #1~#8)
   - 설문 기능 MVP 4 사이클 설계 (5 질문 타입 + 익명/식별 + 13 라우트 + 6 UI 페이지)

### 검증
- 헬스체크 27/27 PASS
- E2E 누적 13/13 PASS (인박스 + Q Talk + 멤버 카운트 + refresh rolling)
- 빌드 1.50~1.59s, TS 에러 0
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.5.5

### 운영 배포
- commit `2f379ee` (N+8 hotfix 누적 4 commit + docs), deploy-planq.sh --auto, 125s
- 백업: `/opt/planq/backups/20260511_160916`

---

## 메모리 박제
- 신규 박제 없음 (기존 메모리 + 본 세션 작업으로 충분)

---

## 다음 할 일 (DEVELOPMENT_PLAN.md 기반)
DEVELOPMENT_PLAN.md "다음 진입 ★" — Irene 선택:
- **권한 옵션 A + 개인 보관함** (1.5 사이클, 13~15 commit, 설계 완료)
- Q note 텍스트 type + Quick Capture (중)
- Custom SMTP (Pro+) (소)
- **설문 기능 MVP** (4 사이클, 설계 완료 — docs/SURVEY_SYSTEM_DESIGN.md)
- 공유 미리보기 보강 #1~#3 (공유자 정체성 / PublicShell / 1-step redirect, 2.5일)

이번 사이클 follow-up:
- lua 의 모바일 반응형 7 파일 — lua 마무리 후 별도 commit / 통합
- AI 사용량 기능별 세분화 표시 (CueUsage action_type 별, Task AI 예측·번역 recordUsage 통합 누락 fix)
- 시간 예측 workspace 학습 (callAiEstimate prompt 에 비슷한 task 통계 주입)
- 파일 업로드 전 토큰 예상 표시 (Cue 통합 가드)

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY (Q Note STT 503 fallback)
- JWT_SECRET dev/prod 분리
- platform_admin: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한: 640 (planq 그룹 read)

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
- 공유 미리보기 정책 (NEW): `/opt/planq/docs/SHARE_PREVIEW_POLICY.md`
- 설문 기능 설계 (NEW): `/opt/planq/docs/SURVEY_SYSTEM_DESIGN.md`
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`
- UI 가이드: `/opt/planq/dev-frontend/UI_DESIGN_GUIDE.md`
- 프로젝트 규칙: `/opt/planq/CLAUDE.md`

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
