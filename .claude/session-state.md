## 현재 작업 상태
**마지막 업데이트:** 2026-04-20
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Calendar Phase A — DB + API**
- `calendar_events` + `calendar_event_attendees` 모델 2개
- `routes/calendar.js` 6 엔드포인트 (range GET, CRUD, attendee 응답, video/status)
- AuditLog 4종 (created/updated/deleted/attendee_responded/meeting_created)
- 멀티테넌트 격리, visibility personal/business, scope=mine 서버 지원
- 검증 24/24 PASS

**Calendar Phase B — UI + API 연결**
- `pages/QCalendar/` 9 파일 (월/주/일 3뷰, 드로어, 모달, 유틸)
- URL 싱크 `?view=week&date=...&event=...&scope=mine&task=...`
- `services/calendar.ts` 래퍼 + 낙관적 업데이트 + 로딩/에러 UI
- i18n ko/en `qcalendar` 네임스페이스
- CalendarPicker + PlanQSelect 재사용 (native datetime-local 제거)

**Calendar Phase C — 반복 (RRULE)**
- `rrule.js` 설치, 백엔드 range 쿼리에 expansion 로직
- 프리셋 6종 (없음/매일/매주/2주마다/매월/매년)
- `_parent_event_id` / `_instance_key` 메타 필드
- 드로어 반복 배지
- 검증 10/10 PASS

**Calendar Phase D — Daily.co 화상 미팅**
- `services/daily.js` REST 래퍼 (createRoom, isConfigured)
- `auto_create_meeting` 플래그 시 자동 방 생성
- `POST /meeting` 지연 방 생성 엔드포인트
- `GET /video/status` 구성 여부 감지
- 드로어 iframe 임베드 + "여기서 참여" 버튼
- `DAILY_API_KEY` 설정 → `planq.daily.co` 실 방 생성 확인

**Calendar Phase E — Q Task 통합**
- `taskToEvent.ts` 변환기 (due_date 있는 업무 종일 이벤트)
- 4필터 세그먼트: 전체 / 나 / 업무 / 일정
- 업무 클릭 시 캘린더 페이지 위 `TaskDetailDrawer` 오버레이 (Q Task 이동 X)
- 버그픽스: due_date 풀 ISO 파싱, 단일 날짜 표시(중복 제거)
- 월 뷰 "+N 더보기" 팝오버 (Google Calendar 방식)
- 그리드 행 min-height 112px + 세로 스크롤 (가려짐 해결)

**드로어 반응형 통일**
- `DetailDrawer` 프리미티브 (Header/Body/Footer) 신규
- 5개 드로어 전부 `min(desktopW, 100vw - 56px)` — 좌측 56px strip = 햄버거 패턴
- `FloatingPanelToggle` — 얇은 엣지 핸들(8px) + 화살표 회전 + 펄스(최초 1회)
- `useBodyScrollLock` · `useFocusTrap` · `useEscapeStack` · `useMediaQuery` 4 훅 신규
- blur 백드롭 제거 (Irene 피드백), dim 0.32→0.08
- 키보드 `⌘/` · `Ctrl+\` 토글 (QTask/QTalk)

**레거시 호환**
- `/api/tasks/attachments/:id/raw` 자동 302 → `/public/attach/:storedName` (구 task body 이미지 401 에러 해결)

**PlanQSelect 개선**
- `density='compact'` prop 추가 (시간 드롭다운 같이 옵션 많은 경우)

### 검증 결과
- 헬스체크 27/27 (반복)
- 빌드 tsc 0 error, 290 modules, gzip 422 kB
- Phase A+B+C+D+E 통합 E2E 20/20 PASS
- 라우트 12/12 전부 200
- Daily.co 실 방 생성 확인 (planq.daily.co)

### 다음 할 일 (다음 세션 시작점)

**1순위 — 잔여 UX 정리 (DEVELOPMENT_PLAN.md 2순위)**
- 프로젝트 문서 탭 실파일 업로드 (files API 재사용)
- 프로젝트 삭제 UI (cascade 확인 모달)
- F5-2b `/invite/:token` 수락 랜딩 페이지

**2순위 — Calendar 폴리시**
- RRULE 단일 인스턴스 수정/삭제 ("이 이벤트만 / 이후 모두" 분기)
- RRULE UNTIL/COUNT 종료 조건 UI
- Calendar 알림 (이벤트 시작 N분 전 푸시)

**3순위 — 출시 직전 스프린트 (약 8일)**
- 반응형 Phase 1~5 (사이드바 햄버거화, 모바일 마스터-디테일, 터치 44px)
- 메일 시스템 (SMTP 설정 + 초대 템플릿)
- Capacitor 하이브리드앱 래핑

**백로그**
- Q Talk Cue 자동 추출 트리거
- Dashboard 위젯
- lua 팀원 계정 세팅
- 타임라인 바 드래그 (3단계 로드맵)
- 프로덕션 Daily.co 키 분리 + dev 키 rotate

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
