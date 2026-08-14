# Q 캘린더 동기화 — 상태·행동·정리 (설계)

작성 2026-08-14 · 규모 중 · 고위험 #5(보안 경계: 외부 계정 삭제 행위) 접촉
운영 피드백 #242 재신고("구글에서 수정해도 Q calendar 에 반영 안 됨 — 아직 해결 안 됨")에서 출발.

---

## 0. 운영 실측 — 신고는 옳고, 우리 진단은 반쪽이었다

읽기 전용으로 운영(87.106.78.146)에서 직접 확인한 것:

| 사실 | 근거 |
|---|---|
| 역방향 동기화는 **작동한다** | 신고자(user#3) 본인 일정: 08-14 01:45 PlanQ 생성 → **01:47 구글에서 제목 수정** → **01:50 PlanQ 반영**(`audit_logs#580 event.reverse_sync`). 구글 API 로 현재값 대조 시 구글·PlanQ 모두 `수정이안되나??` **일치** |
| 반영까지 **최대 5분** | `calendarReverseSyncCron` 5분 간격. 위 사례는 3분. **화면 어디에도 이 지연을 고지하지 않는다** |
| 팀(워크스페이스) 캘린더는 **여전히 죽어 있다** | `business_cloud_tokens#3.scope='userinfo.email openid'`, `last_error='Request had insufficient authentication scopes.'`, **row updated_at 이 2026-07-31 이후 무변경 = 재연결이 저장된 적 없음** |
| 같은 뿌리로 Meet 자동생성도 실패 중 | 운영 로그 `[gcal createMeetingEvent] Request had insufficient authentication scopes.` — #242 의 **1번 항목**이 아직 살아 있다 |
| 폴링은 매 회차 정상 기동 | `[reverseSync] 소스 1 · 반영 0 · 무시 0 · 비링크 0 · 오류 0 · 제외 2(no_links:1, no_calendar_scope:1)` |

**결론: 코드 결함이 아니라 "고쳤는데 사용자가 그 사실에 도달하지 못하는" 결함이다.**
지연을 모르고(→ 고장으로 오인), 팀 토큰이 죽은 것을 캘린더 화면에서 조치할 수 없고(→ 설정 깊은 곳),
구글에 남은 옛 사본은 **사용자에게 손으로 지우라고 안내**했다(→ 우리가 할 일을 떠넘김).

## 1. 지금 화면의 상태 (조사 결과)

- `components/Calendar/CalendarSyncNotice.tsx` 가 이미 있고 `workspaceBroken` 분기까지 있다.
  **그러나** ① 재연결 버튼이 없다 ② 오너가 아니면 무엇을 해야 하는지 없다 ③ 지연 고지가 없다
  ④ 문구가 **"실시간 양방향(Google 변경의 자동 반영)은 Google 검수 승인 후 제공"** — **이미 배포된 기능을 거짓 서술**한다.
- 판정이 프론트에 흩어져 있다 — `QCalendarPage` 가 `/api/cloud/status/:id` 와 `/api/me/external-connections`
  두 응답을 각각 받아 4개 boolean 으로 조립한다. 같은 판정이 서버(`gcal.hasWriteScope`)와 프론트 두 벌.

## 2. 절단면 (이번 청크에서 하는 것만)

### A. 동기화 상태 단일 API — `GET /api/calendar/sync-status/:businessId`
`authenticateToken` + `checkBusinessAccess`. 응답:

```json
{ "poll_interval_minutes": 5,
  "workspace": { "connected": true, "scope_ok": false, "sync_enabled": true,
                 "needs_reconnect": true, "account_email": "...", "last_error_at": "..." },
  "personal":  { "connected": true, "can_write": true, "sync_enabled": true,
                 "needs_reconnect": false, "account_email": "..." },
  "last_reverse_sync_at": "2026-08-14T01:50:00Z",
  "can_reconnect_workspace": true,
  "orphan_scan": { "supported": true } }
```

- 판정은 **서버 기존 함수 재사용**: `gcal.hasWriteScope` · `personalCalendar.hasCalendarWrite` ·
  `/api/cloud/status` 와 동일한 `needs_reconnect` 정규식. **새 판정식을 만들지 않는다**(두 벌 금지).
- `personal` 은 **호출자 본인 연결만**(`pickPersonalConn` 과 같은 우선순위). 남의 연결 상태 노출 금지.
- `can_reconnect_workspace` = `req.businessRole === 'owner' || platform_admin` (기존 `requireOwnerForCloud` 와 동일 기준).
- `last_reverse_sync_at` = 그 워크스페이스의 최근 `audit_logs.action='event.reverse_sync'` created_at.

### B. 배너 개편 — 상태에서 **행동**으로
`CalendarSyncNotice` 를 sync-status 소비로 바꾸고:

1. **깨짐(workspace.needs_reconnect)** — Danger 톤, dismiss 불가(현행 유지)
   - 오너: **"다시 연결"** 버튼 → `POST /api/cloud/connect/gcal/:businessId` 로 받은 URL 을 팝업으로
     (StorageSettings 와 **같은 경로 재사용**, 새 OAuth 흐름 만들지 않음). ★ COOP 로 opener 가 끊기므로
     완료 신호는 **BroadcastChannel**, 창은 부모가 닫는다([[feedback_oauth_popup_coop_parent_closes]]).
   - 오너 아님: "워크스페이스 오너가 다시 연결해야 합니다 — {오너 이름}" (행동 가능한 사람을 명시)
   - 문구에 **동의 화면에서 "캘린더" 항목 체크 필수**를 명시(체크 안 해도 연결은 성공한 것처럼 보인다)
2. **정상** — 정보 톤, dismiss 가능(현행 유지) + **"구글에서 변경한 내용은 최대 5분 내 자동 반영됩니다"** +
   `last_reverse_sync_at` 상대시간("마지막 반영 3분 전")
3. **낡은 문구 삭제** — "검수 승인 후 제공" 제거. 개인 연동 읽기/쓰기 분기 문구는 유지.

### C. 즉시 동기화 — `POST /api/calendar/sync-now/:businessId`
`authenticateToken` + `checkBusinessAccess` + `perUserLimiter`(**분당 3회**, `middleware/costGuard` 재사용).

- `classifySources()` 결과에서 **이 워크스페이스에 해당하는 소스만** 폴링:
  workspace = `token.business_id === bizId` / personal = `conn.business_id === bizId && conn.user_id === req.user.id`.
  **남의 개인 캘린더를 남이 눌러 돌리지 않는다.**
- 응답 `{ applied, skipped, unlinked, errors, excluded }` → 프론트는 캘린더 재조회 + 배너 갱신.
- 왜 rate-limit: 외부 quota 를 쓰는 라우트(운영 안정성 규칙 #1). 버튼 연타 = 구글 API 폭주.
- 버튼 위치: 배너 우측(정상/깨짐 무관하게 노출, 단 소스 0이면 숨김).

### D. 구글에 남은 고아 사본 — **1클릭 정리**(자동 삭제 아님)
`GET /api/calendar/gcal-orphans/:businessId` (스캔) · `POST /api/calendar/gcal-orphans/:businessId/cleanup` (삭제)
둘 다 **오너 전용**(`requireOwnerForCloud` 와 동일 기준) + `perUserLimiter`.

- 스캔: 워크스페이스 캘린더에서 `privateExtendedProperty: 'planq=1'` 로 목록 →
  각 `id` 가 `calendar_event_gcal_links` 에 **전역으로 없으면**(= 다른 워크스페이스 사본까지 보호) 고아.
- 정리: 고아만 `events.delete`. **1회 최대 50건**, 건별 `AuditLog action='event.gcal_orphan_cleanup'`.
- ★ **자동 삭제하지 않는다.** 사용자 자산 임의 변경 금지([[feedback_no_user_asset_mutation]]) —
  재연결 직후 스캔 결과만 배너에 "구글에 남은 옛 사본 N건 정리" 로 띄우고, **누를 때만** 지운다.
- ★ **개인 캘린더는 대상 아님.** 사생활 공간이라 PlanQ 가 지우지 않는다(비대칭은 의도).
- 운영 실사례: `link#1`(event#29 `test1234848484`)의 구글 사본. 지금은 "사용자가 직접 지우세요" 로 안내 중.

### E. 문구 정합
`qcalendar` ko/en 신규·수정 키 전부 양쪽 작성. 설정 화면(StorageSettings)의 gcal 문구도 같은 사실로 정렬.

## 3. 하지 않는 것 (명시)

- **watch(push) 채널 도입** — 지연 5분을 0으로 만드는 정공법이지만 수신 도메인 검증·7일 만료 재등록·
  중복 수신 처리가 붙는 별개 청크다. 이번엔 **고지 + 즉시 동기화**로 체감을 해결한다.
- 폴링 주기 단축 — 구글 쿼터를 사용자 수만큼 곱해 태운다. 근본 해결은 watch 다.
- 개인 캘린더 고아 정리 · 구글에서 만든 일정 가져오기(import) — 절단면 밖.

## 4. 검증 계획 (Fable 구현 게이트에서 요구할 것)

1. **실HTTP** — sync-status 200/비멤버 403/무토큰 401 · sync-now 200 + **4번째 호출 429** ·
   orphans 스캔·정리 **member 403** · 정리 후 재스캔 0건
2. **반증(양성 대조군)** — dev 에 scope 없는 workspace 토큰을 만들어 ①배너가 Danger + 버튼으로 뜨는가
   ②정상 토큰으로 되돌리면 사라지는가. **안 뜨면 이 배너는 없는 것과 같다**
3. **고아 정리 반증** — 링크 있는 planq 이벤트는 **지워지지 않아야** 한다(음성 대조). 링크 없는 것만 삭제.
   삭제 후 구글 재조회로 부재 확인 + 감사로그 건수 일치
4. **회귀** — 정상 연동 워크스페이스에서 배너 비노출, 기존 캘린더 CRUD·overlay·Meet 무변경,
   `[reverseSync]` cron 로그 계속(즉시 동기화가 cron 을 방해하지 않는가 — 동시 실행 가드)
5. 가드 3축 + 빌드 EXIT 0, i18n 래칫·패리티

## 5. Fable 설계 게이트 반영 (2026-08-14, VERDICT: APPROVE WITH CHANGES)

치명 5건 + 권고 5건을 아래로 흡수한다. **위 §2 보다 이 절이 우선**한다.

### 치명-1 → A 는 신설하지 않는다. `GET /api/calendar/video/status` 를 확장한다
프론트는 이미 이 라우트를 소비 중이고(`QCalendarPage:160`), 워크스페이스/개인 4축 판정을 **서버에서** 내려준다.
새 라우트를 만들면 `/cloud/status` + `/video/status` + `/sync-status` **세 벌**이 된다.
→ `video/status` 에 `needs_reconnect · can_reconnect_workspace · poll_interval_seconds · last_error_at ·
last_checked_at · last_reverse_sync_at · orphan_supported` 추가. `needs_reconnect` 정규식은
`cloud.js:44` 인라인 사본을 **`gcal.needsReconnect(token)` 헬퍼로 추출**해 양쪽이 공유(복붙 금지).

### 치명-2 → sync-now 의 개인 소스 필터는 `conn.user_id === req.user.id` **만**
`pickPersonalConn` 은 같은 워크스페이스 연결이 없으면 **다른 워크스페이스 row 로 폴백**한다.
`business_id === bizId` 를 걸면 그런 사용자는 버튼을 눌러도 **소스 0 = 200 인데 아무 일도 안 일어난다**.

### 치명-3 → 겹침 가드를 `calendarReverseSync` 로 내린다 (소스별 뮤텍스)
`running` 은 cron 모듈 로컬이라 sync-now 가 **우회**한다. 같은 커서로 동시 폴링 시 감사로그 중복·
etag 경합·오래된 커서 저장이 난다. → `const inFlight = new Set()` (키 `${kind}:${id}`) 를
`calendarReverseSync` 에 두고 `pollSource` 진입/이탈에서 획득·해제, 실패 시 `{ busy:true }` skip.
cron 의 전역 `running` 은 유지. ★ **PM2 fork·instances 1 전제** — cluster 전환 시 무효라는 주석 필수.

### 치명-4 → 고아 정리는 **인스턴스 마커 + 선택식**. 일괄 삭제 금지
마커는 실제 코드와 일치 확인됨(`extendedProperties.private.planq='1'` ↔ `privateExtendedProperty`).
그러나 **인스턴스 구분이 없어** 같은 구글 계정을 dev·운영이 함께 쓰는 이 팀에선
**dev 에서 누르면 운영이 관리 중인 사본이 지워진다**(링크 "전역" 부재는 한 DB 안에서만 전역).
→ ① 이제부터 쓰기 시 `planq_env`(APP_URL host 유도) 마커 동봉 ② 같은 env 마커 고아만 일괄 대상
③ **마커 없는 legacy 고아는 제목·일시·링크를 보여주고 건별 체크 선택으로만 삭제**
④ cleanup 은 클라이언트 id 를 신뢰하지 않고 **서버 재스캔 ∩ 선택분**, 삭제 직전 링크 부재 재확인(TOCTOU).

### 치명-5 → **재연결 후 백필 push** 를 넣는다 (이게 없으면 신고가 안 끝난다)
scope 가 죽어 있던 기간에 만든 일정은 `resolveTargets` 가 목적지에서 제외해 **워크스페이스 링크가 없다**.
재연결해도 사용자가 그 일정들을 하나하나 다시 저장하기 전까지 구글에 나타나지 않는다 —
재연결 직후 첫 검증이 "구글 열어보기" 라 **정확히 거기서 재신고**된다.
→ 재연결 성공 시 `services/calendarWorkspaceBackfill.js`: 최근 30일~미래 일정 중
`wantsWorkspace && !isPrivateForGcal && 워크스페이스 링크 없음` 을 기존 **`reconcile` 로 재정렬**
(상한 100건, 건별 감사로그, reconcile 이 이미 멱등). 사용자 자산 임의 변경이 아니라 **연동 계약의 이행**이다.

### 권고 반영
- **권고-1 watch 제외 유지** — 근거를 교체: Drive watch 코드가 있음에도 운영 `watch_channel_id` 가
  **gdrive·gcal 둘 다 NULL** = push 수신 경로(도메인 검증 포함)가 **한 번도 산 적이 없다**.
  후속 청크 순서: ①Drive 채널을 운영에서 기동해 수신 실증 → ②Calendar watch.
- **권고-2 폴링 5분 → 1분 + 백오프 + focus 자동 당김** — 채택. 소스당 1콜/회차(증분)이라
  소스 100개에도 분당 100콜로 쿼터 여유. 연속 빈 회차 10회 후 5분으로 백오프,
  (반영 발생 | sync-now | 화면 focus) 시 1분 복귀. **QCalendarPage mount·visibilitychange 시
  sync-now 를 자동 silent 호출**(서버측 소스별 쿨다운 30초) → "캘린더를 열면 이미 최신".
  수동 버튼은 보조로 유지(재연결 직후 즉시 확인용).
- **권고-3** `last_reverse_sync_at`(audit)은 "마지막 **반영**"이라 건강한 워크스페이스는 며칠 전/null →
  "고장났나?" 를 재생산한다. **`last_checked_at`(마지막 확인, 메모리)** 을 주 표기로.
- **권고-4** 재연결 안내에 **"확인되지 않은 앱" 경고에서 고급 → 계속** 진행법 + **"캘린더" 체크 필수**
  둘 다 명시. ★ **근본 해소 = Google OAuth 검수 제출(Irene 액션)** — 코드로 그 경고를 없앨 수 없다.
  운영 로그에 `[gcal callback]` **0건** = 재연결이 콜백까지 도달한 적 없음(경고 화면 이탈 가설과 정합).
  워크스페이스 토큰 계정이 직원 개인 gmail 이므로 배너에 **연결 계정 이메일 노출** + 전용 계정 권고.
- **권고-5** `routes/calendar.js` 는 1,234줄이라 신규 라우트는 **`routes/calendar_sync.js` 신설**.
  `requireOwnerForCloud` export 재사용 · `perUserDaily` 일당 상한 200 · dismiss 키 **v4** ·
  배너 버튼은 **ActionButton 3톤**(재연결 Primary / 고아 정리 Danger / 즉시 동기화 Secondary) ·
  재연결·백필 완료 시 `business:{id}` **broadcast** 로 다른 멤버 화면 배너도 갱신(실시간 16번).

## 6. 롤백

DB 마이그레이션 **없음**. 라우트 3개 추가 + 프론트 1컴포넌트 개편이라 커밋 revert 로 원복.
