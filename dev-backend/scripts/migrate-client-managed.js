// 직접 관리 고객(비가입 고객) — clients.status ENUM 끝 'managed' append + 옛 행 백필. docs/CLIENT_MANAGED_DESIGN.md
//
//   ① ENUM append — 멱등, 매 배포 실행 안전. 모델이 'managed' 를 쓰므로 PM2 reload 전(배포 슬롯 등록).
//   ② 백필 — «status='active' 인데 계정 없음» 행. 옛 [보관 해제] 스위치·PUT status 가 계정 없는 행을 active 로 만들었다.
//      active 는 «계정이 연결된 고객» 이므로 초대 흔적이 있으면 invited, 없으면 managed 로 바로잡는다.
//      **기본은 읽기만(건수·id 출력). `--apply` 일 때만 쓴다.**
//
//   롤백: 코드 revert + `UPDATE clients SET status='prospect' WHERE status='managed';`
//     (한도 밖·«문의 고객» 라벨이 가장 덜 거짓). ENUM 원복 ALTER 는 선택(새 값 잔존은 무해).
//
//   사용: node scripts/migrate-client-managed.js [--dry] [--apply]
require('dotenv').config();
const { sequelize } = require('../config/database');
const { appendEnum } = require('./lib/enumAppend');

const DRY = process.argv.includes('--dry');
const APPLY = process.argv.includes('--apply');
const TAG = 'migrate-client-managed';

async function main() {
  const changed = await appendEnum(sequelize, { table: 'clients', column: 'status', value: 'managed' }, { dry: DRY, tag: TAG });

  const [rows] = await sequelize.query(
    "SELECT id, business_id, invited_at, invite_token IS NOT NULL AS has_token FROM clients WHERE status = 'active' AND user_id IS NULL ORDER BY id",
  );
  const toInvited = rows.filter((r) => r.invited_at || r.has_token).map((r) => r.id);
  const toManaged = rows.filter((r) => !(r.invited_at || r.has_token)).map((r) => r.id);
  console.log(`[${TAG}] 백필 대상 active+계정없음 ${rows.length}건 → invited ${toInvited.length} [${toInvited.join(',')}] · managed ${toManaged.length} [${toManaged.join(',')}]`);
  if (APPLY && !DRY && rows.length) {
    if (toInvited.length) await sequelize.query("UPDATE clients SET status='invited' WHERE status='active' AND user_id IS NULL AND id IN (:ids)", { replacements: { ids: toInvited } });
    if (toManaged.length) await sequelize.query("UPDATE clients SET status='managed' WHERE status='active' AND user_id IS NULL AND id IN (:ids)", { replacements: { ids: toManaged } });
    const [[left]] = await sequelize.query("SELECT COUNT(*) c FROM clients WHERE status='active' AND user_id IS NULL");
    console.log(`[${TAG}] 백필 적용 — 남은 active+계정없음 ${left.c}건`);
  } else if (rows.length) {
    console.log(`[${TAG}] 백필은 읽기만 했다 — 적용하려면 --apply`);
  }
  const [dist] = await sequelize.query('SELECT status, COUNT(*) c FROM clients GROUP BY status ORDER BY c DESC');
  console.log(`[${TAG}] clients.status 분포:`, dist.map((r) => `${r.status}=${r.c}`).join(' '));
  console.log(changed ? `[${TAG}] ENUM ${DRY ? '변경 예정' : '변경'}` : `[${TAG}] ENUM 변경 0 (멱등 확인)`);
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
