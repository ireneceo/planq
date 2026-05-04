#!/usr/bin/env node
// 1회 실행 — 기존 q_records → posts (kind='table') 자동 마이그레이션.
// 안전: 이미 q_record_id 가 매핑된 post 가 있으면 skip (멱등 재실행 가능).
//
// 사용:
//   cd /opt/planq/dev-backend
//   node ../scripts/migrate-qrecord-to-post.js

const path = require('path');
process.chdir(path.join(__dirname, '..', 'dev-backend'));
const dotenvPath = path.join(__dirname, '..', 'dev-backend', 'node_modules', 'dotenv');
require(dotenvPath).config();

const { QRecord, Post, BusinessMember } = require(path.join(__dirname, '..', 'dev-backend', 'models'));

(async () => {
  console.log('=== q_records → posts 마이그레이션 시작 ===');
  const records = await QRecord.findAll();
  console.log('q_records:', records.length, '개');

  let created = 0, skipped = 0;
  for (const rec of records) {
    const existing = await Post.findOne({ where: { q_record_id: rec.id } });
    if (existing) { skipped += 1; continue; }

    // author_id 결정 — created_by 가 그 워크스페이스 멤버인지 확인. 아니면 owner 로 fallback.
    let authorId = rec.created_by;
    const isMember = await BusinessMember.findOne({ where: { business_id: rec.business_id, user_id: authorId } });
    if (!isMember) {
      const owner = await BusinessMember.findOne({ where: { business_id: rec.business_id, role: 'owner' } });
      authorId = owner?.user_id || authorId;
    }

    await Post.create({
      business_id: rec.business_id,
      project_id: rec.project_id,
      title: rec.name,
      category: rec.category,
      kind: 'table',
      q_record_id: rec.id,
      author_id: authorId,
      content_text: rec.description,  // 검색 인덱싱용 plain text
      status: 'published',
      visibility: 'internal',
    });
    created += 1;
  }

  console.log(`\n=== 결과 ===`);
  console.log(`신규 post 생성: ${created}`);
  console.log(`이미 매핑된 skip: ${skipped}`);
  console.log('=== 완료 ===');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
