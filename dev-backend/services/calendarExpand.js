// 반복 일정 펼치기 한 벌 (2026-11-05 — routes/calendar.js GET 목록 안에 있던 것을 그대로 옮김).
//   캘린더 화면과 AI 앱(list_events)이 같은 회차를 본다. 옛 AI 도구는 원본 1건만 돌려줘 «이번 주 일정» 에서
//   주간 회의가 빠지거나 1월 날짜로 나왔다(점검 실측).
//   입력 = 원본 행 JSON(반복 원본·보통 일정·예외 자식 섞여도 됨) + 범위 안 예외 자식 JSON · 출력 = 화면 목록과 같은 모양.
const { rrulestr } = require('rrule');
const allDay = require('../utils/allDayDate');

function expandRecurring(rawJsons, exceptionChildJsons, start, end) {
  const exceptionByParentDate = new Map();
  for (const child of exceptionChildJsons) {
    exceptionByParentDate.set(`${child.recurrence_parent_id}_${child.recurrence_id}`, child);
  }
  const events = [];
  for (const json of rawJsons) {
    // child (exception) 는 master expansion 안에서 대체 — 단독으로 push 하지 않음 (중복 방지)
    if (json.recurrence_parent_id) continue;
    if (!json.rrule) { events.push(json); continue; }
    try {
      const dur = new Date(json.end_at).getTime() - new Date(json.start_at).getTime();
      const ruleSrc = json.rrule.startsWith('RRULE:') || json.rrule.startsWith('DTSTART') ? json.rrule : `RRULE:${json.rrule}`;
      const rule = rrulestr(ruleSrc, { dtstart: new Date(json.start_at) });
      // 종일은 UTC 자정 부호화 날짜라(utils/allDayDate) 회차 «시작» 이 워크스페이스 벽시계 범위보다 최대 반나절 앞뒤로 어긋난다 —
      //   서쪽 시간대에서 범위 첫날 회차가 빠졌다(Fable 실측, 호놀룰루). 하루씩 넓혀 펼치고 화면이 날짜로 자른다.
      const wide = json.all_day ? allDay.DAY_MS : 0;
      const instances = rule.between(new Date(start.getTime() - wide), new Date(end.getTime() + wide), true);
      // exception_dates set (YYYY-MM-DD) — EXDATE 처리
      const exDates = new Set((Array.isArray(json.exception_dates) ? json.exception_dates : []).map((d) => String(d).slice(0, 10)));
      for (const inst of instances) {
        const instDate = inst.toISOString().slice(0, 10);
        if (exDates.has(instDate)) {
          const child = exceptionByParentDate.get(`${json.id}_${instDate}`);
          if (child) events.push({ ...child, _is_exception: true, _parent_event_id: json.id });
          continue;
        }
        events.push({
          ...json,
          start_at: inst.toISOString(),
          end_at: new Date(inst.getTime() + dur).toISOString(),
          _instance_key: `${json.id}_${instDate}`,
          _parent_event_id: json.id,
        });
      }
    } catch (err) {
      console.error('rrule expansion failed', json.id, err.message);
      events.push(json);
    }
  }
  // exception child 가 master 범위 밖이라 위 loop 에서 안 잡힌 경우 별도 push
  for (const cjson of exceptionChildJsons) {
    const alreadyAdded = events.some((e) => e._is_exception && e.id === cjson.id);
    if (!alreadyAdded) events.push({ ...cjson, _is_exception: true, _parent_event_id: cjson.recurrence_parent_id });
  }
  return events;
}

module.exports = { expandRecurring };
