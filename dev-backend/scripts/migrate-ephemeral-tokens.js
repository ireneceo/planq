// migrate-ephemeral-tokens.js — `ephemeral_tokens` 테이블 생성 (멱등).
//
// 왜 (2026-09-10, Fable 게이트 지적): OAuth 흐름 세 곳이 메모리 `Map` 을 들고 있어
//   **PM2 재시작마다 사라졌다.** 진행 중이던 앱 로그인이 끊기고(10분 창), 일회용 code 의
//   재사용 차단 원장까지 사라져 replay 창이 다시 열렸다. 자세한 것은 models/EphemeralToken.js.
//
// 안전: CREATE TABLE IF NOT EXISTS — 여러 번 돌려도 무해하다. 데이터 이관은 없다
//   (옮길 데이터가 애초에 메모리에만 있었고, 수명이 2~10분이라 이관할 것이 없다).
const { sequelize } = require('../config/database');

(async () => {
  console.log('▶ ephemeral_tokens 마이그레이션');
  try {
    const [exists] = await sequelize.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'ephemeral_tokens'",
    );
    if (Number(exists[0].c) > 0) {
      console.log('  · ephemeral_tokens — 이미 있음(건너뜀)');
      // 컬럼만 뒤늦게 는 경우도 멱등하게 채운다(옛 배포본 위에 올라갈 때).
      const [col] = await sequelize.query(
        "SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name='ephemeral_tokens' AND column_name='attempts'",
      );
      if (Number(col[0].c) === 0) {
        await sequelize.query('ALTER TABLE ephemeral_tokens ADD COLUMN attempts INT NOT NULL DEFAULT 0');
        console.log('  ✅ attempts 컬럼 추가');
      }
    } else {
      await sequelize.query(`
        CREATE TABLE ephemeral_tokens (
          id INT NOT NULL AUTO_INCREMENT,
          kind ENUM('oauth_pair','oauth_used_code','oauth_confirm') NOT NULL,
          token_key VARCHAR(191) NOT NULL,
          payload JSON NULL,
          attempts INT NOT NULL DEFAULT 0,
          expires_at DATETIME NOT NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY ephemeral_kind_key_unique (kind, token_key),
          KEY ephemeral_expires_idx (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('  ✅ ephemeral_tokens 생성');
    }
    // 만료된 행은 있으면 정리하고 시작한다(재실행 시 무해).
    const [r] = await sequelize.query('DELETE FROM ephemeral_tokens WHERE expires_at < NOW()');
    console.log(`  · 만료 행 정리: ${r.affectedRows ?? 0}건`);
    const [cnt] = await sequelize.query('SELECT COUNT(*) AS c FROM ephemeral_tokens');
    console.log(`  · 현재 보관 중: ${cnt[0].c}건`);
    console.log('▶ 완료');
    process.exit(0);
  } catch (e) {
    console.error('  ❌ 실패:', e.message);
    process.exit(1);
  }
})();
