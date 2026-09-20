// Q mail 목록의 「문의」 표시 — **Q sale 유입 술어를 그대로** 읽는다.
//
// Irene 2026-09-20 (#421): *"[문의] 와 같은 다른 태그 필요한 거 없어?"* → 넣되,
// 무엇을 문의로 볼지는 이미 정해져 있다(`services/saleMailCriteria.mailThreadVerdict`).
// 여기서 키워드로 다시 가르지 않는다 — CLAUDE.md 가 적어 둔 대로 그 길은 두 번 걸었고 두 번 다 샜다.
// 판정은 `saleInbox.classifyMailThreads` **한 함수**가 하고, 이 파일은 **캐시만** 한다.
//
// 왜 캐시가 필요한가: 그 함수는 워크스페이스의 사람 스레드를 통째로 분류한다(상한 5000).
// 메일 목록은 한 페이지(수십 건)만 필요한데 매 요청마다 전체를 돌리면 비싸다.
// 반대로 페이지만 따로 판정하면 **술어가 두 벌**이 된다(그게 이 규칙이 막으려는 것이다).
// 그래서 결과를 짧게 캐시하고 페이지 id 로 교집합만 낸다.
const TTL_MS = 30 * 1000;
const cache = new Map();   // key: `${businessId}:${userId}` → { at, ids: Set }

async function inquiryIdSet(businessId, userId) {
  const key = `${businessId}:${userId || 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
  try {
    const { classifyMailThreads } = require('./saleInbox');
    const { inquiryIds } = await classifyMailThreads(businessId, { userId });
    const ids = new Set(inquiryIds);
    cache.set(key, { at: Date.now(), ids });
    // 워크스페이스가 늘어도 이 맵이 무한히 자라지 않게 — 오래된 것부터 버린다.
    if (cache.size > 200) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
      for (const [k] of oldest) cache.delete(k);
    }
    return ids;
  } catch (err) {
    // ★ 표시를 못 만들어도 **목록은 그대로 나가야 한다.** 부가 정보 하나 때문에 메일함이
    //   비면 그게 훨씬 큰 고장이다(검색 하이라이트와 같은 방침).
    console.error('[mail-inquiry-tag] err:', err.message);
    return null;
  }
}

/** 이 페이지의 행들에 `is_inquiry` 를 붙인다. 판정을 못 했으면 **아무 것도 붙이지 않는다**
 *  (false 를 붙이면 "문의가 아니다" 라고 단언하는 것이라 거짓이 된다). */
async function attachInquiryFlag(rows, { businessId, userId }) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const ids = await inquiryIdSet(businessId, userId);
  if (!ids) return;
  for (const r of rows) r.is_inquiry = ids.has(r.id);
}

module.exports = { attachInquiryFlag, inquiryIdSet };
