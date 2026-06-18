# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-18
**작업 상태:** 완료 — Q위키 진입점 연결 F6·F7·F8 (dev 검증 완료, 미배포)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **Q위키 진입점 연결 F6·F7·F8** (순수 프론트 배선, DB·API·실시간 변경 0):
  - **F6** `HelpDot` 에 `askTab` prop(기본 `'wiki'`) → ⓘ "Q helper 에 묻기" 클릭 시 `cue:ask` detail.tab='wiki' 전달, 드로어가 Q위키 탭으로 진입(드로어 tab 분기는 이미 기구현 — CueHelpDrawer.tsx:176-189).
  - **F8** 기존 진입점 6곳(QTask·QTalk·QNote·Knowledge·QDocs·Todo) askTab 미지정→기본 wiki 자동 라우팅 + **Dashboard `PageShell.helpDot` 신규**(dashboard.help ko/en).
  - **F7** 랜딩 헤더 nav + 푸터 PRODUCT "도움말"→`/wiki` (landing `nav.help` ko/en).
  - 수정 파일: HelpDot.tsx · LandingLayout.tsx · DashboardPage.tsx · locales {ko,en}/{landing,dashboard}.json.
  - 검증: 헬스 29/29 · 빌드 EXIT0(index 12:02) · dev `/`·`/wiki`·`/dashboard` 200 · i18n 하드코딩 0 · HelpDot 8 사용처 후방호환 · 레이아웃 표준 0위반.
- **운영 피드백 14건(#57~#70) 전수 정리** — 운영 DB(87.106.78.146) feedback_items 조회. 4클러스터 분류(아래 "다음 할 일" 참조).

### 다음 할 일
1. **미배포 F6·F7·F8 → `/배포`** (다음 섹션에서 운영 반영).
2. **B 클러스터 — Q helper 허브 마무리 (착수 전 설계 확인):**
   - **#70 내 문의·피드백** (오늘 11:53 Irene): `/me/feedback` 를 좌측 리스트/우측 상세(Q docs·Q note식 master-detail, `?item=:id`) 재구성 + **답변에 추가문의 스레드**. 제안: `feedback_items.parent_id` self-FK 1컬럼(기존 무영향) + `GET /mine` 부모기준 그룹핑 + `POST /` parent_id 허용(본인·답변완료 부모만) + platform_admin notify. PanelLayout/SearchBox/PlanQSelect 재사용. **중 규모, DB변경 → 착수 전 승인.**
   - **#61 Cue 답변 범위** (오늘 09:29 Irene): 진단됨 — Q helper 드로어 Cue(workspace)는 page_context(경로)만 넘겨 `buildCueContext`(services/cue_context.js)가 본인 업무/일정/인박스+KB만 봄, 질문 기준 전 워크스페이스(업무·고객·프로젝트·문서·청구) 검색 안 함. → "권한 범위 내 전방위 검색 주입" 필요. **AI 감사(docs/AI_FEATURE_AUDIT.md A항목)와 중첩 — 함께 다룰지 결정.**
   - **A1·A2 AdminWikiPage** — `routes/admin_wiki.js` 라이브. 카테고리·article CRUD + RichEditor 본문 + published 토글 + 1클릭 캡처 + 미리보기 UI 신규 + Admin 사이드바 "Q위키 관리". **중 규모.**
3. **C 클러스터 — 빠른 버그:**
   - **#69** 관리자에게 "Q Bill 연체" 배너 오표시 — 구독결제 연체(설정>구독)를 Q Bill(고객청구) 연체로 잘못 노출(#39·#40 계열). 배너 출처/문구 분리.
   - **#60** 모바일 Q talk push 미수신 (iOS push 미해결 계열 — 기기 표시 단계).
4. **상태 정리(코드 X):** #57·#58·#59 는 v1.40.3 으로 이미 수정·배포됨 → 운영 feedback_items 상태 done + 한수정 회신.
5. **D 클러스터 — 대형 전략 재설계(별도 `/기능설계` 사이클, Irene 결정 필요):** #66 고객/외부업체/프리랜서 명칭+담당자화+최정우 연동버그 · #67 조직(부서/팀) 기반 소속+부서별/회사/개인 대시보드·통합보고서 · #64 통합보고서 통합뷰/프로젝트뷰 분리 · #65 프로젝트 항목 확장(목표·핵심메시지 등)+종합 타임라인+업무연계도 · #62 자료 보안등급+외부공유/개인드라이브 제한 · #63 자료 일괄 export+워크스페이스 간 이동 · #68 Q talk @멘션.

### 참고
- `planq-dev-backend`·`planq-qnote` 는 **irene** pm2. `pm2 restart planq-dev-backend`.
- 운영 DB 읽기: `ssh irene@87.106.78.146 'cd /opt/planq/backend && node ...'` (PROD_BE=/opt/planq/backend, port 3004).
- 운영 피드백은 운영 서버 feedback_items (dev DB 아님 — dev엔 4월 테스트 4건뿐).

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
