// 통합 공유 시스템 — 헬퍼 (사이클 N+4 4차)
//
// 모든 share 가능한 entity (Task/File/KbDocument/CalendarEvent) 의 POST /share 와
// GET /public/by-token/:token 라우트가 공통으로 사용. 만료/비번 처리 표준화.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// POST /:id/share 핸들러에서 사용 — token 발급 + 만료 + 비번 일괄 처리.
// entity 인스턴스를 직접 update 하고, 응답용 정보 반환.
//
//   body fields:
//     expires_in_days  — 0/null: 무기한, >0: N일 후 만료
//     password         — 빈 문자열/null: 비번 없음, 비어있지 않으면 bcrypt hash 저장
//
// 미설정 (undefined) 인 필드는 기존 값 유지.
async function applyShareUpdate(entity, body = {}) {
  const updates = {};
  let token = entity.share_token;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    updates.share_token = token;
    updates.shared_at = new Date();
  }
  if (body.expires_in_days !== undefined) {
    const d = Number(body.expires_in_days);
    updates.share_expires_at = (d > 0)
      ? new Date(Date.now() + d * 24 * 60 * 60 * 1000)
      : null;
  }
  if (body.password !== undefined) {
    if (body.password) {
      updates.share_password_hash = await bcrypt.hash(String(body.password), 10);
    } else {
      updates.share_password_hash = null;
    }
  }
  if (Object.keys(updates).length > 0) await entity.update(updates);
  return {
    token,
    updates,
    shared_at: entity.shared_at || updates.shared_at,
    share_expires_at: updates.share_expires_at !== undefined ? updates.share_expires_at : entity.share_expires_at,
    password_set: updates.share_password_hash !== undefined
      ? !!updates.share_password_hash
      : !!entity.share_password_hash,
  };
}

// GET /public/by-token/:token 핸들러에서 사용 — 비번 보호 검증.
// 비번 미설정이면 ok=true. 설정돼 있으면 X-Share-Password 헤더로만 검증(주소 ?p= 는 받지 않는다).
//
// 호출 예:
//   const v = await verifySharePassword(task, req);
//   if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
// ★ (2026-10-09 보안점검) 두 가지를 막는다.
//   ① 비밀번호를 주소(?p=)로 받지 않는다 — 웹 서버 접속 기록에 평문으로 남는다. 화면은 헤더로만 보낸다.
//   ② 링크 하나에 틀린 비밀번호를 15분 10번까지만 — 전역 분당 600 회 한도로는 하루 수십만 번 대입할 수 있었고
//      매번 bcrypt 비교라 CPU 도 같이 탔다. IP 가 아니라 **링크(토큰)** 로 센다(IP 를 바꿔도 같은 링크다).
//      잠긴 동안에는 비교 자체를 하지 않는다. 프로세스 메모리 — 재시작하면 풀린다(그래도 대입 속도는 묶인다).
const PW_WINDOW_MS = 15 * 60 * 1000;
const PW_MAX_WRONG = 10;
const pwWrong = new Map();   // token → { n, until }
function pwLocked(key) {
  const e = pwWrong.get(key);
  if (!e) return false;
  if (Date.now() > e.until) { pwWrong.delete(key); return false; }
  return e.n >= PW_MAX_WRONG;
}
function pwFail(key) {
  const now = Date.now();
  const e = pwWrong.get(key);
  if (!e || now > e.until) pwWrong.set(key, { n: 1, until: now + PW_WINDOW_MS });
  else e.n += 1;
  if (pwWrong.size > 10000) for (const [k, v] of pwWrong) if (now > v.until) pwWrong.delete(k);
}
async function verifySharePassword(entity, req) {
  if (!entity.share_password_hash) return { ok: true };
  const pw = req.headers['x-share-password'] || '';
  if (!pw) return { ok: false, status: 401, error: 'password_required', requires_password: true };
  const key = String(entity.share_token || entity.token || entity.id);
  if (pwLocked(key)) return { ok: false, status: 429, error: 'password_attempts_exceeded', requires_password: true };
  const ok = await bcrypt.compare(String(pw), entity.share_password_hash);
  if (!ok) { pwFail(key); return { ok: false, status: 401, error: 'password_wrong', requires_password: true }; }
  pwWrong.delete(key);
  return { ok: true };
}

