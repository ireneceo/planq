// 데스크탑 앱 받기 주소 — platform_settings.app_windows_url · app_mac_url (2026-11-07, 멱등).
//   설계 docs/DESKTOP_APP_DESIGN.md §3-9·§4-2. iOS·안드로이드 주소(app_ios_url·app_android_url)와 같은 자리·같은 규칙(https 만 내보냄).
//   ★ PM2 reload 전: 모델이 이 칸을 SELECT 하므로 칸이 없으면 플랫폼 설정·/app 다운로드가 ER_BAD_FIELD 로 죽는다.
//   롤백은 코드만(칸은 남겨도 무해).
const { sequelize } = require('../config/database');

async function hasColumn(col) {
  const [r] = await sequelize.query(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    { replacements: ['platform_settings', col] },
  );
  return Number(r[0].c) > 0;
}

async function run() {
  for (const col of ['app_windows_url', 'app_mac_url']) {
    if (await hasColumn(col)) { console.log(`[desktop-urls] ${col} 이미 있음 — skip`); continue; }
    await sequelize.query(`ALTER TABLE platform_settings ADD COLUMN ${col} VARCHAR(500) NULL AFTER app_android_url`);
    console.log(`[desktop-urls] ${col} 추가`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[desktop-urls] 실패:', e); process.exit(1); });
