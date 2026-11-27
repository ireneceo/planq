# Q sale «고객 중심 접점» — 지난 메일 연결(B) · 등록 고객 새 메일(C) · AI 고객·문의 추가(D)

- 2026-11-27 · Fable 설계 판정 DESIGN-READY · 구현 [Opus]
- Irene 원문: «Q sales 에 AI로 고객이나 문의 추가하는 것도 필요해. 그리고 고객이 먼저 등록이 되고 고객이 가진 정보에서 온 이메일이나 문의는 상담문의 내용으로 자동으로 가져오게 … 고객을 접점으로 하는 거야 … 이 이메일로 오는 모든 문의는 이제 고객의 이메일이 되는거지.»
- 정찰 계획: `.claude/plans/qmwyo3afy.md` · 화면 몫 A 는 523f75fd2.

## 0. 선행 결함 (B 전에 고친다)
| # | 위치 | 결함 |
|---|---|---|
| P1 | `scripts/backfill-mail-links.js` + `linkThread` | 미리보기가 `syncThreadIssuesProject` 로 실제로 쓴다 → 미리보기는 `resolveLink`(쓰기 없음)만 |
| P2 | 같은 스크립트 | 스팸 스레드를 거르지 않음 → `status <> 'spam'` |
| P3 | `matchClientByAddresses` | invite/billing `findOne`·별칭 `LIMIT 1` — 두 고객이 같은 주소면 아무 쪽 → 단계별 주인 목록 `claimantsOfAddress`, 여럿이면 null(중복 판정만 `ambiguous:'first'`) |
| P4 | `mailLink` | 우리 메일함 주소를 매칭에서 안 뺌 → `ownAddressSet` 서비스로 옮겨 `resolveLink` 맨 앞에서 뺌 |
| P5 | `routes/sale.js` 상세 채널 수 · `clientTimeline` 메모 threadIds | 계정 격리 없이 고객 스레드를 셈 → `accessibleAccountIds` + 비스팸 |

## B. 지난 메일 붙이기 — `mailLink.linkPastThreadsForClient`
- 범위 워크스페이스 전체(수신 크론과 같다) · 주소 축 from+to+cc · 노출은 계정 축(붙인 수는 응답에 싣지 않고 감사에만, `thread_ids` 남김).
- «이 고객 하나만»: ① 주소 선검사 `matchClientByAddresses(biz,[x]) === clientId` ② 스레드별 `resolveLink` 결과 고객이 그 고객일 때만.
- 건너뛸 주소: 우리 메일함·별칭 · 활성 멤버 계정 이메일 · 자동 발송 주소.
- 제외 스팸(archived 포함) · 상한 호출당 후보 2,000 · 주소 10개(넘으면 감사 `capped`).
- 주소 집합 = invite + billing + 담당자 이메일 + 별칭.
- 프로젝트는 `resolveLink` 값 그대로(`project_id IS NULL` 일 때만) + 이슈 동기 + 히스토리 신호.
- 쓰기는 `client_id IS NULL` 조건 UPDATE 만(sticky).
- 신호 `mail:updated {bulk}` + `client:updated` — `saleCommon.broadcast`.
- 부르는 문(`afterClientAddressesChanged`, 실패가 저장을 막지 않음): save-as-client(신규·기존) · /invite · /managed · sale PATCH(invite_email) · clients PUT(invite/billing) · 담당자 POST/PATCH/make-billing/명함 · `prospect.afterProspectCreated` · 프로젝트 고객 초대로 고객 생성.
- `attachSourceToClient` 의 «같은 발신자 500건» 블록은 지우고 이 함수로.
- 백필: 새 스크립트 없음. 기존 스크립트 P1·P2 수정 + `--business=`. 운영 `--apply` 는 Irene 지시 뒤 수동.

## C. 등록 고객의 새 메일 — `services/clientMailState.mailStateByClient`
- 범위 business + client + 보는 사람 접근 계정 + 비스팸.
- pending = `mailFolders.folderOf(row)==='reply_needed'` 스레드 하나라도 · replied = 보이는 스레드에 outbound(internal_only=false) · latest = 최신 스레드 {subject, preview, at}.
- 상담 목록 고객 행: `needs_reply = pending || (inquiry && !touched && !replied)` · title/preview = latest · at = max(last_touch, latest.at) · `meta.mail`.
- **단계 자동 전이 없음.** none/won/lost 라도 pending 이면(보관 제외) 그 동안만 행으로(`meta.via_mail`) — stage 필터가 있으면 안 넣음.
- 배지: Q sale 에 메일을 더하지 않는다(Q mail 이 센다). saleBucket ① 은 `!replied && !pending` 으로 좁히기만.
- 수신 때 touchClient: 공용 메일함 + inbound + 비스팸 + 백필 아님일 때만 · `client:updated` 신호.
- `client_interactions` 로 복사하지 않는다 · 분류(triage) 불변.

## D. 외부 AI — `create_client_inquiry`
- 문의 고객(prospect + inquiry)만. managed·초대·수정 도구 없음.
- scope `clients:write` 신설(재연결 필요) · 메뉴 qsale write · 입력 strict(이름/회사 하나 필수 · email · phone · sales_source · content · content_title · kind · direction · occurred_at · source · idempotency_key).
- risk LOW, `riskOf` email/source 있으면 MEDIUM(확인 2단계 — 지난 메일 일괄 연결이 따라온다).
- 같은 연락처 고객 → 그 고객 반환(`created:false, linked_existing:true`, content 있으면 기록) · 한도 → `QUOTA_EXCEEDED`.
- 결과 `{client, created, linked_existing, record}` — 붙인 메일 수 없음.
- 본체 `services/actions/client_actions.saveInquiryClient` — save-as-client 공통부를 옮김(값·순서·감사 이름 그대로).
- 앱 안 Cue `CUE_WRITE` 에 넣는다.

## E. 메일 드로어 기본 상태 — 바꾸지 않는다(이미 managed, 메일 출처면 inquiry 단계).
