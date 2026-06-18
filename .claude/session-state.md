# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-18 — dfd23b2 검증완료 + 신규 운영피드백 #57·#58·#59(포커스/주간그래프) 수정·커밋.

## 2026-06-18 세션 (미배포 — 다음 `/배포` 대기)
- **dfd23b2 (Q Mail 팀/개인 scope + Q Bill 인박스/프로젝트연결) 검증완료** — E2E **20/20 PASS** (공용=admin·개인=본인 격리·set-default 개인400·발행자 결제대기 미노출·고객 누출차단·projectStage &project=). 커밋은 이미 dfd23b2 (미배포).
- **신규 운영피드백 #57·#58·#59 (오늘, 포커스/주간업무진척 그래프) 수정·커밋 `6ea454a` v1.40.3** — 근본원인: 그래프 actual 라인이 task_daily_progress 스냅샷(cron 아침)만 사용 → 진행중 업무 포커스 측정시간이 그날짜에 안잡힘(스냅샷 없으면 빈 그래프), 오늘도 actual_hours 합만 써 active 포커스 미반영. 수정: daily-progress 가 FocusSession.computeActualSeconds() 일별귀속 누적 + act_used=max(스냅샷,포커스), 프론트 오늘 actual=max(라이브, 포커스누적). #59 submit-review 는 이미 정상(포커스중단+actual계산 검증됨) — 그래프 미반영이 증상이었음. E2E 6/6.
- **다음 `/배포` 대상 커밋:** dfd23b2 + 0119427(v1.40.2) + 6ea454a(v1.40.3).
- **도움말(Help) 시스템 — Irene 신규 대형요청.** 범위 확정: Q helper + 랜딩 + 전용 도움말센터(`/help`). 초보자 단계별 가이드 DB + Puppeteer 자동 스크린샷. 피드백 처리 후 기능설계→승인→구현. memory `project_help_center_plan`.

---
## (이전) 2026-06-16 (오후)

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

**✅ #54 Part1+2 운영 라이브 (v1.38.0, commit `d35110c`).** MyFeedback 필터 + Q Note 카테고리/태그(메모·음성 통합). 운영 qnote.db category/tags 컬럼 자동추가 확인. qnote E2E 6/6.

**✅ #41 Q Calendar 타임존 운영 라이브 (v1.38.1, commit `5170335`).** EventDrawer 워크스페이스 tz 시간+라벨 + 개인 tz 다르면 보조표시 / NewEventModal tz 힌트. (월/타임그리드 뷰 tz 풀리팩터는 후속 — 브라우저=워크스페이스 일치 케이스 현행)

**이번 세션 누적 배포 4릴리스 / 14 피드백:** v1.37.0(#38·#42·#48·#46·#47·#43·#44·#45 + #39/#40 확인) · v1.37.1(#51·#56) · v1.38.0(#54 Part1+2 qnote포함) · v1.38.1(#41).

**✅ 운영 피드백 19건 중 18건 운영 라이브 완료 (8 릴리스 v1.37.0~v1.38.5):**
- v1.37.0: #38·#42·#48·#46·#47·#43·#44·#45(+#39·#40 확인)
- v1.37.1: #51·#56 / v1.38.0: #54(qnote 스키마 포함) / v1.38.1: #41
- v1.38.2: #55(Q Mail 멀티계정) / v1.38.3: #52(고객 초대일시·재발송) / v1.38.4: #53(개인외부연동 정의)
- v1.38.5: #49(전 공개공유 타입 페이지별 OG — ogMetaMiddleware 확장, nginx 변경 불필요)

**✅ #50 운영 라이브 (v1.38.6, `36c4300`)** — Irene 확인 "노트북 작업 없음"으로 진행. BusinessMember.weekly_holidays 컬럼(운영 자동추가) + work-hours/my-week 왕복 + 프론트 로드·저장 → 휴일 persistence fix. 주간그래프 effectiveCapacity 가용시간 기준선(주황 점선) 추가. 백엔드 E2E 3/3.

**🎉 운영 피드백 19건(#38~#56) 전건 처리·운영 배포 완료 (9 릴리스 v1.37.0~v1.38.6).** 피드백 큐 0건.

**✅ 구독 청구(ClientSubscription) 강화 운영 라이브 (v1.39.0, `8cb34c2`)** — Irene 요청:
- 주기 추가: biweekly(격주)·semiannual(반기). advanceDate +14일/+6개월.
- 회차 자동 종료: end_mode(never/after_count/until_date)+max_occurrences+occurrences_count+end_date+status 'completed'. 발행 후 조건 충족 시 자동 completed.
- UI: 구독 폼 주기 6종 + 종료조건 입력, 카드 회차진행("N/M회")·종료일·상태 배지.
- ★ **nextInvoiceNumber 다건 충돌 fix** — 기존 "last by id"가 같은 날 2건+ due 시 NaN·중복으로 2번째부터 발행 실패하던 실결함(memory recurring_billing_latent_bugs) → prefix max-scan + unique 재시도. **clientSubscriptionBilling 만 fix — recurring_invoice.js·invoices.js 도 같은 패턴이라 후속 점검 권장.**
- DB: 운영 ENUM 확장(interval/status) + 4컬럼 배포 전 수동 선적용 완료.
- 검증: 엔진 E2E(주기·자동종료·3건 동시발행 번호 distinct) + 헬스 29/29.

**✅ nextInvoiceNumber 3엔진 통일 fix 운영 라이브 (v1.39.1, `25e1356`)** — recurring_invoice.js(프로젝트 정기)·invoices.js(수동)도 clientSubscriptionBilling 과 동일 robust max-scan 적용. 운영 3파일 반영 확인. 운영 invoice 번호 정합(다음 INV-2026-0002).

**✅ AI 생성물 재생성/재수정 UX 통일 운영 라이브 (v1.40.0, `0b50ed4`)** — 공유 AiRegenerateBar(지시 기반 인라인 재생성) + 백엔드 instruction(ai-create·docs ai-generate·Q Note요약). Q task·Cue·Q Note 통일. **Q docs 에디터 레벨 재생성 UI 만 남음(백엔드 ready) — 진행 중.**

**✅ Q docs 에디터 재생성 운영 라이브 (v1.40.1, `46280f4`)** — PostsPage·ProjectPostsTab 에 AI 생성 새문서 시 AiRegenerateBar(지시 기반 본문 교체). PostAiModal onGenerate 가 생성 컨텍스트 동봉. **→ AI 재생성 4영역(Q task·Cue·Q Note·Q docs) 통일 완성.**

**이번 세션 누적 릴리스: v1.37.0 ~ v1.40.1 (~14 배포).** 운영 피드백 19건 + 구독청구 강화 + nextInvoiceNumber 3엔진 fix + AI 재생성 4영역 통일.

**남은 백로그 (대형/의존):**
- iOS OS push (Capacitor 네이티브앱) — memory project_native_app_capacitor_plan. Apple 개발자계정·인증서·TestFlight 는 Irene 필요. 코드 wrapper 는 가능.
- lua reviewing 13건 — lua 항목 확인 필요.

**#49 참고:** nginx 변경 불필요였음(N+23 $planq_share_bot 봇 라우팅 기존 존재). ogMetaMiddleware 가 posts/sign 만 처리하던 것을 전 타입으로 확장한 게 fix.
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
