// 워크스페이스를 만드는 **유일한 문** (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md D1, Fable 설계).
//   가입(비밀번호·구글·애플·계정 추가)은 계정만 만든다 — Irene «모르는 새 그냥 만들어지면 안되잖아».
//   만들기는 «시작하기»(/welcome) 에서 «14일 무료 체험이 시작됩니다» 를 읽고 누르는 명시적 행동이고,
//   그 버튼이 POST /api/businesses → 이 함수 하나를 부른다. 옛 세 벌(register · oauth setupNewWorkspace ·
//   businesses POST)은 지웠다. 체험 필드는 config/plans.newTrialBusinessFields 하나(가드 trialplan).
const bcrypt = require('bcryptjs');
const { Business, BusinessMember, User } = require('../models');

async function uniqueSlug(name, transaction) {
  // slug 자동 생성 (한글 등 비ASCII 면 ws-랜덤). 충돌 시 -2, -3 …
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    || ('ws-' + Math.random().toString(36).slice(2, 8));
  let slug = base; let n = 1;
  while (await Business.findOne({ where: { slug }, transaction })) { n += 1; slug = base.slice(0, 38) + '-' + n; }
  return slug;
}

/**
 * @param {number} userId 만드는 사람(= 대표)
 * @param {{ name: string, brand_name_en?: string|null, lang?: 'ko'|'en', plan_code?: string|null }} input
 * @param {{ transaction }} opts 호출부 트랜잭션(커밋·롤백은 호출부)
 * @returns {Promise<Business>}
 */
async function createWorkspace(userId, { name, brand_name_en = null, lang = 'ko', plan_code = null }, { transaction }) {
  const bName = String(name || '').trim();
  const language = lang === 'en' ? 'en' : 'ko';
  const slug = await uniqueSlug(bName, transaction);
  // 새 워크스페이스 = 고른 플랜으로 14일 체험 (모르는 값 → starter)
  const trialFields = require('../config/plans').newTrialBusinessFields(plan_code);
  const business = await Business.create({
    name: bName, brand_name: bName,
    brand_name_en: language === 'ko' ? (brand_name_en || null) : null,
    slug, owner_id: userId, default_language: language,
    cue_mode: 'smart', cue_paused: false,
    ...trialFields,
  }, { transaction });

  await BusinessMember.create({
    business_id: business.id, user_id: userId, role: 'owner', joined_at: new Date(),
  }, { transaction });

  // Cue 시스템 계정 (AI 팀원) — 워크스페이스 필수
  const cueHash = await bcrypt.hash(Math.random().toString(36) + Date.now(), 12);
  const cueUser = await User.create({
    email: `cue+${business.id}@system.planq.kr`, password_hash: cueHash,
    name: 'Cue', avatar_url: '/static/cue.svg', is_ai: true, platform_role: 'user', status: 'active', language,
  }, { transaction });
  await business.update({ cue_user_id: cueUser.id }, { transaction });
  await BusinessMember.create({
    business_id: business.id, user_id: cueUser.id, role: 'ai', joined_at: new Date(),
  }, { transaction });

  // 만든 사람의 지금 워크스페이스를 새 워크스페이스로
  await User.update({ active_business_id: business.id }, { where: { id: userId }, transaction });
  return business;
}

module.exports = { createWorkspace };
