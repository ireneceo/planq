# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-11
**작업 상태:** 완료 — v1.5.4 운영 라이브
**버전:** v1.5.4 운영 라이브 (commit `c962c5f`, deploy 111s)

---

## 진행 중인 작업
- 없음
- lua 의 모바일 반응형 7 파일 (PageShell, QCalendar, QProject + i18n) 은 working tree 미커밋 — lua 마무리 대기 (다음 사이클에서 통합)

---

## 완료된 작업 (이번 세션 — 사이클 N+8 follow-up)

### Backend
1. **refresh_token rolling renewal** (`routes/auth.js`)
   - cookie maxAge 를 옛 tokenRow.expires_at → 새 successorRow.expires_at 기준으로 변경
   - DB(매 rotation NOW+7d) 와 cookie 동기화 → 점진 감소 회귀 차단
   - "여전히 자주 로그아웃" 회귀 fix. grace 5분 + chain 격리는 그대로 유지

### Frontend
2. **LeftPanel 모바일 Unread/별표 일관** (`pages/QTalk/LeftPanel.tsx`)
   - Unread 를 ChatTop 안 → ChatRow 직접 자식으로 이동 + align-self:center
   - ChatName flex:1 squeeze 회귀 해소. 데스크탑·모바일 같은 순서·위치
   - margin-left:auto 제거 (ChatRow flex 의 자연 우측 정렬)

3. **AI 라벨 분기 통일** (`QTaskPage.tsx` + `TaskDetailDrawer.tsx`)
   - InlineAddBox + Panel + Drawer 3곳: 값 있으면 'AI 다시' / 없으면 'AI 추천'
   - i18n ko/en: `add.estAi`/`estAiAgain`/`estAiHint`/`estAiNeedTitle` 추가
   - `detail.meta.aiEstShort` ko "AI 다시" → "AI 추천" 으로 수정 (호출 전 자연), `aiEstAgain` 신설

4. **TodoList 인박스 액션버튼 제거** (`TodoList.tsx` + `TodoPage.tsx`)
   - task ack/confirm InlineBtn 제거. drawer 가 단일 진입점 (이미 ack/approve/complete 자체 처리)
   - onTaskAction prop + handleTaskAction 함수 정리

### 검증
- 헬스체크 27/27 PASS
- E2E refresh rolling 10/10 + 정적 15/15 = 25/25 PASS
- 빌드 1.59s, TS 에러 0
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.5.4

### 운영 배포
- commit `c962c5f`, deploy-planq.sh `--auto`, 111s
- 백업: `/opt/planq/backups/20260511_143100`
- 외부 https://planq.kr/api/health 200

---

## 메모리 박제
- 이번 사이클 신규 박제 없음 (기존 메모리만 활용)

---

## 다음 할 일 (DEVELOPMENT_PLAN.md 기반)
DEVELOPMENT_PLAN.md "다음 진입 ★" — Irene 선택:
- **권한 옵션 A + 개인 보관함** (1.5 사이클, 13~15 commit, 설계 완료 — VISIBILITY_VOCABULARY + PERSONAL_VAULT_DESIGN)
- Q note 텍스트 type + Quick Capture (중, 설계 완료 — QNOTE_CAPTURE_DESIGN)
- Custom SMTP (Pro+) (소, 설계 완료 — EMAIL_DELIVERY_POLICY)
- ShareModal 채팅방 발송 후 PostShareModal 흡수 (chat·email 통일 마무리)

이번 사이클 follow-up:
- lua 의 모바일 반응형 7 파일 — lua 마무리 후 별도 commit / 통합
- Message 편집/삭제 라우트 신규 구현 (PERMISSION_MATRIX §5.9 박제만 됨)

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated. 메일 발송 정상
- DEEPGRAM 양쪽 EMPTY (Q Note STT 503 fallback)
- JWT_SECRET dev/prod 분리 운영
- platform_admin 계정: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한: 640 (planq 그룹 read)

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
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
