# 워크스페이스 삭제 설계

> 2026-10-29 · 방 15884e3b · [Opus] 초안 → Fable 설계 판정 대기
> Irene 원문(10-29): «워크스페이스 삭제는 어딨지?» → 답(없음) 뒤 «권고대로» = ① 만든다.
> 정찰 `.claude/plans/qmvrvqi7g.md` «만든다면» · 바꾸는 옛 결정: `docs/ACCOUNT_DELETION_DESIGN.md` D8 «범용 삭제 안 만듦».

## 1. 지금 있는 것 (HEAD 9d3d7855 실측)

| 항목 | 사실 |
|---|---|
| 삭제 표시 | `businesses.deleted_at` (계정 탈퇴 v3 때 추가). dev 에 삭제된 행 88개(시험) |
| 닫히는 문 | `middleware/workspaceAlive.js` — 인증 요청마다 business_id(params/query/body · `/api/businesses/:id`)가 삭제본이면 404 (30초 캐시, `invalidate()`) · `access_scope.getUserScope` 뿌리에서 권한 0 · `attachWorkspaceScope` 404 `workspace_deleted` · 전환 `auth.js:968` 404 · 스위처 목록 `getUserWithBusiness` 제외 · `pickActiveBusinessId` 가 정본 자가치유 · 공개 링크 `workspaceAliveParam` · `notify()` 삭제본 제외(`notifications.js:124`) · platform_admin 은 통과 |
| 지우는 유일한 길 | 계정 탈퇴 — 솔로(다른 사람 멤버·고객·미수금·유료 구독 0) 워크스페이스만 `deleted_at` + Cue 계정 status=deleted (`account_deletion.js:146`). 복구 = 계정 복구가 «내가 owner + deleted_at ≥ 요청시각» 을 되살림(`auth.js:1158`) |
| 영구 삭제 | 없음. 행 삭제 불가에 가깝다 — `businesses` 를 가리키는 FK 88개(RESTRICT 60 · CASCADE 20 · SET NULL 8), `business_id` 칸이 있는 표 112개 |
| 돈 | 플랫폼 구독은 **선불**(계좌이체·Stripe 1회). 자동 카드청구 없음. 환불은 `services/refund.js refundPayment`(관리자 수동, 체험 중 환불 규칙 있음) |
| 확인 흐름 재료 | `ConfirmDialog` · 탈퇴 창의 «이메일 입력 + 비밀번호» (`AccountDeletionSection.tsx`) · OAuth 전용 계정 비밀번호 재확인은 **미구현**(탈퇴도 `oauth_otp_required` 400 으로 막혀 있다) |
| 소유권 이전 | 있음 `POST /api/businesses/:id/transfer-ownership` (설정 → 멤버 서랍 Danger Zone) |

### 1-1. 삭제본을 거르지 않는 자동 작업 (솔로만 지워지던 동안은 무해 — 범용 삭제면 문제)

| cron / 서비스 | 하는 일 | 거르나 |
|---|---|---|
| `recurring_invoice.runDailyRecurringBilling` | 프로젝트 정기 청구서 발행(**고객에게 메일**) | ✗ |
| `overdue_handler` | 연체 청구서 처리(독촉) | ✗ |
| `clientSubscriptionBilling` | 고객 정기 구독 청구 | ✓ (110줄) |
| `contractBilling` | 서명 계약 → 청구 초안 | ✓ |
| `billing.runDailyBillingCron` | 플랫폼 구독 만료·갱신 결제 생성·**입금 안내 메일** | 일부(면제 안내만 ✓) |
| `trial.runDailyTrialCron` | 체험 종료 안내 메일·잠금 | ✗ |
| `recurringTaskGenerator` | 반복 업무 생성 | ✗ |
| `calendarReminderCron` | 일정 임박 알림(notify 경유 — notify 가 거름) | 간접 |
| `calendarReverseSyncCron` · `gdriveWatchCron` | 구글 캘린더·드라이브 동기화(외부 API 호출) | ✗ |
| `emailImapCron` | 메일 수집 | ✓ |
| `mailFollowUpCron` · `unreadEscalationCron` | 메일 후속·미확인 승격(메일 발송 가능) | ✗ |
| `taskExtractorScheduler` | 채팅 → 업무 후보(LLM 비용) | ✗ |
| `monthlyReport` · `weeklyReviewCron` · `reportUnitCron` | 보고서 | monthly ✗ / 나머지 ✓ |
| `retentionPurge` | 보관기간 정리 | `paranoid:false` 로 전부 |
| MCP/AI 앱 토큰 `ApiToken`·`AgentGrant` (user_id, business_id) | 교환 시 `getUserScope` → 삭제본이면 권한 0 | 간접 ✓ |

