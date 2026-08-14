# 청크 4-A — 캘린더 링크 무결성 + 역방향 관찰성 (Fable 설계 게이트 **APPROVE WITH CHANGES** 반영본)

> 2026-08-13. Fable 배포 검증(PASS)이 남긴 리스크 (a)고아 링크 · (c)관찰성 구멍을 닫는다.
> Irene 지시: "고아 링크랑 관찰성도 같이 고쳐". 아래 **§5 가 구현의 정본**이다.

---

## 5. Fable 판정 반영 — 구현 정본

판정: **APPROVE WITH CHANGES**. 문제 인식과 처방 방향(FK + 사유 있는 제외)은 승인. 실측 주장도 전부 사실 확인.
단 구현 시 사고가 나는 구멍 4곳이 있어 아래를 반영한 뒤 착수한다.

### 5-1. Fable 이 확인해 준 사실

- 삭제 경로는 **정확히 3개** — 라우트 / anonymize / DB CASCADE. 제4의 경로 없음
  (`auth_oauth.js:444` 는 `OauthConnection` 별개 테이블, `external_connections.js:458` 은 `EmailAccount`).
- 단, **User hard-delete 앱 경로는 없고**(anonymize 는 마스킹) Business hard-delete 도 grep 0건 →
  구멍 2(CASCADE)는 **현재 이론적**. 그래도 FK 로 닫는 것이 맞다.
- FK 전제 충족: 운영·dev 모두 `external_connections.id` = `int`, `connection_id` = `int`, 둘 다 InnoDB.
  `uniq_event_target_conn` 과 충돌 없음(CASCADE 는 행 삭제일 뿐). FK 인덱스는 기존 `idx_conn` 재사용.
- 운영 8행 — ALTER 락 시간 **무시 가능**.
- 구글 쪽 고아 사본은 **어차피 불가피** — DELETE 라우트도 anonymize 도 토큰을 먼저 revoke/purge 하므로
  연결 사망 시점엔 구글 이벤트를 지울 권한이 이미 없다. CASCADE 가 상황을 악화시키지 않는다.
- 대안 기각 확인: `SET NULL` 은 링크를 목적지 없는 유령으로 만들고, 앱 레벨 전수는 이번 사고 유형 그대로 재발.

### 5-2. 치명 — C2. 마이그레이션은 **pre-sync 슬롯**에 등록 (idempotent 슬롯 아님)

`sync-database.js:29` 가 **`SET FOREIGN_KEY_CHECKS = 0`** 으로 alter 를 돈다.
C1 대로 모델에 `references` 를 넣으면 sync 가 FK 를 붙일 수 있는데,
**FK 검사가 꺼진 상태의 `ADD FOREIGN KEY` 는 기존 행을 검증하지 않는다**
→ 운영 link#1 고아가 **잔존한 채 FK 가 공존하는 최악 상태**.

따라서 고아 정리는 **반드시 sync-database 보다 먼저** 실행돼야 한다.
`deploy-planq.sh` 에 이미 pre-sync 슬롯 전례가 있다(`migrate-calendar-sync-split.js`, :236) — 그 자리에 넣는다.

### 5-3. C1. 모델에도 `references` 선언 — 절단면에 `models/CalendarEventGcalLink.js` 추가

모델 자신의 주석(16-21줄)이 근거다: 마이그레이션에만 FK 를 두면
**sync-database 가 테이블을 새로 만드는 fresh-create 경로에서 FK 가 영구 누락**된다.
`event_id` 와 같은 패턴으로:

```js
connection_id: {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: 'external_connections', key: 'id' },
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
}
```

### 5-4. C3. 멱등 판정은 제약 **이름이 아니라 컬럼 쌍**으로

sequelize alter 는 FK 를 drop/재생성하며 **개명**한다(dev `external_connections` 의 FK 가 `ibfk_115/116`
까지 증가한 실증). 이름 `fk_gcal_link_conn` 으로 판정하면 개명 후 **중복 FK 를 또 붙인다**.

