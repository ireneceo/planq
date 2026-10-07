// 설문(#460) — 판정·질문지·응답 검증을 한 곳에. 설계 docs/SURVEY_DESIGN.md (Fable 설계 판정 수정 7건 반영)
//
// 설문 = 표 문서(Q docs kind='table')의 «응답 받기» 문. 문항 = 표 칸, 응답 1건 = 표 1줄.
// ★ 설문 열쇠(q_records.survey_token)는 **쓰기만** 된다. 응답을 읽는 공개 경로는 없다 —
//   응답은 그 표 문서를 볼 수 있는 사람만 본다(routes/records.js canViewRecord).
// ★ 무인증 GET/POST 는 매번 resolveSurveyToken **한 함수**로 판정한다. 켤 때만 보면 켠 뒤 등급을 올리거나
//   문서를 지운 표가 계속 열린다(Fable 수정 2).
const crypto = require('crypto');
const { blocksExternalShare } = require('./securityLevel');

const HARD_CAP = 5000;            // 설문당 응답 상한 — max_responses 는 이 이하로만. 넘으면 표 화면(무페이지 행 조회)이 무거워진다
const SKIP_TYPES = new Set(['secret']);   // 질문지에 절대 나오지 않는 칸
const LIMITS = { text: 500, longtext: 5000, url: 2000, email: 254, phone: 40 };

class SurveyError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

function settingsOf(record) {
  const s = record && record.survey_settings;
  return s && typeof s === 'object' ? s : {};
}

/** 질문지 — 칸 순서대로. secret 칸·숨김 칸은 빠진다. 응답·행 수·숫자 id·집계 설정은 싣지 않는다. */
function questionsOf(record) {
  const st = settingsOf(record);
  const hidden = new Set(Array.isArray(st.hidden) ? st.hidden : []);
  const required = new Set(Array.isArray(st.required) ? st.required : []);
  const help = st.help && typeof st.help === 'object' ? st.help : {};
  const cols = Array.isArray(record.columns) ? [...record.columns] : [];
  cols.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return cols
    .filter((c) => c && c.id && !SKIP_TYPES.has(c.type) && !hidden.has(c.id))
    .map((c) => ({
      id: String(c.id),
      name: String(c.name || ''),
      type: String(c.type || 'text'),
      ...(c.type === 'select' || c.type === 'multi_select' ? { options: (c.options || []).map(String) } : {}),
      required: required.has(c.id),
      ...(help[c.id] ? { help: String(help[c.id]).slice(0, 300) } : {}),
    }));
}

/**
 * 토큰 → 열린 설문. 실패 사유는 두 가지로만 밖에 나간다:
 *   404 not_found  — 모르는 토큰·꺼짐·문서 삭제·워크스페이스 삭제·보안등급·미게시 (존재 여부를 가르지 않는다)
 *   410 survey_closed — 마감·정원·하드캡
 */
async function resolveSurveyToken(token) {
  const { QRecord, QRecordRow, Post, Business } = require('../models');
  const t = String(token || '');
  if (t.length < 16 || t.length > 64 || !/^[A-Za-z0-9_-]+$/.test(t)) throw new SurveyError('not_found', 404);
  const record = await QRecord.findOne({ where: { survey_token: t } });
  // 컬럼 collation 이 대소문자를 안 가려 변형 열쇠도 찾힌다 — 정확히 같을 때만(레이트리밋 버킷이 갈라지지 않게, Fable 비차단 a)
  if (!record || record.survey_token !== t) throw new SurveyError('not_found', 404);
  // 문서(paranoid — 휴지통에 들어간 문서는 안 나온다)
  const post = await Post.findOne({ where: { q_record_id: record.id, kind: 'table' } });
  if (!post) throw new SurveyError('not_found', 404);
  if (post.status && post.status !== 'published') throw new SurveyError('not_found', 404);
  if (blocksExternalShare(post)) throw new SurveyError('not_found', 404);
  const biz = await Business.findOne({ where: { id: record.business_id, deleted_at: null }, attributes: ['id', 'name', 'brand_name', 'timezone'] });
  if (!biz) throw new SurveyError('not_found', 404);

  const st = settingsOf(record);
  if (st.closes_at && new Date(st.closes_at).getTime() <= Date.now()) throw new SurveyError('survey_closed', 410);
  const cap = Math.min(Number(st.max_responses) > 0 ? Number(st.max_responses) : HARD_CAP, HARD_CAP);
  const count = await QRecordRow.count({ where: { q_record_id: record.id } });
  if (count >= cap) throw new SurveyError('survey_closed', 410);
  return { record, post, business: biz, settings: st };
}

