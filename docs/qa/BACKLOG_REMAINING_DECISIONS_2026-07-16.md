# 남은 백로그 — Irene 결정 필요 항목 (2026-07-16 밤 자율 세션 결과)

> 자율 밤샘 세션에서 `docs/qa/NEXT_SECTION_BACKLOG.md` 전수 검증. **기능 고장은 전부 수정**했고,
> 나머지 대부분은 **이미 구현됐으나 백로그에 close 안 된 상태**였다. 실제로 남은 미완은 ⑤·⑥ 둘뿐이며,
> 둘 다 **설계 결정이 선행**되어야 해서 자율로 완성하지 않고 여기 정리한다. (임의로 지으면 "대충"이 되어 재작업)

---

## 이번 밤 실제로 고친 것 (dev 반영·커밋, 운영 미배포)

| 항목 | 커밋 | 검증 |
|------|------|------|
| #126 캘린더 동기화 안내 배너 | c49e7e3(완성) | tsc/vite EXIT0, 배너 번들 포함 |
| Q Mail AI #153/#164/#179 (언어·미리보기·추출무반응) | `9a293e3` | 유닛 11/11, 실HTTP 영어메일→영어답장(ko:0/en:198), health 30/30 |
| #155 말로추가 iOS 포맷 견고화 | `79db3e4` | tsc/vite EXIT0 (실기기 STT는 배포 후 검수) |

## 검증해보니 이미 완료였던 것 (재작업 안 함)
- #166 주간 진척그래프 — 유예·과정형/결과형·코칭문구 전부 구현됨. **문구 Irene 컨펌만 남음**
- 모바일 반응형 ② (a~e 전부) — 탭바 overflow·KPI 2열·통계필터·달력잘림·키보드여백 전부 처리됨
- #163 캘린더 모바일 — 뷰/스코프 드롭다운·툴바 모바일CSS·기본 agenda 처리됨
- MyFeedback 2-pane — 모바일 list↔detail 토글 + BackBtn 완비 (감사 mediaPhone grep 오탐)
- #162 피드백 환경/팝아웃 수집 — FeedbackItem client_env/is_popout 컬럼(DB반영)·팝아웃 부모URL 보정 완비
- #152 공유링크 OG — `middleware/ogMeta.js` 봇 감지 후 posts/sign/docs/tasks/files/kb/calendar/invoices 엔티티별 OG. 실HTTP 검증됨

---

> **2026-07-16 심야 2차 갱신 (Fable 판정 후 실행):**
> - ⑤(B) **완료(dev)** — Fable GO 판정. `created_via VARCHAR(20) NULL` 3테이블(tasks/calendar_events/documents, sync-database 자동) + action layer(createTask/Event/Document) `createdVia` 배선 + cue_tools executeTool 생성 3분기 `'cue'` 세팅 + `ProvenanceBadge`(중립 회색, ✨ 없음) 3화면(TaskDetailDrawer·EventDrawer·DocumentEditorPage) + i18n `common:provenance.cue`(Cue로 추가됨/Added via Cue). **원칙 무충돌 실증**: source='manual' 유지·created_via가 권한/재무/전이 로직 0건(grep 불변식)·고객 응답 차단(taskClientView BLOCKED_FIELDS). 실HTTP: Cue execute-action→created_via='cue'/source='manual'·멤버 toJSON 노출. 가드 3축 통과.
> - ⑥ **카나리 자동화 3건 추가** — Fable CONDITIONAL-GO. `canary-tabs.js`에 뒤로가기·F5복원·마이크 track-alive(fake-device) 추가 → tabs 스위트 **6/6**. Irene 인간검증 5→**2건(IME 한글조합·전환 체감)**으로 압축. beta/spike 운영 플래그는 여전히 off(Irene 2검증 후 /배포 때 flip).
>
> **[1차] 2026-07-16 심야 갱신:** ⑤(A) **완료·운영 배포됨** — 캔버스 AI 초안 생성(`projects.strategy_sources` JSON + `project_workstreams.source` ENUM('ai','manual') 마이그레이션 + `services/canvasDraft.js` + POST `/:id/canvas/ai-draft` + AutoGenBadge 3상태. ProjectCanvas·WorkstreamBoard 부착). ⑤(C) **확인 결과 이미 구현됨** — 세 보고서 뷰(ReportUnitView "자동 확정"·IntegratedReportView "자동확정"·WeeklyReviewWorkspaceView `Badge $auto` "자동")가 `finalized_by==='auto'`로 자체 자동 배지 표시 중. 신규 작업 불요(작동 배지를 ✨로 교체 = churn). ⑤(B)만 미결(아래).

