// scripts/e2e/lib/cleanup.js — 검사기가 만든 파일을 되돌린다. **단일 원천.**
//
// 왜: 카나리가 업로드해 놓고 안 지우면 워크스페이스에 쓰레기가 쌓인다.
//   실측 2026-09-02 — dev 에 `icon.png` 1033건(검사 계정)이 2026-05-26 부터 누적돼 있었다.
//   정리 코드는 canary-mail-image 에만 있었고, 베껴 쓰면 갈라지므로 여기 하나만 둔다.
//
// ★ soft delete 만으로는 바이트가 남는다(휴지통). purge 까지 불러야 되돌린 것이다.
const { BASE, CREDS } = require('./browser');

async function loginToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
  });
  const j = await r.json().catch(() => ({}));
  return (j.data && (j.data.token || j.data.accessToken)) || null;
}

/**
 * 이름이 names 중 하나이고 since 이후에 만들어진 파일을 지운다(바이트까지).
 * @returns 러너 형태 한 줄 — 못 지웠으면 **실패로** 낸다(조용히 쌓이는 것이 지금까지의 문제였다).
 */
async function cleanupTestFiles(bizId, names, since) {
  const row = (fail, msg) => ({ name: 'cleanup', fail, details: [msg], hasCanary: true });
  try {
    const tok = await loginToken();
    if (!tok) return row(1, '🔴 원복용 로그인 실패 — 검사 파일이 남는다');
    const H = { Authorization: `Bearer ${tok}` };
    const r = await fetch(`${BASE}/api/files/${bizId}?limit=500`, { headers: H });
    const j = await r.json().catch(() => ({}));
    const rows = Array.isArray(j.data) ? j.data : [];
    const targets = rows.filter((f) => names.includes(f.file_name) && new Date(f.created_at).getTime() >= since);
    if (!targets.length) return row(0, '검사기가 남긴 파일 없음');
    let purged = 0;
    for (const f of targets) {
      await fetch(`${BASE}/api/files/${bizId}/${f.id}`, { method: 'DELETE', headers: H }).catch(() => null);
      const p = await fetch(`${BASE}/api/files/${bizId}/${f.id}/purge`, { method: 'DELETE', headers: H }).catch(() => null);
      if (p && p.ok) purged += 1;
    }
    return purged === targets.length
      ? row(0, `검사기가 올린 파일 ${purged}건을 지웠다 (바이트까지)`)
      : row(1, `🔴 ${targets.length}건 중 ${purged}건만 지워졌다 — 나머지는 휴지통에 바이트가 남는다`);
  } catch (e) {
    return row(1, `🔴 원복 중 오류: ${e.message}`);
  }
}

module.exports = { cleanupTestFiles };
