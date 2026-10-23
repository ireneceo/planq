# 서명 문서 공개 범위 바닥 — 설계 (2026-10-23 · Fable 설계 DESIGN-CHANGE · [Opus] 구현)

## 원문
> Irene: «팀 계약인데 나만이라고 공개가 나오는게 맞아? 서명을 회사이름으로 하면 개인이 마음대로 나만으로 하면 안되는 것 같은데.»
> (프로젝트 매니지먼트 업무협력 계약서 — 자동저장 초안의 L1 강제가 서명 요청 뒤에도 남았다. 정찰 `.claude/plans/qmvkimsqn.md` B절)

## 판단 근거
- L1 은 작성자만 읽는다(`access_scope.canAccessPostByLevel`, owner/admin 도 D2). 우리 쪽(party='us') 서명자는 워크스페이스 멤버라 **L1 문서면 서명할 사람이 문서를 못 연다**.
- 서명된 문서는 워크스페이스 이름으로 남는다(`signatureCore` ~85·137) = 회사 기록. 설정 › 서명 관리(owner)에서 «비공개 문서» 로 가려지면 그 화면의 뜻이 없다.
- 공개 범위 문 두 곳은 서명 상태를 안 봤다 — 본문은 잠그는데 범위는 안 잠그는 비대칭.

## 규칙
1. **적용**: 문서에 **살아 있는 서명·확인 요청**이 하나라도 있으면 — party(us·them)·kind(sign·confirm) 불문.
   살아 있음 = `pending·sent·viewed·signed` (`signatureCore.SIGNATURE_ACTIVE_STATUSES` — 서명 잠금과 같은 상수). 취소·거절·대체·만료만 남으면 풀린다. signed 는 영구.
2. **바닥 = L2.** 소속은 그대로(두 축 규칙): 프로젝트 문서 → 프로젝트 멤버(+그 프로젝트 고객) · 프로젝트 없음 → L2 특정 멤버 = 작성자 ∪ 우리 쪽 서명자(owner/admin 은 L2 를 다 본다). L3 로 올리지 않는다.
3. **보낼 때**: 막지 않고 같은 트랜잭션에서 올린다. 응답 `visibility_raised {from,to,audience}` · 감사 `post.visibility_change reason=signature_floor`. 보내기 창이 미리 알린다(`SignOutboundScope` 위 안내).
4. **보낸 뒤 좁히기**: `PUT /posts/:id/visibility` · `PUT /posts/:id` vlevel 둘 다 L1 이면 **409 `signature_visibility_floor`** `{floor, active_requests}`. **예외 없음**(작성자·owner·admin·platform_admin). 공개 범위 창은 상세 `signature_visibility_floor` 로 «나만 보기» 를 숨기고 이유를 말한다.
5. **옛 데이터**: `dev-backend/scripts/migrate-signature-visibility-floor.js`(기본 읽기만 · `--apply`). dev 7건 적용. 운영은 Irene 답 뒤 배포 방에서.

## 한 술어
`services/signatureCore.signatureVisibilityFloor(post)` → `{floor, audience, requiredTargetIds, activeCount}` ·
`raisePostToSignatureFloor` (보내기·스크립트) · `blockIfBelowSignatureFloor` (두 문) · 상세 응답 칸.
자동저장 초안 L1 강제(`post_actions.createPost`)는 **만들 때만** 걸린다 — 그 순간엔 요청이 없고, 초안에 요청을 보내면 발행된다(eb9769e1) → 따로 건드릴 곳 없음.

## 검증
`node scripts/e2e/run.js --suite sigfloor` (실 HTTP 25검사) — L1+us/them → L2 members·명단·서명자 읽기·owner 서명 관리 제목·감사 / 작성자·owner L1 409(두 문) / confirm·them 만 / 프로젝트 L2 소속 유지 / L3 그대로 / 대조군: 요청 전부 취소 → L1 200 · 요청 없는 문서 L1 200.
양성 대조군: `belowSignatureFloor` 를 늘 false 로 → 14검사 뒤집힘(2026-10-23 실측).

## 남긴 것(비차단)
- 프로젝트 L2 문서의 우리 쪽 서명자가 그 프로젝트 멤버가 아니면 문서를 못 연다(프로젝트 L2 는 target_member_ids 를 안 본다) — 서명은 앱 안 서명 화면으로 가능한지 별도 확인 필요.
- Fable 설계의 «작성자에게 앱 알림 1건»(옛 행 일괄 올림 때)은 넣지 않았다 — 운영 일괄 여부가 Irene 답에 달려 있어 그때 함께.
- guard-invariants 래칫(«posts vlevel 쓰는 라우트는 술어를 부른다»)은 넣지 않았다 — vlevel 쓰는 문이 두 곳뿐이고 e2e 가 둘 다 잰다.
