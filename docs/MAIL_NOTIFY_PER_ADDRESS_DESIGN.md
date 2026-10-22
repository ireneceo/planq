# 메일 알림 — 메일 주소별 · 사람별 켜고 끄기 (설계, 2026-10-22, Fable)

> Irene: *«이메일 오는 거 알림을 이메일 주소 별로 세팅할 수 있어야 할 것 같아. 받고 안받고도. 무슨 탭만 받을지만 있지?
> 회사 건 받고 개인거 안받거나 개인거 받고 회사고 안받을 수도 있잖어.»*
>
> 정찰 계획 `.claude/plans/qmvjhaogk.md`(HEAD 1299b901) 를 코드로 다시 확인했다. 방향은 맞다 — 아래는 **확정값**이다.
> 구현 모델은 이 문서대로 하고, 여기 없는 것을 더하지 않는다.

## 0. 한 줄

**계정의 `notify_scope` 는 «기본값» 이 되고, 사람마다 계정별로 덮어쓴다(«받지 않음» 포함).** 행이 없으면 옛 동작 그대로 —
백필 없음, 기존 사용자 체감 변화 0.

## 1. 지금 (코드로 확인한 사실)

| 축 | 어디 | 단위 |
|---|---|---|
| 무엇을 알릴지 | `email_accounts.notify_scope` ENUM('all','recommended','reply_only') — `services/mailNotify.js:112` 가 **계정 범위로 조기 return** | 메일함 하나에 한 값(사람 무관) |
| 누가 받나 | `mailNotify.js:125-133` — 개인 계정(owner_user_id) = 주인 / 회사 계정 = `BusinessMember.findAll({business_id})` | defaultScope `removed_at: null` 이라 내보낸 멤버는 빠진다(확인) · 초대 중 행은 `user_id NULL` 이라 `filter(Boolean)` 에서 빠진다 |
| 어느 채널로 | `notification_prefs` event_kind=`mail` × inbox/chat/push/email — `routes/notifications.js isAllowed` | 사람별이지만 **메일 전체** 한 줄 |
| 중복 제거 | `seenRecently(uid, messageId)` — 수신자 루프 **안**, 검사와 동시에 표시를 찍는다 | 사람 × Message-ID, 10분 |
| 시간당 캡 | `bump(account.id)` — 계정 범위 판정 **뒤**, 수신자 계산 **앞** | 계정당 20/시 |
| 범위 저장 | `routes/email_accounts.js:270` PUT `/:businessId/email-accounts/:id` — `canManageAccount`: 회사 계정은 owner/admin 만 | — |
| 접근 술어 | `services/mailIdentity.accessibleAccountIds(biz, uid)` = 회사 계정 ∪ 내 개인 계정. `email_accounts.js accessibleWhere` 도 같은 조건 | — |

그래서 지금은 ① 멤버가 help@ 알림만 혼자 끌 수 없고(메일 전체를 꺼야 한다 → 개인 메일도 꺼짐) ② 회사 계정 범위를 바꾸면
전원에게 바뀌며 멤버는 못 바꾼다 ③ 어디에도 «끔» 이 없다(최소가 답변 필요).

## 2. 결정

### D1. 저장 모양 — 새 표 `email_account_notify_prefs` (행 없음 = 계정 기본값)

