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
// 비번 미설정이면 ok=true. 설정돼 있으면 X-Share-Password header 또는 ?p=... query 검증.
//
// 호출 예:
//   const v = await verifySharePassword(task, req);
//   if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
async function verifySharePassword(entity, req) {
  if (!entity.share_password_hash) return { ok: true };
  const pw = req.headers['x-share-password']
    || (req.query && req.query.p ? String(req.query.p) : '');
  if (!pw) return { ok: false, status: 401, error: 'password_required', requires_password: true };
  const ok = await bcrypt.compare(pw, entity.share_password_hash);
  if (!ok) return { ok: false, status: 401, error: 'password_wrong', requires_password: true };
  return { ok: true };
}

module.exports = { applyShareUpdate, verifySharePassword };
