## 현재 작업 상태
**마지막 업데이트:** 2026-04-19
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**1. 타임존 백엔드 연결 + 전역 tz 표시 통일**
- DB: `users.timezone`/`reference_timezones`, `businesses.reference_timezones` JSON 추가
- API: `PUT /api/users/:id` + `/businesses/:id/settings` 확장, `/auth/me` 에 workspace_timezone
- `useTimezones` 훅 localStorage → API 기반으로 교체
- `utils/dateFormat.ts` + `hooks/useTimeFormat.ts` 신규 (워크스페이스 tz 바인딩)
- Q Talk·Q Note·Q Task·Clients·Profile 모든 시각 표시 통일
- `utils/datetime.js` (백엔드 UTC↔tz 유틸) + my-week/month/year + task_snapshot per-business tz

**2. Q Talk 청크 3 완성**
- OpenAI 키 연결 (Q Note 에서 복사)
- 청크 3 E2E 13/13 통과 (extract/register/merge/reject)
- 배너 "업무 후보 확인 대기" 로 재정의 + Cue 드래프트 뱃지 클릭 이동
- 업무명 규칙 정정 — "완료" 접미사 금지
- task:new/updated/deleted Socket 이벤트 business room 추가

**3. Q Project 신규 페이지**
- `/projects` + `/projects/:view` 라우트 + 사이드바 메뉴
- 리스트/타임라인/일정 3뷰, 프로젝트 색상 팔레트 (10색 swatch)
- 드릴다운 → `/talk?project=` 이동, 반응형

**4. Q Task 워크플로우 재설계 (Phase 1 스키마 + API)**
- 8 상태 ENUM 재정의: not_started/waiting/in_progress/reviewing/revision_requested/done_feedback/completed/canceled
- `task_reviewers` (멀티 컨펌자 + UNIQUE + state) + `task_status_history` 테이블
- API 13개: ack/submit-review/cancel-review/approve/revision/revert/complete/reviewers CRUD/policy
- 정책 all/any + 재제출 시 전원 pending 리셋
- 댓글·메모 visibility 통일 (personal/internal/shared)
- FK CASCADE (task_comments, task_daily_progress, task_reviewers, task_status_history)

**5. Q Task 탭 재구성 + 관점별 라벨 (Phase A+B)**
- `/tasks` ↔ `/tasks/workspace` URL 분리 + 세그먼트 토글
- 탭: 이번 주 내 업무 / 내 전체업무 / 요청하기 (순서 및 이름)
- `utils/taskRoles.ts` + `taskLabel.ts` — 역할 판정 + 관점별 라벨
- i18n `status.{code}.{role}` 4차원 구조 (담당자/요청자/컨펌자/관찰자)
- 가상 상태 `task_requested` 도입 (displayStatus — 받은 요청 미확인)
- 탭별 카드 칸반 카테고리 컬럼 + 빈 컬럼 자동 숨김

**6. 보기 모드 + 반응형 + UX 개선**
- 리스트/카드 뷰 토글 (localStorage 유지)
- 리스트 뷰 컬럼 정렬 (flex-shrink 0, min-width 0, overflow hidden)
- 반응형 breakpoint 기반 컬럼 숨김 ($hideBelow)
- 상태 드롭다운: 한 번 클릭 → 열림, outside/Escape 닫힘
- 업무 추가 중복 버그 (Socket + POST 경합) 수정
- 지연 업무 좌측 정렬 (box-shadow inset)

**7. 버그 픽스 다수**
- 보안 필터 hex 차단 완화 (프로젝트 색상 저장 가능)
- SQL regex pattern 과차단 수정
- FK CASCADE (task_comments, task_daily_progress)
- i18n 캐시 무효화 (vite BUILD_ID define + ?v= 쿼리)

**8. 스킬 업데이트**
- `.claude/commands/검증.md` 8단계 UI/UX 상세 템플릿 (8-A~8-G)

### 검증 결과
- 헬스체크 27/27 통과 (매 Phase)
- 워크플로우 API E2E 18/18
- 청크3 E2E 13/13
- 타임존 E2E 11/11 + per-biz snapshot 7/7
- SPA 15/15 라우트 200
- 빌드 성공 (gzip 249.18 kB, tsc 0 error)

### 다음 할 일 (다음 세션 시작점)

**Phase C — Q Task 상세 패널 액션 버튼 매트릭스 (역할별)**
- 담당자: [요청 확인] / [확인 요청 보내기] / [확인 요청 취소] / [최종 완료]
- 컨펌자: [승인] / [수정 요청] (댓글 필수) / [내 결정 취소] (1회)
- 컨펌자 추가/제거 시 라운드 리셋 UI 경고 다이얼로그
- 히스토리 타임라인 (task_status_history 렌더)

**Phase D — 탭 뱃지 카운트**
- 이번 주: 미확인 요청 개수 (teal)
- 요청하기: 내가 컨펌해야 할 개수 (rose)
- 전체업무: 수정요청 받은 개수 (rose)

**Phase E — 역할별 범위 확장**
- 이번 주 / 내 전체업무 필터에 reviewer=me 케이스 합치기 (workflow GET 응답에 reviewers include 또는 별도 API)

**기타 백로그**
- Q Project 상세 페이지 (`/projects/:id`) — 프로젝트 허브 (대시보드/업무/문서/고객정보/AI 탭)
- Q Talk 청크 5 — Cue 자동 추출 트리거 (auto_extract_enabled 실제 동작)
- Clients 초대/편집 UI (F5-2b 설계 — 미가입/기가입 분기)
- Dashboard 구현 (현재 placeholder)
- lua 팀원 계정 세팅

### Irene 확인 필요
- https://dev.planq.kr/tasks 카드/리스트 뷰 실제 사용, 관점별 라벨 인지 확인
- https://dev.planq.kr/tasks/workspace 팀 업무 뷰
- https://dev.planq.kr/projects 리스트/타임라인/일정 + 색상
- https://dev.planq.kr/talk 업무 추출 실동작 + 후보 등록

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
