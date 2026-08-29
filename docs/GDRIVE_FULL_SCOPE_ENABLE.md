# Google Drive 전체 권한(Restricted `drive`) 활성화 절차

> **이 문서가 없으면 인제스트는 영영 켜지지 않는다.**
> 코드는 다 있고 게이트도 통과했지만, **요청하는 scope 를 바꾸는 것은 코드 변경**이다.
> 심사를 통과해도 사용자가 다시 연결하는 것만으로는 켜지지 않는다 —
> 그 사실을 모르면 "승인됐는데 왜 안 되지" 로 몇 주를 잃는다.
> (같은 계열 전례: `docs/GMAIL_OAUTH_RESTORE.md`, memory `feedback_env_flag_default_off_dies_silently`)

작성: 2026-08-29 · Fable 구현 검증 게이트 요구사항 (가)

---

## 지금 상태 (2026-08-29)

| 항목 | 상태 |
|------|------|
| 인제스트 코드 | ✅ 완성 (`services/gdriveIngest.js` · `gdriveTree.js` · 배선 · 화면) |
| 요청 scope | `drive.file` — `services/gdrive.js` 의 `SCOPES` |
| 활성 판정 | `googleScopes.hasDriveFull(token.scope)` → **현재 전 워크스페이스 false** |
| 화면 표시 | "Google 승인 후 켜집니다" (대기 상태) |
| 원장 | 모르는 파일마다 `skip / ingest_scope_missing` — **정상 대기의 증거** |

`buildAuthUrl` 이 `drive.file` 만 요청하므로 **full `drive` 는 승인받을 경로 자체가 없다.**
그래서 v2 조합(`storage_provider='planq'` + `origin_provider='gdrive'`) 행은 지금 0행이고,
아래 봉인 항목들이 미구현이어도 도달 불가다.

---

## 🔒 활성화 **전** 반드시 끝낼 것 (Fable 봉인)

이 넷을 끝내지 않고 scope 를 켜면 사고가 난다. 활성화 시점에 **Fable 게이트 재통과 필수.**

1. **인제스트분의 PlanQ측 삭제 = 인제스트 해제** (Fable B-4-①)
   `services/fileOrigin.js` 의 `detachFromDrivePatch()` 는 만들어져 있으나 **호출부가 없다.**
   워크스페이스에서 지웠다고 사용자의 Drive 원본을 지우면 안 된다.
   *지금 안전한 이유:* `filePurge` 가 `storage_provider` 로 분기하는데 v2 행은 `planq` 라
   Drive 삭제 분기에 닿지 않는다. 실패 모드는 "연결 잔존" 이지 "원본 증발" 이 아니다.

2. **최초 전체 스캔** (브리프 v2 요구 #3)
   `business_cloud_tokens.gdrive_ingest_cursor` 는 컬럼·모델만 있고 **사용처 0건.**
   이게 없으면 활성화 이후의 **변경분만** 들어오고 기존 Drive 파일은 영영 안 들어온다 —
   화면 문구 "직접 올린 파일도 가져옵니다" 가 절반만 참이 된다.

3. **`scope_exit` 배선** (Fable B-3 조건 ①)
   ENUM 값만 있고 사용처 0건. root 폴더 **밖으로 이동**한 파일은 소유자가 회수한 것이므로
   soft delete + `scope_exit` 기록. 활성 상태에서 이게 없으면 프라이버시 문제가 된다.
   복구 시에는 planq 정본으로 전환한다(재동기화 시도 없음).

4. **웹훅 페이지 루프 상한** (Fable 라)
   `routes/cloud.js` 웹훅의 `while (pageToken)` 에는 상한이 없다(크론 catchUp 은 guard 50).
   인제스트가 붙으면 한 번의 웹훅이 무상한 배치가 된다. 페이지 수 + 바이트 총량 이중 상한.

---

## 활성화 절차

### 1) Irene — Google Cloud Console (심사)
- Drive 전용 GCP 프로젝트 분리 (Gmail OAuth 복원과 같이 정리 가능 —
  `memory: project_gmail_oauth_disabled_restore`)
- OAuth 동의 화면에 **Restricted scope** `https://www.googleapis.com/auth/drive` 등록
- 보안 평가(CASA) 포함 심사 제출 — **4~8주**
- ⚠️ Console 에 없는 scope 를 코드가 요청하면 사용자는 "액세스 차단됨: 승인되지 않은 요청" 만 본다.
  **반드시 승인 후에 2)를 한다.**

### 2) 개발 — 요청 scope 갱신 (코드 변경)
```js
// services/gdrive.js
const SCOPES = ['https://www.googleapis.com/auth/drive'];   // drive.file → drive
```
- `REQUIRED_SCOPES.gdrive` 는 **이미 둘 다 수용**한다(OR 목록) — 건드리지 않는다.
  기존 `drive.file` 연결은 그대로 살아 있다.
- `hasDriveFull()` 은 손대지 않는다. 이 술어가 곧 활성 스위치다.

### 3) 사용자 — 재동의
- scope 는 **OAuth 콜백에서만** 기록된다(googleScopes 불변식 ①).
  심사 통과·코드 배포만으로는 **한 워크스페이스도 켜지지 않는다.**
- 설정 → 파일·외부 연동 → Drive **다시 연결**. 동의 화면에서 항목을 체크해야 한다.
  (체크 안 해도 code 는 발급된다 — `feedback_requested_scope_is_not_granted`)

### 4) 확인
```bash
# 활성으로 바뀌었는가 (파생 상태)
curl -s -H "Authorization: Bearer $TOKEN" https://planq.kr/api/cloud/status/$BIZ | jq '.data.gdrive.ingest'
# → {"active": true, "reason": "ok", "recent_30d": N}

# 원장에서 대기 → 인제스트로 바뀌는가
SELECT action, reason, COUNT(*) FROM gdrive_sync_logs
 WHERE business_id=? AND created_at >= NOW() - INTERVAL 1 DAY GROUP BY action, reason;
# ingest_scope_missing 이 줄고 ingest 가 생겨야 한다
```

## 롤백
`SCOPES` 를 `drive.file` 로 되돌린다. 이미 full 을 승인한 사용자의 저장된 scope 는 남아 있어
인제스트가 계속 활성이므로, **즉시 멈춰야 하면** `hasDriveFull()` 이 false 를 돌려주게 하거나
`buildApplyCtx` 의 `canIngest` 를 강제 false 로 둔다(그 경우 사유 로그가 남는지 확인할 것).
