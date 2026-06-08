// #9 팝아웃 재인증 버그 실측 — 멀티윈도우 refresh rotation 시나리오
// 끝에 생성한 refresh_tokens row 전부 정리.
const { sequelize } = require('./config/database');
const { User, RefreshToken } = require('./models');
const { helpers } = require('./routes/auth');
const crypto = require('crypto');
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

const BASE = 'http://localhost:3003';

async function refreshCall(cookieVal) {
  const res = await fetch(BASE + '/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'refresh_token=' + cookieVal },
  });
  let setCookie = res.headers.get('set-cookie') || '';
  let newCookie = null;
  const m = setCookie.match(/refresh_token=([^;]+)/);
  if (m) newCookie = m[1];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, success: body.success, newCookie, msg: body.message };
}

(async () => {
  const createdIds = [];
  try {
    const user = await User.findOne({ where: { status: 'active', is_ai: false } });
    console.log('test user id=%d email=%s', user.id, user.email);

    // 로그인 모사 — R1 발급 + row
    const r1 = helpers.generateRefreshToken(user, 'web');
    const row1 = await helpers.createRefreshTokenRow(user, r1, { headers: {}, ip: '127.0.0.1' }, null, { clientKind: 'web' });
    createdIds.push(row1.id);
    let jar = r1; // 공유 쿠키 jar (항상 최신)
    console.log('\n[로그인] jar=R1 row=%d', row1.id);

    // 메인 창 앱 로드 시 checkSession → refresh (R1->R2)
    let res = await refreshCall(jar);
    console.log('[메인 로드 refresh] status=%d success=%s cookieUpdated=%s', res.status, res.success, !!res.newCookie);
    if (res.newCookie) jar = res.newCookie;

    // 팝아웃1 열기 → refresh
    res = await refreshCall(jar);
    console.log('[팝아웃1 열기 refresh] status=%d success=%s cookieUpdated=%s msg=%s', res.status, res.success, !!res.newCookie, res.msg||'');
    if (res.newCookie) jar = res.newCookie;

    // 팝아웃1 닫기 (no-op)
    // 팝아웃2 열기 → refresh  ← Irene 이 401 보는 지점
    res = await refreshCall(jar);
    console.log('[팝아웃2 열기 refresh] status=%d success=%s cookieUpdated=%s msg=%s', res.status, res.success, !!res.newCookie, res.msg||'');
    if (res.newCookie) jar = res.newCookie;

    // --- 추가: 두 창이 동시에 같은 쿠키로 refresh (진짜 race) ---
    console.log('\n[동시 race 시뮬] 두 창이 같은 jar 로 동시 refresh');
    const [ra, rb] = await Promise.all([refreshCall(jar), refreshCall(jar)]);
    console.log('  창A status=%d success=%s msg=%s', ra.status, ra.success, ra.msg||'');
    console.log('  창B status=%d success=%s msg=%s', rb.status, rb.success, rb.msg||'');
    // race 후 새 쿠키 (창A 우선)
    const afterRace = ra.newCookie || rb.newCookie || jar;
    res = await refreshCall(afterRace);
    console.log('  race 후 최신쿠키 refresh status=%d success=%s', res.status, res.success);

    // --- 추가: 한 창이 stale 쿠키 보유 (jar 안 갱신된 케이스) ---
    console.log('\n[stale 쿠키 시뮬] R1(최초) 으로 다시 refresh — 체인 2칸 이상 전진 후');
    res = await refreshCall(r1);
    console.log('  R1 재사용 status=%d success=%s msg=%s', res.status, res.success, res.msg||'');

    // 정리용 — 이 user 의 방금 만든 체인 row 들 수집
    const chain = await RefreshToken.findAll({ where: { user_id: user.id }, order: [['id','DESC']], limit: 20 });
    chain.forEach(r => { if (r.id >= row1.id) createdIds.push(r.id); });
  } catch (e) {
    console.error('ERR', e);
  } finally {
    // 원복 — 테스트가 만든 row 전부 삭제
    const uniq = [...new Set(createdIds)];
    if (uniq.length) {
      await RefreshToken.destroy({ where: { id: uniq } });
      console.log('\n[원복] 삭제한 refresh_tokens row:', uniq.join(','));
    }
    await sequelize.close();
  }
})();