## ⑤ 자동/수동 인지 (source 플래그) — **⑤(B)만 결정 필요 (A·C 완료)**

### 조사로 드러난 사실 (전제가 일부 성립 안 함)
1. **프로젝트 개요/캔버스는 현재 AI가 생성하지 않는다.** strategy_*·success_metrics·workstream·process part
   전부 사용자 수동 입력 전용이고 백엔드에 AI 채움 경로가 **없다**(전수 grep 확인). 즉 캔버스에
   "자동입력 배지"를 붙이려면 **AI 초안 생성 기능을 먼저 만들어야** 한다.
2. **Cue 생성물의 `source:'manual'`은 의도된 설계다.** Cue 대화형 실행 모델(#81)은 "사람이 확인 카드를
   눌러야 실행 = 사람 본인의 행동"이라 actor=사용자. 그래서 task.source='manual'로 박힌다. 이걸 'ai'로
   뒤집는 건 [[project_cue_conversational_execution]] · [[project_agent_permission_model]]의 근본 원칙을
   건드리는 결정 — 임의 변경하면 안 됨.
3. **재사용 자산 존재:** `components/Common/SourceHint.tsx`에 `AutoGenBadge`("✨ 자동 생성") 이미 구현됨(미사용).
   백엔드 선례: `TaskEstimation.source ENUM('ai','user')`, `Document.ai_generated`, `Task.actual_source`.

### Irene 결정 필요
- **(A) 캔버스 AI 초안 생성을 만들 것인가?** 만든다면 그때 `strategy_sources JSON` + workstream/part `source`
  컬럼을 함께 도입하고 3상태 배지 부착(자동입력+수정가능 / 완전수동 / 읽기전용). **안 만들면 캔버스 ⑤는 무의미.**
- **(B) Cue 생성물을 "AI 유래"로 표시할 것인가?** 표시하려면 "사람 확인=사람 행동" 원칙과 어떻게 화해시킬지
  (예: source='manual' 유지하되 별도 `created_via='cue'` 프로비넌스 컬럼 추가 → "Cue 도움으로 추가됨" 배지).
- **(C) 즉시 가능한 안전 슬라이스:** 자동 생성 보고서(Report/WeeklyReview/BusinessWeeklyReport — 이미
  `generated_by nullable`/`finalized_by ENUM('manual','auto')` 보유)에 "✨ 자동 생성" 배지만 부착.
  마이그레이션 0, Cue 모델 무접촉, 순수 additive. **승인하면 바로 구현 가능.**

> 권장: (C) 먼저(저비용 즉효) → (A)는 별도 기능으로 기획 → (B)는 Cue 원칙 재확인 후.

---

## ⑥ 노션형 상단 멀티탭 — **구현·배포 완료(플래그 off), Irene 5 인간검증만 남음**

> **2026-07-16 심야 갱신:** P0-A~P1 **전부 완료 + 운영 배포됨(플래그 off)**. UI 와이어는 Irene 피드백 반복 반영으로 확정(좌측바짝·브라우저모델·＋통합검색·위치고정·닫기가드). strangler 10/12 커밋.
- 구현: `tabStore`(외부 store)·통일 `TabStrip`·chrome 17파일 RR탈피·형제 `MemoryRouter` 트리스왑·keep-alive·오버레이 편입·숨은탭 격리·라우트 config+drift 가드. tabs e2e **3/3 영구 게이트**.
- 운영: 두 플래그(`planq_tabs_beta`/`planq_tabs_spike`) 기본 off → 운영 사용자는 재구성 shell만(planq.kr 무회귀 실측), 탭바·keep-alive 미노출.
- **남은 것 = Irene 5 인간검증** (spike on: `localStorage.setItem('planq_tabs_spike','1')`): IME 한글조합·전환 체감·뒤로가기·Q Note 마이크 유지·F5 복원 → 통과 시 ⑫에서 beta 승격. + ⑪ 탭 드래그정렬(폴리시).
- 메모리: [[project_multitab_keepalive]]. 설계 `docs/MULTITAB_DESIGN.md`.

---

## ⑦ 인프라 — Irene 액션 (개발 아님)
- Stripe Webhook Secret 입력 (백엔드 준비됨)
- 운영 SMTP DKIM/SPF/DMARC DNS (운영 발송 전 필수)
- Google OAuth 검증 제출 (승인 시 캘린더 양방향·Gmail 원클릭 활성)

---

## 배포
이번 밤 커밋(9a293e3·79db3e4 + 캘린더배너) 전부 **dev만**. Q Mail·voice 는 재무/보안 경계 아님 →
일반 `/검증` 급. 운영 반영은 Irene `/배포` 시. (OG·공개라우트는 이미 운영 반영된 기존 기능)