// N+44 — 공개 endpoint 만료 응답 통일 (Post/Doc/Invoice 의 N+43 패턴과 일치):
//   만료된 share_expires_at < NOW 이면 410 + { code: 'share_expired', expired_at } 응답.
//   helper 가 res 직접 write 하므로 라우트는 호출 후 return 만 하면 됨.
//
// 사용 패턴:
//   const entity = await Model.findOne({ where: { share_token } });   // share_expires_at WHERE 조건 빼야 함
//   if (!entity) return errorResponse(res, 'not_found', 404);
//   if (checkShareExpiry(entity, res)) return;
//   // 정상 처리
function checkShareExpiry(entity, res) {
  if (!entity || !entity.share_expires_at) return false;
  if (new Date(entity.share_expires_at) < new Date()) {
    res.status(410).json({
      success: false,
      code: 'share_expired',
      message: 'This share link has expired.',
      expired_at: entity.share_expires_at,
    });
    return true;
  }
  return false;
}

// ── 하위 주소 서명 (2026-09-27) ────────────────────────────────────────────
// 공개 페이지의 하위 주소(첨부 다운로드·PDF)는 `<a href>`·window.open 이라 비밀번호 헤더를 못 싣는다.
//   그래서 비밀번호를 **통과한 응답에만** 짧게 유효한 서명(`dl`)을 주소에 붙이고, 하위 라우트가 그것을 본다.
//   ★ 전에는 하위 라우트가 비밀번호를 아예 안 봐서, 비밀번호를 건 문서도 PDF·첨부 주소만 알면 받아졌다.
//   서명은 (토큰, 대상, 만료, 비밀번호 해시 지문)을 묶는다 — 비밀번호를 바꾸면 옛 서명은 죽는다.
//   비밀번호 없는 공유는 토큰이 곧 자격이라 서명이 필요 없다.
const SUB_TTL_S = 2 * 3600;
const subKey = () => crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:planq-share-sub-v1`).digest();
const pwFp = (h) => crypto.createHash('sha256').update(String(h || '')).digest('hex').slice(0, 12);
const macOf = (token, target, exp, pwHash) => crypto.createHmac('sha256', subKey())
  .update(`${token}.${target}.${exp}.${pwFp(pwHash)}`).digest('base64url').slice(0, 32);
function signShareSub(token, target, pwHash) {
  const exp = Math.floor(Date.now() / 1000) + SUB_TTL_S;
  return `${exp}.${macOf(token, String(target), exp, pwHash)}`;
}
/** 하위 주소 자격 — 비밀번호가 없으면 true, 있으면 유효한 서명 또는 비밀번호 헤더. */
async function verifyShareSub(entity, req, token, target) {
  if (!entity.share_password_hash) return true;
  const [expS, mac] = String((req.query && req.query.dl) || '').split('.');
  const exp = Number(expS);
  if (exp && mac && exp * 1000 >= Date.now()) {
    const want = macOf(token, String(target), exp, entity.share_password_hash);
    if (want.length === mac.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return true;
  }
  const v = await verifySharePassword(entity, req);   // 헤더로 비밀번호를 보낸 호출도 받는다
  return v.ok;
}
/** 하위 주소에 붙일 꼬리 — 비밀번호 없는 공유면 빈 문자열. */
function shareSubQuery(entity, token, target) {
  return entity.share_password_hash ? `?dl=${signShareSub(token, target, entity.share_password_hash)}` : '';
}

// ── 공유 끄기 (2026-09-27) ────────────────────────────────────────────────
// 공개 범위를 좁히거나(L1 나만·L2 한정) 보안등급을 올리면 **이미 나간 링크를 끊는다.** 달력이 선례였고
//   문서·파일·Q info 는 토큰을 그대로 둬서, «나만 보기» 로 바꾼 문서가 옛 링크로 계속 열렸다.
//   비밀번호 해시도 같이 지운다 — 남기면 다시 공유할 때 옛 비밀번호가 조용히 승계된다.
//   모델마다 칸 이름이 조금씩 달라(shared_at / share_created_at) **그 모델에 있는 칸만** 비운다.
const SHARE_COLS = ['share_token', 'shared_at', 'share_created_at', 'share_expires_at', 'share_password_hash'];
function shareOffPatch(entity) {
  if (!entity || (!entity.share_token && !entity.share_password_hash)) return {};
  const attrs = (entity.constructor && entity.constructor.rawAttributes) || {};
  const patch = {};
  for (const c of SHARE_COLS) if (attrs[c]) patch[c] = null;
  return patch;
}
const narrowsShare = (level) => level === 'L1' || level === 'L2';

module.exports = { applyShareUpdate, verifySharePassword, checkShareExpiry, verifyShareSub, shareSubQuery, shareOffPatch, narrowsShare };
