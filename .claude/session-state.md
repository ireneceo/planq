## 현재 작업 상태
**마지막 업데이트:** 2026-04-25 19:15
**작업 상태:** 완료 (큰 마일스톤 정리)

---

## ⚡ 빠른 재개 (새 세션)

```
session-state.md 읽고 이어서 개발해.
```

---

## 진행 중인 작업
- **없음** (이번 세션 큰 마일스톤 완료)
- ⚠️ 사용자 검수 대기: PostEditor 빨간 테두리 캐시 비운 후 정상 보임 확인

---

## 완료된 작업 (이번 세션, 2026-04-25)

### Q Task
- 시간/진행율 = 담당자 전용 (백엔드 403 + 프론트 disabled + 회색 점선 시각)
- 헤더 chip: `15개 · 내 업무 X.Xh/가용 Y.Yh · 실제 Z.Zh` (3 chip)
- 0.5h 화살표 입력 (`type=number step=0.5`)
- workspace 뷰 담당자 컬럼 + mine 뷰 NameChip 중복 제거
- 요청 task 시간칸 숨김 (`newAssignee !== myId` 시)
- `done_feedback` 단계 폐지 (컨펌 정책 충족 시 자동 completed, DB 6 row 마이그레이션)

### Inbox
- `fetchTodo(bizId)` 활성 워크스페이스 명시 (첫 가입 fallback 버그 fix)
- task_candidate 카드 명확화: 추정 담당자 본인/타인/미지정 분기 + 클릭 → 원본 대화

### Q docs
- D-2 잔여: 시드 5종 본문 풍부화 (NDA 8조항·제안서 5섹션·회의록 4섹션) + placeholder 치환
- D-3: AI 자동 생성 (Cue gpt-4o-mini, CueUsage 카운터, 플랜별 한도)
- D-4 핵심: 공개 페이지 + 동의/서명/거절 (`/public/docs/:token`) + A4 print PDF
- D-5 핵심: Q Talk RightPanel "+ 새 문서" 진입점
- 게시판/문서 잘못 분리 → 복구 (PostsPage 단일 + 템플릿 흡수)
  - 템플릿 모달 검색 + 5종 고정 해제 (시스템 + 사용자 자작 합산)
  - 만든 거 "템플릿으로 저장" (DocumentTemplate 멤버 권한 완화)
  - 인쇄/PDF 버튼 (`window.print()` + `[data-print-area]` 격리)
  - 이모지 → 라인 SVG 통일 (KindIcon, PinDot)
  - URL 싱크 (`?post=:id`)

### PostEditor 안 보임 진단·해결
- 콘솔 로그 추적 → 두 가지 원인 발견:
  1. **TipTap v3 Link 중복** (StarterKit 가 Link 자체 포함 + 별도 Link → "Duplicate extension names" warn → editor 인스턴스 깨짐) → `link: false`
  2. **중첩 flex column 안에서 Wrap height 0** → `flex-shrink: 0; min-height: 280px`
- 메모리 3건 저장: try/finally 데이터 원복 / props useMemo 안정화 / flex min-height

---

## 다음 할 일 (우선순위 순)

### 1. 화면 검수 (사용자 직접) — 다음 세션 시작 시
- /docs 새 글 작성 → 본문 입력 영역 정상 보이는지
- 표 추가 다시 (Link 충돌 fix 검증된 후 안전하게)
- 검색란 풀 폭 / URL 싱크 / 사용자 템플릿 저장 / 인쇄

### 2. Q docs 잔여 — Step 6 공유
- **URL 미리보기 공유** — Post 에 share_token 추가 (또는 Document 시스템 재활용)
- **이메일로 보내기** — Nodemailer + share URL
- **고객 연동 (채팅창으로 보내기)** — Q Talk 메시지 첨부

### 3. Q Note 자동 회의록 변환 (2~3일)
- 세션 종료 hook + AI 호출 + meeting_note 자동 생성 + 사용자 편집

### 4. 프로젝트 Documents 탭 (0.5일)
- `/projects/:id` 에 PostsPage(scope='project') 통합

### 5. Q Bill Phase 1.2 (1주)
- 백엔드 + 포트원 V2 통합 + 채널 등록 + 웹훅 + 주문 동기화

---

## 환경 / 인증

- 백엔드: pm2 planq-dev-backend (port 3003)
- DB: planq_dev_db / planq_admin
- 도메인: dev.planq.kr
- 시스템 템플릿 5종 (DocumentTemplate is_system=true): proposal/quote/invoice/nda/meeting_note 모두 본문 풍부화 완료
- 마지막 빌드: index-twbQUc7a.js (서빙 정상)

---

## 주요 문서 위치

- `/opt/planq/DEVELOPMENT_PLAN.md` (히스토리 + 다음 계획)
- `/opt/planq/CLAUDE.md` (Q Task 시간 권한 + done_feedback 폐지 반영)
- `/opt/planq/docs/DOCS_TEMPLATE_SYSTEM_DESIGN.md`
- `/opt/planq/docs/Q_BILL_SPEC.md`
- 메모리: `/home/irene/.claude/projects/-opt-planq/memory/`

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
