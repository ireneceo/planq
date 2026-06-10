# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-10 — 운영 신규 피드백 처리 중. **오전 배포(`a145e37`) 이후 dev 추가 수정분 미배포** (Irene이 운영에서 옛 화면 보고 같은 버그 반복 보고 중 → 배포 필요).

---

## ✅ 운영 라이브 (오전, a145e37)
Q docs 버그 클러스터(#3·4·5·7) + 통화 원 + 청구서 발행일 + 메모장 스크롤 + 인박스 3버그 + 빌링 관리자 입금확인. + 운영 DB ALTER (payments notify 2컬럼, business_members.role ENUM 'admin').

## 🟡 dev 완료·검증 · **미배포** (이번 세션)
배포하면 운영 피드백 #18·#22·#20 상당수 즉시 해결:
- **#12 Q info(KB) 공유/수정/리스트 (운영 #18·#22)** — 모두 dev 빌드 EXIT 0:
  - `PublicKbDocumentPage` CTA `/talk?kb=` → `/info?doc=` (+ `KnowledgePage` `?doc=` 리더로 문서 자동 열림) — "planQ로 보기가 Q talk로 감/메인 튕김" fix
  - `PublicFilePage` `/file?file=`→`/files?file=`, `PublicTaskPage` `/task?task=`→`/tasks?task=` (같은 단수경로 튕김)
  - `RichEditor` `.pq-editor-body` + `KnowledgePage BodyClickable` `overflow-wrap:anywhere` — 긴 URL 레이아웃 깨짐 fix
  - `KnowledgePage` 저장 silent catch → 에러배너 노출 + 실패 시 편집유지(DrawerBodyEdit/TagsEdit) + `knowledge.errors.saveFailed` ko/en
  - **`access_scope.js postListWhereByLevel` 작성자 본인 글 항상 노출** — member가 프로젝트멤버 아니어도 자기 L2 문서 리스트에 보임. **E2E 5/5** (격리 유지)
- **#13 Q helper 워크스페이스명 (운영 #20)** — `CueHelpDrawer` "내 워크스페이스" → "{business_name}에 대해 무엇이든" (타이틀+입력란), common ko/en `{{ws}}` 보간

> **배포 시 운영 DB ALTER 불필요** (코드만). `./scripts/deploy-planq.sh --auto`.

## 📋 신규 백로그 (운영 피드백, 진단/설계 단계)
- **#18 공개 공유 레이아웃 통일** — public KB 미리보기 헤더/푸터를 문서 public 페이지와 동일 레이아웃으로. 모든 Public*Page 공통 컴포넌트.
- **#19 다수공유(번들) 리스트 뷰** — kb-bundle 공유를 리스트→상세 패턴으로. PublicKbBundlePage.
- **#20(task) 포커스 측정시간 SSOT (운영 lua #17) — 진단 완료, 구현 대기.** 근본: focus 표시가 '현재 세션 1개'라 재개 시 0리셋(#17-2), FocusWidget(baseline+tick) vs TaskFocusBar(actual_seconds+tick 이중계산) 불일치(#17-1), actual_hours는 status_history 기반이라 focus와 분리+실시간 안 됨(#17-3). **수정안: SSOT = task의 stopped focus_sessions 합 + 진행중 elapsed.** backend `sumFocusSecondsForTask` 헬퍼 + `/focus/current`에 `task_accumulated_seconds` + 두 위젯 공용 카운터 훅(`useFocusElapsed`). 파일: `focus.js:74,122` / `FocusSession.js:20` / `FocusWidget.tsx:231` / `TaskFocusBar.tsx:157` / `TaskDetailDrawer.tsx:951` / `taskActualHours.js:15` / `focusSync.js:51`.
- **#15 모바일 등록 팝업 키보드 가림** (운영 #23) · **#16 외부캘린더 일정 제목 누락** (운영 #24) · **#14 본인 피드백 내역 보기**(운영 #21, GET /api/feedback/mine 있음 → UI).
- 청구서 묶음: #1 외부 수신자 직접입력 · #2 항목 상세내용 · #11 공유·다운로드·미연동 표시 · #10 문서 PDF 다운로드 · #6 AI 재생성 통일.

## 운영 피드백 원본 (운영 DB feedback_items, pending)
#24 외부캘린더 제목 · #23 모바일 키보드 가림 · #22 Q info 공유/레이아웃 · #21 본인 문의내역 · #20 Q helper 워크스페이스명 · #19 Q task 실시간 · #18 Q docs 리스트/Q info 수정·공유 · #17 포커스 측정시간. (done: #2·3·4)

## 환경
- dev 3003 / prod planq.kr 3004 (v1.33.3). 배포 `./scripts/deploy-planq.sh --auto`.
- ⚠️ 백그라운드 `pm2 restart` 자주 멈춤 → **포그라운드 `timeout 45 pm2 restart`** 사용.
- 운영 DB 조회/ALTER: `ssh irene@87.106.78.146 'cd /opt/planq/backend; node -e "..."'` (운영 자체 config/database, idempotent).
