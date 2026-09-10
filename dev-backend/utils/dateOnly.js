// DATEONLY 값 정규화 — **단일 원천.**
//
// ★ 왜 필요한가: Sequelize 의 DATEONLY 는 환경에 따라 **문자열('2026-10-10')로도 Date 객체로도**
//   온다(dev/운영 드라이버 차이). 그래서 `String(v).slice(0,10)` 같은 손 정규화는 Date 가 오는
//   순간 `"Sat Oct 1"` 이 되어 조용히 틀린다 — 비교가 항상 거짓이 되고, "같은 값인데 또 저장"
//   같은 증상으로 나타난다(2026-09-10 실제로 그랬다).
//   health-check 에 `DATEONLY 비교 전 정규화` 항목이 있는 이유다.
//
// ★ 이 함수를 **비교·저장 전에 반드시 통과**시킨다. services/recurringTaskGenerator.js 가
//   같은 함수를 지역 선언해 쓰고 있었고, 다른 곳은 그것을 못 써서 각자 손으로 썼다.

/** @param {string|Date|null|undefined} v @returns {string|null} 'YYYY-MM-DD' */
function dateOnlyOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

module.exports = { dateOnlyOf };
