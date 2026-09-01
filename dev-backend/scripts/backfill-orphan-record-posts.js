#!/usr/bin/env node
// 운영 #360 — **연결 post 가 없는 표(q_record)는 화면에서 도달할 길이 없다.**
//
// Q record 메뉴는 폐지되고 표는 Q docs 의 post(kind='table')로 흡수됐다(App.tsx: /records → /docs).
// 그래서 표를 여는 유일한 통로가 post 다. 그런데 `POST /api/records` 는 post 없이 q_record 만
// 만들 수 있어, 그 경로로 만들어진 표는 **데이터는 살아 있는데 아무도 열 수 없다.**
//
// 운영 실측(2026-09-01): q_records 6건 중 1건(#12 "앱 스토어 개발자 계정", 행 15)이 그 상태였다.
// D-U-N-S·Team ID·사업자번호가 들어 있는데 화면에서 찾을 수 없었다.
//
// ★ 도달 가능하게 만드는 것이 **더 많이 보이게** 만드는 것이면 안 된다.
//   q_records 와 posts 는 같은 가시성 어휘(vlevel · target_member_ids)를 쓰므로 그대로 옮긴다.
//   L1 인 표는 L1 post 가 되어 작성자 본인만 본다. read_policy 는 records API 가 따로 강제하므로
//   post 를 만들어도 행 열람 권한은 변하지 않는다.
//
// 멱등 — 이미 post 가 있는 record 는 건너뛴다. 기본 dry-run, `--apply` 로 실행.
require('dotenv').config();
const { sequelize } = require('../config/database');
const { QRecord, Post } = require('../models');

const APPLY = process.argv.includes('--apply');

(async () => {
  const records = await QRecord.findAll({ order: [['id', 'ASC']] });
  const made = [], skipped = [];

  for (const r of records) {
    const existing = await Post.findOne({ where: { q_record_id: r.id } });
    if (existing) { skipped.push(`#${r.id} 이미 연결됨 (post ${existing.id})`); continue; }

    const payload = {
      business_id: r.business_id,
      project_id: r.project_id || null,
      title: String(r.name || '표').slice(0, 200),
      content_json: null,
      content_text: r.description ? String(r.description).slice(0, 500) : null,
      category: r.category || null,
      author_id: r.created_by,
      status: 'published',
      kind: 'table',
      q_record_id: r.id,
      // ★ 가시성은 원본 표에서 그대로 가져온다 — 넓히지 않는다.
      //   표에 vlevel 이 없으면(옛 데이터) 가장 좁은 L1 로 둔다. 넓게 여는 쪽으로 추측하지 않는다.
      vlevel: r.vlevel || 'L1',
      target_member_ids: r.target_member_ids || null,
    };
    if (!APPLY) { made.push(`#${r.id} "${payload.title}" → post 생성 예정 (vlevel ${payload.vlevel}, biz ${r.business_id})`); continue; }
    const p = await Post.create(payload);
    made.push(`#${r.id} "${payload.title}" → post ${p.id} (vlevel ${payload.vlevel})`);
  }

  console.log(`[backfill-orphan-record-posts] 표 ${records.length}건 검사`);
  if (skipped.length) console.log(`  건너뜀 ${skipped.length}:\n    ${skipped.join('\n    ')}`);
  console.log(`  ${APPLY ? '생성' : '생성 예정'} ${made.length}${made.length ? ':\n    ' + made.join('\n    ') : ' (없음)'}`);
  if (!APPLY && made.length) console.log('  → 실제 적용하려면 --apply');
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('[backfill-orphan-record-posts] 오류:', e.message); process.exit(1); });
