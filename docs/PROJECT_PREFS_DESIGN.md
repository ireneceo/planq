# 프로젝트 직접 정렬 · 즐겨찾기(별) — 설계 (2026-10-23, Fable DESIGN-OK)

> Irene: *"프로젝트에서 프로젝트 리스트 순서가 직접정렬도 있게 해줘. 드래그 드롭하면 카드들 위치 바뀌게 그리고 드래그 하면 바로 최신순 디폴트가 직접 정렬로 바뀌게. 그리고 즐겨찾기 기능 넣어줘. 프로젝트 탭들에도 즐겨찾기 있으면 좋은 기능 다 만들어주고, 프로젝트 밖에 리스트에도 즐겨찾기 기능 넣어줘. 채팅방에 이미 있는 디자인이랑 기능 형태 통일해서 해"*

## 1. 저장 — 사람 단위, 다형 표 하나
- `user_entity_prefs`(user_id · business_id · entity_type ENUM('project') · entity_id · pinned_at · sort_order) · UNIQUE(user_id, entity_type, entity_id).
- **개인이다.** 정본 Q talk 별(`conversation_participants.pinned_at`)이 사람 단위다. 남이 끌어 바꾸면 «순서가 저절로 바뀐다» 가 된다.
- 다형인 이유: 업무·파일 항목 별이 뒤에 붙으면 ENUM 끝 append 만 한다(새 표·새 마이그레이션 없음). FK 없음 — 목록은 LEFT 매핑.
- `project_members` 에 넣지 않는다(owner/admin·전체 공개 프로젝트를 보는 사람은 멤버 행이 없다).
- **정렬 선택은 저장하지 않고 파생한다** — 이 워크스페이스에 내 sort_order 행이 하나라도 있으면 기본 = 직접 정렬, 없으면 최근순. 끌기가 곧 행을 만드니 «끌면 직접 정렬로 바뀐다» 가 저장 없이 성립하고 기기마다 같다. 셀렉트로 고른 다른 정렬은 화면 상태만.
- 되돌리기: «순서 초기화»(확인 창) → sort_order 전부 NULL(별 유지).

## 2. API (routes/projects.js)
| 문 | 판정 |
|---|---|
| `GET /api/projects` 행마다 `my_pinned_at`·`my_sort_order` · `GET /:id` 에 `my_pinned_at` | 목록과 같은 범위 |
| `POST/DELETE /api/projects/:id/pin` | `loadProjectOrForbidden`(읽기와 같은 술어 — 참여 고객도 됨) |
| `PUT /api/projects/order {business_id, ids}` | `services/projectAccess.visibleProjectWhere` — **GET 목록과 같은 한 벌**로 좁힌 교집합만. 응답 `applied` |
| `DELETE /api/projects/order?business_id=` | 내 행만 |

- `/order` 두 라우트는 `/:id` 보다 위에 둔다(Express 가 `/order` 를 `/:id` 로도 받는다).
- **자리 바꾸기**: 화면은 필터 안의 것만 보낸다. 받은 것만 0..k 로 덮으면 숨은 프로젝트의 옛 번호와 뒤섞이므로, 내 기존 순서에서 받은 id 들이 차지하던 자리에 받은 순서대로 다시 넣는다.
- 실시간: `user:<id>` 방에 `project:pref {business_id, project_id|null}` 신호만. 목록은 다시 읽고, 상세는 별만 다시 읽는다.
- 감사 예외(`audit-exempt`): 개인 화면 상태.

## 3. 정렬 규칙 — `dev-frontend/src/utils/projectOrder.ts` 한 벌
- 별 먼저는 모든 정렬·모든 화면 공통(Q talk 와 같다).
- 직접 정렬 = sort_order 오름차순. **번호 없는 것(그 뒤 새로 만든 프로젝트)은 번호 있는 것보다 위**, 그들끼리 최신 생성순.
- 끌기: 목록 보기 ∧ 그룹 없음일 때만. 검색·필터 중에는 된다. 타임라인·캘린더 없음. 별 묶음을 가로질러 놓을 수 없다.
- 네이티브 HTML5 draggable(EditableNavSection 과 같은 방식). 여러 열이면 좌우 절반, 한 열이면 위아래 절반으로 앞/뒤를 가른다.
- 폰·키보드: 카드 ⋯ 메뉴 «맨 위로 / 위로 / 아래로»(모든 폭) — 같은 저장, 같은 직접 정렬 전환.

## 4. 이번 범위
- 프로젝트 별: 목록 카드(배지 다음·⋯ 바로 앞) · 상세 머리줄 맨 앞.
- 상세 안 탭: 대화 탭은 이미 대화방 별이 있다(Q talk 본체). 문서 탭은 공용 «고정»·«탭으로 올리기» 가 이미 있어 셋째 핀을 넣지 않는다.
- 프로젝트 밖: 프로젝트를 고르는 칸(업무 추가·업무 상세·Q note 새 노트·노트 연결·공개 범위·Q sale 연결·관련 프로젝트·`listProjects` 를 쓰는 화면 전부)이 별 먼저 → 내 직접 정렬 순서. 셀렉트 옵션에는 작은 별 글리프(표시만). Q file/Q docs 좌측 트리는 별 먼저(그 안은 파일 수) + 이름 옆 작은 별.
- 넣지 않는 곳: Q talk 좌측(별은 대화방 단위가 정본) · 대시보드·확인필요 · 사이드바 바로가기.
- 안 만든 것: 업무·파일·일정 **항목별** 사람 별(각자 술어로 pin 문이 따로 필요 — 표는 준비돼 있다).

## 5. 별 버튼 한 벌
`components/Common/StarToggle.tsx` — Q talk LeftPanel `PinBtn` 을 값 그대로 옮겼다(28×28 · 켜짐 #F59E0B 채움 / 꺼짐 #CBD5E1 윤곽 · hover #FEF3C7/#F1F5F9 · 상시 노출). 대화방·프로젝트 카드·상세가 같이 쓴다. 표시만 하는 자리는 `StarGlyph`.

## 6. 운영
`dev-backend/scripts/migrate-user-entity-prefs.js`(멱등) — 배포 슬롯에서 **코드보다 먼저**(목록이 이 표를 읽는다). 백필 없음. 롤백 = 코드 revert(표 잔존 무해).
