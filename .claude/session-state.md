## 현재 작업 상태
**마지막 업데이트:** 2026-09-07 (Opus 5, 1M)
**작업 상태:** 완료 — 단, **운영 배포 미실행** (Irene 의 명시적 `/배포` 명령 필요)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 · 6차)
- **채팅 첨부 미리보기 — 원인 두 개를 모두 닫음**
  - `QTalkPage.apiMessageToMock` 이 `preview_url` 을 안 옮겨 이미지가 전부 파일 카드로 떨어지던 것
    (같은 자리에서 `reactions` 가 첨부 객체 안에 잘못 들어가 있던 것도 교정)
  - `GET /api/message-attachments/:id/download` 이 로컬 디스크만 봐서 Drive 저장분이 항상
    404 `file_missing` 이던 것 → `services/attachmentStorage.readAttachmentBody` 단일 원천으로
- **미리보기에서 바로 편집** — `AttachmentPreviewDrawer` 에 "Drive 에서 편집"
  (채팅·업무 첨부·의뢰 첨부가 같은 드로어라 한 번에 적용). 여는 절차는 `utils/driveEdit.ts` 로 단일화
- **파일 목록의 출처는 태그** — 접어도 `sources` 에 전부 남긴다(`utils/dedupeFileRows`).
  프로젝트 파일이 채팅에도 붙어 있으면 좌측 '채팅' 에서도 보인다
- 신규 카나리 2종 — `--suite chatattach`(2/2) · `--suite filesrc`(4/4), **둘 다 양방향 반증 완료**

### 검증 결과 (자체 검증 · Fable 미검증)
판정 R=0 · F=1 → CLAUDE.md 판정식상 자체 검증 대상. 실제로 돌린 수치:
- health-check **41/41** · guard-invariants **38/38** · e2e tenant **실패 0**
- 프론트 빌드 **EXIT 0** · `error TS` **0**
- chatattach 2/2 · filesrc 4/4 · inboxcount 15/15 · reviewnotify 4/4 · gdrivesync 6/6 · folderdnd 4/4 · delivver 4/4
- 운영 실측: `message_attachments` #36(PDF)·#37·#38(PNG) 전부 `storage_provider='gdrive'`,
  PNG 공개 경로는 운영에서 **200 · image/png · 75,027바이트** 정상 (문제는 프론트 매퍼였다)

### 배포 후 추가 작업 (7차 — **미배포**)
- **Cue 가 파일을 내용으로 찾아 답한다** — 업로드 시 본문을 색인(`services/fileIndex`).
  스키마 무변경(`kb_documents.source_type='file'` + `source_file_id` 재사용).
  같이 고친 것: `fileText` 가 Drive 저장분을 못 읽던 것(운영 46건) · HTML 태그 제거 ·
  질문에 "파일/문서/메일" 어휘가 없으면 그 영역을 아예 안 뒤지던 게이트.
  기밀·개인(L1)은 색인하지 않고, 삭제하면 색인도 걷는다. 자동 색인분은 Q info 목록에서 감춘다.
  **실 HTTP 검증**: 파일 본문에만 있는 무작위 코드를 Cue 가 정확히 답했다(이름은 안 댔다).
  기존 파일 백필 = `dev-backend/scripts/backfill-file-index.js`(dry-run 기본, `--apply --limit`).
- **메일 요약·검증** — 메일 상세의 번역 줄에 "요약·확인". 누르면 아래에 펼쳐진다.
  요약(LLM) + **검증(LLM 아님 — 결정적 신호만)** + 연결된 고객·프로젝트·현재 단계·미수금·열린 업무.
  신호: 발신 이력 · 등록 고객 · 표시이름↔도메인 사칭 · 링크 위장 · 위험 첨부 · 대량발송 ·
  스팸 점수 · 발신 인증(없으면 "모른다"). `authentication-results` 등 헤더를 이제부터 보관한다.
- 신규 카나리 2종 — `--suite fileindex` 8/8 · `--suite mailbrief` 11/11(실브라우저 포함)

### 다음 할 일
1. **운영 배포** — Irene 이 `/배포` 라고 말하면 즉시. 6차는 배포 완료(커밋 a93cf31d),
   **7차(Cue 파일 색인 · 메일 요약·검증)는 아직 운영에 없다.**
   배포 후 운영에서 `node scripts/backfill-file-index.js --apply --limit 50` 로 옛 파일부터 색인.
2. **Cue 가 파일 내용으로 답하기** — 지금은 `hints.files`(파일 어휘가 있을 때) + **파일명 일치** 상위 3건만
   본문을 읽는다. 내용 검색을 하려면 색인이 필요한데 `kb_documents.source_type` 에 이미 `'file'` 이
   있고 `source_file_id` 컬럼도 있어 **스키마 변경 없이** KbDocument 경로로 넣을 수 있다.
   업로드마다 임베딩 비용이 나가므로 게이트 설계(플랜별 한도·크기 상한·수동 on/off)를 먼저 정하고
   Irene 확인 후 착수
3. **기존 파일 Drive 트리 이관 운영 실행** — `dev-backend/scripts/migrate-drive-folder-tree.js`
   (dry-run 기본, `--apply`). dev 는 옮길 것 0건. 운영 호스트에서 실행 필요
4. Q Sale 사이클 1 (Irene 이 명시적으로 제외해 둔 것)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
