## 현재 작업 상태
**마지막 업데이트:** 2026-09-13
**작업 상태:** 완료 (운영 배포 `1f57a4e6` · v1.50.0 · 20:06)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **★ 운영 회귀 수리** — `routes/projects.js` 의 `GET /:id/notes` 중복 선언이 **프로젝트 메모 조회를 가리고** 있었다(v1.49.0 에 나갔다). Q talk 우측패널·프로젝트 상세·Q task 4곳이 에러 없이 Q Note 목록을 받았다. 경로를 옮기고 가드 `--category=duproute` 신설(873개 경로, 깨뜨려 확인)
- **노트 탭 = Q Note 본체** — `QNotePage scope={{type:'project'}}`. 문서 탭이 `PostsPage` 를 쓰는 것과 같은 방식. 녹음 중에는 탭을 옮겨도 언마운트하지 않는다. `NotesTab.tsx` 삭제
- **q-note 쓰기 경로 조용한 결손 2건** — ①생성 시 보낸 `project_id`·`client_id` 가 스키마에 없어 버려지고 있었다 ②공개 범위를 L2 아닌 값으로 바꾸면 `project_id` 를 NULL 로 덮어써 프로젝트에서 사라졌다. 연결과 공개 범위를 갈랐다
- **정보 탭 = Q info 한 벌** — 목록 행을 `components/Knowledge/kbListShell` 로 추출해 두 화면 공유. 정렬 3종·EmptyState·카테고리 라벨 함수 일치. AI 버튼을 표준 `AiActionButton` 으로
- **고객 프로필에 [노트]·[정보]**(읽기 전용) — 새 라우트 `GET /api/clients/:biz/:id/qnotes`(`routes/client_links.js`, clients.js 앞 마운트). `/info?doc=N` 딥링크가 keep-alive 탭에서 죽던 것도 수리
- **문서 표 두 겹 수리** — ①[폭 맞춤]이 열마다 160px 고정 → 본문 폭을 재서 나눔 ②prosemirror-tables 의 **인라인 min-width** 가 우리 `min-width:100%` 를 덮어 표가 `max-content` 에 머물렀다 → 스타일시트를 `!important` 로. 버튼 문구 `열 균등` → `폭 맞춤`
- **카나리 2종 신설** — `--suite projecttabs` 8/8 · `--suite tablefit` 8/8 (둘 다 양성 대조군으로 판정 뒤집힘 확인)
- 문서: DEVELOPMENT_PLAN · CLAUDE.md(라우트 중복 절·탭 임베드 규칙) · UI_DESIGN_GUIDE 1.11(표 폭 계약) · Q위키 아티클 2건(`project-notes-tab`·`document-table-width`) · memory 2건

### 검증 (Fable 미검증 — 자체 검증)
- 빌드 EXIT 0 / `error TS` 0 · 가드 EXIT 0 (✗ 0건) · health-check 44/44 · e2e tenant 실패 0
- 실HTTP: 라우트 충돌 9/9 · 고객 연결 7/7 · 픽스처 대조 10/10 · 연결 유지 8/8
- 실브라우저: `projecttabs` 8/8 · `tablefit` 8/8 · `detailopen`·`drafts`·`salepanel` 실패 0
- 표 폭 실측 — 1440: 전 290/872(여백 582) → 후 872/872(여백 0) · 375: 표 872/본문 327 래퍼 스크롤, 페이지 안 밀림
- **Fable 호출 오늘 전부 HTTP 429.** 마커 `by:"unavailable"`. 확인 항목은 `docs/FABLE_GATE_QUEUE.md` 29번

### 다음 할 일
- **Fable 게이트 라운드** — 대기열 26·27·27-B·28·29 를 한 번에 올린다(토큰 회복 시). 특히:
  - 표 기본 폭의 `!important` 가 열 리사이즈·붙여넣기·undo 에서 부작용이 없는지. **옛 문서(저장된 열 폭 합계가 본문보다 좁은 표)는 이제 늘어난다**
  - q-note 생성 경로의 새 연결 필드 소속 검증 · 공개범위 변경이 L2 판정 전제를 흔들지 않는지
  - `/api/clients` 에 라우터 둘을 마운트한 순서 계약
  - 프로젝트 노트 탭 녹음 중 탭 전환이 recorder lock·WS·quota 계측에 미치는 영향
- **어제의 표 잘림 수정은 여전히 실측 못 함** — 게스트 문서 보기·프로젝트 문서 미리보기. 게스트 토큰이 해시 저장이라 링크 복원 불가. **Irene 이 게스트 링크 1건을 주면 바로 잰다**
- 버튼 전수검사 2~3라운드 — `data-testid` 부여는 Irene 승인 대기(클릭 가능 2,178개 중 343개만 보유)
- 게스트 프로젝트 링크에 거래 탭을 넣을지(고객 안전한 형태로) — R=1, Fable 판단 대기

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
