// services/kbFields.js — Q info(kb_documents) 입력 정규화 헬퍼 **한 벌** (2026-10-07 routes/kb.js 에서 옮김).
//
//   화면 라우트(routes/kb.js)와 행동 계층(services/actions/kb_actions — AI 에이전트 create_knowledge_item)이 같은 함수를 쓴다.
//   베껴 두면 카테고리·공개 범위·색인 본문 합성 규칙이 한쪽에서만 바뀐다. 내용은 옮기기만 했다(동작 무변경).
const { KbCategory } = require('../models');

// ─── N+64: 카테고리 + visibility 통합 헬퍼 ───────────────────
// 카테고리: 자유 string (40자 cap). categories JSON 우선, category 컬럼은 ENUM 호환 위해 'manual' fallback 또는 ENUM-match.
// vlevel: L1/L2/L3/L4 + target_member_ids — 라우트가 항상 vlevel 채움.
const LEGACY_CAT_ENUM = ['policy','manual','incident','faq','about','pricing'];
function sanitizeCategories(input) {
  if (input === null) return null;
  if (!Array.isArray(input)) return undefined;
  const cleaned = input.map(c => String(c || '').trim().slice(0, 40)).filter(Boolean);
  // dedup
  return Array.from(new Set(cleaned));
}
function pickLegacyCategoryEnum(categories) {
  if (!Array.isArray(categories)) return 'manual';
  const match = categories.find(c => LEGACY_CAT_ENUM.includes(c));
  return match || 'manual';
}
// 새 categories 가 들어오면 KbCategory 마스터 row 자동 upsert (사용자가 자유 추가한 카테고리도 마스터에 박제 → 다음 등록 시 추천)
// #316 — 후보(AI·CSV)의 임의 필드를 Q info 항목(custom_columns / custom_values)으로 정규화한다.
//
//   AI 는 { fields: {서비스명: "...", 링크: "..."} } 또는 { custom_values: {...} } 로 낸다.
//   CSV 는 title/body 외 남은 열이 그대로 항목이 된다(#319).
//   여태 이 배관이 없어 표형 자료가 body 덩어리로 뭉쳤다.
//
//   타입 추론은 보수적으로 — 값 모양만 보고 url/email 을 잡고, 비밀번호성 이름이면 secret 으로.
//   secret 으로 잡히면 색인 본문에서 값이 제외된다(문서 생성 경로의 규칙과 같다).
const SECRET_NAME_RE = /(비밀번호|패스워드|password|passwd|pw|secret|api[\s_-]?key|token|토큰|시크릿|인증키)/i;
function inferColumnType(name, value) {
  const v = String(value == null ? '' : value).trim();
  if (SECRET_NAME_RE.test(String(name || ''))) return 'secret';
  if (/^https?:\/\//i.test(v)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (v.includes('\n')) return 'longtext';
  return 'text';
}
function normalizeCandidateFields(c) {
  const src = (c && typeof c === 'object')
    ? (c.custom_values && typeof c.custom_values === 'object' ? c.custom_values
      : (c.fields && typeof c.fields === 'object' ? c.fields : null))
    : null;
  if (!src) return { columns: [], values: {} };

  // 후보가 columns 를 같이 주면 그 이름·타입을 존중한다.
  const given = Array.isArray(c.custom_columns) ? c.custom_columns : [];
  const byName = new Map(given.filter(g => g && g.name).map(g => [String(g.name), g]));

  const columns = [];
  const values = {};
  let i = 0;
  for (const [rawName, rawVal] of Object.entries(src)) {
    const name = String(rawName || '').trim().slice(0, 60);
    if (!name) continue;
    if (rawVal == null || String(rawVal).trim() === '') continue;
    if (columns.length >= 30) break;                 // 항목 폭주 방지
    i += 1;
    const g = byName.get(name);
    const id = (g && g.id) ? String(g.id) : `c${i}`;
    const type = (g && g.type) ? String(g.type) : inferColumnType(name, rawVal);
    columns.push({ id, name, type, show_in_list: g ? g.show_in_list !== false : columns.length < 4 });
    values[id] = String(rawVal).slice(0, 5000);
  }
  return { columns, values };
}

/**
 * #332 — 항목만 있는 정보의 색인 본문을 항목에서 합성한다. **공식은 여기 하나뿐이다.**
 *   ★ secret 타입 항목의 값은 절대 넣지 않는다 — 색인 본문은 임베딩·번역 API 로 나간다(#318).
 *     항목명(라벨)만 남겨 "이 정보에 비밀번호 항목이 있다" 까지는 검색되게 한다.
 *   생성(POST)과 항목 변경(PUT) 이 같은 함수를 부른다 — 베껴 두면 반드시 갈라진다.
 *   항목이 하나도 없으면 '' 을 돌려준다(부르는 쪽이 판단한다).
 */
function synthesizeBodyFromColumns(title, customColumns, customValues) {
  const cols = Array.isArray(customColumns) ? customColumns : [];
  const vals = (customValues && typeof customValues === 'object') ? customValues : {};
  const lines = [];
  for (const c of cols) {
    if (!c || !c.id) continue;
    const raw = vals[c.id];
    if (raw == null || String(raw).trim() === '') continue;
    const label = String(c.name || c.id).trim();
    if (c.type === 'secret') lines.push(label);            // 라벨만 — 값 제외
    else lines.push(`${label}: ${String(raw).trim()}`);
  }
  if (lines.length === 0) return '';
  return `${String(title || '').trim()}\n${lines.join('\n')}`;
}

async function upsertKbCategories(businessId, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return;
  for (const name of categories) {
    try {
      await KbCategory.findOrCreate({
        where: { business_id: businessId, name },
        defaults: { business_id: businessId, name, sort_order: 0 }
      });
    } catch (_) { /* unique 충돌 무시 */ }
  }
}
// visibility 입력 → DB 컬럼 매핑
// req.body 의 vlevel, target_member_ids, project_id, client_id, client_ids 를 받아
// scope/read_policy/project_id/client_id/client_ids/vlevel/target_member_ids 풀세트 반환
function resolveVisibility(body) {
  const inVlevel = body.vlevel;
  if (!['L1','L2','L3','L4'].includes(inVlevel)) return null;  // vlevel 없으면 legacy scope 로 fallback
  const out = {
    vlevel: inVlevel,
    target_member_ids: null,
    scope: 'workspace',
    read_policy: 'all',
    project_id: null,
    client_id: null,
    client_ids: null,
  };
  if (inVlevel === 'L1') {
    out.scope = 'private';
  } else if (inVlevel === 'L2') {
    if (body.project_id) {
      out.scope = 'project';
      out.project_id = Number(body.project_id) || null;
    } else if (Array.isArray(body.target_member_ids) && body.target_member_ids.length > 0) {
      out.scope = 'workspace';
      out.read_policy = 'owner'; // legacy 호환 — 멤버 지정은 owner-only 영역에 가까움
      out.target_member_ids = body.target_member_ids.map(Number).filter(Boolean);
    } else {
      // L2 인데 target 없음 — 프로젝트도 멤버도 미지정. 일단 workspace 로 fallback (라우트가 400 처리해도 됨)
      out.scope = 'workspace';
    }
  } else if (inVlevel === 'L3') {
    out.scope = 'workspace';
  } else if (inVlevel === 'L4') {
    out.scope = 'client';
    if (Array.isArray(body.client_ids) && body.client_ids.length > 0) {
      out.client_ids = body.client_ids.map(Number).filter(Boolean);
      out.client_id = out.client_ids[0]; // legacy single 호환
    } else if (body.client_id) {
      out.client_id = Number(body.client_id) || null;
      out.client_ids = out.client_id ? [out.client_id] : null;
    }
  }
  return out;
}

module.exports = {
  LEGACY_CAT_ENUM, sanitizeCategories, pickLegacyCategoryEnum, SECRET_NAME_RE, inferColumnType,
  normalizeCandidateFields, synthesizeBodyFromColumns, upsertKbCategories, resolveVisibility,
};
