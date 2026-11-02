# 자동 히스토리 «글 고치기» — 설계 (2026-11-02 · Fable 설계 판정 DESIGN-READY · 방 e251c22e)

Irene 원문: «프로젝트나 업무상세 같은 곳에 남는 자동기록 히스토리를 수동으로 수정하고 싶어. 수정하게 해주고 자동생성이 다시 또 되면서 엉망이 안되게 할 수 있어? … 각 항목별 글자 수정»

## 결론
- **원장(task_status_history·project_status_history·invoice_status_history 등)은 한 글자도 안 고친다.** 사람이 고친 글은 `history_overrides` 에 «원장 좌표» `(source_table, source_id)` 로 저장하고, 읽을 때 `services/historyOverrides.applyOverrides` 한 함수가 덧입힌다.
- «자동생성이 다시 돌아 엉망» 의 실체 = 원장은 추가만 하므로 같은 사건이 새 id 로 다시 생기진 않고, **표시 글이 매 읽기마다 원장에서 재계산**되는 것. 덧입힘은 읽기 마지막 단계라 재계산과 무관하게 고친 글이 남는다. 새 사건은 새 좌표라 덮어쓰기 없이 정상 추가.
- 원장 note 를 직접 고치지 않는 이유: note 가 기계 의미를 갖는 행(task_actions `'client'|'internal'`·`'handover'`) · 합성 이벤트(project-created)는 행이 없음 · note 칸이 없는 표(문서·파일·업무 추가·Q Note·상담) · 외부 서비스(qnote) · 내보내기 원문 보존 · «원래대로» 가 행 삭제 하나로 끝남.
- **고치는 것 = 설명 줄(note) 하나.** 종류 라벨·이름(title)·from→to·대상·회차·시각·작성자는 사실이라 안 고친다(이름은 객체 이름을 바꾸면 따라온다). `title` 칸은 예약(1차 400 `field_not_editable`).
- 수동 항목(manual)은 덮어쓰기가 아니라 **그 행 자체 수정**(PATCH 확장: title·body·occurred_at — 적은 사람 또는 owner/admin/platform_admin. client_visible 만은 종전대로 멤버).

## 좌표
| source_table | source_id | 프로젝트 히스토리 접두어 | 다른 소비처 |
|---|---|---|---|
| task_status_history | 행 id | task-status: | 업무 상세 /workflow |
| project_status_history | 행 id | project: | /status-history 카드 |
| invoice_status_history | 행 id | invoice: | — |
| task_created | tasks.id | task-created: | — |
| project_created | projects.id | project-created: | — |
| post · file · project_note · qnote · client_interaction | 각 id | post: file: note: qnote: interaction: | — |
접두어 ↔ 좌표 변환은 `services/historyOverrides.js` 한 곳.

## 표 `history_overrides`
id · business_id(좌표에서 도출) · source_table VARCHAR(32) · source_id BIGINT · note TEXT(≤1000) · title VARCHAR(200)(예약) · edited_by · created_at · updated_at · UNIQUE(source_table, source_id). FK 없음(다형, 고아 무해). 마이그레이션 `dev-backend/scripts/migrate-history-overrides.js`(멱등, 배포 슬롯).

## API `/api/history-overrides/:source_table/:source_id`
- PUT `{note, project_id?}` upsert — 빈 글 400 note_required · >1000 400 note_too_long · title 400 field_not_editable · 모르는 표 404.
- DELETE = 원래대로(멱등).
- 권한: 업무 계열 = 업무 볼 수 있음(canAccessTask) ∧ 고객 아님 · 프로젝트 계열 = 프로젝트 역할 ≠ client(qnote 는 본문 project_id 로 판정). 감사 `history.override.set|clear`. 실시간 신호 `task:updated`/`project:updated`.

## 읽기 덧입힘 (응답 칸)
note=고친 글 · note_original · edited_by · edited_by_name · edited_at (고친 행만) · editable=['note'] (멤버에게) · 고친 업무 추가 줄은 groupable=false.
적용: getProjectStream · /api/tasks/:id/workflow · /api/projects/:id/status-history. 고객이 업무 상세를 보면 note 는 고친 글(한 벌 진실), 나머지 메타는 뺀다.
내보내기는 원장 원문 + 별도 표 `history/history_overrides`. 활동·멤버 현황은 note 를 안 실어 변동 없음.

## 범위 밖
줄 숨기기/삭제 · 라벨·이름·from→to 수정 · 묶음 머리글 · 워크스페이스 활동 · /workflow 고객 노출 범위 축소(비차단 지적 — 이 기능 이전부터 고객이 업무 history 전체를 받음).
