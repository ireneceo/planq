// 국가 공휴일 데이터셋 생성기 (#424 후속, 2026-10-06) — config/holidays/<CC>.json
//
// ★ 실행 시점에만 date-holidays(devDependency)를 쓴다. 서버는 이 스크립트가 만든 JSON 만 읽는다
//   (services/workspaceHolidays.js DATASETS) — 운영에 라이브러리가 없어도 된다.
// ★ KR 은 만들지 않는다 — 2026 개정(노동절·제헌절)·설 연휴를 라이브러리가 반영하지 못해(실측)
//   손으로 대조한 KR.json 이 정본이다.
// ★ 법정 공휴일(type 'public')만 넣는다. 지역(주·성) 공휴일·중국 조휴(대체 근무일)는 없다 —
//   워크스페이스가 휴일 설정에서 직접 추가·끄기 한다.
//
// 사용: node scripts/gen-holiday-datasets.js [시작연도=올해] [끝연도=시작+1]  — 2029 싱가포르 Vesak 이 빠지는 등 먼 해는 불완전(실측)
const fs = require('fs');
const path = require('path');
const Holidays = require('date-holidays');

const COUNTRIES = ['US', 'JP', 'CN', 'TW', 'HK', 'SG', 'MY', 'VN', 'TH', 'ID', 'PH', 'IN', 'AU', 'NZ', 'GB', 'DE', 'FR', 'CA'];
const from = Number(process.argv[2]) || new Date().getFullYear();
const to = Number(process.argv[3]) || from + 1;
const OUT = path.join(__dirname, '..', 'config', 'holidays');

for (const cc of COUNTRIES) {
  const out = {
    _source: `date-holidays@${require('date-holidays/package.json').version} 로 생성(scripts/gen-holiday-datasets.js, ${new Date().toISOString().slice(0, 10)}). `
      + '법정 공휴일만 — 지역 공휴일·대체 근무일 없음. 정부 발표로 바뀐 날은 워크스페이스가 직접 고친다. 음력·이슬람력 휴일은 먼 해일수록 빠지므로 2년치만 두고 해마다 다시 만든다(KR.json 과 같은 주기).',
  };
  for (let y = from; y <= to; y += 1) {
    const ko = new Holidays(cc).getHolidays(y, 'ko').filter((h) => h.type === 'public');
    const en = new Holidays(cc).getHolidays(y, 'en').filter((h) => h.type === 'public');
    const enByKey = new Map(en.map((h) => [h.date + h.rule, h.name]));
    const seen = new Set();
    out[String(y)] = ko.map((h) => {
      const date = h.date.slice(0, 10);
      const nameEn = enByKey.get(h.date + h.rule) || h.name;
      return { date, name: h.name, name_en: nameEn, kind: 'generated' };
    }).filter((h) => (seen.has(h.date) ? false : (seen.add(h.date), true)));   // 같은 날 두 행 금지(UNIQUE biz+date)
  }
  fs.writeFileSync(path.join(OUT, `${cc}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(cc, Object.keys(out).filter((k) => k !== '_source').map((y) => `${y}:${out[y].length}`).join(' '));
}