## 2. 정해야 할 것 (Fable 설계 판정)

1. **soft + 유예 후 정리** vs **soft 만**
2. **데이터 있는 워크스페이스도 허용** (멤버·고객·청구·미수금·유료 구독) — D8 변경
3. 남은 멤버·고객 처리 · 알림(외부 발송 여부) · 구독 해지·환불 · Cue · 메일/드라이브/캘린더 연결 · API 토큰
4. `active_business_id` 가 그곳인 사용자 착지 · 워크스페이스가 0 개가 된 사람
5. 확인 흐름(누가·재확인·이름 입력) · 감사 로그 · 복구 경로
6. 계정 탈퇴 동반 삭제와의 관계(복구가 서로를 되살리지 않게)

## 3. [Opus] 초안 — Fable 이 고칠 것

- **A. soft + 30일 유예 → 정리(영구)**. 행은 남긴다(FK 88). 정리 = 그 워크스페이스의 PlanQ 저장 파일 물리 삭제 · 연결 자격(메일 계정 비밀번호·클라우드 토큰·API/에이전트 토큰) 행 삭제 · 고객 PII 익명화 · `purged_at`. **청구서·결제·세금계산서 증빙 행은 남긴다**(법정 보관 — 정리 대상 아님). 유예 중 복구 = 대표가 «내 프로필 → 삭제 예정 워크스페이스 → 복구».
- **B. 데이터 있어도 허용** — 막지 않고 «잃는 것» 요약(멤버 n·고객 n·미수금 n건·남은 구독 기간)을 창에 보여 준다. 단 **유료 구독 남은 기간은 자동 환불하지 않는다**(관리자 수동 환불 흐름 그대로 · 창에 «남은 기간 환불은 문의» 문구). 미수금 청구서는 그대로 남는다(받을 돈 기록).
- **C. 남은 사람** — 멤버십·고객 행은 그대로(복구 때 그대로 돌아오게). 멤버에게 **앱 안 알림만**(메일·푸시 X — 외부 발송 0) — 단 알림은 삭제본 범위라 notify 가 거른다 → 받는 사람의 **다른 워크스페이스/플랫폼 범위** 알림 1건? 아니면 알림 없이 소켓 신호로 화면만 옮김. 고객에게는 아무것도 안 보낸다. Cue 계정 status=deleted(복구 시 active).
- **D. 연결** — 유예 중에는 자동 작업이 삭제본을 건너뛴다(1-1 표 전부 — 공용 술어 `aliveBusinessWhere` 한 벌 + 가드). 연결 행은 정리 때 지운다(유예 중 복구하면 그대로 다시 동작).
- **E. 착지** — `business:<id>` 방에 `workspace:deleted` 신호 → `WorkspaceSyncGuard` 가 /me 다시 읽음 → `pickActiveBusinessId` 가 다른 워크스페이스로. 0 개면 «워크스페이스 만들기» 화면.
- **F. 확인** — **대표(owner)만**(admin 불가) · 비밀번호 재확인(OAuth 전용 계정은 이메일 OTP — 탈퇴 D9 와 같은 것을 이번에 만든다) · 워크스페이스 이름 그대로 입력 · `ConfirmDialog variant=danger` · 감사 로그 `business.delete`/`business.restore`. 서버가 진실 원천(이름·비밀번호 서버에서 다시 봄).
- **G. 표시** — `businesses.deletion_reason ENUM('account_deletion','owner_request')` · `deleted_by` · `purge_after` · `purged_at` 추가. 계정 복구는 `account_deletion` 만 되살리고, 워크스페이스 복구는 `owner_request` 만.
- **H. 화면** — 설정 일반(브랜드) 탭 맨 아래 Danger Zone «워크스페이스 삭제»(owner 에게만 보임) · 내 프로필에 «삭제 예정 워크스페이스» 칸(있을 때만) · ko/en.

## 4. 검증 계획 (초안)
- 실HTTP: owner 삭제 200 → 스위처·목록에서 사라짐 · 그 id 로 API 404 · admin/member/client 403 · 남의 워크스페이스 404 · 비밀번호 틀림 403 · 이름 틀림 400 · 복구 200 → 전부 되돌아옴 · 계정 탈퇴 복구가 owner_request 삭제본을 안 되살림(대조군)
- cron: 삭제본 대상 정기 청구·체험 메일·반복 업무 0건(삭제 전 1건 대조군)
- 착지: 멤버 창이 열린 채 삭제 → 다른 워크스페이스로 옮김(실브라우저 3폭)
- e2e `--suite tenant` · guard · health-check · build

## 5. Fable 설계 판정 (2026-10-29 · VERDICT: DESIGN-FIX — 아래 11건 반영하면 추가 설계 라운드 없이 구현 시작 가능. 다음 Fable 은 완료 검증 1회)

