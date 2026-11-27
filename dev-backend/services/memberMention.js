// 말로 지목한 사람 → 워크스페이스 멤버 (2026-11-27, Irene «큐에게 업무를 요청하면 기본적으로는 요청한 사람에게 담당이 돼야 되고
//   누구한테 요청 넣어 달라고 하면 그 사람이 담당으로 … 여러 가지 경로로 이런 명칭이나 사람을 배당하는 거 고도화»).
//
// 왜 한 곳인가 — 담당자 이름 해석이 길마다 달랐다:
//   Cue 대화창(cue_tools)·말로 추가(voice) = 표시명/계정명 **정확 일치만** → «이디자» 가 «이디자Renamed» 를 못 찾고,
//   «디자님»·«박 개발자»·«대표님» 도 못 찾아 **아무 말 없이 요청한 사람(나) 업무**가 됐다.
//   Cue 업무 바(aiTaskPlanner) = 포함 일치 + 역할 힌트 → 이름을 말하지 않아도 직함 맞는 동료에게 갔다.
//   거꾸로 «박개발이 보내준 자료 정리» 처럼 이름이 **언급만** 돼도 그 사람이 담당이 됐다(dev 실측 2026-11-27).
//
// 규칙(모든 길이 이 함수 하나):
//   - 사람을 지목하지 않으면 담당 = 요청한 사람(이 모듈은 null 을 돌려주고 createTask 가 정한다).
//   - 지목 = «OO에게/한테/께/더러/보고 + 요청·부탁·시켜·맡겨·전달…» · «담당(자)은 OO» · «OO 담당으로».
//   - 지목한 말 → 멤버: ① 이름 그대로 ② 호칭·조사·직함을 뗀 이름 ③ 성 뺀 이름·앞부분(«디자» → 이디자, «이디자» → 이디자Renamed)
//     ④ 한 글자 오차(3자 이상) ⑤ 직함·전문 분야(«대표님» → 대표/CEO, «박 개발자» → 박○○ 중 개발) — 단계마다 **한 명일 때만** 확정.
//     둘 이상이면 ambiguous(후보를 돌려줘 사람이 고른다) · 없으면 none — 틀린 추측으로 남에게 알림을 보내지 않는다.
//   - 고객·AI·내보낸 멤버는 후보가 아니다.
'use strict';

const { BusinessMember, User } = require('../models');

const HONORIFIC = ['님', '씨', '군', '양', '쌤'];
// 길이가 긴 것부터(«에게서» 가 «에게» 보다 먼저)
const PARTICLE = ['에게서', '한테서', '께서', '에게', '한테', '더러', '보고', '이랑', '하고', '으로', '께', '랑', '로', '이', '가', '은', '는', '을', '를', '도', '의'];
const TITLE = ['팀장', '파트장', '본부장', '실장', '부장', '차장', '과장', '대리', '주임', '사원', '이사', '상무', '전무', '부사장', '사장', '대표', '원장', '국장', '매니저', '선임', '책임', '수석', '연구원',
  '디자이너', '개발자', '기획자', '마케터', '디렉터', '리더', '선생', '코치', 'pm', 'po', 'ceo', 'cto', 'cfo', 'coo'];
// 직함 → 멤버 칸(job_title·expertise·role)에서 찾을 말
const TITLE_SYNONYM = {
  대표: ['대표', 'ceo', 'owner', '사장'], 사장: ['사장', '대표', 'ceo', 'owner'], ceo: ['ceo', '대표', 'owner'],
  개발자: ['개발', 'developer', 'engineer', 'cto', '엔지니어'], 디자이너: ['디자인', 'design', '디자이너'], 기획자: ['기획', 'planner', 'pm'],
  마케터: ['마케팅', 'marketing', '마케터'], pm: ['pm', '기획', 'project manager'], cto: ['cto', '개발'],
};
const SELF = new Set(['나', '저', '내', '제', '본인', '나자신', 'me', 'myself', 'i']);

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s.,·'"«»()[\]{}!?~:;/\\_-]+/g, '');

/** 지목한 말 → 비교할 꼴들 + 떼어 낸 직함. «박 개발자님께» → forms [박개발자님께, 박개발자, 박], title 개발자 */
function formsOf(said) {
  const raw = norm(said);
  const forms = new Set(raw ? [raw] : []);
  let title = null;
  let cur = raw;
  for (let i = 0; i < 4 && cur; i += 1) {
    let changed = false;
    for (const p of PARTICLE) if (cur.length - p.length >= 1 && cur.endsWith(p)) { cur = cur.slice(0, -p.length); changed = true; forms.add(cur); break; }
    for (const h of HONORIFIC) if (cur.length - h.length >= 1 && cur.endsWith(h)) { cur = cur.slice(0, -h.length); changed = true; forms.add(cur); break; }
    for (const t of TITLE) if (cur.endsWith(t)) { title = title || t; cur = cur.slice(0, -t.length); changed = true; if (cur) forms.add(cur); break; }
    if (!changed) break;
  }
  if (!title && TITLE.includes(cur)) title = cur;
  return { forms: [...forms].filter(Boolean), base: cur, title };
}

