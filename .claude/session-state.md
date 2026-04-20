## 현재 작업 상태
**마지막 업데이트:** 2026-04-20
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**공용 인프라**
- `components/QTask/TaskDetailDrawer.tsx` 신규 (QTask + QProject 공용 드로어)
- `components/Common/GanttTrack.tsx` 공용 간트 (ProjectTaskList·TimelineView·Dashboard 3곳 재사용)
- `components/Common/EmptyState.tsx` 통일 (Q Note/Talk/Task 동일 스타일)
- `theme/breakpoints.ts` 반응형 Phase 0 토큰

**재클릭 토글 전역 원칙**
- Q Talk 대화, Q Note 세션, Q Task·Project 드로어 모두 재클릭 토글
- CLAUDE.md + 메모리 `feedback_reclick_toggle.md` 명문화

**Q Talk 재설계**
- 독립 대화 생성 (`POST /api/conversations`) + 프로젝트 선택 연결
- NewChatModal 신규 (이름·프로젝트·참여자). 좌측 "+ 대화/프로젝트" 분리
- 프로젝트 자동 채널 생성 제거. 채팅방 단위 URL 싱크 `?project=X&conv=Y`
- 프로젝트 미선택 시 우측 패널 숨김. 중앙 empty state
- 좌측 필터 탭 제거 (미동작 코드). 일반 대화 섹션 추가

**Q Note**
- 좌측 헤더·검색 border 통일 + Layout `100vh` (바닥 회색 제거)
- main 배경 #FFFFFF. 세션 상태 pill Q Task 동일 파스텔 bg+fg

**Q Task**
- 리스트 빈 상태 EmptyState + CTA. `?view=` URL 싱크
- scope 별 우측 패널 인사이트 (전체/요청하기/workspace 각각 Period·Capacity·Burndown·ProjectProgress·Issues·Notes)
- 액션 드로어 깜빡임 수정 (병렬 fetch + 액션 섹션 display 토글)

**Q Project 감사 + 샘플**
- `docs/QPROJECT_AUDIT.md` 신규 — 미구현 목록 3단계 우선순위
- 샘플 6 시나리오 시드 (A 진행중 / B 지연 / C 완료직전 / D 신규 / E 지속 / F 복합)
- 프로젝트 상세정보 탭 상태 3-segment + closed 모달 (고객 체크박스 내보내기)
- 대화 cascade archived · 멤버 관리 카드 (추가/역할/제거)
- `PUT /tasks/by-business/:bizId/:id` project_id 이관 버그 수정

**Irene 3-역할 실데이터**
- 워프로랩 (owner·biz 3): 프로젝트 3 + 업무 39 + 대화 6
- PlanQ 테스트 (member·biz 6): 프로젝트 6 + 업무 21 + 대화 3
- 브랜드 파트너스 (client·biz 7): 프로젝트 2 + 업무 8 + 대화 4
- `ProjectClient.contact_user_id` 일괄 매칭 (client role 권한 체크)

**고객 페이지 (/business/clients) 마스터-디테일 드로어**
- 리스트 인라인 편집 (이름·회사 더블클릭) · 필터 세그먼트 (활성/전체/보관)
- 드로어: 헤더(아바타+이름+회사+Switch) · 연락처 · 메모 자동저장 · 연결 프로젝트 · 연결 대화 · 히스토리(시계 토글) · 삭제
- 클릭 → `/projects/p/:id` · `/talk?project=X&conv=Y` 이동
- hard delete + ProjectClient 정리 + removal-impact 경고 모달
- `POST /api/clients/:bizId/invite` 신규 초대 (이메일 기반 User 자동 생성)
- 프로젝트 고객 탭 "초대 대기 / 참여 중" 상태 pill

**AuditLog**
- client.invited/activated/archived/updated/deleted + project.client_added/removed
- 미들웨어 camelCase/snake_case 호환 (기존 코드 영향 없음)

**브랜드·UX**
- `docs/BRAND_CONCEPT.md` 10섹션. 슬로건 "일을 일답게 하다" / "일이 일이되지 않게"
- auth 로그인 슬로건 교체. Q Note/Talk empty state 문구 정리
- 사이드바 라벨: Business→워크스페이스 / Features→기능 / Admin→관리 / Main 제거
- 간트 바 파스텔화 (bg + border-left + fg text)

### 검증 결과
- 헬스체크 27/27 (반복)
- 빌드: tsc 0 error, vite ~1.2s, gzip ~414 kB
- API 18건 PASS (client drawer/history/archive/invite + cascade + project_id 이관 + removal-impact)
- 프론트 9개 핵심 URL 전부 200

### 다음 할 일 (다음 세션 시작점)

**1순위 — 캘린더 Phase A~E (약 5일)**
- Phase A: DB 2테이블 (`calendar_events`, `calendar_event_attendees`) + CRUD API + 범위 쿼리
- Phase B: 월/주/일 뷰 + 이벤트 모달 + 드로어
- Phase C: 반복 (`rrule.js` — 매일/매주/매월/매년/커스텀)
- Phase D: **화상 미팅 — Daily.co 임베드 + 수동 링크 입력** (Irene 결정 2026-04-20)
- Phase E: Q Task 업무 통합 표시 + 4필터 세그먼트 (전체/내/업무만/일정만)
- 색상: 프로젝트 색 자동 상속 + 개인일정 카테고리 팔레트 5종

**2순위 — 현재 미구현 UX 잔여**
- 문서 탭 실파일 업로드 (기존 files API 재사용)
- 프로젝트 삭제 UI (확인 모달 + cascade 정책 안내)
- F5-2b `/invite/:token` 수락 랜딩 페이지

**3순위 — 출시 직전 스프린트 (약 8일, 반응형 + 메일 + 래핑 묶음)**
- 반응형 Phase 1~5 (사이드바 햄버거화, 마스터-디테일 모바일 패턴, 터치 타겟 44×44)
- 메일 시스템 (SMTP 설정 페이지 + 초대 템플릿 + `/invite/:token` 연동)
- Capacitor 하이브리드앱 래핑 (아이콘/스플래시/푸시)

**백로그 (후일 업데이트)**
- 타임라인 바 드래그 (3단계 로드맵)
- Q Talk Cue 자동 추출 트리거
- Dashboard 위젯
- lua 팀원 계정 세팅

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
