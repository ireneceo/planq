# 고객 목록에 멤버가 남는 것 — «같은 사람» 판정을 이메일까지 (초안 · **해소됨**)

> **2026-10-22 해소** — 같은 사안을 방 f9b7abaa 가 Fable 설계 판정 6(`docs/PEOPLE_PROFILE_UNIFY_DESIGN.md`)으로 받아 `a7853c5d` 로 구현했다
> (이메일 = 계정 + 확인된 보조 · 이름만 같은 행·다른 계정 행은 건드리지 않음). 정본은 그 문서다 — 이 초안은 기록으로만 남긴다.

> 2026-10-21 Irene: *"고객에 왜 멤버 정보를 안걸러주고 들어가? 정보가 매칭되면 멤버인건데."*
> Q sale 고객 목록에 «송형섭» 두 줄 — 둘 다 초대 대기. 하나는 이메일 없음, 하나는 hssong992@naver.com. 송형섭은 워크스페이스 멤버다.
> 작성 [Opus] · Fable 한도 초과(429)로 설계 판정을 못 받아 **구현하지 않았다**(공용 기준 5절).

## 원인 (코드 사실)
- «멤버가 이긴다»(`services/clientToMember.promoteClientToMember`, 2026-10-16 Fable 설계)는 **계정 id 로만** 고객 자국을 찾는다
  (`clients.user_id = 나` · `project_clients.contact_user_id = 나`).
- 그런데 프로젝트 고객 초대(`routes/projects.js POST /:id/clients`)는 그 순간 계정이 없으면
  `Client{user_id:null, invite_email, status:'invited'}` + `ProjectClient{contact_user_id:null, contact_email}` 을 만든다.
  이름만 넣으면 `Client{user_id:null, 이메일 없음, status:'invited'}`.
- 이 행들은 뒤에 같은 사람이 **멤버로** 가입해도 user_id 가 채워지지 않아 전환 대상이 아니다 → 고객 목록에 «초대 대기» 로 남는다.
- 운영 행 확인은 못 했다(운영 읽기 권한 거절). 위는 화면 모양(이메일 있음/없음 두 줄 · 초대 대기)과 코드로 추론한 것이다.

## 제안
1. `promoteClientToMember` 가 «같은 사람» 을 **이메일로도** 찾는다 — 같은 워크스페이스 · `user_id IS NULL` · 보관 안 됨 ·
   `LOWER(invite_email)` ∈ {계정 이메일, 확인된 보조 이메일}. 그 고객 행은 지금과 같이 보관(+`member_converted_at`).
   그 고객에 달린 `project_clients`(client_id 일치, 또는 contact_user_id NULL ∧ contact_email 일치)는 같은 프로젝트 멤버로.
   근거: 고객을 붙이는 문은 이미 «User.email == 넣은 이메일 = 같은 사람» 으로 409 `already_member` 를 낸다 — 같은 술어로 맞춘다.
2. `scripts/migrate-client-to-member.js` 탐지도 같은 술어(기본 읽기만, `--apply` 수동).
3. **이름만 같은 행**(이메일·전화·계정 없음)은 자동으로 합치지 않는다 — 동명이인. 후보:
   (a) 그대로 두고 사람이 보관 (b) 고객 상세에 «멤버 ○○ 와 같은 사람이면 정리» 버튼 (c) 목록에서 숨김.

## 판정 받을 것
- 1 의 이메일 일치를 «같은 사람» 으로 써도 되나(보조 이메일 포함 여부).
- 3 의 이름만 같은 행 처리.
- 전환은 project_clients 를 지운다(되돌림은 감사 old_value) — 이메일 일치로 범위가 넓어지는 데 따른 위험.

## 검증 계획(판정 뒤)
- dev: 계정 없는 이메일로 프로젝트 고객 초대 → 같은 이메일로 멤버 초대 수락 → 고객 행 보관·프로젝트 멤버 추가·목록에서 빠짐.
- 대조군: 다른 이메일 고객은 그대로 · 다른 워크스페이스의 같은 이메일 고객은 그대로 · 이름만 같은 행은 그대로.
- 마이그레이션 읽기만 출력에 이메일 일치 쌍이 잡히는가.
