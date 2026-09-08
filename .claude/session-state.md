## 현재 작업 상태
**마지막 업데이트:** 2026-09-08 (Opus 5, 1M)
**작업 상태:** 배포 완료 (Irene 이석 — 남은 것은 다음 세션에서 이어서)
**배포:** — **v1.48.13** · commit `8739f05c` · 20260908_064239

### 이번 배포에 들어간 것
1. **Cue 가 파일을 내용으로 찾아 답한다** — 업로드 시 본문 색인(`services/fileIndex`).
   스키마 무변경(`kb_documents.source_type='file'` 재사용). Drive 저장분도 읽는다(전엔 0건).
   어휘 게이트 제거 — "계약서 금액 얼마야?" 처럼 '파일' 이라는 말 없이도 찾는다.
   근태·휴가 + 주간 보고서도 Cue 범위에 들어왔다.
   **운영 백필 완료: 59건 색인 · kb_chunks 158개 · status 전부 ready**
2. **메일 요약·검증** — 번역 옆 '요약·확인'. 검증은 LLM 이 아니라 결정적 신호로만.
3. **평문 메일 링크 · 내용 복사 · 본문만 ⌘A**
4. **채팅 첨부 미리보기 두 원인** + Drive 편집 · **Q File 출처는 태그(겹침)**
5. **반복업무 수정 범위가 태그·컨펌자까지** — 판정은 `services/taskSeriesScope` 한 함수
6. **업무 팝아웃 정렬**(최신등록순 기본·이름순·업무단계순), 그룹 안쪽 순서
7. **주소별 메일 보기 429** — 무한스크롤이 폴더 목록을 부르던 것
8. **렌더 크래시 자동 보고**(`POST /api/client-errors`) + **관리자 16화면 크롤 카나리**

### 신규 카나리 (전부 양방향 반증 완료)
`chatattach` 2/2 · `filesrc` 4/4 · `fileindex` 8/8 · `mailbrief` 11/11 ·
`mailplain` 8/8 · `seriesscope` 8/8 · `admincrawl` 16/16

### ▶ 다음 세션 **첫 작업** (Irene 지시 2026-09-08)
**Drive 폴더 트리 이관 dry-run 을 먼저 보여준다.** 실행하지 말고 결과만 보고한다.

```bash
ssh irene@87.106.78.146 "cd /opt/planq/backend && node scripts/migrate-drive-folder-tree.js"
```
- dry-run 이 기본이다. `--apply` 는 **Irene 이 결과를 보고 승인한 뒤에만.**
- 보고할 것: 옮길 파일 몇 건 · 어디서 어디로 · 건너뛰는 것과 그 사유.
- 로그는 `/tmp/planq-drive-tree-*.json` 에 남는다.
- 배경: 파일의 Drive 자리를 정하는 규칙이 세 곳으로 갈라져 있던 것을
  `services/gdriveMirror.resolveDriveParent` 한 함수로 모았고(2026-09-07),
  그 규칙으로 **기존 파일을 다시 배치**하는 것이 이 스크립트다.
  스크립트가 앱과 같은 함수를 쓰므로 이관 결과가 앱 동작과 갈라지지 않는다.

### 그 다음 (Irene: "지금 남은 거 다음에 다 하자")
1. **플랫폼 관리자 React #185 재현** — dev 16화면 + 항목 클릭 모두 정상이고 운영 위키(66)·
   개발현황(52) 데이터도 구조가 깨끗해 재현 실패. 이번 배포의 자동 크래시 보고가 살아 있으니
   Irene 이 그 화면에 한 번 더 들어가면 `pm2 logs planq-prod-backend | grep client-crash` 에
   경로·컴포넌트가 남는다 → 그걸로 고친다
2. **docx·xlsx 본문 추출** — 운영에 4건뿐이라 후순위(지금은 텍스트·PDF·HTML만)
3. **Q Note 회의록을 Cue 범위로** — 별도 서비스(FastAPI)라 내부 호출 설계 필요.
   본인 것만 읽어야 한다(개인 도구 L1 정책)
4. **Q Sale 사이클 1** — Irene 이 명시적으로 제외해 둔 것

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
