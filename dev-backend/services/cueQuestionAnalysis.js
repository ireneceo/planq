// Cue 질문 분석 — «무엇을 많이 묻는가» 만 남긴다 (2026-10-07, Fable 판정 B5 · docs/IRENE_DECISIONS_2026-10-07.md §5).
//
//   ① 주제 통계 `cue_question_topics` — 주제 라벨·의도·답변 여부·모드·플랜·언어만. **user_id·business_id 없음.**
//      서로 다른 워크스페이스 수는 하루마다 바뀌는 비밀 해시로만 센다(랜딩 순방문자 landing_visitors 와 같은 방식 —
//      값에서 워크스페이스를 되찾을 수 없고 날이 바뀌면 같은 워크스페이스도 다른 값이 된다).
//      라벨은 **이미 하는 답변 LLM 호출**의 끝줄 분류 태그에서 읽는다(추가 호출 0).
//      워크스페이스 스위치 permissions.cue_analysis.topics — 기본 켜 둠(opt-out).
//   ② 원문 `cue_question_raw` — 분류에 실패한 질문만, **가명처리 후**, 30일. 워크스페이스가 켰을 때만
//      (permissions.cue_analysis.raw — 기본 꺼 둠, opt-in). **워크스페이스 모드(데이터 질문)는 절대 원문을 남기지 않는다.**
//   ③ 보존 — help_question_logs 90일(소급) · cue_question_raw 30일. 서버 매일 0시(server.js).
//
//   판정은 이 파일 한 곳이다: 스위치 읽기(analysisPrefs) · 태그 해석(parseClassification) · 가명처리(pseudonymize).
const crypto = require('crypto');
const { Op } = require('sequelize');

// 기능 분류 — ≤40. 'other' 는 «맞는 칸이 없다» = 분류 실패로 센다(원문 보강 대상).
const TOPICS = [
  'qtalk', 'qtask', 'qcalendar', 'qnote', 'qdocs', 'qfile', 'qinfo', 'qbill', 'qmail', 'qsale',
  'project', 'client', 'member_org', 'permission', 'workspace_settings', 'account_login', 'plan_billing',
  'notification', 'google_integration', 'ai_agent', 'mobile_app', 'cue', 'signature', 'report',
  'attendance_leave', 'guest_link', 'search', 'import_export', 'other',
];
const INTENTS = ['howto', 'data', 'bug', 'feature_gap'];
const TOPIC_SET = new Set(TOPICS);
const INTENT_SET = new Set(INTENTS);

const TOPICS_RETENTION_DAYS = 400;   // 통계는 개인 식별 불가 — 랜딩 집계와 같은 기간
const RAW_RETENTION_DAYS = 30;
const HELP_LOG_RETENTION_DAYS = 90;

/** 답변 LLM 의 system 끝에 붙이는 분류 지시. 사용자는 이 줄을 보지 않는다(서버가 떼어 낸다). */
const CLASSIFY_INSTRUCTION = `

[내부 분류 — 반드시 지킬 것]
답변을 다 쓴 뒤 **맨 마지막 줄**에 아래 형식의 태그 한 줄만 덧붙여라. 이 줄은 사용자에게 보이지 않는다.
[[cue:topic=<주제>;intent=<의도>;ok=<1|0>]]
- 주제(하나): ${TOPICS.join(', ')} — 맞는 것이 없으면 other
  · cue 는 «Cue·Q helper(AI 도우미) 기능 자체» 를 물을 때만이다. PlanQ 기능과 무관한 질문(잡담·일반 상식·추천·다른 서비스)은 other.
- 의도(하나): howto(사용법) · data(내 업무 데이터 질문) · bug(오류·안 됨) · feature_gap(없는 기능 요청)
- ok: 질문에 실제로 답했으면 1, 근거가 없어 답하지 못했으면 0
태그 안에 질문 내용·이름·숫자를 넣지 마라.`;

const TAG_RE = /\[\[\s*cue\s*:([^\]]*)\]\]/gi;

/**
 * 답변 끝의 분류 태그를 떼어 내고 해석한다. 태그가 없거나 값이 목록 밖이면 classified=false.
 * @returns {{ answer: string, topic: string, intent: string|null, ok: boolean|null, classified: boolean }}
 */
