// services/signatureItems.js — 서명 칸 값 받기 (docs/SIGNATURE_ITEMS_DESIGN.md §9) — 받는 쪽 공개 서명·우리 쪽 앱 안 서명 **한 벌**
//
// 서명자는 자기 서명 칸 수(required_items.sign)만큼 «그리기 또는 이미지 올리기» 로 채운다(사인·회사 스탬프 모두 이 칸).
// 옛 화면(signature_image_b64 한 장)도 받는다 — 서명 칸이 1개일 때만.
const crypto = require('crypto');

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_DRAW = 200_000;          // 손그림 dataURL(지금 규칙 그대로)
const MAX_IMAGE = 7_000_000;       // 올린 이미지 ≈ 5MB 파일(base64 는 4/3 배)

function signCountOf(sr) {
  const n = Number(sr && sr.required_items && sr.required_items.sign);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * @returns {{ ok: true, images: Array<{index,mode,b64,sha256}>, first: string } | { ok: false, code: string }}
 */
function readItemImages(body, sr) {
  const need = signCountOf(sr);
  let list = Array.isArray(body && body.item_images) ? body.item_images : null;
  if (!list) {
    const one = String((body && body.signature_image_b64) || '');
    if (!one) return { ok: false, code: 'invalid_signature_image' };
    if (need > 1) return { ok: false, code: 'signature_items_incomplete' };
    list = [{ mode: 'draw', b64: one }];
  }
  if (list.length !== need) return { ok: false, code: 'signature_items_incomplete' };
  const images = [];
  for (let i = 0; i < list.length; i += 1) {
    const it = list[i] || {};
    const mode = it.mode === 'image' ? 'image' : 'draw';
    const b64 = String(it.b64 || '');
    if (!DATA_URL.test(b64)) return { ok: false, code: 'invalid_signature_image' };
    if (b64.length > (mode === 'image' ? MAX_IMAGE : MAX_DRAW)) return { ok: false, code: 'signature_image_too_large' };
    images.push({ index: i, mode, b64, sha256: crypto.createHash('sha256').update(b64).digest('hex') });
  }
  return { ok: true, images, first: images[0].b64 };
}

/** 고정본(content_json 문자열)의 서명 항목을 서명자 번호별로 — { sign: 서명 칸 수, date, name }.
 *  읽는 공식은 화면 utils/signatureFields.ts readSignerItems 와 같다(item 없음 = sign). */
function signatureItemsBySlot(contentSnapshot) {
  const out = new Map();
  let doc = null;
  try { doc = typeof contentSnapshot === 'string' ? JSON.parse(contentSnapshot) : contentSnapshot; } catch { return out; }
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'signatureField') {
      const slot = Number(n.attrs && n.attrs.slot) || 1;
      const item = n.attrs && (n.attrs.item === 'date' || n.attrs.item === 'name') ? n.attrs.item : 'sign';
      const cur = out.get(slot) || { sign: 0, date: false, name: false };
      if (item === 'sign') cur.sign += 1; else cur[item] = true;
      out.set(slot, cur);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}

/**
 * 서명 요청을 만들 때 — 서명자마다 채울 것(required_items)을 정하고, 서명 칸이 없는 요청을 막는다.
 *   · 서명(kind='sign')은 서명자 전원의 번호에 서명 칸이 1개 이상 있어야 한다 → 아니면 signature_fields_required
 *     (서명 칸 없이 보내면 서명이 문서 끝 별도 영역에 붙고, 본문에 손으로 적은 «서명: ____» 는 빈칸으로 남는다)
 *   · 서명일 표기 — 보낸 사람 설정(없으면 언어 기본) · 워크스페이스 시간대. 요청 때 고정한다(나중에 설정을 바꿔도 서명본이 안 바뀐다).
 *   · 확인 요청(kind='confirm')은 칸이 필요 없다 → requiredFor 는 늘 null.
 */
async function planRequiredItems({ kind, contentSnapshot, signers, userId, businessId, transaction }) {
  if (kind !== 'sign') return { ok: true, requiredFor: () => null };
  const bySlot = signatureItemsBySlot(contentSnapshot);
  const missing = (signers || []).filter((s) => !bySlot.get(Number(s.slot))?.sign);
  if (!bySlot.size || missing.length) return { ok: false, code: 'signature_fields_required' };
  const { User, Business } = require('../models');
  const u = await User.findByPk(userId, { attributes: ['date_format', 'language'], transaction });
  const b = await Business.findByPk(businessId, { attributes: ['timezone'], transaction });
  const meta = {
    date_format: u?.date_format || null,
    locale: String(u?.language || 'ko').startsWith('en') ? 'en' : 'ko',
    tz: b?.timezone || 'Asia/Seoul',
  };
  return {
    ok: true,
    requiredFor: (slot) => {
      const it = bySlot.get(Number(slot));
      return it ? { sign: it.sign, date: it.date, name: it.name, ...meta } : null;
    },
  };
}

module.exports = { readItemImages, signCountOf, signatureItemsBySlot, planRequiredItems };
