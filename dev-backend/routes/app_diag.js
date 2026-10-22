// routes/app_diag.js — 앱 알림 탭 → «연결 안 됨» 화면 추적 (2026-10-22).
//
// Irene: *"가끔 알림누르면 모바일앱에서 낫커넥티드 떠. 원인불명인데 … 누가 이렇게 연결되면 기록되서 파악할 방법 없어?"*
//   그 화면은 앱 번들 안 로컬 파일이라 뜨는 순간 우리 JS 가 사라진다. 그래서 화면(services/navDiag)이
//   알림 탭을 적어 두었다가 **다음 문서가 뜰 때** «눌렀는데 목적지에 못 갔다» 를 여기로 보낸다.
//
// client_errors.js 와 같은 모양이되 **관리자 메일은 보내지 않는다**(크래시가 아니라 조사 자료다).
//   · 새 테이블 없음 — 로그 한 줄 `[app-nav-fail]` (운영: pm2 logs planq-backend | grep app-nav-fail)
//   · 인증 필수 · per-user 분당 5 / 일 50 · 필드마다 길이 캡 · 개행 제거
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');

const limiter = perUserDaily('app-diag', { perMin: 5, perDay: 50 });

const cap = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

function tapOf(t) {
  if (!t || typeof t !== 'object') return null;
  const steps = t.steps && typeof t.steps === 'object' ? t.steps : {};
  return {
    link: cap(t.link, 200),
    tap_at: num(t.tapAt) ? new Date(num(t.tapAt)).toISOString() : null,
    ago_ms: num(t.ago),
    boot_gap_ms: num(t.bootGap),        // 탭 → 다음 문서가 뜨기까지
    doc_age_ms: num(t.docAge),          // 탭이 왔을 때 그 문서가 뜬 지 얼마였나
    cold: bool(t.cold),
    vis: cap(t.vis, 12),
    online: bool(t.online),
    conn: cap(t.conn, 12) || null,
    full_load: num(steps.full_load) ? true : false,
    ws_reload: num(steps.ws_reload) ? true : false,
  };
}

router.post('/', authenticateToken, ...limiter, async (req, res) => {
  // audit-exempt: 진단 로그 한 줄만 남긴다 — 데이터 변경 없음
  const b = req.body || {};
  const kind = b.kind === 'offline_return' ? 'offline_return' : 'push_nav_fail';
  let lastReload = null;
  if (b.last_reload && typeof b.last_reload === 'object') {
    lastReload = { why: cap(b.last_reload.why, 20), vis: cap(b.last_reload.vis, 12), ago_ms: num(b.last_reload.ago) };
  }
  const entry = {
    at: new Date().toISOString(),
    kind,
    user_id: req.user.id,
    business_id: Number(b.business_id) || null,
    taps: (Array.isArray(b.taps) ? b.taps : []).slice(0, 5).map(tapOf).filter(Boolean),
    // 오프라인 화면이 실어 온 표식(JSON 문자열 그대로 — 새 앱 빌드부터 온다)
    offline: b.offline == null ? null : cap(b.offline, 400),
    last_reload: lastReload,
    landed: cap(b.landed, 200),
    boot_ms: num(b.boot_ms),
    online: bool(b.online),
    conn: cap(b.conn, 12) || null,
    build: cap(b.build, 60),
    ua: cap(req.get('user-agent'), 200),
  };
  console.warn('[app-nav-fail]', JSON.stringify(entry));
  // 응답은 언제나 200 — 진단 보고가 화면을 방해하면 안 된다.
  return successResponse(res, { ok: true });
});

module.exports = router;