```sql
CREATE TABLE IF NOT EXISTS email_account_notify_prefs (
  id               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id      INT NOT NULL,
  email_account_id INT NOT NULL,
  user_id          INT NOT NULL,
  notify_scope     ENUM('off','reply_only','recommended','all') NOT NULL,
  created_at       DATETIME NOT NULL,
  updated_at       DATETIME NOT NULL,
  UNIQUE KEY uq_mail_notify_pref_account_user (email_account_id, user_id),
  INDEX  mail_notify_pref_user_biz (user_id, business_id),
  CONSTRAINT mail_notify_pref_biz_fk  FOREIGN KEY (business_id)      REFERENCES businesses(id)     ON DELETE CASCADE,
  CONSTRAINT mail_notify_pref_acct_fk FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  CONSTRAINT mail_notify_pref_user_fk FOREIGN KEY (user_id)          REFERENCES users(id)          ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- 모델 `models/EmailAccountNotifyPref.js` (`tableName: 'email_account_notify_prefs'`, `underscored`, 인덱스는 **options.indexes** 에 —
  컬럼 `unique:true` 금지, EmailAccountAlias 와 같은 이유). `models/index.js` 등록 + `EmailAccount.hasMany(EmailAccountNotifyPref, {as:'notifyPrefs', foreignKey:'email_account_id', onDelete:'CASCADE'})`.
- **«기본값 따름» 은 값이 아니라 행의 부재다.** ENUM 에 `'default'` 를 넣지 않는다 — 같은 뜻의 표현이 둘이 되면 판정이 두 갈래가 된다.
  API 의 `'default'` 는 «행 삭제» 로 번역한다(§D5).
- `business_id` 는 FK 로 파생 가능하지만 둔다 — 멀티테넌트 규칙(모든 WHERE 에 business_id)과 «멤버 탈퇴 시 그 워크스페이스 행만» 지우는 축.
- **대안(business_members JSON 칸) 기각** — 계정이 사라져도 찌꺼기가 남고, «계정 X 를 누가 덮어썼나» 를 셀 수 없다.

**생명주기**
| 사건 | 처리 |
|---|---|
| 계정 비활성(`is_active=false`, DELETE 라우트의 실제 동작) | 행 그대로(다시 켜면 설정 살아 있음). 알림은 비활성 계정에서 안 오므로(cron 이 `is_active:true` 만 돈다) 무해. 설정 목록(§D5)은 **활성 계정만** 보여 준다 |
| 계정 하드 삭제(`accountAnonymize` 의 `EmailAccount.destroy`) | FK CASCADE |
| 멤버 내보내기(`removed_at`, soft) | **지우지 않는다.** 수신자 집합이 defaultScope 로 이미 빠지고, 다시 들어오면 자기 설정이 돌아오는 것이 맞다. 개인 계정은 어차피 남이 못 본다 |
| 계정 탈퇴(`services/accountAnonymize.js` 5단계) | `EmailAccountNotifyPref.destroy({ where: { user_id: uid }, transaction: t })` 한 줄을 `NotificationPref.destroy` 옆에 — users 행이 남는 흐름이라 FK 에 기대지 않는다 |
| 워크스페이스 삭제 | FK CASCADE |

### D2. 판정 의미 — `effective = pref ?? account.notify_scope ?? 'recommended'`, 조기 return 은 «모든 수신자가 거절» 일 때만

`allowedByScope(kind, scope)` 첫 줄에 `if (scope === 'off') return false;` 를 **`kind === 'reply'` 규칙보다 앞에** 둔다 — 지금은 답변 필요가 어느 범위에서도
true 라서, 뒤에 두면 «끔» 이 답변 필요를 못 끈다.

`notifyInboundMail` 새 순서(바뀌는 줄만):

```
1  self-sent 차단                                   (그대로, 맨 앞)
2  kind = classify(...)                             (그대로)
3  userIds = 개인→주인 / 회사→활성 멤버              (그대로 — 수신자 집합은 바꾸지 않는다)
   없으면 return no_recipients
4  prefs = EmailAccountNotifyPref.findAll({ where: { email_account_id: account.id, user_id: userIds } })  ← 쿼리 1번, 맵으로
5  targets = userIds.filter(uid => allowedByScope(kind, prefs.get(uid) ?? account.notify_scope ?? 'recommended'))
   targets 비면 return { sent:0, reason:`scope_skip_${kind}`, scoped: userIds.length }   ← ★ bump 전
6  bump(account.id) — 캡 초과면 return hourly_cap     (계정 기준 그대로)
7  for uid of targets:
     seenRecently(uid, messageId) → deduped, continue   ← ★ 범위에서 떨어진 사람은 여기 오지 않는다
     notify(...)                                       (그대로)
