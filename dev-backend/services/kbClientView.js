// services/kbClientView.js — Q info 를 **팀 밖**(고객 홈·공개 링크)으로 내보낼 때의 모양 한 벌
//   (2026-10-23, Fable 설계 docs/CLIENT_QINFO_VIEW_DESIGN.md ②)
//
// ★ 지울 것을 열거하지 않고 **남길 것만 남긴다**(화이트리스트). 컬럼이 늘어도 새지 않는다.
// ★ 비밀(secret) 칸은 라벨까지 뺀다 — CSV 내보내기·색인·Cue 문맥과 같은 선. 공개 링크(by-token)가
//   «살아 있는 칸이면 값 그대로» 실어 secret 값이 나가던 구멍도 이 함수로 막는다.

// 살아 있는 칸(정의에 있는 칸) 중 비밀이 아닌 것만 — 칸 객체는 {id, name, type} 세 키
function publicColumns(doc) {
  const cols = Array.isArray(doc && doc.custom_columns) ? doc.custom_columns : [];
  return cols
    .filter((c) => c && c.id && c.type !== 'secret')
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

// 위 칸의 값만 — 지운 칸의 고아 값·예약키(auto_indexed 등)는 자동으로 빠진다
function publicValues(doc, cols = publicColumns(doc)) {
  const raw = (doc && doc.custom_values && typeof doc.custom_values === 'object') ? doc.custom_values : {};
  const out = {};
  for (const c of cols) {
    if (Object.prototype.hasOwnProperty.call(raw, c.id)) out[c.id] = raw[c.id];
  }
  return out;
}

const tsOf = (doc, a, b) => (doc[a] !== undefined ? doc[a] : doc[b]) || null;

// 고객 홈 목록 한 줄
function kbClientListRow(doc) {
  const cols = publicColumns(doc);
  const vals = publicValues(doc, cols);
  return {
    id: doc.id,
    title: doc.title,
    created_at: tsOf(doc, 'createdAt', 'created_at'),
    updated_at: tsOf(doc, 'updatedAt', 'updated_at'),
    has_body: !!(doc.body && String(doc.body).trim()),
    item_count: cols.filter((c) => vals[c.id] != null && String(vals[c.id]).trim() !== '').length,
  };
}

// 고객 홈 상세 — 본문은 그대로(화면이 sanitizeRichText 로 정화) + 비밀 아닌 칸
function kbClientDetail(doc) {
  const cols = publicColumns(doc);
  return {
    ...kbClientListRow(doc),
    body: doc.body || '',
    custom_columns: cols,
    custom_values: publicValues(doc, cols),
  };
}

// 목록 쿼리에 실을 칸(본문은 has_body 판정에만 쓴다)
const CLIENT_LIST_ATTRIBUTES = ['id', 'title', 'body', 'custom_columns', 'custom_values', 'created_at', 'updated_at'];

module.exports = { publicColumns, publicValues, kbClientListRow, kbClientDetail, CLIENT_LIST_ATTRIBUTES };
