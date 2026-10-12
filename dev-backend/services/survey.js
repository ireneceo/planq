// 설문 — 판정·질문지·응답 검증을 한 곳에. 설계 docs/SURVEY_DESIGN.md(#460) → docs/SURVEY_V2_DESIGN.md(v2)
//
// 설문 = Q docs 의 세 번째 종류(kind='survey'). 문항 = 표 칸, 응답 1건 = 표 1줄, 설명 = 문서 본문.
//   옛 «표에서 켠 설문»(kind='table' + survey_token) 공개 링크도 그대로 산다(v2 §2.2).
// 열쇠는 두 종류 — ① 공개 링크(q_records.survey_token, 누구나·여러 번) ② 개인 열쇠(survey_recipients.token, 받는 사람 1명·1회).
//   둘 다 같은 공개 화면·같은 판정 함수(resolveSurveyToken)를 쓴다.
// ★ 설문 열쇠(q_records.survey_token)는 **쓰기만** 된다. 응답을 읽는 공개 경로는 없다 —
//   응답은 그 표 문서를 볼 수 있는 사람만 본다(routes/records.js canViewRecord).
// ★ 무인증 GET/POST 는 매번 resolveSurveyToken **한 함수**로 판정한다. 켤 때만 보면 켠 뒤 등급을 올리거나
//   문서를 지운 표가 계속 열린다(Fable 수정 2).
const crypto = require('crypto');
const { blocksExternalShare } = require('./securityLevel');

const HARD_CAP = 5000;            // 설문당 응답 상한 — max_responses 는 이 이하로만. 넘으면 표 화면(무페이지 행 조회)이 무거워진다
// 질문지에 절대 나오지 않는 칸 — 비밀·첨부·행 계산·URL·일시·체크(«동의» 칸, 설문의 예/아니오와 다르다) (v2 §4)
//   ★ 첨부(attach) 칸이 질문지에 «글 입력» 으로 나가던 버그도 여기서 막는다.
const SKIP_TYPES = new Set(['secret', 'attach', 'row_sum', 'row_avg', 'row_min', 'row_max', 'url', 'datetime', 'checkbox']);
// 옛 표-설문(kind='table')은 v1 그대로 — 체크·URL·일시 칸을 받던 질문지를 조용히 줄이지 않는다
const SKIP_TYPES_LEGACY = new Set(['secret', 'attach', 'row_sum', 'row_avg', 'row_min', 'row_max']);
const SURVEY_KINDS = ['table', 'survey'];
const LIMITS = { text: 500, longtext: 5000, url: 2000, email: 254, phone: 40 };

class SurveyError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

function settingsOf(record) {
  const s = record && record.survey_settings;
  return s && typeof s === 'object' ? s : {};
}

/** 질문지 — 칸 순서대로. 숨기는 종류·숨김 칸은 빠진다. 응답·행 수·숫자 id·집계 설정은 싣지 않는다.
 *  kind — 문서 종류('survey' 면 v2 규칙, 'table' 이면 옛 표-설문 규칙). */