/** 워크스페이스에서 담당자가 될 수 있는 사람(고객·AI·내보낸 멤버 제외). */
async function memberPool(businessId) {
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    attributes: ['user_id', 'role', 'name', 'name_localized', 'job_title', 'expertise'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'is_ai'] }],
  });
  const seen = new Set();
  const out = [];
  for (const m of rows) {
    if (!m.user_id || m.role === 'ai' || m.role === 'client' || m.user?.is_ai || seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    const loc = m.name_localized && typeof m.name_localized === 'object' ? Object.values(m.name_localized) : [];
    const names = [m.name, ...loc, m.user?.name].filter((x) => x && String(x).trim());
    out.push({ user_id: m.user_id, role: m.role || null, display_name: m.name || m.user?.name || null, names: [...new Set(names.map(String))], job_title: m.job_title || null, expertise: m.expertise || null });
  }
  return out;
}

function oneCharOff(a, b) {
  if (a.length !== b.length || a.length < 3) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d === 1;
}
// 한글 3자 이름이면 성을 뺀 이름(«이디자» → «디자»). 표시명 앞부분이 이름인 꼴(«이디자Renamed») 도 그 앞 한글로.
function givenNames(n) {
  const out = [];
  const ko = (n.match(/^[가-힣]+/) || [''])[0];
  if (ko.length === 3 || ko.length === 4) out.push(ko.slice(1));
  return out;
}
function hangulHead(n) { return (n.match(/^[가-힣]+/) || [''])[0]; }

/**
 * 지목한 말 하나 → { status: 'self'|'matched'|'ambiguous'|'none', userId, tier, candidates:[{user_id,name}], said }
 *   opts.askerId — «나·저» 는 요청한 사람, 직함 매칭에서 요청한 사람은 다른 후보가 있으면 뺀다.
 */
function resolveMention(said, pool, opts = {}) {
  const askerId = opts.askerId ? Number(opts.askerId) : null;
  const out = (status, ids, tier) => ({
    status, said: said || null, tier: tier || null,
    userId: status === 'matched' || status === 'self' ? ids[0] : null,
    candidates: ids.map((id) => ({ user_id: id, name: pool.find((m) => m.user_id === id)?.display_name || null })),
  });
  if (!said || !String(said).trim()) return out('none', []);
  const { forms, base, title } = formsOf(said);
  if (forms.some((f) => SELF.has(f)) || SELF.has(base)) return askerId ? out('self', [askerId], 'self') : out('none', []);
  const members = pool.map((m) => ({ m, ns: m.names.map(norm).filter(Boolean) }));
  const pick = (pred) => [...new Set(members.filter(pred).map((x) => x.m.user_id))];
  const settle = (ids, tier) => (ids.length === 1 ? out('matched', ids, tier) : ids.length > 1 ? out('ambiguous', ids, tier) : null);

  // ① 이름 그대로 / 호칭·조사·직함 뗀 이름
  let r = settle(pick((x) => x.ns.some((n) => forms.includes(n))), 'exact');
  if (r) return r;
  // ② 성 뺀 이름 · 표시명 앞부분(3자 이상 · 이름이 그 말로 시작)
  r = settle(pick((x) => x.ns.some((n) => forms.some((f) => (f.length >= 2 && givenNames(n).includes(f)) || (f.length >= 3 && n.startsWith(f)) || (f.length >= 2 && hangulHead(n) === f)))), 'partial');
  if (r) return r;
  // ③ 한 글자 오차(받아쓰기·오타) — 3자 이상, 한글 이름 머리끼리도
  r = settle(pick((x) => x.ns.some((n) => forms.some((f) => oneCharOff(f, n) || oneCharOff(f, hangulHead(n))))), 'typo');
  if (r) return r;
  // ④ 직함·전문 분야 — 성(한 글자)이 남았으면 그 성으로 좁힌다(«박 개발자» → 박○○)
  if (title) {
    const keys = TITLE_SYNONYM[title] || [title];
    const fieldsOf = (m) => norm([m.job_title, m.expertise, m.role || ''   /* 직함 «대표» 를 owner 역할로도 찾는다 — 권한 판정 아님 */].join(' '));
    let ids = pick((x) => keys.some((k) => fieldsOf(x.m).includes(norm(k))));
    const sur = base && base.length <= 2 ? base : null;
    if (sur) {
      const bySur = pick((x) => x.ns.some((n) => n.startsWith(sur)));
      const both = ids.filter((id) => bySur.includes(id));
      ids = both.length ? both : (bySur.length === 1 ? bySur : ids.length ? [] : bySur);
    }
    if (askerId && ids.length > 1) ids = ids.filter((id) => id !== askerId);
    r = settle(ids, 'title');
    if (r) return r;
  }
  return out('none', []);
}