function parseClassification(content) {
  const raw = String(content || '');
  let last = null;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(raw))) last = m[1];
  // 태그 전부 + 잘려 나간 꼬리(`[[cue:to…`)까지 지운다 — 사용자 화면에 내부 표기가 새면 안 된다.
  const answer = raw.replace(TAG_RE, '').replace(/\[\[\s*cue[^\]]*$/i, '').trim();
  const out = { answer, topic: 'unclassified', intent: null, ok: null, classified: false };
  if (!last) return out;
  const kv = {};
  for (const part of last.split(';')) {
    const [k, v] = part.split('=').map((s) => String(s || '').trim().toLowerCase());
    if (k) kv[k] = v;
  }
  if (TOPIC_SET.has(kv.topic)) out.topic = kv.topic;
  if (INTENT_SET.has(kv.intent)) out.intent = kv.intent;
  if (kv.ok === '1' || kv.ok === '0') out.ok = kv.ok === '1';
  // 분류 = 주제. 의도는 보조 칸이라 비어도 분류 실패로 세지 않는다(공개 질문은 의도가 흔히 목록 밖이다).
  out.classified = TOPIC_SET.has(kv.topic) && kv.topic !== 'other';
  return out;
}

/** 워크스페이스 스위치 — 판정은 이 함수 하나(설정 GET·PUT 응답·기록이 같이 쓴다). */
function analysisPrefs(permissions) {
  const p = permissions && typeof permissions === 'object' ? permissions : {};
  const c = p.cue_analysis && typeof p.cue_analysis === 'object' ? p.cue_analysis : {};
  return { topics: c.topics !== false, raw: c.raw === true };
}

/** 하루 단위 워크스페이스 해시 — 비밀+날짜+id. 되돌릴 수 없고 날마다 바뀐다(landing_visitors 와 같은 방식). */
function workspaceDayHash(businessId, date) {
  if (!businessId) return null;
  const secret = process.env.JWT_SECRET || 'planq';
  return crypto.createHash('sha256').update(`${secret}:cueq:${date}:${businessId}`).digest('hex').slice(0, 32);
}

function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * 가명처리 — 이름(사전)·이메일·URL·전화·금액을 자리표시로 바꾼다. 순서가 중요하다:
 *   URL·이메일 먼저(안의 숫자가 전화·금액으로 잘못 잡히지 않게) → 이름 → 전화 → 금액.
 * @param {string} text
 * @param {{ names?: string[] }} [opts]  워크스페이스의 고객·멤버·워크스페이스 표시명
 */
