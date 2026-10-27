# 프로젝트 연결(참조) — 문서·파일을 여러 프로젝트에 (2026-10-27)

> Irene: «같은 문서가 여러 프로젝트에 연결되는 거면 어떻게 해? 파일, 문서, 업무, 등등 프로젝트 연결도 업무처럼 여러 개 연결해야 할 것 같아.»
> 정찰 `.claude/plans/qmvqeavlj.md` · Fable 설계 판정 **GO-WITH-CHANGES (B안)** — 기록 `docs/FABLE_GATE_QUEUE.md` 맨 위.

## 결정
- **소속은 하나, 연결은 여러 개.** `posts.project_id`·`files.project_id` 는 그대로 공개 범위(L2 = 그 프로젝트 멤버)·폴더·방송의 기준이다.
  새 표 `project_refs` 는 «이 자료를 저 프로젝트 탭에도 보여 준다» 만 뜻한다 — **볼 수 있는 사람을 넓히지 않는다.**
- A안(진짜 다대다 — project_id 를 연결표로)은 기각: 붙이는 행동이 곧 공개 범위 확대 통로가 되고, 판정·목록·소켓·검색·폴더 138 파일 재작성 + 운영 백필.
- 1차 대상 = **문서·파일**. 업무는 2단계(같은 표 `entity_type='task'` 자리만 비워 둠 — 진행률·배지·보드 집계 규칙을 따로 정해야 한다. 원칙: 연결 업무는 집계에 넣지 않고 보기만).
- «업무도 여러 개» 라는 전제는 사실과 다르다 — 업무도 지금 프로젝트 하나뿐. 여러 개로 보이는 것은 «관련 업무»(task_links)·«업무 첨부».
- 고객: 1차에 아무것도 안 보인다(연결 목록·칩 빈 배열, 붙이기·떼기 403, 실시간 사건은 CLIENT_VIEW 미등록).

## 표 `project_refs`
`id · business_id · project_id(BIGINT FK projects ON DELETE CASCADE) · entity_type VARCHAR(16) · entity_id · created_by · created_at`
UNIQUE(project_id, entity_type, entity_id) · INDEX(entity_type, entity_id) · INDEX(business_id). ENUM 아님(값 검사는 서비스).
운영: `scripts/migrate-project-refs.js`(멱등, `deploy-planq.sh` PM2 reload 앞 슬롯). 백필 없음.

## 계약 (`services/projectRefs.js` 한 곳)
| | 규칙 |
|---|---|
| 붙이기 | 원본 읽기(`canReadPost` / `canAccessFileByLevel`) ∧ 대상 프로젝트 보임 ∧ (그 프로젝트 멤버 ∨ owner/admin) ∧ 같은 워크스페이스(아니면 **404**) ∧ L1 아님(400 `private_not_linkable`) ∧ 안 지워짐 ∧ 소속 아님(409 `already_home`) · 중복 409 `already_linked`. 원본 편집 권한은 요구하지 않는다 |
| 떼기 | 연결한 사람 ∨ 원본 편집자(문서 `canEditPost`, 파일 올린 사람·소속 PM) ∨ 대상 프로젝트 PM ∨ owner/admin |
| 보여 주기 | 원본 목록 술어(`postListWhereByLevel`·`fileListWhereByLevel`) ∧ id IN 연결 ∧ 안 지워짐 ∧ 소속 ≠ 대상. 소속 프로젝트 이름은 보는 사람이 그 프로젝트를 볼 수 있을 때만 |
| 휴지통 | 연결 행은 남는다(목록에서만 빠짐 · 복원하면 다시 보임). 영구 삭제(`contentTrash.purgeContentRow`) 때 지운다 |
| 범위 축소 | 볼 때 판정하므로 할 일 없음 |
| 소속 이동 | 새 소속으로 걸린 연결을 지운다 — `models/index.js` Post·File `afterUpdate` 훅(이동 문이 모두 인스턴스 update). 읽을 때도 소속=대상 행은 뺀다 |
| 복사 | 따라가지 않는다(문서·파일·프로젝트 복제 모두) |
| 감사 | `project_ref.link` / `project_ref.unlink` — 값은 `{project_id, entity_type, entity_id}` 만(제목 없음) |
| 실시간 | `emitProject(io, project_id, 'project:ref_changed', {project_id, entity_type, entity_id})` 신호만, 고객 방 안 감 |
| AI 앱 | 1차 제외(도구 없음). `move_document_to_project` 는 위 훅을 그대로 탄다 |

## API (`routes/project_refs.js`, `/api` 마운트)
- `GET /api/projects/:id/refs?type=post` — 프로젝트 문서 탭의 «연결됨» 행(문서 목록과 같은 모양 `services/postSerialize` + `linked:true`, 최대 200)
- `POST /api/projects/:id/refs {entity_type, entity_id}` · `DELETE /api/projects/:id/refs/:type/:entityId`
- `GET /api/project-refs/:type/:id` — 항목 상세 칩(원본 못 읽으면 404)
- 파일은 기존 `GET /api/projects/:id/files` 에 `source:'linked'`(`linked_file_id`·`home_project`, `deletable:false`)

## 화면
- 문서 편집 밴드2: «업무 연결» 옆에 `components/Common/ProjectRefsField`(고르는 칸 + 칩 + ×, L2 면 «공개 범위는 그대로예요», L1 이면 칸 끔). 보기 밴드2: 같은 칩 읽기 전용.
- 파일 미리보기(Q file·프로젝트 파일): 직접 올린 파일에 «연결 프로젝트» 칸 · 연결로 들어온 행은 소속 프로젝트 이름.
- 프로젝트 문서 탭: 연결 행에 «연결됨» 표시 + [전체 | 소속 | 연결됨](`components/Docs/LinkedDocsFilter`, 연결 행이 있을 때만). 프로젝트 파일 탭: 좌측 «연결됨» 칸(있을 때만).

## 검증
`dev-backend` 실호출 51건(연결·보이기 · member2 음성/양성 대조군 · 파일 · 거절 7종 · 고객 대조군 + 소켓 수신 0 · 휴지통/복원/영구 삭제 · 범위 축소 · 소속 이동 · 떼기 권한 · 감사 값).
