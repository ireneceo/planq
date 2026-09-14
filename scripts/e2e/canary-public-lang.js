// scripts/e2e/canary-public-lang.js — **공개(무인증) 화면은 보는 사람의 브라우저 언어를 따른다** (2026-09-14)
//
// Irene: *"웹 미리보기 보는 고객사 브라우저가 영어면 영어기준으로, 한글이면 한글 기준으로 나오게 하고 있어?"*
//
// 실측 배경: 감지(navigator) 자체는 되고 있었는데, 공개 화면의 문구 **95건**이 ko/en 어느 쪽에도
//   키가 없어 소스의 **한국어 기본값**으로 떨어졌다. 영어 브라우저로 링크를 연 고객은 한국어를 봤다.
//   패리티 가드는 이걸 못 잡는다 — "ko 에만 있고 en 에 없는" 것이 아니라 **양쪽 다 없는** 부채라서다.
//
// ★ 하니스 함정 (실제로 걸렸다): 언어마다 **브라우저를 새로 띄워야 한다.**
//   한 인스턴스를 재사용하면 앞 언어가 남긴 localStorage `i18nextLng` 를 같은 출처에서 그대로 읽어
//   감지가 아니라 **앞 검사의 잔재**를 잰다 — ko 판정 4건이 전부 거짓 FAIL 로 나왔다.
//   그리고 `--lang` 플래그 없이 navigator 만 덮으면 감지가 안 붙는다. 둘 다 준다.
//
// 재는 것: 없는 토큰의 "링크 없음" 화면(데이터를 만들지 않는다)에서
//   ① 영어 브라우저 → 화면에 한글 0자 · `<html lang>` = en
//   ② 한국어 브라우저 → 화면이 한국어 · `<html lang>` = ko   ← 음성 대조군 역할
//   ③ 서버 코드(`not_found_or_expired` 같은)가 고객 화면에 그대로 노출되지 않는다
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const PAGES = [
  '/public/posts/none-xyz',
  '/public/tasks/none-xyz',
  '/public/qnote-sessions/none-xyz',
  '/public/calendar/none-xyz',
  '/public/kb/none-xyz',
  '/public/files/none-xyz',
];
const HANGUL = /[가-힣]/;
const RAW_CODE = /\b[a-z]+(_[a-z0-9]+){2,}\b/;   // not_found_or_expired 류

async function readPage(lang, path) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', `--lang=${lang}`],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
    await page.evaluateOnNewDocument((l) => {
      Object.defineProperty(navigator, 'language', { get: () => l });
      Object.defineProperty(navigator, 'languages', { get: () => [l, l.split('-')[0]] });
    }, lang);
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(30000);
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 5000));
    // ★ `return await` — await 없이 반환하면 finally 의 browser.close() 가 **먼저** 돌아
    //   evaluate 가 ProtocolError(Target closed) 로 죽는다. 실제로 그렇게 터졌다.
    return await page.evaluate(() => ({
      lang: document.documentElement.lang,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
    }));
  } finally { await browser.close(); }
}

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, ok, detail });

  const en = [];
  const ko = [];
  for (const p of PAGES) en.push([p, await readPage('en-US', p)]);
  for (const p of PAGES) ko.push([p, await readPage('ko-KR', p)]);

  const enEmpty = en.filter(([, r]) => !r.text);
  push('⓪ 공개 화면이 실제로 그려진다 (빈 화면으로 거짓 통과하지 않게)',
    enEmpty.length === 0, enEmpty.length ? `빈 화면: ${enEmpty.map(([p]) => p).join(', ')}` : `${en.length}개 화면 렌더됨`);

  const enKo = en.filter(([, r]) => HANGUL.test(r.text));
  push('① 영어 브라우저에 한국어가 새지 않는다',
    enKo.length === 0,
    enKo.length ? enKo.map(([p, r]) => `${p}: ${r.text.slice(0, 50)}`).join(' | ') : `${en.length}개 화면 전부 영어`);

  const enLang = en.filter(([, r]) => r.lang !== 'en');
  push('①-b <html lang> 이 en',
    enLang.length === 0, enLang.length ? JSON.stringify(enLang.map(([p, r]) => `${p}=${r.lang}`)) : 'en');

  // ★ 음성 대조군 — 한국어 브라우저에서 한국어가 나와야 "영어로 나온 것"이 감지의 결과임이 증명된다.
  //   (en 은 fallbackLng 라, 영어만 재면 감지가 죽어 있어도 통과한다.)
  const koNotKo = ko.filter(([, r]) => !HANGUL.test(r.text));
  push('② 한국어 브라우저에는 한국어가 나온다 (음성 대조군)',
    koNotKo.length === 0,
    koNotKo.length ? koNotKo.map(([p, r]) => `${p}: ${r.text.slice(0, 50)}`).join(' | ') : `${ko.length}개 화면 전부 한국어`);

  const koLang = ko.filter(([, r]) => r.lang !== 'ko');
  push('②-b <html lang> 이 ko',
    koLang.length === 0, koLang.length ? JSON.stringify(koLang.map(([p, r]) => `${p}=${r.lang}`)) : 'ko');

  const raw = [...en, ...ko].filter(([, r]) => RAW_CODE.test(r.text));
  push('③ 서버 코드가 고객 화면에 그대로 노출되지 않는다',
    raw.length === 0,
    raw.length ? raw.map(([p, r]) => `${p}: ${(r.text.match(RAW_CODE) || [''])[0]}`).join(' | ') : '코드 노출 0건');

  return results;
}

module.exports = { name: '공개 화면 언어 — 보는 사람의 브라우저를 따른다 (ko/en 양방향)', run };
