// #215 Fable — H(#226/#200) 무회귀 픽스처 검증 (실 DOMPurify, 검증 후 삭제)
//   함수 본문은 MailPage.tsx(신) / git 74f794c(구) 에서 런타임 추출 — 사본 괴리 차단.
const fs = require('fs');
const { execSync } = require('child_process');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

let PASS = 0, FAIL = 0;
const check = (name, ok, extra) => {
  if (ok) { PASS++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { FAIL++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

function extractFn(src) {
  const start = src.indexOf('function buildMailSrcDoc');
  const end = src.indexOf('\n}', start);
  let fn = src.slice(start, end + 2);
  // TS 어노테이션 제거 (시그니처 + 로컬 타입)
  fn = fn
    .replace('(id: number, html: string, cidMap?: Record<string, string>): string', '(id, html, cidMap)')
    .replace('(id: number, html: string): string', '(id, html)')
    .replace('const spans: number[] = []', 'const spans = []');
  return fn;
}

(async () => {
  const cur = fs.readFileSync('/opt/planq/dev-frontend/src/pages/QMail/MailPage.tsx', 'utf8');
  const old = execSync('git -C /opt/planq show 74f794c:dev-frontend/src/pages/QMail/MailPage.tsx', { maxBuffer: 64 * 1024 * 1024 }).toString();
  const newFn = extractFn(cur);
  const oldFn = extractFn(old).replace('function buildMailSrcDoc', 'function buildMailSrcDocOld');
  if (!/cidMap/.test(newFn)) throw new Error('신 함수 추출 실패');
  if (/cidMap/.test(oldFn)) throw new Error('구 함수 추출 실패(cidMap 이 이미 있음?)');

  const purify = fs.readFileSync('/opt/planq/dev-frontend/node_modules/dompurify/dist/purify.min.js', 'utf8');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: purify });
  // sanitizeMailHtml — utils/sanitizeHtml.ts 의 설정 그대로 (파일 무변경은 git diff 로 별도 증명됨)
  await page.addScriptTag({ content: `
    const NON_URI_VALUE = '[^a-z]|[a-z+.\\\\-]+(?:[^a-z+.\\\\-:]|$)';
    const MAIL_URI_RE = new RegExp('^(?:https?:|mailto:|tel:|cid:|/|#|data:image/|' + NON_URI_VALUE + ')', 'i');
    window.sanitizeMailHtml = function (value) {
      if (!value) return '';
      return DOMPurify.sanitize(value, {
        WHOLE_DOCUMENT: true,
        ADD_TAGS: ['style'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base'],
        FORBID_ATTR: ['srcdoc', 'formaction'],
        ALLOWED_URI_REGEXP: MAIL_URI_RE,
      });
    };
  ` });
  page.on('pageerror', e => console.log('  [page error]', e.message));
  await page.addScriptTag({ content: 'const sanitizeMailHtml = window.sanitizeMailHtml;\n' + newFn + '\n' + oldFn + '\nwindow.buildNew = buildMailSrcDoc; window.buildOld = buildMailSrcDocOld;' });

  // #226 재현 표본 — align/width/colspan/height + cid 3형(쌍따옴표/홑따옴표/대소문자 섞임)
  const fixture = `<html><head><style>.x{color:#333}</style></head><body bgcolor="#f4f4f4">
    <table align="center" width="600" cellpadding="0"><tr><td colspan="2" align="center">
      <img src="cid:LOGO.png@x" width="120" height="40" alt="logo">
      <img src='cid:Photo.2$a+b@mail' width="300">
      <p>부가세 안내 &amp; 납부 <a href="https://hometax.go.kr">홈택스</a></p>
    </td></tr></table></body></html>`;

  const r = await page.evaluate((fx) => {
    const out = {};
    out.noMapNew = window.buildNew(7, fx, undefined);
    out.noMapNewEmpty = window.buildNew(7, fx, {});
    out.old = window.buildOld(7, fx);
    const dataUri = 'data:image/png;base64,AAAABBBB';
    out.sub = window.buildNew(7, fx, { 'logo.png@x': dataUri, 'photo.2$a+b@mail': 'data:image/jpeg;base64,CCCC' });
    out.dataUri = dataUri;
    // 반증: sanitize **앞** 치환 변형 — & 포함 data URI 로 직렬화 차이 유도
    const uriAmp = 'data:image/svg+xml,%3Csvg%3E&x=1';
    const pre = fx.split('cid:LOGO.png@x').join(uriAmp);
    out.beforeSub = window.buildNew(7, pre, undefined);           // sanitize(치환된 원문)
    const safeAfter = window.buildNew(7, fx, { 'logo.png@x': uriAmp }); // 치환은 sanitize 뒤
    out.afterSub = safeAfter;
    return out;
  }, fixture);

  console.log('[T1] #226/#200 — presentational 속성 생존 (sanitize 출력)');
  check('align="center" 생존', r.noMapNew.includes('align="center"'));
  check('width="600" 생존', r.noMapNew.includes('width="600"'));
  check('colspan="2" 생존', r.noMapNew.includes('colspan="2"'));
  check('img height="40" 생존 (#200)', r.noMapNew.includes('height="40"'));
  check('guard CSS(#200 img 규칙) 포함', r.noMapNew.includes('img:not([height]):not([width])'));
  check('base target=_blank 주입', r.noMapNew.includes('<base target="_blank"'));

  console.log('[T2] cidMap 미전달 시 옛 코드와 byte-identical');
  check('new(undefined) === old', r.noMapNew === r.old, `len ${r.noMapNew.length} vs ${r.old.length}`);
  check('new({}) === old', r.noMapNewEmpty === r.old);

  console.log('[T3] 치환 정확성 — cid 스팬 외 0 byte 차이');
  check('dataUri 삽입됨', r.sub.includes(r.dataUri));
  check('cid:logo 잔존 없음', !/cid:logo\.png@x/i.test(r.sub));
  check('메타문자 cid(.$+) 치환됨', !/cid:photo\.2\$a\+b@mail/i.test(r.sub) && r.sub.includes('data:image/jpeg;base64,CCCC'));
  const restored = r.sub.split(r.dataUri).join('cid:LOGO.png@x').split('data:image/jpeg;base64,CCCC').join("cid:Photo.2$a+b@mail");
  check('치환 역산 = 미치환 출력 (스팬 외 0 byte)', restored === r.noMapNew, `len ${restored.length} vs ${r.noMapNew.length}`);

  console.log('[T4] 반증 — sanitize 앞 치환이면 출력이 달라져 검사가 잡는가');
  check('before-sanitize ≠ after-sanitize (가드 변별력)', r.beforeSub !== r.afterSub,
    r.beforeSub === r.afterSub ? '동일 — 가드 변별 실패' : `before ${r.beforeSub.length}B vs after ${r.afterSub.length}B`);
  const ampIdx = r.beforeSub.indexOf('&x=1');
  const ampIdx2 = r.beforeSub.indexOf('&amp;x=1');
  console.log(`    (before 치환본: &x=1 raw=${ampIdx !== -1} entity-escaped=${ampIdx2 !== -1})`);

  await browser.close();
  console.log(`\n════ 픽스처 결과: PASS ${PASS} / FAIL ${FAIL} ════`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('오류:', e); process.exit(2); });
