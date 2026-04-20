# Q Project 기능 감사 (2026-04-20)

> 샘플 시드 6건 + API 실호출 + UI 탭 전수 점검 결과

## 1. 기능 존재 여부 (6 탭 × 세부)

| 탭 | 섹션 | 상태 | 비고 |
|---|---|:-:|---|
| 대시보드 | 기본 정보 카드 | ✅ | 타입/고객/기간/멤버 수 |
| 대시보드 | 연결된 채팅방 | ✅ | conversations 리스트 |
| 대시보드 | 진척 통계 | ✅ | total/completed/overdue/progress |
| 대시보드 | 업무 타임라인 (공용 GanttTrack) | ✅ | 2026-04-20 통일 |
| 대시보드 | 주요 이슈 + 메모 | ✅ | inline 추가 가능 |
| 업무 | split / list / timeline / calendar 4뷰 | ✅ | URL `?view=` 싱크 |
| 업무 | 드로어 오버레이 상세 | ✅ | `?task=:id` 싱크 |
| 업무 | 리스트 행 빈공간 클릭 | ✅ | 2026-04-20 |
| 프로세스 | 커스텀 컬럼 + 파트 CRUD | ✅ | |
| 고객 | 고객 CRUD + 초대 토큰 | ✅ | 토큰은 생성만, 랜딩 페이지 (`/invite/:token`) 는 F5-2b 미구현 |
| **문서** | **실파일 업로드/리스트** | ❌ | 플레이스홀더만 (`문서/자료는 추후 연결`) |
| 상세정보 | 기본 정보 편집 | ✅ | 이름/고객사/타입/기간/색상/설명 자동저장 |
| 상세정보 | **프로젝트 멤버 관리** | ✅ | 2026-04-20 신규 (추가/역할/제거) |
| 상세정보 | 채팅방/이슈/메모 | ✅ | |

## 2. 빠진 항목 (우선순위)

### 🔴 필수 (사용 중 막히는 항목)
1. **문서 탭 실구현** — 업로드·리스트·다운로드. 기존 `files` API 재사용
2. **프로젝트 상태 토글 UI** — `active / paused / closed` DB 필드는 있으나 노출 없음. 상세 헤더 또는 상세정보 탭에 드롭다운 필요
3. **프로젝트 삭제 UI** — `DELETE /api/projects/:id` 는 존재, UI 진입점 없음. 파괴적이므로 확인 모달 필수
4. **F5-2b 초대 랜딩 페이지** — `/invite/:token` 세션 처음부터 미구현 (별도 백로그)

### 🟡 개선 (있으면 좋음)
5. **프로젝트 아카이브/복제** — 반복 프로젝트 빠르게 재시작
6. **대시보드 빈 상태** — 업무 0건일 때 "첫 업무 만들기" CTA
7. **NewProjectModal 채팅 채널 0~N 유연화** — 현재 customer+internal 2개 고정
8. **프로젝트 멤버 제거 시 담당 업무 재할당 UX** — 현재 orphan 방지 로직 없음
9. **프로세스 탭 데이터 없는 기본 상태 안내** — "+ 파트 추가" 유도

### 🟢 마이너
10. 멤버 역할 프리셋 (기타/팀원/리더/디자이너/개발자 등 자동완성)
11. 프로젝트 검색/필터 (`/projects` 리스트)
12. 프로젝트 색상 커스텀 입력 (현재 10색 팔레트만)

## 3. Q Task ↔ Q Project 연동 검증 (G)

### API 실호출 결과
| 항목 | 결과 |
|---|:-:|
| GET `/projects/:id` — projectMembers include | ✅ |
| GET `/projects/:id/tasks` — reviewers/assignee/requester include | ✅ |
| GET `/projects/workspace/:bizId/all-tasks` — Project.name 포함 | ✅ |
| GET `/tasks/:id/detail` — Project 관계 | ✅ |
| **PUT `/tasks/by-business/:bizId/:id` — `project_id` 이관** | ✅ **2026-04-20 버그 수정** |
| 잘못된 `project_id` (다른 biz 또는 없는 id) 거부 | ✅ 400 |
| `project_id: null` (프로젝트 해제) 허용 | ✅ |
| Q Talk 후보 추출 → 등록 시 프로젝트 연결 (`project_name`) | ✅ |
| 진척률 계산 (task 평균) | ✅ A=52%, B=18%, C=96% |
| Socket.IO `task:updated` project room + business room 브로드캐스트 | ✅ 코드 확인 |

### 발견된 버그 (수정됨)
- **`PUT /api/tasks/by-business/:bizId/:id` 가 `project_id` 를 화이트리스트에서 누락**
  - 증상: 프론트에서 프로젝트 변경 요청 → 200 응답이나 DB 미반영
  - 수정: 허용 필드 추가 + 같은 비즈니스 프로젝트 검증 + null 허용 (`routes/tasks.js`)

### 확인 안 된 영역 (별도)
- **프로젝트 삭제 시 업무 처리** — DB ON DELETE 정책 (CASCADE vs SET NULL) 미검증 (파괴적 테스트 스킵)
- **멤버 제거 시 담당 업무 재할당** — 현재 멤버만 제거되고 업무는 그대로 남음 (orphan 담당자) → UX 필요

## 4. 샘플 데이터 시드

`scripts/seed-project-samples.js` — 6가지 시나리오로 멱등 시드:

| 시나리오 | 프로젝트 | 특성 |
|---|---|---|
| A | 진행 중 일반 | fixed, avg 52%, overdue 0 |
| B | 지연 위험 | fixed, avg 18%, overdue 3 |
| C | 완료 직전 | fixed, avg 96% |
| D | 신규 | fixed, 업무 0 |
| E | 월간 유지보수 | **ongoing**, 반복 |
| F | 복합 시나리오 | fixed, 다수 멤버, 다양한 상태 업무 8개 (reviewing/revision_requested/waiting 포함) |

실행: `cd /opt/planq/dev-backend && node scripts/seed-project-samples.js`

멱등: `[SAMPLE]` 접두어 기반으로 재실행 시 전체 삭제 후 재생성.