```

- **왜 pref 판정이 `seenRecently` 보다 먼저인가**: 같은 메일이 help@(내가 끔)·irene@(켬) 두 계정으로 오면 cron 이 help@ 를 먼저 돌린다.
  지금 구조대로 루프 첫 줄에서 `seenRecently` 를 찍으면 irene@ 차례에 «중복» 으로 버려져 **켠 쪽 알림이 사라진다.** 표시는 «실제로 알릴 사람» 만 찍는다.
- **시간당 캡은 계정 기준 그대로.** 캡의 뜻은 «이 메일함에 쏟아지는 유입을 push 로 새지 않게» 이지 사람 단위가 아니다. 단 **bump 는 targets 가 1명 이상일 때만** —
  지금도 범위에서 떨어진 메일은 bump 전에 return 하므로 같은 뜻을 지킨다(안 그러면 아무도 안 받는 광고 메일이 캡을 소진해 진짜 알림을 막는다).
- 수신자 집합(개인=주인·회사=활성 멤버)은 건드리지 않는다. pref 는 **집합을 좁히기만** 한다 — 회사 계정 pref 로 비멤버가 받게 되는 길은 없다
  (pref 행이 있어도 `userIds` 안의 사람만 본다).
- 반환값에 `scoped`(범위로 뺀 수) 를 더한다 — 검증이 «sent 0 이 끔 때문인지 수신자 0 때문인지» 가른다.
- 채널 매트릭스(`mail` × 채널)는 그대로 `notify()` 안 `isAllowed` 가 본다. **두 축은 독립이다**: 매트릭스가 꺼져 있으면 주소별이 켜져 있어도 안 온다(화면 문구 §D5).

### D3. 단위 — **연결된 계정(메일함) 단위.** 별칭(EmailAccountAlias) 은 이번 범위 밖

- Irene 의 «이메일 주소» 는 설정 화면의 메일함 주소(help@·irene@)다. 별칭은 «보내는 주소» 모델이고(받는 축은 `receivedAddressesOf` 가 스레드 단위로 사후 해석),
  알림 시점에 To/Cc 를 별칭과 대조하는 로직을 새로 만들어야 한다 — 범위가 다른 일이다.
- 나중에 내리더라도 **이 표에 nullable `alias_id` 를 지금 넣지 않는다**(UNIQUE 축이 바뀌고 읽는 곳이 없는 칸이 남는다).

### D4. 받는 사람 축 — 수신자 집합 == `accessibleAccountIds` 의 전치(轉置). 설정 API 도 같은 술어

- 사람 u 가 계정 a 의 수신자 ⇔ `a ∈ accessibleAccountIds(a.business_id, u)` ∧ u 가 그 워크스페이스 **활성 멤버**. 두 사실(owner_user_id 가 NULL 이거나 나 / 멤버십)에서 나오며
  mailNotify 의 분기와 `mailIdentity.accessibleAccountIds`·`email_accounts.js accessibleWhere` 가 같은 조건이다(확인).
- 설정 GET/PUT 은 `accessibleWhere(req)` + `business_id` + `is_active: true` 로 계정을 찾는다 — **남의 개인 계정 id 는 404**(403 이 아니다 — 존재를 말하지 않는다. 기존 `findAccountForMutation` 과 같은 결).
- `checkBusinessAccess` 는 `memberOnly:true` 라 고객(client)은 못 들어온다(확인). platform_admin 은 비멤버라도 목록을 보고 저장할 수 있지만 수신자가 아니라 무해 — 기존 계정 목록과 같다.

### D5. API · 화면

**라우트 2개 — `routes/email_accounts.js`, 관리 권한 불필요(본인 것만). 둘 다 `/:id` 류 선언 **앞**에 둔다. `guard --category=duproute` 로 확인.**

```
GET /api/businesses/:businessId/email-accounts/my-notify
  → data: [{ account_id, email, display_name, is_shared(owner_user_id==null), account_scope, my_scope(null|'off'|…), effective_scope }]
     활성 계정 · accessibleWhere · order: 회사 먼저(owner_user_id ASC), 그 안에서 created_at ASC
PUT /api/businesses/:businessId/email-accounts/:id/my-notify   body { notify_scope: 'default'|'off'|'reply_only'|'recommended'|'all' }
  → 계정을 { id, business_id, is_active:true, ...accessibleWhere } 로 찾는다 — 없으면 404 not_found
  → 값 밖이면 400 invalid_notify_scope
  → 'default' = 행 destroy / 그 외 = upsert(findOrCreate → update) · 응답 { account_id, my_scope, effective_scope }
  → // audit-exempt: 본인 알림 수신 설정 — PUT /notifications/prefs 와 같은 수준(타인·워크스페이스 데이터 변경 아님)