function questionsOf(record, kind = 'survey') {
  const skip = kind === 'table' ? SKIP_TYPES_LEGACY : SKIP_TYPES;
  const st = settingsOf(record);
  const hidden = new Set(Array.isArray(st.hidden) ? st.hidden : []);
  const required = new Set(Array.isArray(st.required) ? st.required : []);
  const help = st.help && typeof st.help === 'object' ? st.help : {};
  const cols = Array.isArray(record.columns) ? [...record.columns] : [];
  cols.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return cols
    .filter((c) => c && c.id && !skip.has(c.type) && !hidden.has(c.id))
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
 * 토큰 → 열린 설문. 실패 사유는 세 가지로만 밖에 나간다:
 *   404 not_found  — 모르는 토큰·꺼짐·회수·문서 삭제·워크스페이스 삭제·보안등급·미게시 (존재 여부를 가르지 않는다)
 *   410 survey_closed — 마감(설문·회차)·정원·하드캡
 *   410 already_responded — 개인 열쇠로 이미 응답함(v2 §5.2)
 * 개인 열쇠를 먼저 찾고, 없으면 공개 링크. 두 열쇠의 길이·문자 집합이 같아 밖에서는 가를 수 없다.
 * @returns {{ record, post, business, settings, recipient: object|null, issue: object|null }}
 */
async function resolveSurveyToken(token) {
  const { QRecord, QRecordRow, Post, Business, SurveyRecipient, SurveyIssue } = require('../models');
  const t = String(token || '');
  if (t.length < 16 || t.length > 64 || !/^[A-Za-z0-9_-]+$/.test(t)) throw new SurveyError('not_found', 404);

  let recipient = null; let issue = null; let record = null;
  const rc = await SurveyRecipient.findOne({ where: { token: t } });
  if (rc && rc.token === t) {
    // 회차가 «보냄» 이 아니면(확인 대기·건너뜀·만료 — Phase 2) 열쇠가 있어도 닫혀 있다
    issue = await SurveyIssue.findByPk(rc.issue_id);
    if (!issue || issue.status !== 'sent' || !['sent', 'responded'].includes(rc.status)) throw new SurveyError('not_found', 404);
    record = await QRecord.findByPk(issue.q_record_id);
    if (!record || record.business_id !== rc.business_id) throw new SurveyError('not_found', 404);
    recipient = rc;
  } else {
    record = await QRecord.findOne({ where: { survey_token: t } });
    // 컬럼 collation 이 대소문자를 안 가려 변형 열쇠도 찾힌다 — 정확히 같을 때만(레이트리밋 버킷이 갈라지지 않게, Fable 비차단 a)
    if (!record || record.survey_token !== t) throw new SurveyError('not_found', 404);
  }
  // 문서(paranoid — 휴지통에 들어간 문서는 안 나온다)
  const post = await Post.findOne({ where: { q_record_id: record.id, kind: SURVEY_KINDS } });
  if (!post) throw new SurveyError('not_found', 404);
  if (post.status && post.status !== 'published') throw new SurveyError('not_found', 404);
  if (blocksExternalShare(post)) throw new SurveyError('not_found', 404);
  const biz = await Business.findOne({ where: { id: record.business_id, deleted_at: null }, attributes: ['id', 'name', 'brand_name', 'timezone'] });
  if (!biz) throw new SurveyError('not_found', 404);

  if (recipient && (recipient.responded_at || recipient.status === 'responded')) throw new SurveyError('already_responded', 410);
  if (issue && issue.closes_at && new Date(issue.closes_at).getTime() <= Date.now()) throw new SurveyError('survey_closed', 410);
  const st = settingsOf(record);
  if (st.closes_at && new Date(st.closes_at).getTime() <= Date.now()) throw new SurveyError('survey_closed', 410);
  const cap = Math.min(Number(st.max_responses) > 0 ? Number(st.max_responses) : HARD_CAP, HARD_CAP);
  const count = await QRecordRow.count({ where: { q_record_id: record.id } });
  if (count >= cap) throw new SurveyError('survey_closed', 410);
  return { record, post, business: biz, settings: st, recipient, issue };
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
      case 'yesno':
        if (v === true || v === 'true' || v === 'yes') out[q.id] = true;
        else if (v === false || v === 'false' || v === 'no') out[q.id] = false;
        else bad('invalid_option');
        break;
      case 'rating': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) bad('invalid_rating');
        out[q.id] = n; break;
      }
      case 'scale': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 10) bad('invalid_scale');
        out[q.id] = n; break;
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
    // v2 — 익명(켜면 그 이후 응답부터 받는 사람을 잇지 않는다) · 제출 뒤 문구
    anonymous: s.anonymous === undefined ? !!prev.anonymous : !!s.anonymous,
    thanks: String(s.thanks ?? prev.thanks ?? '').slice(0, 500),
    owner_id: prev.owner_id || null,
  };
}

// 칸별 통계는 services/surveyStats.js(계산 정본)로 옮겼다 — 여기서 다시 셈하지 않는다.

module.exports = { HARD_CAP, SKIP_TYPES, SKIP_TYPES_LEGACY, SURVEY_KINDS, SurveyError, newToken, settingsOf, questionsOf, resolveSurveyToken, validateAnswers, sanitizeSettings };