function pseudonymize(text, opts = {}) {
  let s = String(text || '');
  s = s.replace(/\b(?:https?:\/\/|www\.)[^\s<>"'）)]+/gi, '[URL]');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
  const names = [...new Set((opts.names || [])
    .map((n) => String(n || '').trim())
    .filter((n) => n.length >= 2))]
    .sort((a, b) => b.length - a.length);   // 긴 이름부터 — «홍길동님» 안의 «홍길» 이 먼저 먹지 않게
  for (const n of names) s = s.replace(new RegExp(escapeRe(n), 'gi'), '[NAME]');
  // 전화 — 한국 휴대·지역번호·국제표기(+82 …). 9자리 이상 숫자 덩어리.
  s = s.replace(/(?:\+\d{1,3}[\s-]?\(?\d{1,3}\)?|\(?0\d{1,2}\)?)[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g, '[PHONE]');
  // 금액 — 통화기호·통화단위가 붙은 숫자, 또는 천단위 콤마 숫자.
  s = s.replace(/[$₩€£¥]\s?\d[\d,]*(?:\.\d+)?/g, '[AMOUNT]');
  s = s.replace(/\d[\d,]*(?:\.\d+)?\s?(?:만원|천원|억원|억|원|달러|불)/g, '[AMOUNT]');
  s = s.replace(/\d[\d,]*(?:\.\d+)?\s?(?:USD|KRW|EUR|JPY|won|dollars?)\b/gi, '[AMOUNT]');
  s = s.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, '[AMOUNT]');
  return s;
}

/** 가명처리 사전 — 그 워크스페이스의 멤버·고객·워크스페이스 이름. */
async function namesForBusiness(businessId) {
  if (!businessId) return [];
  const { BusinessMember, User, Client, Business } = require('../models');
  const out = [];
  const pushLocalized = (v) => {
    if (v && typeof v === 'object') for (const x of Object.values(v)) if (typeof x === 'string') out.push(x);
  };
  const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name', 'legal_name'] });
  if (biz) out.push(biz.name, biz.brand_name, biz.legal_name);
  const members = await BusinessMember.findAll({
    where: { business_id: businessId },
    attributes: ['user_id', 'name', 'name_localized'],
  });
  for (const m of members) { out.push(m.name); pushLocalized(m.name_localized); }
  const userIds = members.map((m) => m.user_id).filter(Boolean);
  if (userIds.length) {
    const users = await User.findAll({ where: { id: userIds }, attributes: ['name', 'name_localized'] });
    for (const u of users) { out.push(u.name); pushLocalized(u.name_localized); }
  }
  const clients = await Client.findAll({
    where: { business_id: businessId },
    attributes: ['display_name', 'display_name_localized', 'company_name'],
  });
  for (const c of clients) { out.push(c.display_name, c.company_name); pushLocalized(c.display_name_localized); }
  return out.filter(Boolean);
}

/**
 * 답한 직후 기록. 실패해도 응답 흐름은 막지 않는다(로그만).
 * @param {object} a
 * @param {'qhelper'|'workspace'|'public'} a.mode
 * @param {number|null} a.businessId  창의 워크스페이스(없으면 null). **저장하지 않는다** — 스위치·해시·가명 사전에만 쓴다.
 * @param {string} a.question  원문(가명처리 전) — 원문 보관 조건을 다 만족할 때만 가명처리해 남긴다
 * @param {ReturnType<typeof parseClassification>} a.cls
 * @param {string} a.lang
 * @param {boolean} a.answered
 */
async function recordQuestion(a) {
  try {
    const { CueQuestionTopic, CueQuestionRaw, Business } = require('../models');
    let prefs = { topics: true, raw: false };
    let plan = null;
    if (a.businessId) {
      const biz = await Business.findByPk(a.businessId, { attributes: ['id', 'plan', 'permissions'] });
      if (biz) { prefs = analysisPrefs(biz.permissions); plan = biz.plan || null; }
    }
    if (!prefs.topics) return { recorded: false, raw: false };
    const date = kstDate();
    const row = await CueQuestionTopic.create({
      stat_date: date,
      topic: a.cls.topic,
      intent: a.cls.intent,
      classified: a.cls.classified,
      answered: a.cls.ok === null ? !!a.answered : (a.cls.ok && !!a.answered),
      mode: a.mode,
      plan_tier: plan ? String(plan).slice(0, 20) : null,
      lang: String(a.lang || 'ko').slice(0, 5),
      ws_day_hash: workspaceDayHash(a.businessId, date),
    });
    // 원문 — 분류 실패 + qhelper(제품 사용법) + 워크스페이스가 켰을 때만. workspace 모드는 고객사 데이터가 섞여 금지.
    let raw = false;
    if (!a.cls.classified && a.mode === 'qhelper' && a.businessId && prefs.raw) {
      const names = await namesForBusiness(a.businessId);
      await CueQuestionRaw.create({
        topic_row_id: row.id,
        question: pseudonymize(a.question, { names }).slice(0, 1000),
        lang: String(a.lang || 'ko').slice(0, 5),
      });
      raw = true;
    }
    return { recorded: true, raw, id: row.id };
  } catch (e) {
    console.warn('[cue-question-analysis] record failed:', e.message);
    return { recorded: false, raw: false };
  }
}

// KNOWLEDGE_LOOP 축2 — Q helper 질문 로그(위키 개선용, 90일 보존). 실패해도 응답 흐름은 막지 않는다. (routes/cue.js 에서 옮김)
async function logHelpQuestion(fields) {
  try {
    const { HelpQuestionLog } = require('../models');
    const row = await HelpQuestionLog.create(fields);
    return row.id;
  } catch (e) {
    console.warn('[cue] question log failed:', e.message);
    return null;
  }
}

/** 보존 — 질문 로그 90일 · 가명 원문 30일 · 주제 통계 400일. 멱등(날짜 기준 삭제). */
async function pruneCueQuestionData(now = new Date()) {
  const { HelpQuestionLog, CueQuestionRaw, CueQuestionTopic } = require('../models');
  const day = 86400000;
  const help = await HelpQuestionLog.destroy({ where: { created_at: { [Op.lt]: new Date(now.getTime() - HELP_LOG_RETENTION_DAYS * day) } } });
  const raw = await CueQuestionRaw.destroy({ where: { created_at: { [Op.lt]: new Date(now.getTime() - RAW_RETENTION_DAYS * day) } } });
  const topics = await CueQuestionTopic.destroy({ where: { stat_date: { [Op.lt]: kstDate(new Date(now.getTime() - TOPICS_RETENTION_DAYS * day)) } } });
  return { help_question_logs: help, cue_question_raw: raw, cue_question_topics: topics };
}

module.exports = {
  TOPICS, INTENTS, CLASSIFY_INSTRUCTION,
  TOPICS_RETENTION_DAYS, RAW_RETENTION_DAYS, HELP_LOG_RETENTION_DAYS,
  parseClassification, analysisPrefs, workspaceDayHash, pseudonymize, namesForBusiness,
  recordQuestion, pruneCueQuestionData, kstDate, logHelpQuestion,
};