```sql
SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendar_event_gcal_links'
   AND COLUMN_NAME = 'connection_id' AND REFERENCED_TABLE_NAME = 'external_connections';
```

FK 정의에 `ON UPDATE CASCADE` 도 포함해 sequelize 생성형과 일치시켜 churn 을 없앤다
(운영 `event_id` FK 가 그 형태다).

### 5-5. C4. 사유 어휘 수정 — 초안 5종이 코드와 안 맞았다

실제 제외 분기 대조(`calendarReverseSync.js:109-140`):

| 코드 분기 | 어휘 | 비고 |
|---|---|---|
| `!hasCalendarWrite(conn)` / `!hasWriteScope(token.scope)` | `no_calendar_scope` | ✓ |
| `conn.last_sync_error` / `token.last_error` | **`sync_error`** | 초안 `auth_error` 는 **거짓 라벨** — `calendarSync.js:119·369` 가 auth 외 push 오류도 같은 컬럼에 기록 |
| 링크 0건 | `no_links` | ✓ |
| where 절 `is_active: true` (개인만) | `inactive` | 산출하려면 **쿼리에서 is_active 필터를 빼고 분류 단계로 옮겨야** 한다. 워크스페이스엔 이 축이 없다(비대칭 명시) |
| ~~`sync_disabled`~~ | **삭제** | **해당 분기가 코드에 없다.** `sync_enabled` 는 push 전용 축(`calendarSync.js:14`, 라우트 주석 168-169)이고 reverse 는 보지 않는다. **분기 없는 어휘 = 가짜 커버리지** — 이 설계가 잡으려는 바로 그 침묵을 스스로 만들 뻔했다 |

**최종 어휘 4종: `no_links` · `no_calendar_scope` · `sync_error` · `inactive`(개인만).**

### 5-6. C5. 분류를 **구조로 강제**

소스 선정을 "포함/제외를 한 함수가 분류"(if/else 사슬의 끝이 포함)로 재구성해
**사유 없는 제외가 구조상 불가능**하게 만들고, 그 함수를 **export** 해 health-check 가 같은 로직을 재사용한다.
health-check 에 별도 grep 성 근사 구현을 두면 두 벌로 갈라진다.

### 5-7. C6. 반증 순서 — 양성 대조군은 FK **적용 전에**

dev 에 FK 를 붙인 **뒤에는** "FK 없이 링크 잔존" 재현이 불가능하다.
→ 마이그레이션 적용 **전에** 양성 대조군을 수행하거나, `DROP FOREIGN KEY` → 재현 → 재적용 순서를 계획에 박는다.
anonymize 반증은 dev 에 **테스트 전용 유저 생성 → `anonymizeUser()` 직접 호출 → 원복** 방식으로 명시한다.

### 5-8. C7. 배포 검증 항목

- 운영 고아 0건 SQL + `SHOW CREATE TABLE` 로 FK 실존 + `event#29` 상태 1줄 보고
- 롤백 문서: `DROP FOREIGN KEY` 는 **실제 제약 이름을 조회한 뒤** (C3 과 같은 이유로 이름이 바뀔 수 있다)
- 구글 캘린더에 **옛 고아 사본이 남아 사용자가 수동 삭제**해야 함을 배포 보고에 1줄 남긴다

### 5-9. Q1·Q2·Q3 확정 답

- **Q1 = (ㄱ).** health-check 의 DB 항목은 전부 `isLocal` 게이트 안(dev 전용)이고 배포 스크립트는 운영에서
  health-check 를 돌리지 않는다(grep 0건). **운영 감시의 정본은 매 회차 로그 자체** — 운영 프로세스가 찍으므로
  dev/운영 구분이 없다. health-check 에는 ①고아 0건 ②사유 없는 제외 0건(C5 함수 재사용) 두 항목만 둔다.
  상시 운영 점검 스크립트 분리는 8행 테이블 + FK 구조 보장 이후엔 과잉.
