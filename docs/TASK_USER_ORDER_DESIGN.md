# 내 순서(사람별 업무 순서) 설계 — 2026-10-12 · Fable 설계 판정 VERDICT OK

> Irene: *"태그별로 보든 마감일별로 보든 소팅을 자유롭게 만질 수 있게 … 우선순위기능으로 사용하기 어렵고
> 그냥 리스트 재배치가 자유자재였으면 좋겠는데. 이게 정말 중요하거든."* → «권고대로»(1단계 한 줄 압축 + 2단계 내 순서)

## 왜 새 표인가
`tasks.priority_order` 는 업무 **전역 칸 하나**다. 끌어 옮기기를 거기 쓰면 같은 업무를 보는 동료의 순서까지 바뀐다
(services/taskPriority.js 후속안 10-iii 이 «정석은 별도 테이블» 로 적어 둔 문제). 순서는 **사람마다** 갖는다.

## 결정
1. 표 `task_user_orders` — id BIGINT PK · business_id/user_id/task_id INT FK CASCADE · pos BIGINT · created_at/updated_at ·
   UNIQUE(user_id, task_id) · KEY(business_id, user_id, pos). 모델 `models/TaskUserOrder.js`.
2. pos = 정수 간격 GAP 65536. 사이값 floor((a+b)/2) · 앞 없음 after−GAP · 뒤 없음 before+GAP · 간격 < 2 면 (user,biz) 전체를 pos,id 순 i*GAP 재배치(트랜잭션).
3. `PUT /api/tasks/my-order` (`routes/task_order.js`, `/api/tasks` 체인 task_priority 옆 최상단 · 로직 `services/taskUserOrder.js`)
   body `{business_id?, task_id, before_id|null, after_id|null, visible_ids[≤500]}` — visible_ids = 드롭 **뒤** 그 목록(그룹이면 그 그룹)의 표시 순서.
   검증: task_id ∈ visible_ids · before/after 가 그 안의 바로 앞/뒤(400 neighbors_mismatch) · 전부 business_id 일치(404 task_not_found) · 각 canAccessTask(403 task_forbidden).
   응답 `{positions:[{task_id,pos}], rebalanced}`. 읽기는 `/my-week` 각 업무 `my_pos`(2차 쿼리 1회).
4. 권한: requestScope → assertMemberOrAbove(client 배제) → 업무마다 canAccessTask. myWeekWhere 로 묶지 않는다(순서는 주간 집합보다 오래 산다).
5. 순위 없는 업무 혼재: 매 요청 visible_ids 중 행 없는 id(이동 업무 제외)를 표시 순서대로 끝에 먼저 물질화 → 이동. 분기 없음.
6. 실시간: `user:<id>` 방에 `task:my-order {business_id, positions}` 만. `task:updated` 병합 때 my_pos 보존.
7. 감사 생략(개인 표시 선호) — 코드에 `audit-exempt` 선언.
8. 화면: 보기 칩 `mine|tag|project|due`(기본 mine) · 셀렉트 `mine|recent|name|stage`(기본 mine). 칩 mine = 그룹 없음 + 셀렉트 숨김.
   비교자 byMyOrder: my_pos 있는 것 pos asc → 없는 것 recent 사슬. 완료·취소는 맨 아래.
   끌기 = 칩 mine 이거나 셀렉트 mine, 열린 업무만. 손잡이는 우선순위 번호 자리. 팝아웃 우선순위 버튼·안내줄 숨김(데이터 무변경).
   퀵애드 직후 PUT 1건으로 그 그룹 맨 위.
9. 그룹 밖 드롭 = 거절(원위치, PUT 0건) — 그룹 변경은 데이터 변경이지 순서가 아니다.
10. 오늘/이번 주 같은 순서 공유. 11. 집합 밖으로 나간 업무 행은 남긴다(삭제는 CASCADE).
12. 운영: `scripts/migrate-task-user-order.js`(멱등, 표·FK3·키2 재확인) — 배포 슬롯에 **코드보다 먼저**. 롤백은 코드만.
13. 드래그: 라이브러리 없이 공용 `components/Common/useVerticalReorder.ts`(Pointer Events·4px 문턱·가장자리 자동 스크롤·Alt+↑/↓).
14. i18n popout.viewMine · sortMine · dragHandle · reorderFailed (ko/en).

## 2026-10-12 수정 — 순서는 **보기마다 따로** (Irene 피드백)
> *"내 순서라는 기능이 아니라.... 태그별, 프로젝트별, 마감일별로 보면서도 순서를 바꿀 수 있어야 한다는 거야. 태그별로 그룹핑된 상태에서 순서 달라야 하는데"*

- 표에 `view_key`(tag·project·due — 정본 `services/taskUserOrder.VIEWS`) 를 더했다. UNIQUE(user, task, view) · KEY(biz, user, view, pos).
  운영에는 이 표가 아직 없어 CREATE 만 탄다. dev 옛 행은 `due` 로 이관.
- API body 에 `view` 필수(모르는 값 400 `view invalid`) · 응답·실시간에 `view` · my-week 는 `my_order: {tag?, project?, due?}`.
- 화면: «내 순서» 보기 칩을 없앴다(결정 8 의 칩 부분 폐기). 정렬 셀렉트 «직접 정렬»(기본) = 지금 보기의 순서, 그때만 손잡이.
  태그별에서 옮긴 것은 프로젝트별·마감일별을 흔들지 않는다. 그룹 밖 드롭은 그대로 원위치(결정 9 유지).
  셀렉트 저장 키를 `planq.popout.sort2.*` 로 바꿨다 — 옛 키에는 화면이 'recent' 를 늘 써 넣어 기본 «직접 정렬» 이 아무에게도 안 먹었다.
- 퀵애드는 **지금 보기**의 맨 위로. 결정 1~7·9~13 은 그대로.
