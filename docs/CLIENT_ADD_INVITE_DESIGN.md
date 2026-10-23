# 고객 «추가» vs «초대» 분리 · 그 자리에서 추가하고 연결 (2026-10-23 · Fable 설계 판정)

> Irene: *"고객을 추가하는 것과 고객을 초대하는 것을 명확히 나누지를 않았어 … 추가된 고객과 초대되서 참여된 고객이 분리되서 인지도 되어야 하고."*
> 정찰: `.claude/plans/qmvjmx0i6.md`. 새 표·새 status 없음.

## 1. 동사 둘 · 칩 넷
| 동사 | 뜻 | 서버 문 | 메일 |
|---|---|---|---|
| 고객 추가 / Add client | 우리가 등록해 관리(계정 없음) `managed` | `POST /api/clients/:biz/managed` | 없음 |
| 고객 초대 / Invite client | 고객이 계정으로 참여 `invited → active` | `POST /api/clients/:biz/invite` | 1통 + 확인창(받는 주소) |

`accessKindOf` 는 네 값: `prospect`(문의 · 한도 밖) · `managed`(추가한 고객 · 계정·초대 흔적 없는 archived 포함) · `invited`(초대 중) · `member`(참여 중).
옛 `guest` 값은 없앴다(옛 `?access=guest` = 필터 없음). 라벨 정본 `qsale.access.*`, `clients.status.*` 는 같은 글자.
한도 머리글에서 «정식» 글자를 뺀다(고객 = 추가했거나 초대한 고객).

## 2. ClientAddDrawer
- 기본 모드 = **추가**(`inviteFor` 일 때만 초대 고정). 토글 순서 «추가 | 초대 보내기», 제목·제출·도움말이 모드를 따른다.
- 초대 제출은 `ConfirmDialog` 에 받는 주소를 적어 묻는다.
- 메일 주소 메뉴는 드로어를 **메일 화면 안에서** 연다(이동 없음). 열린 메일에 고객이 있으면 «고객 보기».
- Q mail 우측 패널 고객 칸 아래 [+ 고객 추가].

## 3. 서버 — «만들고 연결» 한 함수
- `services/clientLinkSource.js` — `resolveSource`(검증, 행을 만들거나 메일 보내기 **전**) · `attachSourceToClient`(save-as-client 부수효과 블록을 그대로 옮김).
  save-as-client · `/managed` · `/invite` 셋이 같이 쓴다.
- 입력 `source: { kind: 'email_thread'|'guest_link'|'conversation', id }`.
  스레드 = business_id ∧ 보는 사람 접근 가능 계정(아니면 404) · 릴레이 발신자면 400 `relay_sender_use_manual` ·
  대화 = 고객 대화방만 · **이미 다른 고객이 붙어 있으면 409 `already_client` + existing_client_id**(같은 고객이면 그냥 통과).
- 같은 발신자 과거 스레드: 워크스페이스 전체 · 빈 client_id 만 · 상한 500 · **개수는 응답에 싣지 않고** 감사 `client.link_source` 에만.
- 연결 뒤 단계가 비었거나 none 이면 `inquiry`.
- `/managed` 가 같은 연락처의 **prospect(계정 없음)** 를 만나면 승격(한도 add_client → managed · 빈 칸만 채움 · 연결) → 200 `upgraded:true`.
  그 외 기존 행은 409 `client_exists` + existing_client_id(드로어: [그 고객 열기] · source 가 있으면 [그 고객에 이 메일 연결]).

## 4. 상담 [고객으로 등록]
상담 목록·확인 필요 둘 다 ClientAddDrawer(기본 추가, prefill + source). prospect 를 먼저 만들지 않는다.
`saleRegister.ts` 의 자동 초대 분기 삭제(첫 액션 자동 등록 `invite:false` 는 그대로).

## 5. «+ 고객 추가» 자리 · 옵션 라벨
이번: Q mail 주소 메뉴 · Q mail 우측 패널 · Q talk 새 대화(모달을 닫고 드로어 → 저장 뒤 모달을 같은 값 + 그 고객으로 다시 연다).
옵션 라벨 `utils/clientLabel.clientOptionLabel` → «이름 · 추가한 고객». 목록 API 가 `access_kind` 를 싣는다(withAccess).
**이번 범위 밖**: Q note 상담으로 저장 · Q Bill 외부 직접 입력 · NewProjectModal «새 고객»(clients 행 없이 project_clients 만 — AI create_project 와 공유, 별도 설계).

## 7. 완료 검증
되돌리기 어려운 것: 교차 계정 스레드 client_id 쓰기(빈 값만·개수 미노출) · 추가 = 메일 0 / 초대 = 1 + 확인창 · access_kind 값 변경(API 계약) · prospect→managed 승격 한도.