- **Q2 = 매 회차.** 변화 시에만 남기면 ①PM2 재시작(배포마다) 후 기준선 리셋 ②로그 로테이션이 유일한 전이 라인을
  지울 수 있음 ③**"로그 없음 = 프로세스 죽음" 이라는 판정 불변식이 사라짐**. 288줄/일은 무시 가능.
- **Q3 = (ㄴ).** conn#12 의 토큰은 이미 소멸 — 누구도 구글 쪽 사본을 지우거나 입양할 수 없다.
  (ㄷ) 링크 이관은 링크 행이 살아 있어야 성립하는데 **FK CASCADE 채택과 정면 모순**이고 절단면을 넓힌다 —
  별건으로도 **비권고**(GDrive 폴더 재사용과 달리 사용자 데이터 행 이관이라 오배정 위험).
  `event#29` 는 테스트 일정(`test1234848484`)이라 실사용 영향 0.

### 5-10. 규모·순서

**중규모 + 고위험 3번(운영 DB 마이그레이션) — 3단 게이트 필수.**
청크 4 와 **같은 배포에 실어도 된다**(ALTER 8행 즉시, deploy 인프라 재사용, 역방향 코드와 응집도 높음).
조건: ① **이 작업 단독 커밋** ② 배포 전 `git show --stat` 으로 스택 전수 확인 ③ C7 검증 포함.

구현 순서:
1. 모델 references(C1) + 마이그레이션(C2·C3) — **dev 적용 전에** 양성 대조군 반증(C6)
2. `deploy-planq.sh` pre-sync 슬롯 등록
3. `calendarReverseSync` 소스 선정 재구성(C4·C5) + 매 회차 1줄 로그
4. health-check 2항목 + 반증(고아 심기 FAIL / 사유 없는 제외 FAIL / 원복 PASS)
5. 가드 3축 + 실HTTP → Fable 구현 게이트 → 배포 게이트(C7)

---

> 아래는 초안 원문(§1~§4). §5 와 충돌하면 **§5 가 이긴다.**

---

## 1. 문제 ① — 고아 링크가 구조적으로 가능하다

### 1-1. 실측

```
운영 calendar_event_gcal_links (총 8행) 중 고아 1건
  link#1  target=personal  connection_id=12  event_id=29   ← conn#12 는 존재하지 않는다
→ event#29 는 역방향 동기화가 영구 정지 (updateAtLink 가 graceful return)
```

`SHOW CREATE TABLE calendar_event_gcal_links` — FK 는 **`event_id` 에만** 있다:

```sql
CONSTRAINT calendar_event_gcal_links_ibfk_1
  FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
-- connection_id 에는 제약이 없다 (idx_conn 인덱스만)
```

### 1-2. 쓰기측 전 경로 점검 (백필보다 먼저 — memory `feedback_backfill_needs_write_side_fix`)

| 경로 | 링크 정리 | 판정 |
|---|---|---|
| `routes/external_connections.js:194` DELETE /me/external-connections/:id | ✅ `CalendarEventGcalLink.destroy({connection_id, target:'personal'})` | 정상 |
| `services/accountAnonymize.js:64` `ExternalConnection.destroy({user_id})` | ❌ **없음** | **구멍 1** |
| `models/index.js:861-862` Business/User `onDelete: CASCADE` | ❌ 앱 코드를 안 탄다 | **구멍 2** |

즉 **고아를 지우기만 하면 같은 결손이 다시 쌓인다.** 쓰기측을 먼저 닫아야 한다.

### 1-3. 채택안 — DB 가 강제하게 한다 (정석)

`connection_id` 에 FK `ON DELETE CASCADE` 를 건다. 어느 경로로 연결이 사라지든 링크가 함께 사라진다.
앱 레벨 `destroy`(DELETE 라우트)는 **유지**한다 — 명시적이고, FK 와 중복돼도 무해하며, 의도를 코드에 남긴다.

