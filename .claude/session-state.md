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

### 다음 할 일
1. **운영 배포** — Irene 이 `/배포` 라고 말하면 즉시. 이번 수정은 전부 운영 신고분이라 배포해야 닫힌다
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
