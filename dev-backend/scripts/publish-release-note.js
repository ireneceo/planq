#!/usr/bin/env node
// 릴리즈 노트 발행 — 버전 업 시 새소식 글을 만들거나 갱신한다 (2026-08-25).
//
// 왜: 배포할 때마다 릴리즈 노트를 손으로 옮겨 적는 것은 반복 작업이고, 그러다 보면 안 쓰게 된다.
//   ("고객에게 어떻게 버전 올린 걸 알려?" — Irene). /배포 의 버전 업 단계에서 이 스크립트를 부른다.
//
// 입력: JSON 파일 (docs/release-notes/v<버전>.json)
//   { "version": "1.48.4", "date": "2026-08-25",
//     "items": [ { "ko": {"title": "...", "body": "..."}, "en": {"title": "...", "body": "..."} } ] }
//
// 동작:
//   - slug `update-<버전>` 으로 upsert (같은 버전을 두 번 발행해도 글이 하나)
//   - 기본은 **미발행**. --publish 를 주면 발행 상태로 만든다(사용자가 "버전 올려" 라고 한 순간).
//   - 본문은 help_articles 의 블록 배열(ko/en) 형식으로 만든다 — 위키·새소식이 같은 형식을 쓴다.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { HelpArticle } = require('../models');

const UPDATES_CATEGORY_SLUG = 'updates';

function blocksFrom(items, lang) {
  const blocks = [];
  for (const it of items) {
    const v = it[lang] || it.ko;
    if (!v) continue;
    if (v.title) blocks.push({ type: 'heading', text: v.title });
    if (v.body) blocks.push({ type: 'text', text: v.body });
  }
  return blocks;
}

(async () => {
  const fileArg = process.argv.find((a) => a.endsWith('.json'));
  if (!fileArg) {
    console.error('사용법: node scripts/publish-release-note.js docs/release-notes/v1.48.4.json [--publish]');
    process.exit(1);
  }
  const publish = process.argv.includes('--publish');
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  const spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!spec.version || !Array.isArray(spec.items) || spec.items.length === 0) {
    console.error('version 과 items 가 필요합니다.'); process.exit(1);
  }

  const { sequelize } = require('../config/database');
  const [[cat]] = await sequelize.query(
    'SELECT id FROM help_categories WHERE slug = ? LIMIT 1', { replacements: [UPDATES_CATEGORY_SLUG] },
  );
  if (!cat) { console.error(`'${UPDATES_CATEGORY_SLUG}' 카테고리가 없습니다. seed-wiki-content.js 를 먼저 실행하세요.`); process.exit(1); }

  const slug = `update-${String(spec.version).replace(/\./g, '-')}`;
  const payload = {
    category_id: cat.id,
    slug,
    title_ko: `PlanQ 업데이트 v${spec.version}`,
    title_en: `PlanQ Update v${spec.version}`,
    body_ko: blocksFrom(spec.items, 'ko'),
    body_en: blocksFrom(spec.items, 'en'),
    visibility: 'public',
    is_published: publish,
    blog_category: 'updates',
    blog_published_at: publish ? (spec.date ? new Date(spec.date) : new Date()) : null,
  };

  const existing = await HelpArticle.findOne({ where: { slug } });
  if (existing) {
    await existing.update(payload);
    console.log(`갱신: ${slug} (${publish ? '발행' : '미발행'})`);
  } else {
    await HelpArticle.create(payload);
    console.log(`생성: ${slug} (${publish ? '발행' : '미발행'})`);
  }
  console.log(`  ko: ${payload.title_ko} · 블록 ${payload.body_ko.length}개`);
  console.log(`  en: ${payload.title_en} · 블록 ${payload.body_en.length}개`);
  console.log(`  주소: /insights/${slug}`);
  process.exit(0);
})().catch((e) => { console.error('오류:', e.message); process.exit(1); });