/** 응답 값 검증 — 칸 타입별. 질문지에 없는 칸은 버린다(400 아님). 필수 누락은 400. */
function validateAnswers(questions, input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const bad = (code) => { throw new SurveyError(code, 400); };
  for (const q of questions) {
    let v = src[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required && q.type !== 'checkbox') bad('required_missing');
      continue;
    }
    switch (q.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
        if (!Number.isFinite(n)) bad('invalid_number');
        out[q.id] = n; break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) bad('invalid_date');
        out[q.id] = String(v); break;
      case 'datetime':
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v))) bad('invalid_datetime');
        out[q.id] = String(v); break;
      case 'checkbox':
        out[q.id] = v === true || v === 'true'; break;
      case 'select':
        if (!q.options.includes(String(v))) bad('invalid_option');
        out[q.id] = String(v); break;
      case 'multi_select': {
        const arr = Array.isArray(v) ? v.map(String) : [];
        if (!arr.length || arr.some((x) => !q.options.includes(x))) bad('invalid_option');
        out[q.id] = [...new Set(arr)]; break;
      }
      case 'email': {
        const s = String(v).trim();
        if (s.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('invalid_email');
        out[q.id] = s; break;
      }
      case 'url': {
        const s = String(v).trim();
        let ok = false; try { ok = ['http:', 'https:'].includes(new URL(s).protocol); } catch { ok = false; }
        if (!ok || s.length > LIMITS.url) bad('invalid_url');
        out[q.id] = s; break;
      }
      case 'phone': {
        const s = String(v).trim();
        if (s.length > LIMITS.phone || !/^[0-9+()\-.\s]{4,}$/.test(s)) bad('invalid_phone');
        out[q.id] = s; break;
      }
      case 'longtext':
        out[q.id] = String(v).slice(0, LIMITS.longtext); break;
      default:
        out[q.id] = String(v).slice(0, LIMITS.text);
    }
    if (q.type === 'checkbox' && q.required && out[q.id] !== true) bad('required_missing');
  }
  for (const q of questions) if (q.required && q.type === 'checkbox' && out[q.id] !== true) bad('required_missing');
  return out;
}

/** 설정 정리 — 화면이 보낸 값을 그대로 저장하지 않는다(지운 칸 id 는 걸러지고 상한은 하드캡 이하). */
function sanitizeSettings(record, raw, prev = {}) {
  const ids = new Set((record.columns || []).map((c) => String(c.id)));
  const pickIds = (arr) => (Array.isArray(arr) ? arr.map(String).filter((x) => ids.has(x)) : []);
  const s = raw && typeof raw === 'object' ? raw : {};
  const help = {};
  if (s.help && typeof s.help === 'object') for (const [k, v] of Object.entries(s.help)) if (ids.has(k) && String(v || '').trim()) help[k] = String(v).slice(0, 300);
  const max = Number(s.max_responses);
  let closes = null;
  if (s.closes_at) { const d = new Date(s.closes_at); if (!Number.isNaN(d.getTime())) closes = d.toISOString(); }
  return {
    title: String(s.title ?? prev.title ?? '').slice(0, 200),
    intro: String(s.intro ?? prev.intro ?? '').slice(0, 2000),
    required: pickIds(s.required ?? prev.required),
    hidden: pickIds(s.hidden ?? prev.hidden),
    help: Object.keys(help).length ? help : (s.help === undefined ? (prev.help || {}) : {}),
    closes_at: s.closes_at === undefined ? (prev.closes_at || null) : closes,
    max_responses: s.max_responses === undefined ? (prev.max_responses || null)
      : (Number.isFinite(max) && max > 0 ? Math.min(Math.floor(max), HARD_CAP) : null),
    owner_id: prev.owner_id || null,
  };
}

/** 칸별 통계 — 응답(행) 전체를 읽어 셈한다(하드캡 5,000 이라 메모리 안에서 충분). */
function statsOf(record, rows) {
  const cols = (Array.isArray(record.columns) ? record.columns : []).filter((c) => c && !SKIP_TYPES.has(c.type));
  const vals = rows.map((r) => (r.values && typeof r.values === 'object' ? r.values : {}));
  return cols.map((c) => {
    const answered = vals.map((v) => v[c.id]).filter((x) => x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && !x.length));
    const base = { id: c.id, name: c.name, type: c.type, answered: answered.length };
    if (c.type === 'select' || c.type === 'multi_select' || c.type === 'checkbox') {
      const counts = {};
      const keys = c.type === 'checkbox' ? ['true', 'false'] : (c.options || []).map(String);
      keys.forEach((k) => { counts[k] = 0; });
      for (const x of answered) {
        const list = Array.isArray(x) ? x : [c.type === 'checkbox' ? String(x === true || x === 'true') : String(x)];
        for (const k of list) counts[k] = (counts[k] || 0) + 1;
      }
      if (c.type === 'checkbox') counts.false = rows.length - (counts.true || 0);
      return { ...base, answered: c.type === 'checkbox' ? rows.length : answered.length, counts };
    }
    if (c.type === 'number') {
      const ns = answered.map(Number).filter(Number.isFinite);
      if (!ns.length) return { ...base, avg: null, min: null, max: null };
      return { ...base, avg: Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 100) / 100, min: Math.min(...ns), max: Math.max(...ns) };
    }
    if (c.type === 'date' || c.type === 'datetime') {
      const byDay = {};
      for (const x of answered) { const d = String(x).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
      return { ...base, by_day: byDay };
    }
    return { ...base, recent: answered.slice(-20).reverse().map((x) => String(x).slice(0, 300)) };
  });
}

module.exports = { HARD_CAP, SurveyError, newToken, settingsOf, questionsOf, resolveSurveyToken, validateAnswers, sanitizeSettings, statsOf };
