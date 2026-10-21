# 사용자 피드백 승인 체계 — «검토중 → 진행대기» (설계 초안 · 2026-10-21 · [Opus])

> Irene 원문: *"고객이나 멤버 요청이 무조건 반영되지 않고 플랫폼관리자로 지정된 멤버의 최종 승인에 따라 진행하게 해야 해.
> 검토중을 무조건 거쳐야 해. 플랫폼관리자 피드백이 아니면. 이거 어떻게 체계 잡을까? 진행대기 단계가 있어야 할 것 같아.
> 그래서 서버상황판에서 가져다 수정하지"*

## 1. 지금 (사실)

| 단계 | 값 | 누가 바꾸나 |
|---|---|---|
| 접수 | `pending` | 제출 시 |
| 검토 중 | `reviewing` | 관리자 화면 [저장] 아무 값 · `/개발완료` 회신 스크립트가 «고쳤지만 배포 전» 으로 씀 |
| 완료 / 보류 | `done` / `wontfix` | 관리자 화면 · 배포 스크립트 `close_feedback`(Feedback-Closes 트레일러, 답글 있는 것만) |

- **상황판이 일을 가져가는 문**: 정기 점검 «문의 가져오기»(`~/dev-server/board/server.js` SCHED_STEPS `inquiries`)가
  PlanQ `.claude/commands/개발시작.md` 1-B단계의 조회를 따른다 — `WHERE status IN ('pending','reviewing')`.
  → **들어온 모든 요청이 곧바로 개발 대기열에 들어간다.** 승인 단계가 없다.
- `reviewing` 은 두 뜻이 섞여 있다: ①관리자가 보는 중 ②개발이 고쳤고 배포를 기다리는 중(`/개발완료` 7-B).
- 상태 전이 판정이 없다 — 관리자 화면은 네 값 중 아무것으로나 바꾼다(PATCH `/api/feedback/:id/respond`).

## 2. 제안 — 상태 6개, 전이는 한 함수

| 단계(화면) | 값 | 뜻 | 상황판이 가져가나 |
|---|---|---|---|
| 접수 | `pending` | 새로 들어옴 | ✗ |
| 검토중 | `reviewing` | 플랫폼관리자가 보는 중(반드시 거친다) | ✗ |
| **진행대기** | **`queued`** (신규) | 플랫폼관리자가 **승인** — 개발해도 된다 | **✓ 이것만** |
| **반영중** | **`in_progress`** (신규) | 개발이 가져가 고치는 중 · 고쳤고 배포 대기 | ✗ (이미 가져감) |
| 완료 | `done` | 운영 반영 끝 | ✗ |
| 보류 | `wontfix` | 안 함 | ✗ |

전이 규칙(서버 `services/feedbackStatus.js` 한 곳 — 관리자 화면·회신 스크립트·배포 닫기가 같이 쓴다):

- `pending → reviewing` (플랫폼관리자) · `pending → wontfix|done`(답만 하고 닫기 — 문의 답변 등)
- `reviewing → queued` = **승인**. 플랫폼관리자만. `approved_by`·`approved_at` 기록 + 감사 로그.
  ★ `pending → queued` 는 **거절**(409 `review_required`) — «검토중을 무조건 거쳐야 해».
- `queued → in_progress` (개발이 가져갈 때 — `/개발완료` 회신 스크립트·상황판 문의 가져오기) · `queued → reviewing|wontfix`(승인 취소)
- `in_progress → done` (배포 닫기) · `in_progress → queued`(되돌림)
- `done|wontfix → reviewing` (다시 열기)
- **플랫폼관리자가 쓴 피드백**(제출자 `platform_role='platform_admin'`)은 제출 순간 `queued` + `approved_by = 본인`.
- 추가 문의(parent_id 자식)는 부모 스레드 상태를 따라 판단한다 — 자식 단독 승인 없음(부모가 `queued` 면 함께 처리).

## 3. 상황판 연결 — 고칠 곳은 PlanQ 안뿐

- `개발시작.md` 1-B 조회를 `status='queued'` 로(새 일) + `in_progress`(진행 중인 일 확인용, 대기열엔 안 넣음).
  `pending`·`reviewing` 은 **건수만** 보고에 적는다(«승인 기다림 N건 — 관리자 > 사용자 피드백»).
- `/개발완료` 7-B · `scripts/feedback-reply.js`: «고쳤지만 배포 전» = `in_progress`(옛 `reviewing`).
  승인 안 된 건(`pending`/`reviewing`)을 `in_progress`·`done` 으로 바꾸려 하면 거절.
- 배포 `close-deployed-feedback.js`: `in_progress`(+ 옛 호환 `queued`)만 `done` 으로. `pending`·`reviewing` 은 건너뛰고 «승인 전» 으로 보고.
- `~/dev-server` 는 손대지 않는다(조회문은 PlanQ 개발시작.md 가 정본).

## 4. 화면

- 관리자 > 사용자 피드백: 탭 6개(접수·검토중·진행대기·반영중·완료·보류). 상세 하단 버튼 = 지금 상태에서 갈 수 있는 것만
  (접수: [검토 시작] · 검토중: [승인 — 진행대기로] · [보류] …). 상태 셀렉트는 허용 전이만 보인다.
- 확인필요(관리자): `pending`·`reviewing` 만(지금과 같음 — 관리자가 처리할 것).
- 사용자 화면(개인 > 문의·피드백, 도움말 내역): 라벨 «진행 예정»(queued) · «반영 중»(in_progress). 알림 제목도 같은 라벨.

## 5. DB · 운영

- `feedback_items.status` ENUM **끝에** `queued`, `in_progress` append · 컬럼 `approved_by INT NULL`, `approved_at DATETIME NULL`.
  `scripts/migrate-feedback-approval.js`(멱등, 배포 슬롯 — 코드보다 먼저).
- 옛 행: 자동 백필 안 함(기본 읽기만, `--apply` 따로). 지금 `reviewing` 중 `/개발완료` 가 «다음 배포에 반영» 으로 단 것은
  `in_progress` 후보로 **목록만 출력** — 관리자가 화면에서 고른다(뜻이 섞인 값을 기계가 가르지 않는다).
  지금 `pending` 은 그대로 `pending`(새 규칙상 승인 전 — 상황판이 더는 가져가지 않는다).

## 6. 검증(구현 뒤)

1. 멤버 제출 → `pending` · 플랫폼관리자 제출 → `queued` + approved_by 본인
2. `pending → queued` 409 · `reviewing → queued` 200 + approved_* + 감사 · 멤버가 승인 PATCH 403
3. 회신 스크립트: `reviewing` 건을 `in_progress` 로 → 거절 / `queued` 건 → 통과
4. close-deployed: `reviewing` 건 트레일러 → 닫지 않음 / `in_progress` → done
5. 관리자 화면 6탭 3폭 · 버튼이 상태별로 다름 · 사용자 화면 라벨
6. 마이그레이션 두 번 돌려 멱등

## 7. 정할 것 (Fable)

- 상태 이름·개수(특히 `in_progress` 를 둘지 — 없으면 «가져간 것»과 «승인만 된 것»을 상황판이 못 가른다)
- 옛 `reviewing` 행 처리
- 문의(kind inquiry)도 승인 절차를 거치나(답만 하는 문의는 개발이 아님 → `pending/reviewing → done` 허용으로 충분한가)
