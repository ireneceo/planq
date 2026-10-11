// AI 메일 초안의 «맺음 이름» — 한 벌 (2026-10-12).
//
// Irene: *"마지막 이름을 붙일 때 이메일마다 맞춰서 이름붙여야 하는데 마음대로 붙고, 그리고 영어인데 한글로 붙어."*
//
// 옛 동작: 프롬프트에 «no signature» 만 있고 이름을 주지 않아, 모델이 맺음말 뒤에 아는 이름 —
//   대개 워크스페이스 이름("워프로랩 드림") — 을 지어 붙였다. 영문 메일에도 한글 이름이 붙었고,
//   이 메일이 **어느 주소로 나가는지**(별칭·계정)와 무관했다.
//
// 지금: 이름은 모델이 쓰지 않는다. 모델은 맺음 문구(Best regards, / 감사합니다.)까지만 쓰고,
//   이름은 서버가 붙인다 — 이 메일이 실제로 나갈 신원(`outgoingIdentityFor`, 발송과 같은 함수)에서.
//   - 그 신원에 **서명이 붙으면** 이름을 붙이지 않는다(서명이 이름을 싣는다 — 두 번 나오면 안 된다).
//   - 서명이 없으면 보내는 이름을 **메일 언어로** 붙인다. 영문 메일인데 이름이 한글뿐이면
//     워크스페이스/계정의 영문 이름(name_localized.en)을 찾고, 그것도 없으면 붙이지 않는다.
//
// 쓰는 곳: Q mail [AI 답변 초안](ai-suggest) · 새 메일 AI 작성(ai-compose) · AI 답장 초안 도구(create_mail_reply_draft —
//   Cue·ChatGPT·Claude). 셋이 같은 함수를 쓴다(베끼면 한쪽만 고쳐진다).

const HANGUL = /[가-힣]/;
// 맺음 문구 — 이 줄 **뒤**에 오는 짧은 줄은 모델이 지어 붙인 이름으로 본다.
const CLOSING_LINE = /^(?:(?:best|kind|warm|warmest|many)?\s*(?:regards|wishes|thanks)|sincerely(?: yours)?|yours(?: sincerely| truly)?|thank you|thanks|cheers|best|respectfully)[\s,.!]*$|^(?:감사합니다|고맙습니다|감사드립니다|수고하세요|잘 부탁드립니다|부탁드립니다)[\s.!~]*$/i;

const CLOSING_PROMPT = {
  en: 'End with one short closing phrase such as "Best regards," and STOP. Do NOT write any name, company name, job title or contact details after it — PlanQ adds the sender\'s name or signature itself.',
  ko: 'End with one short closing phrase such as "감사합니다." and STOP. Do NOT write any name, company name, job title, "<이름> 드림" or contact details after it — PlanQ adds the sender\'s name or signature itself.',
};

function closingPromptFor(language) {
  return CLOSING_PROMPT[language === 'en' ? 'en' : 'ko'];
}

function nameIn(obj, lang) {
  if (!obj || typeof obj !== 'object') return null;
  const v = obj[lang];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// 메일 언어에 맞는 보내는 이름. 영문 메일에 한글 이름은 내지 않는다(없으면 null).
async function senderNameFor({ businessId, userId, fromName, language }) {
  const want = language === 'en' ? 'en' : 'ko';
  const fits = (s) => !!s && (want === 'ko' || !HANGUL.test(s));
  const fn = fromName && String(fromName).trim();
  if (fits(fn)) return fn;
  const { BusinessMember, User } = require('../models');
  const [bm, u] = await Promise.all([
    BusinessMember.findOne({ where: { business_id: businessId, user_id: userId }, attributes: ['name', 'name_localized'] }),
    User.findByPk(userId, { attributes: ['name', 'name_localized'] }),
  ]);
  for (const c of [nameIn(bm && bm.name_localized, want), nameIn(u && u.name_localized, want), bm && bm.name, u && u.name]) {
    if (fits(c && String(c).trim())) return String(c).trim();
  }
  return null;
}

/**
 * 초안이 나갈 신원을 보고 «이름을 붙일지·무엇을» 정한다.
 * @returns {{ signatureAttached: boolean, name: string|null }}
 */
async function closingFor({ businessId, userId, threadId = null, accountId = null, fromAliasId = null, draftText = '', language = 'ko' }) {
  try {
    const { outgoingIdentityFor } = require('./mailIdentity');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const r = await outgoingIdentityFor({
      businessId, userId, threadId, accountId, fromAliasId: fromAliasId || null,
      bodyHtml: `<p>${esc(draftText)}</p>`,
    });
    const d = r && r.data;
    const hasSig = !!d && ['alias', 'account', 'workspace'].includes(d.signature_source);
    if (hasSig) return { signatureAttached: true, name: null };
    const name = await senderNameFor({ businessId, userId, fromName: d && d.from_name, language });
    return { signatureAttached: false, name };
  } catch {
    // 신원을 못 읽으면 이름을 붙이지 않는다 — 틀린 이름보다 없는 편이 낫다.
    return { signatureAttached: false, name: null };
  }
}

/**
 * 모델이 맺음말 뒤에 지어 붙인 이름 줄을 걷고, 정한 이름을 붙인다.
 * @param {string} text  초안(평문, 줄바꿈 유지)
 * @param {{ name: string|null }} closing
 * @param {'ko'|'en'} language
 */
function applyClosing(text, closing, language = 'ko') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  // 맨 끝에서부터 — 맺음 문구 뒤의 짧은 줄(이름·회사·«OOO 드림»)은 모델이 지어 붙인 것이다.
  let lastClosing = -1;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i -= 1) {
    if (CLOSING_LINE.test(lines[i].trim())) { lastClosing = i; break; }
  }
  if (lastClosing >= 0) {
    const tail = lines.slice(lastClosing + 1).filter((l) => l.trim());
    // 이름·회사·직함 줄은 짧고 문장부호로 끝나지 않는다 — «좋은 하루 되세요.» 같은 문장은 남긴다.
    const allShort = tail.every((l) => l.trim().length <= 60 && !/[.!?。]$/.test(l.trim()));
    if (tail.length && tail.length <= 3 && allShort) lines.length = lastClosing + 1;
  } else {
    // 맺음 문구 없이 «OOO 드림» 한 줄로 끝났다면 그 줄도 지어낸 이름이다.
    const last = lines[lines.length - 1] || '';
    if (/드림\s*$/.test(last.trim()) && last.trim().length <= 30) lines.length -= 1;
  }
  let out = lines.join('\n').replace(/\s+$/, '');
  if (closing && closing.name) {
    out += `\n${language === 'en' ? closing.name : `${closing.name} 드림`}`;
  }
  return out;
}

module.exports = { closingPromptFor, closingFor, applyClosing, senderNameFor };