// ── 문장에서 «지목» 찾기 ─────────────────────────────────────
//   «OO(님|씨)?(께|에게|한테|더러|보고) … » + 맡기는 말, «담당(자)?(은|는|을|를)? OO», «OO (이|가)? 담당».
const ASSIGN_VERB = /(?:으로|로)\s*(?:해|바꿔|변경)|요청|부탁|시켜|시키|맡겨|맡기|배정|담당|넘겨|전달|토스|할당|달라고|하라고|해\s*달라|해\s*주라|assign|ask\b/i;
const TOKEN = '[가-힣A-Za-z][가-힣A-Za-z0-9]{0,15}';
const TARGET_RE = new RegExp(`(?:^|[\\s,.(«"'])((?:${TOKEN}\\s)?${TOKEN})\\s*(?:님|씨)?\\s*(?:께서|께|에게|한테|더러|보고)(?=[\\s,.!?]|$)`, 'g');
const OWNER_RE = new RegExp(`담당(?:자)?(?:는|은|을|를|로|으로|이|가)?\\s*(${TOKEN})`, 'g');
const OWNER_AFTER_RE = new RegExp(`(?:^|[\\s,.(«"'])((?:${TOKEN}\\s)?${TOKEN})\\s*(?:님|씨)?\\s*(?:이|가)?\\s*(?:담당|맡아|맡도록|하도록)`, 'g');

/** 문장 → 지목한 말 목록(나온 순서, 중복 제거). 맡기는 말이 없으면 «OO에게» 만으로는 지목이 아니다(«OO에게 받은 자료»). */
function findTargets(text) {
  const s = String(text || '');
  const out = [];
  const add = (x) => { const v = String(x || '').trim().replace(/(?:님|씨)$/, ''); if (v && !out.includes(v)) out.push(v); };
  if (ASSIGN_VERB.test(s)) {
    for (const m of s.matchAll(TARGET_RE)) {
      // «… 이번 주까지 박개발한테» 같은 두 낱말 잡힘 — 뒤 낱말이 이름이다. 두 낱말 모두 후보로(«박 개발자»)
      //   «박 개발자» 처럼 앞 낱말이 성(한 글자)일 때만 붙여 두고, 아니면 뒤 낱말(«이번 주까지 루아» → 루아).
      const parts = m[1].split(/\s+/);
      add(parts.length === 2 && parts[0].length === 1 ? m[1] : parts[parts.length - 1]);
    }
  }
  for (const m of s.matchAll(OWNER_RE)) add(m[1]);
  for (const m of s.matchAll(OWNER_AFTER_RE)) add(m[1]);
  return out.filter((x) => !/^(업무|일|할일|이거|이것|그거|그것|저거|그|이|이번|다음|오늘|내일|모레)$/.test(norm(x)));
}

/** 두 낱말 지목(«이번 박개발», «박 개발자»)은 둘 다 해 본다 — 붙인 꼴이 먼저, 안 되면 뒤 낱말. */
function resolveSaid(said, pool, opts) {
  const parts = String(said).trim().split(/\s+/);
  const whole = resolveMention(said, pool, opts);
  if (whole.status !== 'none' || parts.length < 2) return whole;
  const last = resolveMention(parts[parts.length - 1], pool, opts);
  return last.status !== 'none' ? { ...last, said: parts[parts.length - 1] } : { ...whole, said: parts[parts.length - 1] };
}

/** 문장 → 지목 결과 목록. */
function resolveTargetsInText(text, pool, opts = {}) {
  return findTargets(text).map((said) => resolveSaid(said, pool, opts));
}

/** 이 멤버가 문장에 (이름·성 뺀 이름으로) 나오는가 — «모델이 말 안 한 사람을 골랐나» 판정용. */
function isMentioned(text, member) {
  const t = norm(text);
  if (!t || !member) return false;
  return member.names.map(norm).some((n) => (n.length >= 2 && t.includes(n)) || givenNames(n).some((g) => g.length >= 2 && t.includes(g)) || (hangulHead(n).length >= 2 && t.includes(hangulHead(n))));
}

// 요청 업무의 제목 끝 «요청/부탁(하기)» — 받는 사람에게는 할 일이 제목이다(voice 와 같은 규칙, 2026-11-18)
const TITLE_REQ_TAIL_RE = /\s*(?:(?:을|를)\s*)?(?:요청|부탁)\s*(?:하기|드리기|넣기)?\s*$/;
function cleanRequestTitle(title) {
  const t = String(title || '');
  const stripped = t.replace(TITLE_REQ_TAIL_RE, '').trim();
  return stripped.length >= 2 ? stripped : t;
}

module.exports = { memberPool, resolveMention, resolveSaid, findTargets, resolveTargetsInText, isMentioned, cleanRequestTitle, formsOf, ASSIGN_VERB, _norm: norm };
