## 현재 작업 상태
**마지막 업데이트:** 2026-04-17
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**1. 타임존 기능 UI (Mock 단계 완료)**
- `utils/timezones.ts` (preset 30개) / `TimezoneSelector` 공통 컴포넌트 / `useTimezones` 훅 (localStorage)
- `SidebarClock`: 워크스페이스 + 내 시간 + 참조 타임존, 가로선 풀폭, 60px 기준 통일, 관리자만 워크스페이스 행 클릭 가능
- Workspace 설정에 `timezone` 탭 신규 (프리뷰 카드 + select + 칩)
- Profile 에 "내 타임존" 섹션 신규 (브라우저 기준 자동감지)

**2. 레이아웃 공통 컴포넌트 + 강제화**
- `components/Layout/PageShell.tsx` 신규 — 단일 컬럼 페이지(60px 헤더, 18px 제목, 14x20 padding 잠금)
- `components/Layout/PanelHeader.tsx` + `PanelTitle/PanelSubTitle/PanelMetaTitle` 신규 — 3컬럼 패널
- CLAUDE.md + UI_DESIGN_GUIDE.md 에 표준 문서화 — 신규 페이지는 반드시 이 둘 중 하나 사용

**3. 페이지 헤더 전체 통일 (60px + border-bottom 수평 연결)**
- /business/settings, /business/members, /business/clients, /profile → PageShell
- Q Talk 좌/중/우, Q Note 사이드바+메인, Q Task 메인+우측 모두 60px 통일
- Q Talk 소속(프로젝트) 메타를 제목 옆 인라인 배치 (stack 제거)
- Q Note 사이드바를 Q Talk 기준으로 SearchBox/SessionItem/EmptyMsg 스타일 완전 통일
- Q Note 새 세션 버튼: teal solid → 투명 아이콘 버튼

**4. Business 메뉴 분리 + 고객 페이지 신규**
- /business/settings (브랜드/법인/언어/타임존 4탭)
- /business/members (멤버/Cue 2탭, 제목 "멤버 관리")
- /business/clients 신규 ClientsPage — 테이블 리스트, 검색, `/api/clients/:businessId` 연결
- 사이드바 Business 메뉴를 Features 아래로 이동

**5. Q Task 선커밋 복구**
- 이전 세션 미커밋이었던 Q Task/Invite/CalendarPicker/task_extractor/task_snapshot/TaskComment/TaskDailyProgress 코드 65f5c2a 커밋

### 검증 결과 (이번 세션)
- **헬스체크**: 27/27 통과
- **빌드**: 성공 (`index-D_IUTmrJ.js`, gzip 240.3 kB) — 중간에 `ReactNode` verbatim import 규칙으로 실패 후 수정 완료

### 다음 할 일 (다음 세션 시작점)

**타임존 백엔드 연결** (UI Mock 완료, 실 데이터 연결 필요)
- DB: `businesses.reference_timezones` JSON, `users.timezone` + `users.reference_timezones` JSON
- API: `PATCH /api/users/:id` (timezone 필드) + `PATCH /api/businesses/:id/settings` (reference_timezones)
- 백엔드 유틸: `dev-backend/utils/datetime.js` (UTC ↔ tz)
- `useTimezones` 훅을 localStorage → API 기반으로 교체
- 기존 시간 표시 화면(Q Task 마감, Q Note 일시) UTC 기준 정규화

**기타 대기 작업**
- lua 팀원 계정 세팅 (Irene 지시 시 실행)
- Q Talk 청크 3 — 업무 후보 자동 추출 (extract/register/merge/reject API 4개 + RightPanel candidates 실 연결)
- /business/clients 초대/편집 기능 (현재 리스트만)
- 워크스페이스 설정 확장 — 알림/연동/보안/API 키 등 (Irene 결정 대기)

### Irene 화면 확인 필요
- https://dev.planq.kr 강력새로고침 후 sidebar 시계 + 타임존 설정 + 페이지 헤더 통일 확인
- /notes/:id 사이드바 Q Talk와 동일 디자인 확인

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
