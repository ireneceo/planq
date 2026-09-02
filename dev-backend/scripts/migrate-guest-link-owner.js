// #259 2차 마이그레이션 — 게스트 링크에서 **고객 의존을 뗀다**. 멱등 (매 배포 실행 안전).
//
//   Irene: "왜 고객정보를 넣어야 해? 고객이 그냥 가볍게 들어와서 확인 및 소통할 수 있나 해서 한건데"
//
//   링크는 사람이 아니라 **방**에 붙는다. 한 링크를 카톡방에서 여럿이 나눠 갖는 것이
//   이 기능의 전제(설계 §2)라 Client(=명함)를 필수 부모로 둔 것 자체가 모델 오류였다.
//
//   ① guest_links.client_id      NOT NULL → NULL   (고객은 선택. 방에 붙어 있으면 자동 복사)
//   ② guest_links.guest_name     NOT NULL → NULL   (멤버 메모용. 화면 표시명이 아니다)
//   ③ guest_links.guest_user_id  신규 INT FK users (그림자 User 를 **링크당 1개**로)
//   ④ clients.guest_user_id      DROP              (옛 "고객당 1개" 잔재)
//
//   표시명은 `messages.meta.guest.name` 에 박제한다 — ALTER 불요(meta JSON 실존).
//   신원(누가 썼나)=링크, 라벨(뭐라고 보이나)=메시지. 둘을 한 곳에 두면 나중 사람이 이름을
//   정하는 순간 **과거 메시지의 이름까지 소급해서 바뀐다.**
//
// ★ 배포 순서: 이 스크립트(DB) → 백엔드 reload. 역전하면 새 코드가 없는 컬럼에 써서 실패한다.
//
// 롤백: 코드만 revert. 컬럼은 남긴다. client_id 가 NULL 인 링크는 옛 코드에서
//   fail-closed(null)로 **죽을 뿐 열리지 않는다** — 안전한 방향으로 깨진다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasColumn(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${name}'`);
  return rows.length > 0;
}
async function columnInfo(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${name}'`);
  return rows[0] || null;
}
async function hasTable(name) {
  const [rows] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
  return rows.length > 0;
}