이 의미론은 이미 라우트가 하고 있는 것과 **같다**(연결이 없으면 그 목적지도 없다 — 기존 주석).
`target='workspace'` 링크는 `connection_id` 가 NULL 이라 FK 영향 밖이다(NULL 은 FK 검사 통과).

**대안(비채택)**: 앱 레벨에서만 모든 삭제 경로에 정리 코드를 추가 — 새 경로가 생길 때마다 다시 빠진다.
이번 사고가 정확히 그 유형이다(라우트는 고쳤는데 anonymize 는 빠졌다).

### 1-4. 마이그레이션 순서 (멱등)

```
① 고아 정리:  DELETE l FROM calendar_event_gcal_links l
               LEFT JOIN external_connections c ON c.id = l.connection_id
               WHERE l.connection_id IS NOT NULL AND c.id IS NULL;
② 제약 추가:  ALTER TABLE calendar_event_gcal_links
               ADD CONSTRAINT fk_gcal_link_conn FOREIGN KEY (connection_id)
               REFERENCES external_connections(id) ON DELETE CASCADE;
③ 멱등:       information_schema 로 제약 존재 확인 후 skip
```

`scripts/migrate-*.js` 의 기존 멱등 패턴을 따른다. **①을 먼저 하지 않으면 ②가 실패한다**(기존 고아가 제약 위반).
운영 적용은 배포 스크립트의 마이그레이션 단계에 얹는다(현재 마이그레이션 9종과 같은 자리).

⚠️ **주의**: `sync-database.js` 의 alter 는 64키 한도 사고 전례가 있다(memory `feedback_sync_alter_too_many_keys`).
이 제약은 **전용 마이그레이션 스크립트**로 추가하고 sync-database 에 맡기지 않는다.

### 1-5. 반증 계획 (구현 후)

1. dev 에서 연결 1개 생성 → 링크 1행 생성 → **연결 삭제** → 링크가 사라지는가 (FK 동작 실증)
2. **양성 대조군**: FK 추가 전 같은 시나리오에서 링크가 남는가 (탐지기 유효성)
3. `target='workspace'` 링크(connection_id NULL)가 영향 없는가
4. anonymize 경로에서도 링크가 사라지는가 (구멍 1이 실제로 닫혔는가 — 트랜잭션 안 FK 동작 확인)
5. 운영 적용 후 고아 0건 재확인 + `event#29` 상태 보고

---

## 2. 문제 ② — 관찰성: 소스가 조용히 탈락한다

### 2-1. 실측된 구멍 (Fable 판정 인용)

> "소스 ≥1 인데 idle" 상태는 무로그라, 정상 idle 과 특정 소스의 조용한 탈락을 로그만으로 구분할 수 없다 —
> 소스가 2개 이상이 되는 순간 한 소스의 죽음이 다시 침묵에 가려진다.

이번 사고의 본질이 **침묵**이었다. `audit_logs` 0건으로야 죽어 있음을 알았다. 같은 침묵이 남아 있다.

### 2-2. 채택안 — "제외에는 반드시 사유가 있다"

단순히 로그를 늘리는 게 아니라, **소스 선정이 제외 사유를 산출하도록** 만든다.

```js
// runAll 이 계산하는 것 (현재는 포함된 소스만 안다)
{ sources: [...], excluded: [ { kind:'workspace', id:3, reason:'no_calendar_scope' },
                              { kind:'personal',  id:1, reason:'no_links' } ] }
```

사유 집합(고정 어휘): `no_links` · `no_calendar_scope` · `auth_error` · `sync_disabled` · `inactive`

1. **매 회차 1줄 로그** — 조건 없이 항상 남긴다(288줄/일, 무시할 수 있는 양):
   `[reverseSync] 소스 1 · 반영 0 · 제외 2(no_calendar_scope:1, no_links:1)`
   "조용한 정상"과 "조용한 죽음"이 로그에서 구분된다.
