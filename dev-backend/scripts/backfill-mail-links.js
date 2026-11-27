// 이미 쌓인 메일 스레드에 고객·프로젝트 연결을 소급한다. **멱등.**
//
// ★ 왜 (2026-09-10): 자동 연결이 없던 동안 쌓인 것이 전부 미연결이다.
//   실측 dev 4,879건 중 project_id 0건 · client_id 1건 — 프로젝트 메일 화면과 고객 타임라인이
//   구조적으로 늘 비어 있었다. 쓰기측(mailLink.linkThread)을 먼저 고친 뒤 소급하는 순서다
//   (memory: 백필 전 쓰기측 전 경로 확인).
//
// ★ 이미 값이 있는 행은 **건드리지 않는다** — 사람이 손으로 건 것을 덮으면 그 결정이 사라진다.
// ★ 기본은 미리보기다. 실제로 쓰려면 --apply.
//
//   node scripts/backfill-mail-links.js            # 몇 건이 붙을지만 센다
//   node scripts/backfill-mail-links.js --apply    # 실제 반영
//   --business=<id>  한 워크스페이스만
//
// ★ 2026-11-27 (Fable 설계 P1·P2 · docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md)
//   · 미리보기가 linkThread 를 불러 **메일 이슈의 프로젝트를 실제로 옮겼다**(쓰기 없는 판정 resolveLink 로 바꿈).
//   · 스팸 스레드를 거르지 않아 스팸이 고객 이력에 붙을 수 있었다 → status <> 'spam'.
//   운영 --apply 는 배포 슬롯에 넣지 않는다 — 미리보기 숫자를 Irene 에게 보이고 지시를 받아 수동.
require('dotenv').config({ quiet: true });
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { EmailThread } = require('../models');
const { linkThread, resolveLink, threadAddresses } = require('../services/mailLink');

const APPLY = process.argv.includes('--apply');
const BUSINESS = Number((process.argv.find((a) => a.startsWith('--business=')) || '').split('=')[1]) || 0;
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;

(async () => {
  console.log(`▶ 메일 연결 백필 ${APPLY ? '(적용)' : '(미리보기 — --apply 로 반영)'}`);
  const where = { [Op.or]: [{ client_id: null }, { project_id: null }], status: { [Op.ne]: 'spam' }, ...(BUSINESS ? { business_id: BUSINESS } : {}) };
  const total = await EmailThread.count({ where });
  console.log(`  · 연결이 비어 있는 스레드: ${total}건`);

  let scanned = 0, changed = 0;
  const via = { project_invite: 0, client_address: 0, sole_project: 0 };
  const BATCH = 200;
  // ★ **keyset 으로 걷는다(offset 금지).** 조건이 `client_id IS NULL OR project_id IS NULL` 인데
  //   `--apply` 는 그 조건을 만족시켜 행을 결과집합에서 **빼낸다**. offset 으로 걸으면 빠진 만큼
  //   다음 배치가 건너뛰어 1회 실행이 전수를 못 훑는다 — 실측(2026-09-10 Fable): 1회차 뒤
  //   2회차에 추가 변경이 119건 더 나왔다. 마지막으로 본 id 부터 이어 가면 그 구멍이 없다.
  let lastId = 0;
  for (;;) {
    const rows = await EmailThread.findAll({
      where: { ...where, id: { [Op.gt]: lastId } },
      order: [['id', 'ASC']], limit: BATCH,
      attributes: ['id', 'business_id', 'client_id', 'project_id'],
    });
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    for (const th of rows) {
      scanned++;
      // 이 스레드에 등장한 주소 — from 이 가장 강한 신호라 앞에 둔다(services/mailLink.threadAddresses 한 벌).
      const addrs = await threadAddresses(th.business_id, th.id);
      if (!addrs.length) continue;
      if (APPLY) {
        const r = await linkThread(th, { addresses: addrs });
        if (r.changed) { changed++; if (r.via) via[r.via] = (via[r.via] || 0) + 1; }
      } else {
        // 미리보기 — **쓰지 않고 판정만**(resolveLink 는 쓰기가 없다 — P1)
        const r = await resolveLink(Number(th.business_id), { client_id: th.client_id || null, project_id: th.project_id || null }, addrs);
        if (Object.keys(r.patch).length) { changed++; if (r.via) via[r.via] = (via[r.via] || 0) + 1; }
      }
      if (LIMIT && scanned >= LIMIT) break;
    }
    if (LIMIT && scanned >= LIMIT) break;
  }

  console.log(`  · 훑음 ${scanned}건 → 연결 ${changed}건`);
  console.log(`  · 경로별: 프로젝트 초대주소 ${via.project_invite || 0} · 고객 등록주소 ${via.client_address || 0} · 단독 프로젝트 ${via.sole_project || 0}`);
  const [[after]] = await sequelize.query(
    'SELECT SUM(client_id IS NOT NULL) c, SUM(project_id IS NOT NULL) p FROM email_threads');
  console.log(`  · 현재 연결 상태: client ${after.c || 0}건 · project ${after.p || 0}건`);
  console.log('▶ 완료');
  process.exit(0);
})().catch((e) => { console.error('  ❌ 실패:', e.message); process.exit(1); });
