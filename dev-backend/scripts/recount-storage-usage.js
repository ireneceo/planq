#!/usr/bin/env node
/**
 * business_storage_usage 재계산 — **쓰기측을 고친 뒤에** 한 번 돌린다 (2026-09-17).
 *
 * 왜 필요한가
 *   업로드에서 SHA-256 dedup 이 걸리면 바이트를 **0** 더하는데, 삭제는 행마다 `file_size` 를
 *   **무조건** 뺐다. 그래서 지울 때마다 카운터가 실제보다 작아졌다(운영 biz1 실측:
 *   실제 950개·250MB vs 카운터 585개·209MB — 365개·41MB 누락).
 *   과소 계수는 곧 **한도를 넘겨도 안 막힌다**는 뜻이다 — 쿼터 판정의 입력값이기 때문이다.
 *
 * ★ #372 가 같은 증상으로 닫혔는데 그때는 **재계산만** 했다. 원인(쓰기측)이 그대로라
 *   재계산 뒤 다시 벌어졌다. 그래서 이 스크립트는 **routes/files.js trashFile 의 lastRef 수정과
 *   한 벌**이다. 그 수정 없이 이것만 돌리면 같은 일이 반복된다.
 *
 * 세는 규칙 (쓰기측과 **같은 술어**여야 한다)
 *   · `storage_provider='planq'` 이고 `deleted_at IS NULL` 인 행만
 *   · 같은 `file_path` 를 공유하는 행(dedup)은 **한 번만** — 물리 파일이 하나이기 때문이다
 *   · 휴지통(soft delete)은 제외 — 삭제 시 한도에서 즉시 빠지는 것이 현 정책이다
 *   · ★ **업무·채팅 첨부도 센다** (2026-09-17, Fable 재검증 FAIL).
 *     그 둘은 `reservePlanqUpload` 로 카운터를 올리는데 `files` 테이블에는 행이 없다.
 *     `files` 만 세면 그 바이트가 통째로 빠진다 — 운영 biz1 실측 **4,115,498B(8건) 누락**.
 *     `file_id` 가 있는 첨부는 `files` 행을 가리키므로 **거기서 이미 세어졌다**(중복 금지).
 *     dev 는 18B 라 안 보인다 — 규칙이 틀려도 초록이 나오는 자리였다.
 *
 * 사용: node scripts/recount-storage-usage.js [--apply] [--business=<id>]
 *   기본은 **미적용(dry-run)** — 차이만 보여 준다.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { BusinessStorageUsage } = require('../models');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyBiz = (args.find((a) => a.startsWith('--business=')) || '').split('=')[1];

(async () => {
  const seq = BusinessStorageUsage.sequelize;
  const wF = onlyBiz ? `AND f.business_id = ${Number(onlyBiz)}` : '';
  const wT = onlyBiz ? `AND ta.business_id = ${Number(onlyBiz)}` : '';
  const wM = onlyBiz ? `AND c.business_id = ${Number(onlyBiz)}` : '';
  // ★ 세 원천을 **하나의 (business_id, file_path) 집합**으로 합친 뒤 접는다.
  //   물리 파일 하나당 한 번 — 원천이 달라도(파일함/업무첨부/채팅첨부) 같은 경로면 바이트는 하나다.
  const [rows] = await seq.query(`
    SELECT business_id, SUM(sz) AS bytes_real, COUNT(*) AS files_real FROM (
      SELECT business_id, file_path, MAX(sz) AS sz FROM (
        SELECT f.business_id, f.file_path, f.file_size AS sz
          FROM files f
         WHERE f.storage_provider = 'planq' AND f.deleted_at IS NULL AND f.file_path IS NOT NULL ${wF}
        UNION ALL
        -- 업무 첨부 — reservePlanqUpload 로 카운터를 올리지만 files 행이 없다.
        --   ★ **planq 저장분만** (2026-09-17, Fable 3차). 쓰기측(routes/task_attachments.js:178)은
        --     planq 분기에서만 예약한다. 필터가 없으면 Drive 저장 첨부가 planq 쿼터로 들어간다 —
        --     운영 실측 **gdrive 8건 4,069,389B 가 유령으로** 더해지고 있었다.
        SELECT ta.business_id, ta.file_path, ta.file_size AS sz
          FROM task_attachments ta
         WHERE ta.file_path IS NOT NULL
           AND (ta.storage_provider IS NULL OR ta.storage_provider = 'planq') ${wT}
        UNION ALL
        -- 채팅 첨부 — business_id 가 없어 대화방을 거친다. file_id 가 있으면 files 에서 이미 셌다.
        SELECT c.business_id, ma.file_path, ma.file_size AS sz
          FROM message_attachments ma
          JOIN messages m ON m.id = ma.message_id
          JOIN conversations c ON c.id = m.conversation_id
         WHERE ma.file_path IS NOT NULL AND ma.file_id IS NULL
           AND (ma.storage_provider IS NULL OR ma.storage_provider = 'planq') ${wM}
      ) u GROUP BY business_id, file_path
    ) d GROUP BY business_id
  `);

  let drift = 0;
  for (const r of rows) {
    const usage = await BusinessStorageUsage.findOne({ where: { business_id: r.business_id } });
    const cur = usage ? Number(usage.bytes_used) : 0;
    const curN = usage ? Number(usage.file_count) : 0;
    const real = Number(r.bytes_real) || 0;
    const realN = Number(r.files_real) || 0;
    if (cur === real && curN === realN) continue;
    drift += 1;
    const mb = (n) => (n / 1048576).toFixed(1) + 'MB';
    console.log(`biz ${r.business_id}: ${curN}개 ${mb(cur)}  →  ${realN}개 ${mb(real)}  (차이 ${realN - curN}개 ${mb(real - cur)})`);
    if (APPLY) {
      if (usage) await usage.update({ bytes_used: real, file_count: realN });
      else await BusinessStorageUsage.create({ business_id: r.business_id, bytes_used: real, file_count: realN, storage_provider: 'planq' });
      // 30초 사용량 캐시를 비워 화면이 즉시 맞는 값을 보게 한다.
      try { require('../services/plan').invalidateBusinessCache(r.business_id); } catch { /* 선택적 */ }
    }
  }
  console.log(drift === 0 ? '어긋난 워크스페이스 없음 ✅' : `${drift}개 워크스페이스 어긋남 — ${APPLY ? '적용했다' : '적용하려면 --apply'}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
