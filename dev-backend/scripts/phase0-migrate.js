// Phase 0 데이터 마이그레이션:
// 1. businesses.name → brand_name (기존 데이터 이전)
// 2. default_language 기본값 'ko' 확정
// 3. 모든 워크스페이스에 Cue 시스템 계정 자동 생성 + business_members 등록

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { User, Business, BusinessMember } = require('../models');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('MySQL connected.');

    // ─── 1. businesses.name → brand_name ───
    const [updated] = await sequelize.query(`
      UPDATE businesses
      SET brand_name = name
      WHERE (brand_name IS NULL OR brand_name = '')
        AND name IS NOT NULL
    `);
    console.log(`[1] brand_name backfilled from name column`);

    // ─── 2. default_language 보정 ───
    await sequelize.query(`
      UPDATE businesses
      SET default_language = 'ko'
      WHERE default_language IS NULL
    `);
    console.log(`[2] default_language = 'ko' where null`);

    // ─── 3. 각 워크스페이스에 Cue 계정 주입 ───
    const businesses = await Business.findAll({ raw: true });
    console.log(`[3] Processing ${businesses.length} workspaces for Cue creation...`);

    const randomHash = await bcrypt.hash(Math.random().toString(36) + Date.now(), 12);
    let createdCount = 0;
    let skippedCount = 0;

    for (const biz of businesses) {
      if (biz.cue_user_id) {
        skippedCount++;
        continue;
      }

      const transaction = await sequelize.transaction();
      try {
        // Cue 사용자 생성
        const cueEmail = `cue+${biz.id}@system.planq.kr`;
        const cueUser = await User.create({
          email: cueEmail,
          password_hash: randomHash,
          name: 'Cue',
          avatar_url: '/static/cue.svg',
          is_ai: true,
          platform_role: 'user',
          status: 'active',
          language: biz.default_language || 'ko'
        }, { transaction });

        // business_members 에 AI 행 등록
        await BusinessMember.create({
          business_id: biz.id,
          user_id: cueUser.id,
          role: 'ai',
          joined_at: new Date()
        }, { transaction });

        // businesses.cue_user_id 업데이트
        await Business.update(
          { cue_user_id: cueUser.id },
          { where: { id: biz.id }, transaction }
        );

        await transaction.commit();
        createdCount++;
        console.log(`    ✓ Cue created for workspace #${biz.id} (${biz.brand_name || biz.name}) → user_id=${cueUser.id}`);
      } catch (err) {
        await transaction.rollback();
        console.error(`    ✗ Failed for workspace #${biz.id}: ${err.message}`);
      }
    }

    console.log(`[3] Cue creation: ${createdCount} created, ${skippedCount} already existed`);

    // ─── 4. 검증 ───
    const [rows] = await sequelize.query(`
      SELECT b.id, b.brand_name, b.cue_user_id, u.name AS cue_name, u.is_ai
      FROM businesses b
      LEFT JOIN users u ON u.id = b.cue_user_id
    `);
    console.log(`[4] Verification:`);
    rows.forEach(r => {
      const ok = r.cue_user_id && r.cue_name === 'Cue' && r.is_ai === 1;
      console.log(`    ${ok ? '✓' : '✗'} Workspace #${r.id} "${r.brand_name}" → Cue user_id=${r.cue_user_id}`);
    });

    console.log('\n✓ Phase 0 migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