(async () => {
  try {
    await sequelize.authenticate();
    if (!(await hasTable('guest_links'))) {
      console.log('[migration] guest_links 테이블 없음 — 1차 마이그레이션 먼저. 중단.');
      process.exit(0);
    }

    // ── ① client_id NULL 허용 ────────────────────────────────────────────
    const ci = await columnInfo('guest_links', 'client_id');
    if (ci && ci.Null === 'NO') {
      await sequelize.query('ALTER TABLE `guest_links` MODIFY `client_id` INT NULL');
      console.log('[migration] guest_links.client_id → NULL 허용');
    } else {
      console.log('[migration] guest_links.client_id 이미 NULL 허용 — skip');
    }

    // ── ② guest_name NULL 허용 ───────────────────────────────────────────
    const gn = await columnInfo('guest_links', 'guest_name');
    if (gn && gn.Null === 'NO') {
      await sequelize.query('ALTER TABLE `guest_links` MODIFY `guest_name` VARCHAR(100) NULL');
      console.log('[migration] guest_links.guest_name → NULL 허용');
    } else {
      console.log('[migration] guest_links.guest_name 이미 NULL 허용 — skip');
    }

    // ── ③ guest_user_id 추가 + 백필 ──────────────────────────────────────
    if (!(await hasColumn('guest_links', 'guest_user_id'))) {
      // NULL 허용으로 먼저 붙이고 백필한 뒤 NOT NULL 로 조인다.
      //   바로 NOT NULL 로 붙이면 기존 행이 0 으로 채워져 **존재하지 않는 User** 를 가리킨다.
      await sequelize.query('ALTER TABLE `guest_links` ADD COLUMN `guest_user_id` INT NULL AFTER `client_id`');
      console.log('[migration] guest_links.guest_user_id 추가 (NULL 허용)');
    } else {
      console.log('[migration] guest_links.guest_user_id 이미 있음 — skip');
    }

    // 백필: 옛 "고객당 1개" 그림자를 링크로 옮긴다. clients.guest_user_id 가 아직 있을 때만.
    if (await hasColumn('clients', 'guest_user_id')) {
      const [r] = await sequelize.query(
        'UPDATE `guest_links` gl JOIN `clients` c ON c.id = gl.client_id ' +
        'SET gl.guest_user_id = c.guest_user_id ' +
        'WHERE gl.guest_user_id IS NULL AND c.guest_user_id IS NOT NULL');
      console.log('[migration] 그림자 User 백필:', r?.affectedRows ?? 0, '건');
    }

    // 백필로도 못 채운 행 — 가리킬 그림자가 없다. 열려 있으면 안 되므로 **회수**한다.
    //   지우지 않는다: 감사 이력과 use_count 가 사라진다.
    const [orphan] = await sequelize.query(
      'SELECT COUNT(*) AS n FROM `guest_links` WHERE guest_user_id IS NULL');
    if (Number(orphan[0].n) > 0) {
      await sequelize.query(
        'UPDATE `guest_links` SET revoked_at = NOW() WHERE guest_user_id IS NULL AND revoked_at IS NULL');
      console.log('[migration] 그림자 없는 링크', orphan[0].n, '건 → 회수 처리(열리지 않게)');
    }

    // NOT NULL 로 조이기 — 남은 NULL 이 없을 때만. 있으면 조이지 않고 사실을 알린다.
    const [stillNull] = await sequelize.query(
      'SELECT COUNT(*) AS n FROM `guest_links` WHERE guest_user_id IS NULL');
    const gui = await columnInfo('guest_links', 'guest_user_id');
    if (Number(stillNull[0].n) === 0 && gui && gui.Null === 'YES') {
      await sequelize.query('ALTER TABLE `guest_links` MODIFY `guest_user_id` INT NOT NULL');
      console.log('[migration] guest_links.guest_user_id → NOT NULL');
    } else if (Number(stillNull[0].n) > 0) {
      console.log('[migration] ⚠ guest_user_id NULL 행', stillNull[0].n, '건 남음 — NOT NULL 보류(회수된 옛 행)');
    } else {
      console.log('[migration] guest_links.guest_user_id 이미 NOT NULL — skip');
    }

    // ── ④ clients.guest_user_id 제거 ─────────────────────────────────────
    //   모델에서 뺐으므로 남겨 두면 sync({alter:true}) 가 어차피 DROP 한다.
    //   여기서 명시적으로 지워 **언제 왜 지웠는지**를 로그에 남긴다.
    if (await hasColumn('clients', 'guest_user_id')) {
      const [used] = await sequelize.query(
        'SELECT COUNT(*) AS n FROM `clients` WHERE guest_user_id IS NOT NULL');
      if (Number(used[0].n) > 0) {
        // 값이 남아 있어도, 그 그림자를 **이미 링크가 가리키고 있으면** 옮겨진 것이다.
        //   그 경우만 비운다. 옮겨지지 않은 값이 하나라도 있으면 지우지 않고 사실을 알린다.
        const [cleared] = await sequelize.query(
          'UPDATE `clients` c SET c.guest_user_id = NULL ' +
          'WHERE c.guest_user_id IS NOT NULL ' +
          'AND EXISTS (SELECT 1 FROM `guest_links` gl WHERE gl.guest_user_id = c.guest_user_id)');
        console.log('[migration] 링크로 옮겨진 그림자', cleared?.affectedRows ?? 0, '건 → clients 쪽 비움');
      }
      const [used2] = await sequelize.query(
        'SELECT COUNT(*) AS n FROM `clients` WHERE guest_user_id IS NOT NULL');
      if (Number(used2[0].n) > 0) {
        console.log('[migration] ⚠ clients.guest_user_id 에 옮겨지지 않은 값이', used2[0].n, '건 — DROP 보류. 수동 확인 필요');
      } else {
        // FK 가 걸려 있으면 먼저 떼야 DROP 이 된다.
        const [fks] = await sequelize.query(
          "SELECT CONSTRAINT_NAME AS n FROM information_schema.KEY_COLUMN_USAGE " +
          "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' " +
          "AND COLUMN_NAME = 'guest_user_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
        for (const fk of fks) {
          await sequelize.query(`ALTER TABLE \`clients\` DROP FOREIGN KEY \`${fk.n}\``);
          console.log('[migration] clients FK 제거:', fk.n);
        }
        await sequelize.query('ALTER TABLE `clients` DROP COLUMN `guest_user_id`');
        console.log('[migration] clients.guest_user_id 제거 완료');
      }
    } else {
      console.log('[migration] clients.guest_user_id 이미 없음 — skip');
    }

    // ── ⑤ 계정 요청 2컬럼 (2026-09-02 후속) ──────────────────────────────
    for (const [name, ddl] of [
      ['account_requested_at', '`account_requested_at` DATETIME NULL COMMENT \'#259 게스트가 계정 요청한 시각\''],
      ['requested_email', '`requested_email` VARCHAR(200) NULL COMMENT \'#259 게스트가 적어 보낸 이메일(힌트)\''],
    ]) {
      if (await hasColumn('guest_links', name)) { console.log(`[migration] guest_links.${name} 이미 있음 — skip`); continue; }
      await sequelize.query(`ALTER TABLE \`guest_links\` ADD COLUMN ${ddl}`);
      console.log(`[migration] guest_links.${name} 추가 완료`);
    }

    // ── 최종 확인 ────────────────────────────────────────────────────────
    const fin = {
      client_id: (await columnInfo('guest_links', 'client_id'))?.Null,
      guest_name: (await columnInfo('guest_links', 'guest_name'))?.Null,
      guest_user_id: (await columnInfo('guest_links', 'guest_user_id'))?.Null,
      clients_guest_user_id: (await hasColumn('clients', 'guest_user_id')) ? '남아있음' : '없음',
    };
    console.log('[migration] 최종:', JSON.stringify(fin));
    console.log('[migration] 완료');
    process.exit(0);
  } catch (e) {
    console.error('[migration] 실패:', e.message);
    process.exit(1);
  }
})();
