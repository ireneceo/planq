// AI 후보의 recurrence('none'|'daily'|'weekly'|'monthly') → RRULE 문자열.
//
// ★ 프론트 `utils/recurrence.ts buildPresetRRule` 과 **같은 규칙**이어야 한다.
//   AI 로 만든 정기업무와 손으로 만든 정기업무가 다른 문자열을 쓰면, 같은 "매주" 인데
//   드로어에서 열었을 때 preset 이 custom 으로 잡히거나 편집 저장 시 규칙이 바뀐다.
//   규칙(프론트와 동일):
//     daily   → FREQ=DAILY
//     weekly  → FREQ=WEEKLY;BYDAY=<기준일 요일>
//     monthly → FREQ=MONTHLY;BYMONTHDAY=<기준일 일자>
//   종료 조건은 붙이지 않는다(무기한) — 후보 단계에서 사용자가 종료를 지정할 방법이 없다.
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function rruleFromRecurrence(recurrence, anchorDate) {
  const kind = String(recurrence || 'none').toLowerCase();
  if (!['daily', 'weekly', 'monthly'].includes(kind)) return null;
  if (!anchorDate) return null;                 // 마감일이 첫 발생일 — 없으면 반복 불가
  const d = new Date(`${anchorDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  switch (kind) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekly': return `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[d.getUTCDay()]}`;
    case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${d.getUTCDate()}`;
    default: return null;
  }
}

module.exports = { rruleFromRecurrence };
