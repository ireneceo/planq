# 업무 보안등급 — «내부 업무» (2026-10-12, Fable 설계)

> Irene: *"업무에서도 보안이랑 공유범위 있어야 하지 않아?"*
> 정찰 계획 `.claude/plans/qmv4pwb7c.md` → Fable 설계 판정(이 문서). 권고대로 진행(memory `feedback_fable_decides_not_opus`).

## 1. 결정 — 업무에 `security_level` 한 축만 (general / internal). 공유범위(vlevel)는 두지 않는다.
- 새는 문은 **바깥**이다 — 프로젝트 고객(`GET /projects/:id/tasks`)·게스트 프로젝트 링크·공개 공유 링크.
  멤버끼리는 PERMISSION_MATRIX §1 «열린 문화» 가 정책이고, 업무는 작성·요청·담당·컨펌자가 얽혀 «나만/프로젝트만» 이 정의되지 않는다.
- L1/L2 는 업무를 직접 읽는 121곳을 전수 감사해야 하고 한 곳만 빠져도 제목이 샌다. internal 은 **멤버 조회를 바꾸지 않는다**.
- confidential 은 두지 않는다 — 1단계에서 internal 과 행동이 같아 «같은 뜻에 다른 글자» 가 된다. 멤버 단위 숨김이 필요해지면 ENUM 끝 append.
- **2026-09-27 판정(«첨부에서 파생»)을 일부 뒤집는다.** 그때는 공유 링크 발급만 범위였다. 첨부 없는 업무의 **제목 자체**가 고객·게스트에 가는 것은 첨부 파생으로 표현할 수 없다.
  첨부 파생 차단은 그대로 두고 **OR** 로 합친다.

## 2. 의미
| | general(기본) | internal(«내부 업무») |
|---|---|---|
| 멤버(owner/admin/member) | 전부 | **전부 (불변)** |
| 직접 관계자인 고객(담당·작성·요청·컨펌자) | 본다 | **본다** — 이름이 박힌 것은 명시적 지정 |
| 프로젝트 고객·대화 참여 고객 | 본다 | **행 자체가 없다** |
| 게스트 프로젝트 링크 | 목록 | 제외 |
| 공유 링크 발급 | 첨부 OR | **403** |
| 고객 소켓 방 `project:<id>:client` | taskClientView | 안 보낸다(전환 시 삭제 신호만) |

- 바꾸는 사람: 작성자 ∨ owner/admin (`FIELD_RULES.security_level` — recurrence_rule 과 같은 집합).
- 기본값 general. 옛 행은 `NOT NULL DEFAULT 'general'` — 넓히지도 좁히지도 않는다.
- internal 로 올리면 `shareOffPatch`(공유 토큰·비밀번호 해시 null). 내리면 자동 복구 없음.
- 복사·반복 생성·프로젝트 이관: 그대로 승계.
- AI 에이전트: create/update 입력에 security_level 없음(AI 가 노출을 바꾸지 않는다).

## 3. 운영
- `dev-backend/scripts/migrate-task-security-level.js`(멱등) — **코드 배포 전**(모델이 SELECT 한다).

## 4. 검증 결과 (2026-10-12)
- 자체: 실HTTP 33/33(생성·고객 목록/상세/taskListWhere/all-tasks·멤버 불변·관계자 고객·공유 끊기·권한·복사·소켓·게스트 링크·todo 수) ·
  양성 대조군(canAccessTask 내부 줄 + taskListWhere 조건 제거 → 2건 FAIL로 뒤집힘) · 고객 작성자 PUT 403(owner 200 대조) ·
  guard 68/69 · health-check 84/84 · e2e tenant 0 실패 · build EXIT 0 · 화면 3폭(owner 칸 보임·편집, member2 읽기 전용, 고객 칸 없음/내부 업무 안 열림).
- Fable 완료 검증 PASS — 비차단 1(고객 작성자가 등급 변경 가능) 고침, 비차단 2(시험 잔여물) 정리.
