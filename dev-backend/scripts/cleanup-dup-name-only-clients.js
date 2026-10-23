#!/usr/bin/env node
// scripts/cleanup-dup-name-only-clients.js — 옛 «이름만» 프로젝트 고객 추가가 만든 중복 고객 행 정리 (2026-10-23)
//
// 왜: 옛 화면(6f4632e5 이전)의 프로젝트 > 고객 «기존 고객 연결» 이 직접 관리 고객(계정 없음)을 { name, email:null } 로 보냈다.
//   서버의 «이름만» 분기가 이메일·회사 없는 **새 고객 행**을 status 'invited' 로 만들었다 → 고객 목록에 «초대 대기» 줄이 하나 더.
//   (운영 신고: «유상은 — 초대 대기» + «유상은 (주)지메이트 — 게스트» 두 줄.) 코드는 고쳤다(routes/projects.js · 이름만 = managed).
//
// 대상(좁게 — 동명이인을 지우지 않게 셋 다):
//   status='invited' ∧ user_id IS NULL ∧ invite_email IS NULL ∧ invite_token IS NULL (= 받을 주소가 없는 «초대»)
//   ∧ 같은 워크스페이스에 표시명(NFC·trim)이 같은 **다른** 고객 행이 있음
// 출력: 워크스페이스 · 중복 id → 원본 id 후보 · 참조 건수(표별).
// --apply: **참조 0건**인 중복만 지운다(감사 client.dedup_removed). 프로젝트 연결 등 참조가 있는 행은 옮기기 후보로만 출력한다
//          — 원본으로 합칠지는 사람이 정한다.
// 사용: node scripts/cleanup-dup-name-only-clients.js [--business=<id>] [--apply]
'use strict';
require('dotenv').config({ quiet: true });
const { sequelize } = require('../config/database');
const { Client, AuditLog } = require('../models');

const APPLY = process.argv.includes('--apply');
const bizArg = (process.argv.find((a) => a.startsWith('--business=')) || '').split('=')[1];

// client_id 를 가진 표(고객 행을 가리키는 것) — agent_clients·agent_grants 의 client_id 는 OAuth 앱 id 라 뺀다
const REF_TABLES = [
  'calendar_event_attendees', 'client_contacts', 'client_interactions', 'client_stage_history', 'client_subscriptions',
  'conversations', 'documents', 'email_threads', 'files', 'guest_links', 'invoices', 'kb_documents', 'project_clients',
  'project_notes', 'quotes', 'survey_recipients', 'tasks',
];
const norm = (s) => String(s || '').normalize('NFC').trim();

(async () => {
  const where = { status: 'invited', user_id: null, invite_email: null, invite_token: null };
  if (bizArg) where.business_id = Number(bizArg);
  const cands = await Client.findAll({ where, attributes: ['id', 'business_id', 'display_name', 'created_at', 'company_name', 'biz_name', 'biz_tax_id', 'phone', 'notes'] });
  let found = 0; let removed = 0; let withRefs = 0;
  for (const c of cands) {
    const name = norm(c.display_name);
    if (!name) continue;
    const peers = await Client.findAll({ where: { business_id: c.business_id }, attributes: ['id', 'display_name', 'status', 'company_name'] });
    const originals = peers.filter((p) => p.id !== c.id && norm(p.display_name) === name);
    if (!originals.length) continue;
    found += 1;
    const refs = {};
    for (const t of REF_TABLES) {
      const [[r]] = await sequelize.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE client_id = ?`, { replacements: [c.id] }).catch(() => [[{ n: 0 }]]);
      if (Number(r.n)) refs[t] = Number(r.n);
    }
    const refTotal = Object.values(refs).reduce((a, b) => a + b, 0);
    console.log(`[ws ${c.business_id}] 중복 #${c.id} «${name}» → 원본 후보 ${originals.map((o) => `#${o.id}(${o.status}${o.company_name ? ' ' + o.company_name : ''})`).join(', ')} · 참조 ${refTotal ? JSON.stringify(refs) : '0'}`);
    // 사람이 이 행에 따로 적은 값(회사·사업자·전화·메모)이 있으면 지우지 않는다 — 감사에는 이름·원본 id 만 남기 때문이다
    const ownData = ['company_name', 'biz_name', 'biz_tax_id', 'phone', 'notes'].filter((k) => c[k]);
    if (ownData.length) console.log(`  └ 이 행에 따로 적은 값이 있어 남김: ${ownData.join(', ')}`);
    if (refTotal || ownData.length) { withRefs += 1; continue; }
    if (APPLY) {
      await c.destroy();
      await AuditLog.create({
        user_id: null, business_id: c.business_id, action: 'client.dedup_removed', target_type: 'client', target_id: c.id,
        old_value: { display_name: c.display_name, original_ids: originals.map((o) => o.id), reason: 'name_only_invited_duplicate' }, new_value: null,
      }).catch((e) => console.warn('  감사 실패', e.message));
      removed += 1;
    }
  }
  console.log(`\n중복 ${found}건 · 참조·자체 값 있어 남김 ${withRefs}건 · ${APPLY ? `지움 ${removed}건` : '읽기만(--apply 로 참조 0건만 지움)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
