#!/usr/bin/env node
// guest_links — 워크스페이스 창구(scope='workspace') 를 위한 운영 ALTER **2건**. 멱등.
//
//   설계: docs/CLIENT_ENTRY_DESIGN.md §3-D1 · §5 P1
//
// ★ **코드 배포 전에** 돌린다. 컬럼·ENUM 값이 없는 상태로 새 코드가 올라가면
//   `scope='workspace'` 를 쓰는 순간 MySQL 이 잘라내거나 1265 로 죽는다.
//
// `sync-database.js` 에 맡기지 않는 이유는 2026-09-05 `migrate-guest-link-scope.js` 와 같다:
//   그 스크립트는 모델에 없는 컬럼을 DROP 한 전례가 있고(memory feedback_sync_drops_columns_not_in_model),
//   ENUM 변경이 alter 한 번에 64키 제한에 걸린 전례가 있다(feedback_sync_alter_too_many_keys).
//
// ── ① scope ENUM 끝에 'workspace' append ─────────────────────────────────────
//   **끝에 붙인다.** MySQL ENUM 은 내부적으로 순서 = 정수다. 중간에 끼우면 기존 행의 값이
//   조용히 다른 라벨로 바뀐다(memory 계열: Q sale 마이그레이션에서 같은 이유로 끝에 붙였다).
//   기본값은 'conversation' 그대로 — **이미 나가 있는 링크가 조용히 넓어지면 안 된다.**
//
// ── ② conversation_id 를 NULL 허용으로 ───────────────────────────────────────
//   ★ 이것은 **Fable 설계에 없는 항목이고 판단 주체는 Opus** 다. 설계 §5 는 스키마를
//     「ENUM append 1건」으로 적었는데, 그 설계가 말하는 «공유 workspace 링크» 는
//     가리킬 대화방이 없다 — 대화방은 OTP 확인 뒤 **개인 링크마다** 하나씩 생긴다(§4.2·§5).
//     그런데 이 컬럼이 NOT NULL 이라 공유 행을 만들 수가 없었다.
//   길이 둘이었고 이쪽을 택한 이유:
//     A) 워크스페이스마다 «창구» 앵커 대화방 1개를 만든다 → 스키마는 안 건드리지만
//        Q Talk·Q sale 상담 탭에 **메시지 0건인 빈 고객 대화방**이 영구히 남는다(사용자에게 보인다).
//     B) (택함) 컬럼을 넓힌다 → 되돌릴 수 있고, 데이터 변경 0, 기존 행 무영향.
//   **넓히는 변경이라 기존 행은 한 줄도 바뀌지 않는다**(실측: NULL 행 0건 → 0건).
//   FK(conversation_id → conversations.id)는 MODIFY 로 타입을 그대로 두면 유지된다.
//   NULL 이 허용되는 것은 **scope='workspace' 인 shared 행뿐**이고, 그 판정은 스키마가
//   아니라 `services/guest_link.js resolveGuestToken` 이 fail-closed 로 한다
//   (conversation_id 가 NULL 인데 scope 가 workspace 가 아니면 **닫는다**).
//
// 사용:  node scripts/migrate-guest-link-scope-workspace.js         (적용)
//        node scripts/migrate-guest-link-scope-workspace.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[guest-link-workspace]', ...a);

(async () => {
  try {
    const [[col]] = await sequelize.query(
      "SHOW COLUMNS FROM guest_links WHERE Field = 'scope'"
    );
    if (!col) {
      console.error('[guest-link-workspace] 실패: guest_links.scope 컬럼이 없다 — '
        + 'scripts/migrate-guest-link-scope.js 를 먼저 돌려라');
      process.exit(1);
    }

    const hasWorkspace = /'workspace'/.test(String(col.Type));
    // 기존 값 순서를 그대로 두고 끝에만 붙인다 — 지금 값을 읽어서 재조립하지 않는다
    // (재조립하면 순서를 내가 정하게 되고, 그 순간 기존 행의 정수 매핑을 건드릴 위험이 생긴다).
    const enumSql = "ALTER TABLE guest_links MODIFY COLUMN scope "
      + "ENUM('conversation','project','workspace') NOT NULL DEFAULT 'conversation'";

    const [[convCol]] = await sequelize.query(
      "SHOW COLUMNS FROM guest_links WHERE Field = 'conversation_id'"
    );
    const convNullable = convCol && String(convCol.Null).toUpperCase() === 'YES';
    const convSql = 'ALTER TABLE guest_links MODIFY COLUMN conversation_id INT NULL';

    if (hasWorkspace && convNullable) {
      log('둘 다 이미 적용됨 — 하는 일 없음');
      log('scope:', JSON.stringify(col.Type), '· conversation_id NULL:', convCol.Null);
      const [dist] = await sequelize.query(
        'SELECT scope, kind, COUNT(*) n FROM guest_links GROUP BY scope, kind'
      );
      log('현재 분포:', JSON.stringify(dist));
      process.exit(0);
    }

    if (DRY) {
      log('--dry — 실행할 것:');
      if (!hasWorkspace) log('  ①', enumSql);
      else log('  ① (건너뜀 — scope 에 workspace 이미 있음)');
      if (!convNullable) log('  ②', convSql);
      else log('  ② (건너뜀 — conversation_id 이미 NULL 허용)');
      process.exit(0);
    }

    // 적용 전 기준선 — 넓히는 변경이 기존 행을 건드리지 않았음을 뒤에서 대조한다.
    const [[before]] = await sequelize.query(
      "SELECT COUNT(*) total, SUM(scope='conversation') conv, SUM(scope='project') proj,"
      + ' SUM(conversation_id IS NULL) null_conv FROM guest_links'
    );
    log('적용 전:', JSON.stringify(before));

    if (!hasWorkspace) { await sequelize.query(enumSql); log('① scope ENUM append 완료'); }
    else log('① 건너뜀 (이미 있음)');
    if (!convNullable) { await sequelize.query(convSql); log('② conversation_id NULL 허용 완료'); }
    else log('② 건너뜀 (이미 허용)');

    const [after] = await sequelize.query(
      "SHOW COLUMNS FROM guest_links WHERE Field IN ('scope','conversation_id')"
    );
    const [[post]] = await sequelize.query(
      "SELECT COUNT(*) total, SUM(scope='conversation') conv, SUM(scope='project') proj,"
      + ' SUM(conversation_id IS NULL) null_conv FROM guest_links'
    );
    log('적용 후 컬럼:', JSON.stringify(after));
    log('적용 후:', JSON.stringify(post));

    // ★ 기존 행이 한 줄도 안 바뀌었는지 **스크립트가 직접 판정한다.** 사람이 눈으로 두 JSON 을
    //   비교하는 것에 맡기면 다르게 나온 날에 그냥 넘어간다.
    const same = ['total', 'conv', 'proj', 'null_conv'].every((k) => String(before[k]) === String(post[k]));
    if (!same) {
      console.error('[guest-link-workspace] ★ 기존 행이 바뀌었다 — 넓히는 변경이 아니었다는 뜻이다. 확인 필요');
      process.exit(1);
    }
    log('기존 행 무변경 확인 ✅');
    process.exit(0);
  } catch (e) {
    console.error('[guest-link-workspace] 실패:', e.message);
    process.exit(1);
  }
})();
