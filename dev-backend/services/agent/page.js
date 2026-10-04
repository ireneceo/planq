// AI 에이전트 도구 — 페이지 규약 **한 벌** (#439 M3-a, 설계 docs/AI_AGENT_M3_DESIGN.md §4.0).
//
//   입력:  page (1-base, 기본 1) · page_size (기본 20, ≤50)   — 옛 `limit` 은 page_size 의 별칭으로 받는다
//          (M1·M2 에 연결된 클라이언트는 옛 스키마를 캐시하고 있다 — 지우면 .strict() 가 그 호출을 거절한다).
//   출력:  { items, page, page_size, total, has_more, next_page, truncated }
//          total 은 셀 수 있으면 숫자, 여러 원천을 합친 목록이면 null. truncated = has_more(옛 이름 호환).
const { z } = require('zod');

const MAX_PAGE_SIZE = 50;
const LIST_SUFFIX = ' Returns one page; call again with next_page to continue.';

const pageInput = {
  page: z.number().int().min(1).max(1000).optional().describe('Page number, 1-based (default 1)'),
  page_size: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`Items per page (default 20, max ${MAX_PAGE_SIZE})`),
};

function parsePage(a, { defaultSize = 20, maxSize = MAX_PAGE_SIZE } = {}) {
  const page = Math.max(1, Number(a?.page) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number(a?.page_size || a?.limit) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 셀 수 있는 목록 — total 로 has_more 를 정한다. */
function pageOf(items, total, { page, pageSize }) {
  const hasMore = page * pageSize < total;
  return { items, page, page_size: pageSize, total, has_more: hasMore, next_page: hasMore ? page + 1 : null, truncated: hasMore };
}

/** 셀 수 없는 목록 — pageSize+1 개를 읽어 넘치면 has_more. */
function pageOfProbe(rows, { page, pageSize }) {
  const hasMore = rows.length > pageSize;
  const items = rows.slice(0, pageSize);
  return { items, page, page_size: pageSize, total: null, has_more: hasMore, next_page: hasMore ? page + 1 : null, truncated: hasMore };
}

/** 긴 본문 자르기 — 잘렸으면 호출부가 truncated_fields 를 싣는다. */
function clip(text, max) {
  const s = text == null ? '' : String(text);
  return { text: s.length > max ? s.slice(0, max) : s, total: s.length, cut: s.length > max };
}

module.exports = { pageInput, parsePage, pageOf, pageOfProbe, clip, LIST_SUFFIX, MAX_PAGE_SIZE };
