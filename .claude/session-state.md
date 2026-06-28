# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-28 (/개발시작 세션)
**작업 상태:** **#90 Cue 자동추출 개선 — dev 완료·검증 통과·미배포.** (이전: 배포 7회 — #93·#94 + §6 6청크 운영 라이브.)

### 진행 중인 작업
- 없음 (#90 dev 완료, 다음 `/배포` 대기)

### 이번 세션 완료 (#90 — 자동추출 개선, 미배포)
Irene 선택 "#90 진행 — 자동추출 개선". 근본원인 3개 수정:
- **Part A 담당자 (backend `services/task_extractor.js`):**
  - A1. **standalone 대화 담당자 해석** — 옛 버그: `resolveAssignees` 가 `project_id` 있을 때만 실행 → 1:1·다이렉트 채팅(project_id NULL)은 담당자 항상 null. 신규 `buildAssigneePool({businessId,projectId,conversationId})` 가 **프로젝트 멤버 ∪ 대화 참여자** 풀 빌드 → standalone 도 1:1 상대·@멘션·이름 매칭 해석.
  - A2. **표시명(닉네임) 매칭** — 옛 매칭은 `User.name`(계정명)만 → 채팅에서 부르는 워크스페이스 닉네임 불일치 시 null. pool 이 `getMemberNameMap`(BusinessMember.name) 표시명 포함, 매칭은 표시명→계정명→role 순. 발신자명·멤버목록·메시지텍스트도 표시명으로 LLM 입력.
  - email 경로도 동일 pool 시그니처로 정합. note 는 개인툴이라 null 유지(설계).
- **Part B 원본 링크 (backend `routes/tasks.js` + frontend):**
  - B1. `GET /:id/detail` 에 **`source_ref`** 추가 — `buildSourceRef(task)` 가 대화/메일/노트 출처를 라벨+상대경로로 resolve(business 격리). 대화→`/talk/:id`, 메일→`/mail?thread=:id`, 노트→라벨만. 고객(isClient)엔 미노출.
  - `TaskDetailDrawer.tsx` — 이월 배너 아래 **"원본 대화/메일/노트 보기"** 링크(클릭→onClose+navigate). `SourceRefLink` styled + i18n `detail.source.*` ko/en.
  - `TaskCandidateCard.tsx` — standalone 은 members 빈 배열이라 해석된 담당자 미표시 갭 → `guessed_assignee` 를 옵션에 보강(members 무관 표시·등록 가능).
- **검증:** 담당자 E2E 9/9(standalone pool·닉네임 매칭"아이린"→user3·계정명 보조·보수적 null) / source_ref HTTP 통합 5/5(임시멤버 생성→직접토큰→/detail 200·route=/talk/74·정리완료) / 빌드 EXIT0·TS0 / i18n qtask ko/en 819/819 / dev /q-task 200.
- **디버그 export:** task_extractor 에 `buildAssigneePool`·`resolveAssignees` 노출(buildExtractionPrompt 패턴).
- **회귀주의:** dev DB `business_members.role` enum 은 `('owner','member','ai')` — **admin 미동기화**(CLAUDE.md 는 admin 박제). 운영엔 있음. 로그인은 `email`+password(username 아님), rate-limit 5회/15분.

### 완료된 작업 (이번 세션)
- **#93-ⓐ/ⓑ** (`cfaf5c3`, 배포) — Q helper 팝아웃 재로그인 방지 + 업무 우측패널 워크플로 전수 깜빡임 제거(callAction 전체refetch→인플레이스, body/description prev 유지).
- **#94** (`403509d`, 배포 + 백필) — 주간 진척 그래프 실제선 187h 비현실값 차단. 포커스 방치세션이 8일(190h) 누적하던 근본버그 → `computeActualSeconds` last_activity+grace 캡. 운영 481.7h→8h 증명. 박제 [[feedback_focus_session_abandoned_cap]].
- **실작업률(%) 입력 UI** (`583f6bb`, 배포) — participation_rate 백엔드 완비분 프론트 연결.
- **§6 통계 재설계 6청크** (`b1558b6`·`6d0af8b`·`c610604`·`9381d53`·`5922fd3`·`3f0673e`, 전부 배포):
  - A1 가용 잔여기반 + 부하구성(이월/신규) + 이월 배지
  - A2 주간그래프 판정칩(EVM→일상어, SPI·CPI)
  - U5 실작업률 자동제안(포커스 실측, 신뢰성 게이트 40%)
  - **§6-C 스코핑 fix** — daily-progress 진척선 153h버그(전체 합산) → task_ids 이번주 스코핑(운영 153.6→8.8 증명)
  - §6-B 드로어 이월 배너 + 이번주/전체 시간(`/api/focus/task-time`)
- **설계 박제:** `docs/WORK_FLOW_DESIGN.md §6` (단일엔티티+주별렌즈, EVM, 잔여기반). 박제 [[project_qtask_weekly_stats_redesign]].
- **운영 워프로랩 실데이터 체크:** 잔여29.2h·이월7.2+신규22·활용률97%·왜곡제거·#94캡 라이브 확인.
- **테스트 잔존물 정리(dev) + 운영 피드백 17건 트리아지.**

### 이번 세션 추가 — 검증 + 신규 피드백 트리아지 (2026-06-28)
- **검증 통과:** 헬스 29/29 · 빌드 EXIT0/TS0 · 담당자 E2E 9/9 · source_ref HTTP 5/5 · cross-tenant 403 3/3 · i18n 819/819 · aiTaskPlanner #90 실증 4/4.
- **#90 진실 규명:** 운영 원문(#90)은 채팅추출이 아니라 **`aiTaskPlanner`(Cue AI 업무 추가)** 경로. 커밋 `e6e9e7a`(6/22)로 **이미 수정·운영 배포됨**(닉네임 담당자 matchMemberByName + 링크 보존 프롬프트). dev 실증: "아이린"→user3 배정 + URL 보존 4/4 PASS. **#90 = 사실상 해결**(사용자가 배포 전 테스트). 이번 세션 task_extractor 작업은 **형제 기능 보강**(채팅/메일 추출의 standalone·표시명·원본링크 — aiTaskPlanner엔 없던 구멍).
- **#95 (프로젝트 채팅방, 신규 6/26) — 부분 수정·미배포:** 확정버그 = **QTalkPage `handleCreateProject` 가 `channels` 누락**(QProjectPage 는 전달) → Q Talk 경로에서 채널 토글 완전 무시(항상 0개). `CreateProjectInput.channels` 추가 + 전달로 수정(빌드 EXIT0). **잔여 의문**: "해지했는데 생성됨" 증상은 프로젝트 생성 코드(양 경로 모두 channels.length>0 가드)로 재현 불가 → **고객 초대 시 자동 환영 대화방**(`clientOnboarding.ensureWelcomeConversation`, project_id=null, invite 수락 시) 가능성 높음. **Irene 재현경로 확인 필요**(어디서 생성·고객 추가 여부).
- **#96 (문서 테이블, 신규 6/27) — 진행 중·미배포.** 실제 기능 = **Q docs 표 kind 문서**(`PostsPage` + `PostTableGrid`), records 메뉴는 폐지(흡수). Explore 초기 매핑은 폐지된 `QRecordDetailPage` 오진 → 바로잡음. 5개 서브버그:
  - **② 기본테이블 없음 → ✅수정·검증** `routes/posts.js` kind=table 생성 시 빈 q_record(columns:0)였던 것을 **기본 컬럼 3개(제목 text/상태 select+옵션3/메모 longtext) + 빈 행 1개** 시드(언어별 ko/en). API E2E 6/6.
  - **① 생성 후 나가버림 → ✅수정** `PostAiModal.submitTable` navigate 에 `&new_table=1` + `PostsPage` 로드 effect 가 표면 edit 모드 진입(플래그 1회 소비). 빌드 EXIT0.
  - **③④ [첨부] 적용안됨/에러 → ⏳미착수** `PostTableGrid` attach 는 구현돼 있음 → 진짜 버그는 **컬럼 추가 시 type='attach' 1차 적용 실패 + cell attach 런타임 에러**. 브라우저 재현 필요.
  - **⑤ 프로젝트>문서 표 없음 → ⏳미착수(설계확정)** 프로젝트 'docs' 탭 = `ProjectPostsTab`(PostsPage 일부만 재사용, 표 미지원). **Irene 결정: PostsPage(scope=project) 로 교체.** PostsPage 는 이미 scope.type='project' 데이터 지원하나 **전체 2컬럼(사이드바+콘텐츠) 레이아웃**이라 탭 임베드 시 레이아웃 검증 필수. submitTable navigate 도 scope-aware(/docs 하드코딩 → onTableCreated 콜백) 필요.
- **#89(랜딩 푸터 카피·소) 미착수.**

### 다음 할 일
1. **§6-C 델타(carry-in 분리)** — 차트 SVG 라인 계산. 단일엔티티 스코핑으로 차트는 이미 현실값이라 **선택적 폴리시**. Playwright 시각검증 권장.
2. **U4 단조완화(되돌림 ↓마커)** — 차트 SVG, 되돌림 희귀라 저우선.
3. **운영 미해결 피드백:** #90 Cue 인식 품질(담당자 미배정·링크 누락) · 운영 feedback_items done 위생 마킹(처리된 #71·#79·#86·#87·#92·#93 등, Irene 확인 후).
4. **[검토 예정]** 피드백/문의 자동 트리아지·응답 시스템(자동회신=가능, 자동코드수정=제안까지만). 정식 /기능설계 필요.
5. **별개 후속:** status_history in_progress live inflation(task 수주 방치 시 1152h) — 작업시간 정의 product 결정 필요.

### 외부의존 (자율 불가)
- **#60** iOS 푸시 — Capacitor 네이티브앱 결정 (Irene)
- **#72/#88(ⓑ)** Google OAuth 검증 제출 — GCP 콘솔 (Irene)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