### 결정
- ①-1 soft + 30일 유예 + 정리(purge). 행 영구 보존.
- ①-2 정리 때 지움: 파일 바이트(`filePurge.purgeFile`+`flushPurgeExternals`) · `EmailAccount`·`BusinessCloudToken`·`ExternalConnection`(business_id)·`ApiToken`·`AgentGrant` · 고객 PII 익명화(`accountAnonymize.js` 방식) · 게스트 링크 revoke · 공유 토큰 null(`workspaceAliveParam` 목록 = 전수) · 미수락 초대 삭제 · `Subscription` canceled(`workspace_purged`) · Q Note `purge-business` 내부 엔드포인트(신규, best-effort 재시도) · `purged_at`. 남김: businesses 행·청구서·결제·세금계산서·환불·감사 로그·business_members·대화/문서 본문(접근 404, 하드 퍼지는 3단계). 화면 문구도 이 사실대로(«전부 영구 삭제» 금지).
- ② 데이터 있어도 허용. 차단: 요청자 ≠ `businesses.owner_id` · 사칭 중(`req.user.impersonator`) 403 · 이미 삭제본 404. 멤버·고객·미수금(건수/합계)·구독 남은 일수는 경고 요약.
- ③-1 외부 발송 0 · 알림 행도 안 만듦 · 소켓 `workspace:deleted {business_id}` 를 `business:<id>` 로 보낸 뒤 `socketsLeave`.
- ③-2 구독은 삭제 때 건드리지 않음(cron 이 술어로 건너뜀, 정리 때 canceled). 자동 환불 없음 — 창에 «남은 기간 환불은 문의».
- ③-3 Cue 계정 status=deleted(복구 시 active). ③-4 연결·토큰은 유예 중 유지, 정리 때 삭제.
- ④ 삭제 트랜잭션 안에서 `users.active_business_id=NULL WHERE =:id` → 소켓 → `WorkspaceSyncGuard` 새 분기(refreshUser 후 rebootForWorkspace) + `apiFetch` 404 `workspace_deleted` 안전망(refreshUser). 0개 화면 새로 안 만듦 — 기존 `WorkspaceSwitcher.noWorkspace`.
- ⑤-1 owner 만(platform_admin 불가) · 비밀번호 · 표시명(`brand_name||name`, trim+NFC) 입력 · `AccountDeletionSection` 껍데기 재사용(새 모달 금지) · 서버가 다시 봄. OAuth 전용 owner 는 1단계 400 `oauth_otp_required` + 이유 문구(보고에 «2단계까지 삭제 불가» 명시).
- ⑤-2 감사 `business.delete`·`business.restore`·`business.purge`.
- ⑤-3 복구 = `GET /api/users/me/deleted-workspaces` · `POST /api/users/me/deleted-workspaces/:id/restore`(비번 재확인 없음) + `workspaceAlive.invalidate()`. 화면: 내 프로필 «삭제 예정 워크스페이스»(있을 때만).
- ⑥ 컬럼 `deletion_reason ENUM('account_deletion','owner_request')`·`deleted_by`·`purge_after`·`purged_at` + 백필(기존 삭제본 → account_deletion) · `account_deletion.js:146` reason 기록 · 계정 복구(`auth.js:1155`) AND reason='account_deletion' · 정리 cron 술어 `purge_after<=now AND purged_at IS NULL AND (reason='owner_request' OR owner.anonymized_at IS NOT NULL)`.
- ⑦ `services/workspaceAlive.js` `aliveBusinessWhere()`·`aliveBusinessInclude()` + 가드 `guard-invariants --category=cronalive`(HARD, 예외 주석 `// cronalive-exempt: 이유`).

### 차단 지적 11건
1 `workspaceAlive.invalidate()` 호출처 0 → 삭제·복구가 부른다 · 2 착지 E 동작 안 함 → ④ 세 개 한 벌 · 3 0개용 새 화면 없음 → 스위처 경로 · 4 누락 cron: shareExpiryNotify(메일)·billing 본체(입금 안내 메일)·recurring_invoice(고객 메일)·retentionPurge(유예 중 건너뜀)·providerCredit·workspaceHolidays·emailFaqCluster·wikiQuestionCluster·candidateCleanup·attendanceAutoClose·contentTrash·invoiceDelivery.sweepStaleDeliveries·runMissedOccurrenceCleanup — 가드가 목록 대신 · 5 사칭 차단 · 6 복구 라우트는 /api/users/me 아래 · 7 reason 을 두 복구 술어에 AND + 백필 · 8 구독 삭제 때 안 건드림 · 9 정리 cron 과 계정 익명화 경쟁 → ⑥ 술어 · 10 OTP 는 3단계 · 11 PushSubscription 제외, AgentGrant·ExternalConnection 포함.