2. **health-check 신규 2항목**:
   - `역방향 폴링 — 제외된 링크 보유 연결에 사유가 있는가` :
     링크를 가진 연결 중 소스에서 빠진 것이 **알려진 사유 없이** 빠졌으면 FAIL.
     (사유가 있으면 PASS + 사유를 출력에 표시 — dev/운영 데이터 차이로 인한 거짓 FAIL 방지)
   - `고아 캘린더 링크 0건` : FK 이후엔 구조적으로 0이지만 회귀 탐지용.
3. **반증 필수** — 두 항목 모두 일부러 깨뜨려 FAIL 이 나는지 확인한다
   (memory `feedback_guard_must_be_falsified` — 안 잡는 가드는 없는 것보다 나쁘다).

### 2-3. Fable 에게 묻는 설계 질문

**Q1.** health-check 는 dev DB 를 본다. 운영에만 있는 상태(워크스페이스 scope 결손)는 dev 에서 재현되지 않아
가드가 **운영 회귀를 못 잡는다**. 이 항목을 (ㄱ) health-check 에 두되 "사유 없는 제외 0" 로만 판정 /
(ㄴ) `scripts/ops-capacity-check.js` 계열 운영 점검으로 분리 / (ㄷ) 둘 다 — 어느 쪽이 맞는가?

**Q2.** 매 회차 로그를 항상 남기는 것이 옳은가, 아니면 **상태 변화 시에만**(제외 집합이 직전 회차와 다를 때)
남기는 것이 옳은가? 항상 남기면 로그가 커지고, 변화 시에만 남기면 프로세스 재시작 후 첫 회차가 기준선이 된다.

**Q3.** `event#29`(고아 링크 소유)를 고아 정리 후 어떻게 할 것인가 — 링크만 지우면 그 일정은 구글 쪽에
**주인 없는 사본**으로 남는다. (ㄱ) 그대로 둔다 (ㄴ) 사용자가 다시 "구글로 보내기" 하면 새 링크가 생기니 충분하다
(ㄷ) 재연결 시 같은 user+provider 의 옛 링크를 새 연결로 이관한다(GDrive 폴더 재사용 패턴).
★ (ㄷ)는 매력적이지만 **이번 절단면을 넓힌다** — 별건 권고인지 판단 요망.

---

## 3. 절단면 (예정)

```
dev-backend/services/calendarReverseSync.js       (소스 선정이 제외 사유 산출 + 매 회차 로그)
dev-backend/scripts/migrate-gcal-link-fk.js       (신규 — 고아 정리 + FK 추가, 멱등)
scripts/deploy-planq.sh                            (마이그레이션 단계에 위 스크립트 등록)
scripts/health-check.js                            (신규 2항목)
dev-backend/services/accountAnonymize.js           (FK 로 자동 처리되므로 변경 없을 수 있음 — Fable 판단)
```

DB 스키마 변경이 포함되므로 **규모 = 중~대**. CLAUDE.md 고위험 3번(운영 DB 마이그레이션 포함 배포)에
해당하여 설계·구현·배포 3단 모두 Fable 게이트 필수.

---

## 4. 검증 계획 (구현 후 Fable 게이트)

1. FK 반증 4종 (§1-5)
2. 관찰성 가드 반증 — 고아 1건 심어 FAIL, 사유 없는 제외 만들어 FAIL, 원복 후 PASS
3. 가드 3축 (health-check · guard-invariants · build) EXIT 별도 파일 박제
4. 실HTTP — 연결 삭제 라우트 정상 동작(401/403 포함), 역방향 회귀 없음
5. 마이그레이션 멱등 — apply → 재실행 → **변경 0 실측** (memory `feedback_mysql_json_key_reorder` 의 교훈)
6. 롤백 경로 — FK 는 `DROP FOREIGN KEY` 로 되돌릴 수 있음을 문서화
7. 검증 데이터 전량 원복 + 잔여 0 증명
