# 파일 «연결된 곳» — 끊김 안내·통합 보기 설계 (2026-11-25)

> Irene: *"파일 위치를 이동하거나 해도 연결해둔 문서에서 끊기지 않게 하거나 꼭 구조상 끊어야 하면 알려줘야 할 것 같아. 그리고 파일이나 문서들이 서로 어디에 연결되어 있는지 제대로 다 알게 통합적인 UI가 되고 있나"* → 점검(`docs/FILE_LINK_REVIEW_2026-11-25.md`) → «권고대로 진행해 줘»
> [Opus] 조사·구현 · Fable 설계 판정 DESIGN-CHANGE(아래 표가 반영본)

## 0. 전제 (실호출로 확정 — 2026-11-25)
- 폴더 이동은 `files.folder_id` 만 바꾼다 → 모든 연결 유지(Drive 사본도 같이 이동).
- 원본을 휴지통에 넣어도 **업무 첨부 내려받기 200**(자기 행에 바이트 경로 복사 = «사본»). 채팅 첨부도 같은 구조(`message_attachments.file_path`, `fileRefs.countLiveRefs` 가 바이트를 지킨다).
- 문서 첨부는 원본을 거쳐 열린다 → 휴지통 뒤 이름은 남고 열면 404 였다. 처음부터 «나만 보기» 파일을 팀 문서에 붙이면 팀원에게 이름만 보이고 403 이었다.

## 1. 결정 (Fable)
| # | 항목 | 결정 |
|---|---|---|
| 1 | 두 부류 | **live** = 문서 첨부 · 문서 본문 그림 · 일정 미팅자료 · project_refs(file) · 청구 증빙(invoices·installments 4칸) · 연락처 사진. **copy** = 업무 첨부 · 채팅 첨부. 경고 숫자는 live 만. |
| 2 | 빼는 것 | 메일 첨부(출처 칩) · Q info(자동 색인과 수동 가져오기를 못 가름) · 문서 버전 기록 · 같은 바이트의 File 형제 |
| 3 | 업무·채팅 찾기 | `file_path IN (fileRefs.pathVariants)` — 절대·상대 두 표기. LIKE 금지. 채팅은 `file_id` 또는 경로, business 는 conversation 경유 + 안내방 제외 |
| 4 | 본문 그림 | 저장 이름(UUID)을 `content_json LIKE` 로 후보 → `imageCtx.bodyHasImage` 로 확정(접미사 오탐 방지). 40개씩 묶음, 요청당 파일 200개 상한. 색인 테이블 없음 |
| 5 | 함수·API | `services/fileUsage.js` 한 곳(`listUsage`·`summarize`). `GET /api/files/:biz/:id/usage`(못 읽으면 404) · `POST /api/files/:biz/usage-summary` {file_ids}|{folder_id 하위 포함}(못 읽는 파일 조용히 제외) — `routes/file_usage.js` |
| 6 | 곳별 판정 | 문서 `canReadPost` · 업무 `canAccessTask` · 채팅 `canAccessConversation` · 일정 `calendarListWhere` · 프로젝트 `canAccessProject` · 청구 증빙 대표·관리자만 · 연락처 멤버 이상. 제목은 매번 읽는다 |
| 7 | 볼 수 없는 곳 | 멤버·대표: 숫자 하나(`hidden`) — 특례 없음. 고객·게스트: 칸 자체 없음 |
| 8 | 삭제 | **막지 않고 알린다**(서버 409 없음). 확인창(단건·여러 개·폴더째)에 «연결된 N곳에서 빠집니다 · 복구하면 돌아옴» + 상위 5곳, 사본이 있으면 «사본 M곳은 그대로». 감사 `file.delete` 에 `live_places` |
| 9 | 범위 변경 | 좁아질 때만(등급 내려감 · L2 프로젝트 바뀜) live ≥1 이면 확인창. 넓히기는 묻지 않는다 |
| 10 | AI 도구 | `move_files` 변경 없음(안 끊김). 파일 삭제·범위 쓰기 도구를 더하면 결과에 `fileUsage.summarize` 를 싣는다 |
| 11 | 문서 첨부 응답 | `services/postAttachmentView.applyViewerAttachments` — 살아 있고 읽음 → 그대로 · 휴지통 + 읽을 수 있는 멤버 → `state:'trashed'`·`can_restore`·내려받기 주소 없음 · 영구삭제 → 뺌 · 못 읽음 → 뺌 + 멤버에게만 `hidden_attachment_count` · 고객은 흔적 없음. 일정 미팅자료도 멤버에게 같은 술어(휴지통 빼기) |
| 12 | 휴지통 표시 | 문서 첨부 줄 «휴지통에 있음» + [복구](`canMutateFile` ∧ `isRestorable`). 업무·채팅엔 표시 없음(사본). 본문 그림은 `<img onerror>` 중립 문구 «그림을 표시할 수 없습니다» |
| 13 | 저장 보호 | 첨부는 붙이기/떼기 라우트 따로(통째 교체 없음) — 숨긴 행이 저장으로 지워지지 않는다(확인함) |
| 14 | 화면 | `components/FileUsage/` — `FileUsagePanel`(파일 상세 «연결된 곳», 출처 한 줄 대체, 줄 누르면 새 탭) · `UsageWarning`+`useUsageSummary`(확인창) · `useNarrowConfirm`(범위 좁히기). 문서 쪽 `components/Docs/TrashedAttachmentRow` |
| 15 | 청구 증빙 | 곳 목록 맨 위·강조. 막지 않는다. 보관기간 뒤 영구삭제가 증빙을 없애는 문제는 별건 |

## 2. 같이 고친 것
- `shareOpenable.isPublicFile` — 휴지통·영구삭제 파일은 공개 아님(L4 인 채 지운 첨부가 공개 문서 링크로 이름·내려받기가 남았다).
- 감사 `file.delete` 의 파일 이름·크기 칸이 없는 컬럼(`original_filename`·`size_bytes`)을 읽어 늘 비어 있던 것.
- `isPublicFile` 은 업무 공개 링크(`taskPublicShare`)도 쓴다 — 원본을 휴지통에 넣으면 업무 공개 링크의 그 첨부도 빠진다(좁히는 방향). 앱 안 업무 첨부(사본)는 그대로 열린다.
- 공유 모달(`PostShareModal`)은 휴지통 첨부를 «함께 공개» 대상에서 뺀다(Fable 비차단 3).

## 3. 검증
- `dev-backend` 일회용 스크립트 3개(커밋 안 함): 종류별 대조(문서·본문 그림·일정·프로젝트·업무) · 양성 대조(연결 0 · 접미사 가짜 그림 · 상대경로 — 완전일치만 쓰면 0건) · 격리(다른 워크스페이스 403, 남의 file_ids 제외) · 존재 노출(못 보는 문서 제목 응답 grep 0) · 휴지통 왕복 · 공개 링크. (test-fu3 의 일정 항목은 휴지통 뒤에 붙이려 해 공허했다 — 일정 멤버 필터는 Fable 독립 프로브가 확인.)
- Fable 완료 검증 PASS(2026-11-25) — 독립 프로브 31/31 · 브라우저 3폭 27건. 비차단: 복제가 못 읽는 첨부 행까지 복사(기존) · 본문 LIKE 는 문서 수만 건 규모 미측정 · 일정 만들기·고치기 응답은 거르지 않음(편집자 본인 응답).