```

- 두 라우트는 `req.user.id` 만 쓴다. `active_business_id` 를 읽지 않는다(가드 wsscope).
- 응답에 자격증명 없음(email·display_name 뿐) — `health-check --category=secrets` 가 보는 원문에 걸릴 값 없음. 비밀값 toJSON 전역 처리와 무관.
- 실시간 방송 없음 — 읽는 화면이 본인 설정 화면 하나뿐이고 형제(알림 매트릭스)도 같다.

**화면 — 설정 > 알림 (`/business/settings/notifications`, `pages/Settings/NotificationSettings.tsx`, ns `settings`)**

- 매트릭스 Section **바로 아래**에 새 Section «메일 주소별 알림» (새 파일 `pages/Settings/MailPerAccountNotifySection.tsx`, `businessId` prop). 마운트 때 GET.
- 계정 한 줄 = 주소 · 작은 뱃지(공용/개인) · 고르기 — **`AutoSaveField type="select"`** 로 감싼 PlanQSelect(팝오버 안이 아니므로 가능):
  `기본값 따름 (현재: <계정 기본값 라벨>)` / `받지 않음` / `답변 필요만` / `답변 필요 + 확인 권장` / `전체`. 고르면 PUT, ✓ 배지. 실패는 던진다(`!` 배지).
  `key={account_id}` 로 인스턴스를 가른다(autosavekey).
- 선택지 라벨은 **`qmail:notifyScope.*` 를 그대로 읽는다**(`useTranslation(['settings','qmail'])`) — 같은 글자를 두 ns 에 두지 않는다.
  새 키(ko/en 같이): `settings` ns `notifications.mailPerAccount.{title, desc, default, off, offDesc, shared, personal, channelsOffHint, empty}`.
  - `desc`: «메일함마다 어떤 메일을 알릴지 각자 정합니다. 비우면 메일함의 기본값을 따릅니다.»
  - `channelsOffHint`(매트릭스 `mail` 행 4채널이 전부 꺼져 있을 때만 한 줄): «위에서 «메일» 알림을 모두 꺼 두어 주소별 설정과 무관하게 알림이 오지 않습니다.»
  - `empty`: 활성 계정 0 → «연결된 메일함이 없습니다» + 메일 계정 설정 링크.
- 계정 카드(`EmailAccountSettings` 안 `MailNotifyScopeSection`)는 **코드 무변경, 문구만** — `qmail:notifyScope.title` «기본 알림 범위», `desc` «이 메일함의 기본값입니다.
  각자 설정 > 알림에서 주소별로 다르게 받거나 끌 수 있습니다.» (ko/en). 선택지는 그대로 3개.
- 데스크탑·태블릿·폰 3폭에서 한 줄이 넘치면 폰은 주소 위/고르기 아래 두 줄(`mediaPhone`).

**계정 범위에 «끔» 을 추가하지 않는다(이번).** 사람별 «받지 않음» 이 요청을 채운다. 관리자가 회사 메일함을 «전원 기본 꺼짐» 으로 두는 것은 워크스페이스 정책 결정이라
Irene 이 말한 적이 없고, 운영 `email_accounts.notify_scope` ENUM ALTER 가 따라온다. 필요해지면 ENUM 끝 append 1 + 선택지 1 + `allowedByScope` 는 이미 'off' 를 안다.

### D6. 운영 반영

- 스크립트 `dev-backend/scripts/migrate-mail-notify-per-user.js` — 멱등(`SHOW TABLES LIKE`), `--dry`, 끝에 검증(표·UNIQUE·FK 3 존재, 실패 exit 1). `migrate-post-comments.js` 를 본으로.
- 배포 슬롯 `scripts/deploy-planq.sh` — 다른 표 생성 슬롯(schedule_batches·ephemeral_tokens) 옆, **PM2 reload 앞**:
  ```
  # 2026-10-22 — 메일 알림 주소별·사람별 (docs/MAIL_NOTIFY_PER_ADDRESS_DESIGN.md D1). 백필 없음.
  #   ★ 코드보다 먼저 — mailNotify 가 이 표를 SELECT 한다. 표가 없으면 cron 의 catch 가 삼켜 **메일 알림 전체가 조용히 0** 이 된다(#203 과 같은 모양).
  log "  Creating email_account_notify_prefs (메일 알림 주소별)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-notify-per-user.js 2>&1 | tail -6"
  ```
- 롤백: **코드만** 되돌린다. 표는 남겨도 무해(옛 코드는 읽지 않는다). 모델 선언을 되돌려도 `sync-database` 는 알지 못하는 표를 DROP 하지 않는다.
- 운영 데이터 변경 없음(ENUM ALTER 없음, 백필 없음).

### D7. 되돌리기 어려운 것 / 게이트

- 되돌리기 어려운 부분은 **D2 의 판정 순서**(pref → bump → seenRecently)와 **D4 의 404 술어** 뿐이다. 표는 additive. → 구현 뒤 `/fable-검증` 1회(gate): 아래 §3 사례 숫자를 넘긴다.

## 3. 구현 모델의 자체 검증 사례 (실HTTP 포트 3003 + `notifyInboundMail` 직접 호출 — 알림 행 수로 판정)

시험 스크립트 `dev-backend/test-mail-notify-per-user.js`(끝나면 삭제). 픽스처: ws 6 에 회사 계정 1(`[확인용] help`·owner_user_id NULL·is_active 1)과
member1 개인 계정 1 — 기존 425 는 비활성이라 쓰지 말고 새로 만든 뒤 원복. `thread` 는 그 계정의 스레드 행(또는 최소 필드를 가진 객체). 판정은 `notifications` 표에서
`entity_type='email_thread' AND entity_id=thread.id AND user_id=?` 행 수, 호출 전후 차이로. 시험 전후 `recentNotified`·`counters` 영향을 피하려 Message-ID 는 매 사례 새 값.

| # | 사례 | 기대 |
|---|---|---|
| 1 | 행 없음(기본값) — 회사 계정 scope recommended, kind review | owner 1 · member1 1 · member2 1 (옛 동작 그대로) · 반환 `scoped:0` |
| 2 | owner 가 회사 계정 `off` PUT → 같은 호출 | owner 0 · member1 1 · member2 1 · `scoped:1` |
| 3 | 2 상태에서 kind **reply** | owner 0 (끔이 답변 필요도 끈다) · 나머지 1 |
| 4 | owner `default` PUT → 행 삭제 확인(SELECT 0) → 같은 호출 | 셋 다 1 |
| 5 | 계정 scope `reply_only` + member1 `all` → kind other(automated) | member1 1 · owner 0 · member2 0 (올리는 방향도 된다) |
| 6 | 계정 scope `reply_only`, kind review, 아무도 덮어쓰지 않음 | 셋 다 0 · reason `scope_skip_review` · **bump 안 됨**(counters 에 그 계정 count 증가 0) |
| 7 | **중복 순서 회귀** — 같은 Message-ID 를 회사 계정(owner off) → owner 개인 계정 순서로 호출 | 첫 호출 owner 0, 둘째 호출 owner 1(`deduped:0`). 양성 대조군: 둘 다 켠 상태로 같은 순서 → 둘째 `deduped:1` |
| 8 | 캡 — targets 가 있는 호출 21회 | 21번째 `hourly_cap`; 그 뒤 모두 off 인 호출은 `scope_skip_*` 이고 캡 상태 불변 |
| 9 | HTTP: member1 로 GET my-notify | 회사 계정 + 자기 개인 계정만. **owner 로 GET 하면 member1 개인 계정이 없다** |
| 10 | HTTP: owner 가 member1 개인 계정 id 로 PUT | 404 · 행 0 |
| 11 | HTTP: 값 `'maybe'` / 비활성 계정 id / 다른 워크스페이스 계정 id | 400 / 404 / 404 |
| 12 | HTTP: client 역할로 GET | 403(checkBusinessAccess memberOnly) |
| 13 | 매트릭스 `mail`×inbox 를 끈 사람 + 주소별 `all` | 알림 행 0 (두 축 독립 — 음성 대조군) · 되돌림 |
| 14 | 가드·빌드 | `node scripts/guard-invariants.js`(전체 — duproute·wsscope·autosave·autosavekey·i18n·parity) · `node scripts/health-check.js` · `npm run build` EXIT 0 |
| 15 | 화면 3폭(390/768/1440) `/business/settings/notifications` [as=member ws=6] | 회사 계정을 혼자 «받지 않음» 으로 → ✓ 배지 · 새로고침 후 유지 · 계정 카드의 관리자 기본값은 그대로 |

사례 1·4·7(양성) 이 먼저 통과하고 2·3·6·7·10·13 이 뒤집혀야 판정을 믿는다. 검증 뒤 픽스처 계정·행·알림을 원복한다.

## 4. 구현 범위 (파일)

- BE: `models/EmailAccountNotifyPref.js`(신규) · `models/index.js` · `services/mailNotify.js` · `routes/email_accounts.js`(라우트 2) · `services/accountAnonymize.js`(1줄) ·
  `scripts/migrate-mail-notify-per-user.js`(신규) · `scripts/deploy-planq.sh`(슬롯)
- FE: `pages/Settings/MailPerAccountNotifySection.tsx`(신규) · `pages/Settings/NotificationSettings.tsx`(마운트 1줄) · `locales/{ko,en}/settings.json` · `locales/{ko,en}/qmail.json`(문구 2줄)
- 문서: CLAUDE.md «Q mail 폴더·배지 계약» 아래에 ⑧ 한 단락(정본 = 이 문서) — 구현 후.
