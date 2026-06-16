# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-16 (오후) — 운영 피드백 19건 그룹핑 + Q Task 클러스터(#38·#42·#48·#47) dev 수정 진행 중.

## 현재 작업 상태 (이번 세션 — dev 수정, 미커밋·미배포)
**채팅 백필(기존 백로그):** 운영 스캔 결과 대상 0건 → 종결(자동참여가 커버).

**운영 피드백 19건(#38~#56) 그룹핑 완료** → G1~G14. 1차 = Q Task 클러스터부터 처리 중:
- **#38 포커스→실제시간 반영** ✅ dev 수정+E2E 7/7. focus.js `/pause`·`/stop`·`/start` recompute+broadcast, focusSync leavingProgress 에서 recompute+pause갭정산+task.reload(완료/검토/대기 전이 전부 커버). task:updated broadcast 추가(§16).
- **#42 프로젝트 이관 권한** ✅ (Irene 결정: 담당자·작성자도 허용). FIELD_RULES.project_id + TaskDetailDrawer canEditProject = isAssignee||isCreator||owner||admin.
- **#48 리스트 직접수정 리프레시·삭제** ✅ dev 수정. QProjectDetailPage socket task:* 를 debouncedReload→in-place merge(리프레시 제거, 이관 시 프로젝트 이동 실시간). TaskRowActionMenu 삭제 확인단계+403 사유 인라인 표시(errForbidden/errHasActivity). QTaskPage 낙관적 제거. utils/taskDeleteError.ts 신규.
- **#47 채팅 추출 후보 거절 안 됨** ✅ dev 수정+E2E. projects.js reject 라우트가 project_id 만 처리 → register 처럼 conversation_id(독립대화) 분기 추가.

**G3 #46 후보카드 통일** ✅ Q Task 우측 '추출된 업무'를 공유 TaskCandidateCard로 교체(담당·기간 인라인+등록/거절). registerCandidate overrides 지원, rejectCandidate 추가. 빌드 green. **→ Q Task 클러스터(#38·#42·#47·#46·#48) /검증 10단계 전부 통과(헬스29/29·HTTP E2E #42·#48·멀티테넌트 4/4).**

**G5 #39·#40 구독배너** ✅ 조사결론: 이미 `ad35d24`로 수정·운영배포됨 + 운영 데이터 정리됨(grace 워크스페이스 0건, Irene active_business_id=null, biz1 active). 06-15 당시 basic결제 처리 전 starter sub가 grace였던 stale → **현재 재현 안 됨.** 비재현 버그라 추가 변경 안 함. Irene 재현여부 확인 대기.

**G4 #43·#44·#45 팝아웃** ✅ (Irene 결정: window.open 일반창 전환, PiP 포기). RightDock PiP(supportsPip/openPopoutPip/activePip/PIP_SIZE) 제거 → window.open 통일. #43(셋 다 동시)·#45(화면공유 생존)·#44(커서 포커스) 한 번에 해소. ⚠️ #26(항상-위 PiP)는 의도적 되돌림.

**G8 #52 고객초대 중복** — 운영 중복 Client 0건(dedup 이미 작동). "2~3개"는 재현 안 됨. 나머지(초대일시 시간·재발송 이력·설정↔프로젝트 동기화·멤버초대 보완)는 기획+개발 필요 → 보류.

**남은 그룹(미착수, 다수 기획결정 필요):** G6 #50(이번주 업무설정·그래프 — ⚠️Irene 노트북 작업과 겹침, 보류) · G7 #41(캘린더 타임존·기획) · G8 #52(개선부분·기획) · G9 #53(개인외부연동 정의·기획) · G10 #55(QMail멀티계정·기획) · G11 #56(통합보고서탭) · G12 #54(문의/QNote리스트·카테고리) · G13 #49(SNS OG메타) · G14 #51(대시보드타임라인+고객담당자표시).

**✅ 운영 라이브 (deploy `20260616_135924`, commit `f75b020`, v1.37.0, 138초).** 헬스 OK·PM2 prod online·last-deployed=f75b020. 8건 운영 반영 완료. (deploy 스크립트 EXIT=1은 요약 후 트레일링 비치명 — 기능 영향 없음 확인)

**#51·#56 dev 완료+빌드 green (commit `fbe0a1f`, 미배포 — 다음 `/배포`):**
- #51 프로젝트 대시보드 타임라인 마감일 내림차순(최신 먼저). QProjectDetailPage DashboardTimeline.
- #56 워크스페이스 주간보고 서브탭 [통합보고서/멤버 주간보고] 분리 + 워크스페이스명 제목. WeeklyReviewTab.

**✅ #51·#56 운영 라이브 (deploy `20260616_142?`, v1.37.1, commit `ba22a4c`).** health ok·PM2 prod 1.37.1.

**#54 Part 1 완료·커밋(`c9eff31`)·미배포** — MyFeedbackPage 검색+분류+상태 필터(PageShell actions). 빌드 green·i18n ok.
**#54 Part 2 (미착수)** — Q Note 카테고리/태그(메모·음성 통합 분류+필터, Q docs 패턴). qnote `sessions`(MySQL)에 category/tags 컬럼 없음 → **Python qnote 스키마 ALTER + 모델/CRUD + 프론트 필터 UI** 필요한 별도 청크. routers/sessions.py.

**남은 그룹 — 전부 기획설계 위임형(Irene이 "탁월하게 판단해줘"):**
- #49 SNS OG 메타 — ⚠️ 크롤러용 **서버 OG 주입 + nginx 라우팅(운영 인프라)** 필요. 설계+승인 권장.
- #41 Q Calendar 타임존 — 워크스페이스 tz 기본 + 개인 tz 보조표시 기획.
- #53 개인 외부연동 정의 — 개인 vs 팀 연동 명확화 + 전수 검증.
- #55 Q Mail 멀티계정 뷰 — All/이메일주소별 인박스.
- #54 내 문의·QNote 리스트/카테고리 — Q docs 패턴 재사용.
- #52 개선부분(초대일시 시간·재발송 이력·동기화·멤버초대 보완).
- #50 보류(Irene 노트북 겹침).
다음 미배포 커밋: f75b020(배포됨) 이후 fbe0a1f.

**검증/배포:** 프론트 빌드 진행 중. 커밋·배포 안 함(Irene `/배포` 명령 대기). 수정 파일: focus.js·focusSync.js·tasks.js·projects.js(backend) / QTaskPage·ProjectTaskList·QProjectDetailPage·TaskDetailDrawer·TaskRowActionMenu·taskDeleteError.ts·qtask.json(ko/en)(frontend).

### (이전) 노트북으로 이어가던 작업
**작업 상태:** 진행 중 (노트북으로 이어서)

### 오늘 운영 배포된 것 (그대로 둠 — 변경 금지)
- `997bda3` 새 워크스페이스 만들기 드롭다운 (WorkspaceSwitcher)
- `3449855` 생성 모달 접근성
- `ad044e8` 초대 수락 알림 링크 `/q-project`→`/projects/p` fix
- `3998b2f` **Q Task "이번 주 나의 업무" 포함 규칙 재정의** (docs/WORK_FLOW_DESIGN.md §5):
  - 완료/취소: completed_at 이 이번 주인 것만
  - 미진행(not_started): 이번 주 계획/마감인 것만
  - 진행중·검토중·수정요청·대기: 날짜 무관 전부

### "이번 주에 예전 완료가 뜬다" 호소 — 근본원인 규명 (결론: 코드 정상, 데이터 정상)
- 현상: 워프로랩/PlanQ 워크스페이스 "이번 주 나의 업무"에 옛 완료(예: 워드프레스 블로그 프로젝트, 기율법률사무소) 업무들이 뜸.
- **근본원인 = 자동 담당자 지정.** `services/templateApply.js:80` — 프로젝트를 템플릿/AI로 만들 때 업무에 담당자 미지정 시 `|| actorUserId` 로 **생성자(PM=Irene)가 자동 담당자**가 됨. 그래서 본인이 안 맡았는데도 "내 업무"에 뜸.
- completed_at 은 정상 (Irene 이 오늘 6/16 프로젝트에서 일괄 완료처리 → 이번 주 완료로 표시되는 게 맞음. 과거 일정이어도 시스템에 넣고 완료해야 보여서 오늘 처리한 것).
- **Irene 결정: 자동 담당자 지정은 문제 아님 → 그대로 둠. 변경 금지.**
- ⚠️ 주의: 진단 중 completed_at 을 due_date 로 잘못 UPDATE 했다가 **원복 완료** (운영 #83~86 → 2026-06-16 원래값 복구). 백업 `/tmp/completed_at_backup_20260616.json` (운영).

### 다음 (노트북에서 Irene 진행)
- "이번 주 나의 업무" 섹션 정리 방향 검토 (완료/미완료/지연 그룹핑 등 — UI 구성). 코드 변경은 Irene 진행 예정.
- 참고: 자동 담당자(PM) 지정을 끄거나 옵션화할지는 미결 (현재 유지하기로 함).

### 백로그 (이전 사이클)
- [프로젝트·채팅] 기존 수락 고객 고객채팅 일괄 합류 백필
- [AI #6] 생성물 재수정/재생성 UX 통일 · [lua #9] reviewing 13건 · [Q docs #10] PDF 다운로드
- [모바일] 🔴 iOS OS push — Capacitor 네이티브 대기

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