### 구현 순서
1단계(이번): 마이그레이션(4컬럼+백필 멱등) → 술어+cronalive 가드(빨간불 먼저 → 전수 적용 → 초록) → `POST /api/businesses/:id/delete`(routes/businesses.js) → 복구 2개 → account_deletion·auth reason → 소켓+socketsLeave+active NULL → 프론트(SyncGuard 분기·apiFetch 안전망·브랜드 탭 맨 아래 Danger Zone `business_role==='owner'`·프로필 칸·ko/en settings/profile).
2단계: `services/workspacePurge.js`(00시 묶음) — ①-2 목록 · Q Note purge-business · 감사 business.purge.
3단계(범위 밖 확정): 공용 이메일 OTP · 구글 토큰 원격 revoke · 본문 하드 퍼지 · 관리자 복구 화면.

### 완료 검증에서 잴 것
삭제 200 → 30초 안 404 `workspace_deleted` · 스위처·/me 에서 사라짐 · member/admin/client/platform_admin/사칭 403 · 남의 것 404 · 비번 틀림 403 · 이름 틀림 400 · 두 번 404 · active 였던 사용자 전부 NULL → /me 자가치유(0개면 스위처 «워크스페이스 없음» 실브라우저) · 착지 소켓 경로·소켓 끊긴 창 404 경로 둘 다 3폭 · 복구 200(Cue active·소켓 재 join) + reason 대조군 양방향 · cron 하루치 직접 호출 삭제본 0 / 삭제 전 ≥1 · cronalive 가드 양성 대조군 · `fetchSockets()` 0 · 감사 3종 · build·guard·e2e tenant,wssync·health · Danger Zone 은 member 토큰 DOM 에 없음(3폭).

## 6. 구현 (2026-10-29 · 방 15884e3b · [Opus]) — Fable 지적 11건 반영
| 무엇 | 어디 |
|---|---|
| 칸 4개 + 옛 삭제본 백필(멱등, 배포 슬롯 등록) | `dev-backend/scripts/migrate-workspace-deletion.js` · `scripts/deploy-planq.sh` |
| 삭제·미리보기 `POST/GET /api/businesses/:id/{delete,deletion-preflight}` · 복구 `GET /api/users/me/deleted-workspaces` · `POST …/:workspaceId/restore` | `dev-backend/routes/workspace_deletion.js` (server.js 마운트 — businesses.js 앞) |
| 사유 분리 — 탈퇴 동반 삭제가 `account_deletion` 기록 · 계정 복구는 그 사유만 되살림 · 둘 다 `invalidate()` | `routes/account_deletion.js` · `routes/auth.js` deletion-recover |
| 404 `workspace_deleted` 에 business_id(안전망) | `middleware/auth.js` · `middleware/access_scope.js` |
| cron 공용 술어 + 가드 `cronalive`(HARD, 35파일) — 13곳 거름 · 22곳 `cronalive-exempt` 이유 | `services/workspaceAlive.js` · `scripts/guard-invariants.js` |
| 정리 cron(00시 묶음) · Q Note `purge-business` | `services/workspacePurge.js` · `q-note/routers/sessions.py` |
| 화면 — 설정 일반 탭 맨 아래 Danger Zone(대표만) · 프로필 «삭제 예정 워크스페이스» · 열린 창 착지(소켓 + 404 안전망) · 껍데기 공용화 | `pages/Settings/WorkspaceDeletionSection.tsx` · `pages/Profile/DeletedWorkspacesSection.tsx` · `components/Common/WorkspaceSyncGuard.tsx` · `contexts/AuthContext.tsx` · `components/Common/dangerZoneShell.tsx` |

**설계와 다르게 한 것 1건** — 정리 때 메일 계정 **행을 지우지 않고 자격(비밀번호·OAuth 토큰)만 지우고 끈다.** 행을 지우면 `email_threads` 가 CASCADE 로 통째로 지워져 «대화·본문은 남김(하드 퍼지는 3단계)» 결정과 어긋난다(FK 실측).
**남긴 것(3단계)** — 업무·채팅 첨부(TaskAttachment·MessageAttachment) 바이트는 정리 대상에 아직 없다(파일함 File 만) · 공용 이메일 OTP · 구글 토큰 원격 revoke · 본문 하드 퍼지.
**검증** — `.claude/plans/wsdel-api-test.js` 34/34 · `wsdel-cron-test.js` 4/4(음성·양성) · `wsdel-purge-test.js` 14/14 · 가드 cronalive 양성 대조군 FAIL→복원 PASS · e2e `--suite wsdelete` 3폭.
