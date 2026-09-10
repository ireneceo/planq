// services/ephemeralStore.js — 짧은 수명 상태의 **단일 저장소**.
//
// 왜 (2026-09-10, Fable 게이트 지적): models/EphemeralToken.js 머리말 참조.
//   요약 — OAuth 세 흐름이 메모리 `Map` 을 들고 있어 **PM2 재시작마다 사라졌다.**
//   배포 2회 × 10분 창이 Irene 의 아이폰 로그인 신고와 겹쳤고, replay 차단 원장까지
//   같이 사라져 일회용 code 재사용 창이 다시 열렸다.
//
// 설계
//   · 호출부가 쓰던 `Map` 과 **거의 같은 모양**으로 둔다(get/set/delete/has). 다만 비동기다.
//   · 비밀(6자리 코드 등)은 **해시로만** 저장한다. DB 는 백업에도 남는다.
//   · 만료 정리는 여기 한 곳 — 호출부마다 sweep 타이머를 두면 세 벌이 된다.
//   · **DB 가 흔들려도 로그인이 죽지 않게** 하지 않는다 — 조용히 통과시키면 replay 차단이
//     무력화된다. 실패는 실패로 던지고 호출부가 판단한다.
const crypto = require('crypto');

/**
 * 비밀 해시. 키를 salt 로 섞어 같은 코드라도 흐름마다 다른 해시가 되게 한다.
 *   6자리는 엔트로피가 낮아 해시만으로 안전해지지 않는다 — 시도 횟수 제한과 짧은 TTL 이 본체고,
 *   이것은 **DB 를 읽은 사람이 곧바로 쓰지 못하게** 하는 층이다.
 */
function hashSecret(key, secret) {
  return crypto.createHash('sha256').update(`${key}::${secret}`).digest('hex');
}

/** 타이밍 안전 비교 — 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function model() {
  return require('../models').EphemeralToken;
}

/** 값 저장(있으면 덮어쓴다). ttlMs 뒤 만료. */
async function set(kind, key, payload, ttlMs) {
  const M = model();
  const expires_at = new Date(Date.now() + ttlMs);
  const [row, created] = await M.findOrCreate({
    where: { kind, token_key: String(key) },
    defaults: { kind, token_key: String(key), payload: payload || null, expires_at },
  });
  if (!created) await row.update({ payload: payload || null, expires_at });
  return row;
}

/** 값 조회. 없거나 만료면 null(만료 행은 지운다). */
async function get(kind, key) {
  const M = model();
  const row = await M.findOne({ where: { kind, token_key: String(key) } });
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await row.destroy().catch(() => {});
    return null;
  }
  return row;
}

/** payload 만 갱신(만료는 그대로). 행이 없으면 false. */
async function update(kind, key, payload) {
  const row = await get(kind, key);
  if (!row) return false;
  await row.update({ payload });
  return true;
}

// ── 원자 연산 3종 (2026-09-10, Fable 게이트 FAIL 지적) ─────────────────────
//   메모리 `Map` 시절엔 단일 스레드라 `읽기 → 판단 → 쓰기` 가 저절로 직렬이었다.
//   DB 로 옮기면서 그 사이에 창이 생겨 **동시 요청이 1회용·시도 상한·replay 차단을 전부 뚫었다**
//   (실측: 동시 2회 claim → 둘 다 성공 = 세션 2개 · 동시 20회 오답 → attempts 4 에 머묾).
//   판단을 애플리케이션이 아니라 **DB 한 문장**이 하게 만든다.

/**
 * **원자적 1회용 소비.** 지운 건수를 돌려준다 — 동시에 둘이 들어와도 1을 받는 쪽은 하나뿐이다.
 *   호출부는 반드시 `=== 1` 을 확인하고서야 성공으로 다뤄야 한다.
 */
async function consume(kind, key) {
  const M = model();
  return M.destroy({ where: { kind, token_key: String(key) } });
}

/**
 * **원자적 시도 증가.** 증가 뒤의 값을 돌려준다.
 *   읽고-더하고-쓰면 동시 요청에서 증가가 유실된다(그것이 상한을 무력화한 원인).
 *   행이 없으면 null.
 */
async function bumpAttempts(kind, key) {
  const M = model();
  const [n] = await M.increment('attempts', { by: 1, where: { kind, token_key: String(key) } });
  // Sequelize 의 increment 반환 형태는 방언마다 다르다 — 값은 다시 읽어 확인한다.
  const row = await M.findOne({ where: { kind, token_key: String(key) }, attributes: ['attempts'] });
  return row ? Number(row.attempts) : null;
}

/**
 * **처음 한 번만 성공하는 등록.** `created` 를 돌려준다 — UNIQUE(kind, token_key) 가 원자성을 준다.
 *   replay 차단은 `has → set` 두 문장이면 그 사이에 둘 다 통과한다. 한 문장이어야 한다.
 */
async function setIfAbsent(kind, key, payload, ttlMs) {
  const M = model();
  const expires_at = new Date(Date.now() + ttlMs);
  try {
    const [, created] = await M.findOrCreate({
      where: { kind, token_key: String(key) },
      defaults: { kind, token_key: String(key), payload: payload || null, expires_at },
    });
    return created;
  } catch (e) {
    // UNIQUE 충돌은 "이미 있다" 는 뜻이다 — 경쟁에서 진 쪽이 여기로 온다.
    if (e && (e.name === 'SequelizeUniqueConstraintError' || /Duplicate entry/i.test(e.message || ''))) return false;
    throw e;
  }
}

async function del(kind, key) {
  const M = model();
  await M.destroy({ where: { kind, token_key: String(key) } });
}

async function has(kind, key) {
  return !!(await get(kind, key));
}

/** 만료 정리 — 호출부가 아니라 여기가 한다. */
async function sweep() {
  const M = model();
  const { Op } = require('sequelize');
  return M.destroy({ where: { expires_at: { [Op.lt]: new Date() } } });
}

// 주기 정리 — 모듈이 캐시되므로 몇 번 require 해도 타이머는 하나다(core.js 의 옛 setInterval 과 같은 이유).
//   ★ unref() — 이 타이머가 프로세스를 붙잡아 종료를 막으면 안 된다.
let timer = null;
function startSweeper(intervalMs = 60000) {
  if (timer) return;
  timer = setInterval(() => { sweep().catch(() => {}); }, intervalMs);
  if (timer.unref) timer.unref();
}

module.exports = {
  set, get, update, del, has, sweep, startSweeper, hashSecret, safeEqual,
  consume, bumpAttempts, setIfAbsent,
};
