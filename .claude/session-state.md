## 현재 작업 상태
**마지막 업데이트:** 2026-04-19 (Q Task 드로어 + Q Project 상세 + Q Talk 정비)
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Q Task — 드로어 오버레이 + 리치 에디터 + 첨부**
- 드로어 `position:fixed` Linear 패턴 (기본 패널 유지)
- 상세 섹션 순서 재배치 (액션/설명/댓글/결과물/첨부/[접기])
- DB `tasks.body LONGTEXT` 추가, description(짧은 plain) + body(리치 HTML) 분리
- TipTap 에디터 — / 슬래시 커맨드 9종, BubbleMenu, 이미지 paste/drag
- `task_attachments` 테이블 + multer + 공개 UUID 경로
- 저장 상태 pill (saving/saved/error) + 2초 debounce 자동저장
- 드로어 닫기 3종 (X / Esc / 좌측 빈 영역)
- URL `?task=:id` 싱크, 제목 인라인 편집
- 초기 로딩 최적화 — 탭 전환 시 lazy

**Q Project — 상세 허브 신규**
- `/projects/p/:id` 라우트 (6탭: 대시보드·업무·테이블·고객·문서·상세정보)
- `projects.project_type` ENUM + `process_tab_label`
- createProject: 오너 자동 참여 + 2채널 자동 생성 + 상태 옵션 4종 seed + channels 커스텀 지원
- 프로세스 파트 테이블 (`project_process_parts`) + 상태/컬럼 커스텀 (`project_status_options`, `project_process_columns`)
- 대시보드: 기본정보/고객/채팅방/진척/이슈/메모/업무 타임라인 순서
- 업무 탭: Q Task 테이블 디자인 복제 + 기본 뷰(리스트+타임라인 통합)
- 상세정보 탭: 2열 풀폭, 기본정보 편집(이름/고객사/타입/기간/색상/설명) + 채팅방/이슈/메모
- NewProjectModal: 타입 카드, CalendarPicker 기간, 색상 팔레트, 채팅 채널 섹션(이름·참여자)

**Q Talk**
- 전체 프로젝트 conversations 병렬 로드 — 직접 /talk 진입해도 채팅 리스트 표시
- 이슈/메모 중복 저장 버그 (IME + submittingRef 가드)
- PlanQSelect 기본 placeholder "선택하기"

**문서화**
- `UI_DESIGN_GUIDE` 1.7 액션 버튼 3톤 / 1.8 중복 제출 / 1.9 URL 싱크
- `FEATURE_SPEC` F5-24 프로젝트 타입 / F5-25 프로세스 파트 / F6 Q Task 재작성
- `CLAUDE.md` UI 규칙 3건
- 메모리 2건 (액션 버튼 3톤, URL 싱크)

### 검증 결과
- 헬스체크 27/27 통과
- 빌드: tsc 0 error, gzip ~400 kB
- E2E: 프로젝트 17/17, 첨부 15/15, 채널 커스텀 7/7

### 다음 할 일 (다음 세션 시작점)

**프로젝트 상세 페이지 완성 잔여**
1. 업무 상세 드로어 — 프로젝트 페이지 안에서 같은 페이지 오버레이로 열기 (지금은 `/tasks?task=` 로 네비게이션)
2. 타임라인 바 드래그 리사이즈/이동
3. 프로젝트 생성 시 **채팅 채널 추가/제거 유연화** (customer+internal 2개 고정 → 0~N개 자유)
4. **문서 탭** 실제 파일 리스트 + 업로드
5. **멤버 관리** (상세정보 탭에서 추가/제거/역할)

**Q Talk**
6. NewChatModal — 프로젝트 연결 + 참여자 지정 간소 모달

**백로그**
7. F5-2b 초대 랜딩 페이지 `/invite/:token`
8. Q Talk 청크 5 — Cue 자동 추출 트리거
9. Dashboard 페이지 구현
10. lua 팀원 계정 세팅

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
