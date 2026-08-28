// MailPage 의 두 함수를 그대로 옮겨 검증 (구현과 같은 렌즈)
function guessLangFromText(text) {
  const t = String(text || '').slice(0, 400);
  if (!t.trim()) return '';
  if (/[가-힣]/.test(t)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(t)) return 'ja';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[A-Za-z]/.test(t)) return 'en';
  return '';
}
function pickTranslateTarget(sourceLang, uiLang) {
  const ui = uiLang?.startsWith('en') ? 'en' : 'ko';
  if (!sourceLang) return ui;
  if (sourceLang !== ui) return ui;
  return ui === 'en' ? 'ko' : 'en';
}
const CASES = [
  ['한글 시험: 새 사용자 등록 · 사용자명 · 이메일 · 확인 부탁드립니다.', 'ko', 'ko', 'en', 'Irene 신고 사례'],
  ['Please confirm the new user registration.',                        'en', 'ko', 'ko', '영어 메일 · 한국어 UI'],
  ['Please confirm the new user registration.',                        'en', 'en', 'ko', '영어 메일 · 영어 UI'],
  ['한글 메일입니다',                                                    'ko', 'en', 'en', '한국어 메일 · 영어 UI'],
  ['ご確認をお願いいたします',                                            'ja', 'ko', 'ko', '일본어 메일'],
  ['请确认新用户注册',                                                    'zh', 'ko', 'ko', '중국어 메일'],
  ['',                                                                  '',   'ko', 'ko', '빈 본문 → UI 언어'],
];
let fail = 0;
console.log('원문추정 / 대상선택 검사:');
for (const [text, expSrc, ui, expTarget, label] of CASES) {
  const src = guessLangFromText(text);
  const tgt = pickTranslateTarget(src, ui);
  const ok = src === expSrc && tgt === expTarget;
  if (!ok) fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(22)} 추정=${(src||'-').padEnd(3)} UI=${ui} → 대상=${tgt} (기대 ${expTarget})`);
}
console.log(`\n검사 ${CASES.length}개 · 실패 ${fail}`);
console.log(fail === 0 ? '✅ 같은 언어로 번역하는 경우 0건' : '🔴 실패');
process.exit(fail ? 1 : 0);
