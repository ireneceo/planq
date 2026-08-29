// Drive 역방향 v2 — 정본 축 분리 스키마. 멱등. 배포 파이프에서 반복 실행돼도 안전하다.
//
// 왜 (Fable 설계 게이트 결정 B-1, 2026-08-29)
//   `storage_provider` 가 두 가지를 겸직하고 있었다:
//     ① "정본이 어디냐" — services/gdriveApply.js 가 이 의미로 읽는다 (Drive 변경을 반영할지 판단)
//     ② "서빙 바이트가 어디냐" — routes/files.js 가 이 의미로 읽는다 (다운로드·미리보기 경로)
//   v2 인제스트(Drive 원본을 내려받아 PlanQ 에 두는 파일)는 **정본=Drive · 바이트=PlanQ** 라
//   한 컬럼으로는 표현할 수 없다. 어느 값을 넣어도 삭제·내용수정·서빙 중 하나가 깨진다.
//
//   → `storage_provider` 는 **서빙 축으로 순수화**하고, 정본 축은 `origin_provider` 로 분리한다.
//     판정은 **단일 헬퍼 하나**만 읽는다 (services/fileOrigin.js). 이중 공식 금지.
//
// ② `drive_md5` — Drive 가 주는 체크섬 보관 자리.
//   `content_hash` 는 CHAR(64) sha256 전용인데 gdriveApply 가 md5(32자)를 넣고 있었다
//   (운영 실측 2026-08-29: 32자 3건 / 64자 82건). 길이가 달라 거짓 dedup 은 불가하나
//   그 행의 해시는 무의미하고, v2 dedup 이 그것을 신뢰하면 오염이 실제 피해가 된다.
//   ★ 기록만 끊으면 안 된다 — 비교 대상이 사라져 에코 흡수가 깨진다. 자리를 만들고 옮긴다.
//   불변식: **content_hash 는 sha256 전용.**
//
// ③ `gdrive_ingest_cursor` — v2 전체 스캔 재개 지점 (배치 중단 후 이어받기).
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}

async function addColumn(table, col, ddl) {
  if (await hasColumn(table, col)) { console.log(`✓ ${table}.${col} 이미 존재 — skip`); return 0; }
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  console.log(`+ ${table}.${col} 추가`);
  return 1;
}

(async () => {
  let changed = 0;
  changed += await addColumn('files', 'origin_provider', "ENUM('gdrive') NULL");
  changed += await addColumn('files', 'drive_md5', 'VARCHAR(32) NULL');
  changed += await addColumn('business_cloud_tokens', 'gdrive_ingest_cursor', 'VARCHAR(255) NULL');

  // 백필 ① — 지금까지 "정본이 Drive" 를 뜻하던 행을 새 축으로 옮긴다.
  //   현행 의미(gdriveApply.js:71 `storage_provider === 'gdrive'`)를 그대로 보존하는 것이지
  //   새로 판단하는 것이 아니다. 멱등 — 이미 채워진 행은 건드리지 않는다.
  const [o] = await sequelize.query(
    "UPDATE files SET origin_provider='gdrive' WHERE storage_provider='gdrive' AND origin_provider IS NULL");
  const originFilled = o?.affectedRows ?? o?.changedRows ?? 0;
  console.log(`· origin_provider 백필: ${originFilled}행`);

  // 백필 ② — content_hash 에 잘못 들어간 md5(32자)를 제 자리로 옮기고 sha256 칸을 비운다.
  //   길이로 판별한다 — sha256 은 항상 64자라 오인 여지가 없다.
  const [m] = await sequelize.query(
    "UPDATE files SET drive_md5 = content_hash, content_hash = NULL " +
    "WHERE content_hash IS NOT NULL AND CHAR_LENGTH(content_hash) = 32");
  const md5Moved = m?.affectedRows ?? m?.changedRows ?? 0;
  console.log(`· md5 오염 정리: ${md5Moved}행 (content_hash → drive_md5)`);

  // ④ 원장 ENUM 확장 — v2 의 'ingest' / 'scope_exit'.
  //   없으면 MySQL 이 'Data truncated' 로 거부하고 우리 log() 는 catch 로 삼켜서
  //   **성공 기록만 조용히 사라진다**(dev 검사에서 실제로 드러났다). 멱등.
  const [ac] = await sequelize.query("SHOW COLUMNS FROM gdrive_sync_logs LIKE 'action'");
  const actionType = ac[0]?.Type || '';
  if (actionType.includes("'ingest'") && actionType.includes("'scope_exit'")) {
    console.log('✓ gdrive_sync_logs.action ENUM 이미 확장됨 — skip');
  } else {
    await sequelize.query(
      "ALTER TABLE gdrive_sync_logs MODIFY COLUMN action " +
      "ENUM('rename','move','content','trash','untrash','unmirror','create','skip','ingest','scope_exit') NOT NULL");
    console.log('+ gdrive_sync_logs.action ENUM 확장 (ingest, scope_exit)');
    changed++;
  }

  // 검산 — 남아 있으면 안 되는 것
  const [chk] = await sequelize.query(
    "SELECT " +
    "(SELECT COUNT(*) FROM files WHERE content_hash IS NOT NULL AND CHAR_LENGTH(content_hash)<>64) AS bad_hash, " +
    "(SELECT COUNT(*) FROM files WHERE storage_provider='gdrive' AND origin_provider IS NULL) AS unfilled");
  const [ac2] = await sequelize.query("SHOW COLUMNS FROM gdrive_sync_logs LIKE 'action'");
  const enumOk = String(ac2[0]?.Type || '').includes("'ingest'");
  console.log(`· 검산: 비-sha256 해시 ${chk[0].bad_hash}행 · 미백필 ${chk[0].unfilled}행 (둘 다 0 이어야 함) · action ENUM ingest 포함 ${enumOk}`);
  if (!enumOk) { console.error('FATAL 검산 실패 — action ENUM 에 ingest 가 없다'); process.exit(1); }
  if (Number(chk[0].bad_hash) || Number(chk[0].unfilled)) {
    console.error('FATAL 검산 실패 — 위 두 값이 0 이 아니다');
    process.exit(1);
  }

  console.log(`[migrate-gdrive-origin] 완료 — 컬럼 변경 ${changed}건 / 백필 ${originFilled + md5Moved}행 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
