// PlanQ 데스크탑 앱 — 전역 단축키 «빠른 업무 추가» 형식 검증 (2단계 C · docs/DESKTOP_APP_PHASE2.md §4-3)
//   ★ 검증은 main 이 한다(렌더러 값을 믿지 않는다). 수식키 Ctrl/Cmd/Alt 중 하나가 **필수** —
//     수식키 없는 키(«A»·«Space»)나 Shift 만 붙은 키를 전역으로 잡으면 다른 프로그램에서 그 글자를 칠 수 없게 된다.
//   ★ Ctrl/Cmd 하나 + 글자·숫자(Ctrl+C·Ctrl+V…)도 거절 — 복사·붙여넣기 같은 흔한 키를 컴퓨터 전체에서 빼앗는다.
'use strict';

const DEFAULT_ACCEL = 'CommandOrControl+Shift+Space';

// 표기 → 정본 이름
const MODS = {
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
  command: 'Command', cmd: 'Command',
  control: 'Control', ctrl: 'Control',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
};
const PRIMARY = new Set(['CommandOrControl', 'Command', 'Control', 'Alt']);   // 이 중 하나는 꼭 있어야 한다
const NAMED_KEYS = new Map([
  'Space', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Up', 'Down', 'Left', 'Right', 'Plus',
].map((k) => [k.toLowerCase(), k]));
const PUNCT = new Set([';', '=', ',', '-', '.', '/', '`', '[', ']', '\\', "'"]);

function normKey(k) {
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(k);
  if (f) return `F${f[1]}`;
  if (PUNCT.has(k)) return k;
  return NAMED_KEYS.get(k.toLowerCase()) || null;
}

/**
 * 단축키 문자열 검사. 통과면 { ok:true, accel:정본 } · 거절이면 { ok:false, error } —
 *   error: 'invalid'(형식) · 'needs_modifier'(Ctrl/Cmd/Alt 없음) · 'common_key'(Ctrl/Cmd + 글자 하나 같은 흔한 키)
 */
function validateAccel(input) {
  if (typeof input !== 'string') return { ok: false, error: 'invalid' };
  const s = input.trim();
  if (!s || s.length > 64) return { ok: false, error: 'invalid' };
  // 마지막 키가 «+» 자체면 «Plus» 로 적어야 한다(Electron 표기)
  const parts = s.split('+').map((p) => p.trim());
  if (parts.some((p) => !p)) return { ok: false, error: 'invalid' };
  const keyRaw = parts.pop();
  const mods = [];
  for (const p of parts) {
    const m = MODS[p.toLowerCase()];
    if (!m || mods.includes(m)) return { ok: false, error: 'invalid' };
    mods.push(m);
  }
  const key = normKey(keyRaw);
  if (!key) return { ok: false, error: 'invalid' };   // 수식키만(«Ctrl+Shift»)·모르는 키
  if (!mods.some((m) => PRIMARY.has(m))) return { ok: false, error: 'needs_modifier' };
  // CommandOrControl 과 Control/Command 를 같이 쓰면 맥/윈도우에서 뜻이 겹친다 — 받지 않는다
  if (mods.includes('CommandOrControl') && (mods.includes('Control') || mods.includes('Command'))) return { ok: false, error: 'invalid' };
  const onlyCtrl = mods.every((m) => m === 'CommandOrControl' || m === 'Command' || m === 'Control') && mods.length === 1;
  if (onlyCtrl && /^[A-Z0-9]$/.test(key)) return { ok: false, error: 'common_key' };
  const order = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { ok: true, accel: [...mods, key].join('+') };
}

/** 화면 표기 — 맥은 Cmd, 그 외는 Ctrl */
function displayAccel(accel, platform) {
  const mac = platform === 'darwin';
  return String(accel || '').split('+').map((p) => {
    if (p === 'CommandOrControl') return mac ? 'Cmd' : 'Ctrl';
    if (p === 'Command') return 'Cmd';
    if (p === 'Control') return 'Ctrl';
    if (p === 'Alt') return mac ? 'Option' : 'Alt';
    return p;
  }).join('+');
}

// ── 점프 목록·메뉴 동작 — 고정 허용 목록(§4-5). second-instance 인자는 이 이름만 받는다(임의 URL 금지) ──
const ACTIONS = ['quick-task', 'qtask', 'qtalk', 'qnote'];
const ACTION_ARG = '--pq-action=';
function actionFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  const a = argv.find((x) => typeof x === 'string' && x.startsWith(ACTION_ARG));
  if (!a) return null;
  const v = a.slice(ACTION_ARG.length);
  return ACTIONS.includes(v) ? v : null;
}

module.exports = { DEFAULT_ACCEL, validateAccel, displayAccel, ACTIONS, ACTION_ARG, actionFromArgv };
