// 개발 현황 섹션의 **모양을 정하는 한 곳**. 발행(쓰기)과 라우트(읽기)가 같이 부른다.
//
// ★ 2026-09-18 (Irene 신고: "관리자에서 개발현황이 제대로 저장이 안되는데. 내용들이. 다 비어서 나와")
//   저장은 멀쩡했다. `docs/dev-status/next.json` 이 대부분의 섹션을 **문자열 배열**로 적었고
//   화면은 `it.title || it.area || … || '—'` 로 **객체 필드**를 읽었다. 문자열에는 그 속성이 없으니
//   전부 `'—'` 로 떨어졌다 — 건수(3·3·1·3·4)는 맞는데 내용만 비는 모양이었다.
//   발행 검증도 `it.verified` 같은 **선택 필드만** 보고 「항목이 제목을 갖는가」 를 한 번도 안 봤다.
//   조용한 기본값 계열(CLAUDE.md 상태값 규약) — 사용자에게는 "저장이 안 됐다" 로 보인다.
//
// 그래서 **문자열도 정식 입력으로 받는다**(사람이 서술을 쓰는 화면이다). 섹션마다 «대표 키» 가
// 다르므로 그 표를 여기 한 곳에 둔다. 발행 때 정규화하고, 읽을 때도 정규화한다 —
// 읽는 쪽에도 걸어야 **이미 저장된 옛 행**(v1.52.11 등)이 재발행 없이 제대로 보인다.

const SECTION_KEYS = [
  'working_on', 'completed', 'in_progress', 'issues', 'backlog',
  'behavior_changes', 'check_areas', 'migrations', 'blocked_on_human',
  'tooling_health', 'undeployed',
];

// 섹션별 «대표 키» — 화면 RowTitle 이 읽는 필드. 문자열 항목은 이 키로 승격된다.
const PRIMARY_KEY = {
  working_on: 'title',
  completed: 'title',
  in_progress: 'title',
  issues: 'title',
  backlog: 'title',
  behavior_changes: 'title',
  check_areas: 'area',
  migrations: 'script',
  blocked_on_human: 'what',
  tooling_health: 'tool',
  undeployed: 'subject',
};

// 화면이 제목으로 인정하는 키들(대표 키가 무엇이든 하나만 있으면 보인다).
const TITLE_KEYS = ['title', 'area', 'what', 'tool', 'script', 'subject'];

/** 항목 하나를 정규화 — 문자열이면 그 섹션의 대표 키를 가진 객체로 승격한다. */
function normalizeItem(sectionKey, item) {
  if (typeof item === 'string') {
    const text = item.trim();
    return text ? { [PRIMARY_KEY[sectionKey] || 'title']: text } : null;
  }
  if (item && typeof item === 'object' && !Array.isArray(item)) return item;
  // 숫자·불린·배열 등 — 값을 버리지 말고 보이게 싣는다(조용히 사라지는 것이 가장 나쁘다).
  return item === null || item === undefined ? null : { [PRIMARY_KEY[sectionKey] || 'title']: String(item) };
}

/** 항목이 화면에 보일 제목을 갖는가. */
function titleOf(item) {
  if (!item || typeof item !== 'object') return '';
  for (const k of TITLE_KEYS) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * sections 전체를 정규화 — 없는 섹션은 빈 배열로 채운다.
 * 알 수 없는 섹션 키는 **버리지 않고 그대로 통과**시킨다(검증이 따로 알려 준다).
 */
function normalizeSections(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of SECTION_KEYS) {
    const arr = Array.isArray(src[k]) ? src[k] : [];
    out[k] = arr.map((it) => normalizeItem(k, it)).filter(Boolean);
  }
  for (const k of Object.keys(src)) if (!SECTION_KEYS.includes(k)) out[k] = src[k];
  return out;
}

module.exports = { SECTION_KEYS, PRIMARY_KEY, TITLE_KEYS, normalizeItem, normalizeSections, titleOf };
