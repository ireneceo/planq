// 피드백 AI 조사 결과 — 검증·저장의 정본 (2026-10-29 · docs/FEEDBACK_AI_TRIAGE_DESIGN.md · Fable 설계 판정).
//   조사(읽기 전용 정찰 방)가 쓴 JSON 을 운영 칸 3개(ai_triage·ai_triage_verdict·ai_triage_at)에만 넣는다.
//   ★ status·답글·승인·responded_*·알림은 이 파일에서 건드릴 수 없다 — 쓰는 칸을 TRIAGE_COLS 로 못 박는다.
//   ★ 조사 결과는 믿지 않는 자료(고객 글을 읽은 AI 의 출력)다 — 모르는 키·상한·경로·비밀값 무늬를 여기서 거른다.
//     상황판의 사전 검사는 보조일 뿐, 거절의 정본은 validateTriage 다.

const VERDICTS = ['already_fixed', 'needs_fix', 'needs_decision', 'not_dev', 'unclear', 'failed'];
const SIZES = ['small', 'medium', 'large'];
const TEXT_KEYS = ['summary', 'cause', 'fix', 'repro'];
const ALLOWED_KEYS = new Set(['id', 'verdict', ...TEXT_KEYS, 'files', 'size', 'fable_needed', 'fixed_commit', 'head', 'room', 'error']);
const TRIAGE_COLS = ['ai_triage', 'ai_triage_verdict', 'ai_triage_at'];
const TEXT_MAX = 2000;
const TOTAL_MAX = 12 * 1024;
const FILES_MAX = 30;
const HASH_RE = /^[0-9a-f]{7,40}$/;
const ROOM_RE = /^[\w-]{1,40}$/;
// 저장소 상대경로(+선택 :줄 또는 :줄-줄). 절대경로·`..`·공백·따옴표는 받지 않는다.
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9._\-/]*(:\d+(-\d+)?)?$/;
// 제어문자(줄바꿈·탭 제외)
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// 비밀값 무늬 — 조사 결과에 .env·키가 옮겨 적히면 관리자 화면·DB 에 남는다
const SECRET_RES = [
  // .env 꼴(대문자 이름=값). 소문자 코드 이름(share_token: …)은 조사 설명에 흔해 막지 않는다.
  /\b[A-Z0-9_]*(PASSWORD|SECRET|API_KEY|PRIVATE_KEY|ACCESS_KEY|TOKEN)[A-Z0-9_]*\s*=\s*\S/,
  /\b(password|passwd|secret)\s*[=:]\s*\S/i,
  /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/, // JWT
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

// 반환: { ok: true, triage } | { ok: false, errors: [코드…] } — 코드만(원문은 담지 않는다)
function validateTriage(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['not_object'] };
  for (const k of Object.keys(input)) if (!ALLOWED_KEYS.has(k)) errors.push(`unknown_key:${String(k).slice(0, 40).replace(/[^\w-]/g, '_')}`);
  const verdict = input.verdict;
  if (!VERDICTS.includes(verdict)) errors.push('verdict');
  const out = { verdict };
  for (const k of TEXT_KEYS) {
    if (input[k] == null) continue;
    if (typeof input[k] !== 'string') { errors.push(`${k}:type`); continue; }
    const v = input[k].trim();
    if (v.length > TEXT_MAX) errors.push(`${k}:too_long`);
    if (CTRL_RE.test(v)) errors.push(`${k}:control_char`);
    if (SECRET_RES.some((re) => re.test(v))) errors.push(`${k}:secret_like`);
    if (v) out[k] = v;
  }
  if (verdict !== 'failed' && !out.summary) errors.push('summary:required');
  if (input.files != null) {
    if (!Array.isArray(input.files) || input.files.length > FILES_MAX) errors.push('files:type');
    else {
      const files = [];
      for (const f of input.files) {
        if (typeof f !== 'string' || f.length > 200 || !FILE_RE.test(f) || f.split('/').some((seg) => seg === '..' || seg === '.')) { errors.push('files:path'); break; }
        files.push(f);
      }
      if (files.length) out.files = files;
    }
  }
  if (input.size != null) { if (SIZES.includes(input.size)) out.size = input.size; else errors.push('size'); }
  if (input.fable_needed != null) { if (typeof input.fable_needed === 'boolean') out.fable_needed = input.fable_needed; else errors.push('fable_needed'); }
  if (typeof input.head !== 'string' || !HASH_RE.test(input.head)) { if (verdict !== 'failed') errors.push('head'); } else out.head = input.head;
  if (input.fixed_commit != null) { if (typeof input.fixed_commit === 'string' && HASH_RE.test(input.fixed_commit)) out.fixed_commit = input.fixed_commit; else errors.push('fixed_commit'); }
  if (input.room != null) { if (typeof input.room === 'string' && ROOM_RE.test(input.room)) out.room = input.room; else errors.push('room'); }
  if (input.error != null) {
    // 실패 이유는 상황판이 붙이는 짧은 코드 목록뿐
    if (verdict !== 'failed' || !Array.isArray(input.error) || input.error.length > 10 || !input.error.every((e) => typeof e === 'string' && /^[\w:.-]{1,60}$/.test(e))) errors.push('error');
    else out.error = input.error;
  }
  if (JSON.stringify(out).length > TOTAL_MAX) errors.push('total_too_long');
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, triage: out };
}

