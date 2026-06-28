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
