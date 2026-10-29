# 업무 템플릿 — 기간 정본 · 디테일 전부 · 시작일/기간 맞춤 · AI patch (2026-10-29, Fable 설계 DESIGN-READY)

Irene: «업무 템플릿 저장할 때는 일정을 기간으로 인식하게 한 후 템플릿 적용 시 시작일이나 기간선택하게 해서 맞게 적용해야지. 날짜가 죄다 그냥 똑같이 들어가면 어떻게 해? 수정도 하기 어렵게.. 템플릿은 디테일 다 가져가야지. 그리고 적용할 때 ai가 제대로 하게 해줘.»
정찰: `.claude/plans/qmvqx7053.md`

## 1. 항목 칸 (task_template_items, 전부 additive)
| 칸 | 타입 | 규칙 |
|---|---|---|
| body | LONGTEXT NULL | 적용 때 task.body 그대로 |
| is_milestone | TINYINT(1) NOT NULL DEFAULT 0 | |
| category | VARCHAR(100) NULL | |
| start_offset_days | INT NULL (DEFAULT 0) | NULL = 날짜 없는 업무 → start/due null |
| duration_days | INT NULL | start NULL 일 때만 NULL |
| vlevel / security_level | ENUM, DEFAULT L3/general | L1 업무는 저장 제외(`private_skipped`). L2 는 target 없이 L2. 프로젝트 없이 적용하면 L2→L3 |
| recurrence_rule | VARCHAR(500) NULL | 시리즈 parent 만 저장, 생성 회차 제외 |
| depends_on_indexes | JSON(기존) | 저장 때 task_links 로 채움(같은 템플릿 안, 작은 index 쪽). 적용 때 task_links 생성. «[선행: …]» 글자 붙이기 없앰 |
| tag_names | JSON NULL | 적용 때 같은 워크스페이스에 이름이 정확히 있는 태그만 연결(새로 안 만듦) |
| action_items | JSON NULL [{kind,label,note}] | 적용 때 pending 으로 생성 |
따라가지 않음: 검토자·review_policy·requires_client_review·target_member_ids·첨부·댓글·이력·공유·상태·진행률·실제 시간.
`task_templates.source_project_id INT NULL` (저장만).
운영: `scripts/migrate-task-template-details.js`(information_schema 확인 → ADD/MODIFY → 재조회, 실패 exit 1) · 배포 슬롯에서 PM2 reload 전.

## 2. 적용
`/apply` body `{business_id, project_id?, start_date, end_date?, assignee_map?, dry_run?}`.
T = max(s+dur), S = end−start. S<0 → 400 end_before_start. T=0 → 축척 안 함 `scaled:false, reason:'zero_span'`.
k=S/T, s'=round(s·k), e'=round((s+dur)·k), dur' = dur===0 ? 0 : max(0,e'−s'). 날짜 없음은 그대로.
계산 한 벌 `templateApply.scheduleItems(items,start,end)`. 화면은 dry_run 응답으로 미리보기·AI seed.
주말 건너뛰기: 이번엔 안 함(달력일).
`materializeItemExtras(task,item,ctx)` — 링크·태그·액션, /apply 와 confirm 이 공유.

## 3. 옛 0 템플릿
GET 응답 계산 필드 `schedule_missing` (항목 ≥2 && 날짜 있는 항목 전부 start 0·dur 0) → 경고 + 끝날짜 비활성. 데이터 보정 없음.

## 4. 수정 화면 `TemplateEditItems.tsx`
예시 시작일 + 항목별 시작·마감 날짜 두 칸 + «날짜 없음» · 저장 때 오프셋으로(최솟값 0 정규화) · 선택 항목 ±N일 밀기 ·
칸: 제목·설명·본문(접힘)·주요·분류·중요도·예상·역할·그룹. 태그·액션·공개범위는 읽기 칩.

## 5. AI 고쳐 넣기 = patch
`POST /api/task-templates/:id/ai-refine` · `services/templateAiRefine.js` (aiTaskPlanner 와 별개).
body `{business_id, project_id?, start_date, items(전부), instructions[], language}`.
LLM 출력 `{"ops":[…],"note":""}` — update{idx,set} · add{after,item} · remove{idx} · shift{idx[]|from,days}.
본문·공개범위·태그·액션은 patch 불가. idx 는 원본 번호. 순서 update·shift → remove → add. 잘못된 op 는 rejected 로.
최소 start<0 이면 전체 당김. n>40 → 400. 깨진 응답 → 400 ai_patch_invalid(전체 재작성 폴백 없음).
앞 지시는 «이미 반영됨», 마지막 지시만 이번 ops.
confirm 에 body·is_milestone·category·vlevel·depends_on_indexes·tags·actions 전달.

## 6. 검증 — 정찰 계획·Fable 판정의 1~8 (저장 / apply start / apply 기간 / 경계 / ai-refine 바이트 동일 / confirm / 마이그 멱등 / 빌드·가드·3폭)