// 실패로 남길 때 — 이유 코드 + 믿을 수 있는 꼬리표(room·head)만. 조사 원문은 남기지 않는다.
function failedTriage(errors, input) {
  const t = { verdict: 'failed', error: errors.slice(0, 10) };
  if (input && typeof input.room === 'string' && ROOM_RE.test(input.room)) t.room = input.room;
  if (input && typeof input.head === 'string' && HASH_RE.test(input.head)) t.head = input.head;
  return t;
}

// 무엇을 할지 판정만(쓰기 없음) — dry-run 과 적용이 같은 함수를 쓴다.
//   반환 { action: 'write'|'skip'|'reject', reason, triage }
function planTriage(item, input, { force = false } = {}) {
  if (!item) return { action: 'reject', reason: 'not_found' };
  if (item.parent_id) return { action: 'reject', reason: 'followup_not_triaged' };
  if (item.kind && item.kind !== 'feedback') return { action: 'reject', reason: 'inquiry_not_triaged' };
  // 이미 조사됨(실패 아님)이면 덮지 않는다 — 다시 조사는 --force
  if (item.ai_triage_at && item.ai_triage_verdict !== 'failed' && !force) return { action: 'skip', reason: 'already_triaged' };
  const v = validateTriage(input);
  if (!v.ok) return { action: 'reject', reason: 'invalid', errors: v.errors, triage: failedTriage(v.errors, input) };
  return { action: 'write', triage: v.triage };
}

// 저장 — 조사 칸 3개만. 감사 feedback.triage.
async function saveTriage(item, triage, { actorUserId = null } = {}) {
  const prev = item.ai_triage_verdict || null;
  await item.update({ ai_triage: triage, ai_triage_verdict: triage.verdict, ai_triage_at: new Date() }, { fields: TRIAGE_COLS });
  try {
    const { writeAudit } = require('./auditService');
    await writeAudit({
      user_id: actorUserId, business_id: item.business_id || null,
      action: 'feedback.triage', target_type: 'feedback_item', target_id: item.id,
      old_value: { verdict: prev }, new_value: { verdict: triage.verdict, room: triage.room || null, head: triage.head || null },
    });
  } catch (_) { /* 감사 실패가 저장을 막지 않는다 */ }
}

module.exports = { VERDICTS, TRIAGE_COLS, validateTriage, failedTriage, planTriage, saveTriage };
