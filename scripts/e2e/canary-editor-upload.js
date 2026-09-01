// scripts/e2e/canary-editor-upload.js — 에디터가 부르는 업로드 주소가 **실제로 존재하는가**
//
// 운영 #378 — Q info 의 RichEditor 가 `/api/files/:biz/upload-inline-image` 로 이미지를 올리고
//   있었는데 **백엔드에 그런 라우트가 없었다**(실측 404). RichEditor 는 실패를 조용히 삼켜
//   (`if (!r.ok) return null`) 사용자에게는 "이미지를 넣어도 그냥 안 들어간다" 로만 보였다.
//   Irene: "이미지를 본문에 넣어도 제대로 안 들어가고".
//
// 왜 이 검사가 필요한가 — 업로드 주소는 프론트에 **문자열로** 박혀 있고 백엔드 라우트와
//   컴파일러가 이어주지 않는다. 한쪽이 바뀌면 조용히 끊긴다. 그래서 실제로 호출해서 본다.
//
// 판정: 404/405 면 실패(주소가 없다). 4xx 라도 400·413·403 은 통과 — 라우트는 존재한다는 뜻이다
//   (검증·쿼터·권한에서 걸린 것이라 이 검사기의 관심사가 아니다).
const { BASE, CREDS } = require('./lib/browser');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);
// 1x1 PNG — 실제 이미지여야 mime 판정을 지난다
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// 프론트가 실제로 넘기는 uploadUrl 들. 새 에디터 화면을 추가하면 여기에 한 줄 더한다.
const TARGETS = [
  { label: 'Q info · Q Task 본문 이미지 (RichEditor)', path: `/api/files/${BIZ}`,        field: 'file' },
  { label: 'Q docs 본문 이미지 (PostEditor)',          path: '/api/posts/editor-image',  field: 'file', extra: { business_id: String(BIZ) } },
];

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
  });
  const j = await r.json();
  return j.data?.accessToken || j.data?.token || null;
}

async function run() {
  const tok = await login();
  if (!tok) return [{ route: '로그인', detail: '실패 — 검사 못 함', fail: 1 }];
  const rows = [];
  const created = [];
  for (const t of TARGETS) {
    try {
      const fd = new FormData();
      fd.append(t.field, new Blob([PNG], { type: 'image/png' }), 'canary.png');
      for (const [k, v] of Object.entries(t.extra || {})) fd.append(k, v);
      const r = await fetch(BASE + t.path, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
      const gone = r.status === 404 || r.status === 405;
      let note = '';
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        // RichEditor 계약: { data: { preview_url } } · PostEditor 계약: { data: { url } }
        const usable = !!(j.data?.preview_url || j.data?.url);
        note = usable ? ' · 삽입 가능한 URL 반환' : ' · ⚠ URL 이 없어 에디터가 삽입 못 한다';
        // ★ 검사기가 파일을 남기면 안 된다 — 정기 실행될 것이라 매번 쌓인다.
        // 응답의 id 필드명이 라우트마다 다르다 — files 는 `id`, posts/editor-image 는 `file_id`.
        //   한쪽만 보면 원복이 조용히 반쪽이 된다(실제로 1/2 만 지워졌다).
        const newId = j.data?.id ?? j.data?.file_id;
        if (newId) created.push(Number(newId));
        rows.push({ route: t.label, detail: `${t.path} → ${r.status}${note}`, fail: usable ? 0 : 1 });
        continue;
      }
      rows.push({ route: t.label, detail: `${t.path} → ${r.status}${gone ? ' ← 주소가 없다' : ' (라우트는 존재)'}`, fail: gone ? 1 : 0 });
    } catch (e) {
      rows.push({ route: t.label, detail: `${t.path} → 호출 오류 ${e.message}`, fail: 1 });
    }
  }
  // 원복 — 검사기가 만든 파일을 지운다 (남기면 매 실행마다 쌓인다)
  let removed = 0;
  for (const id of created) {
    try {
      const d = await fetch(`${BASE}/api/files/${BIZ}/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      if (d.ok) removed += 1;
    } catch { /* noop */ }
  }
  const bad = rows.reduce((a, x) => a + (x.fail || 0), 0);
  console.log(`\n에디터 업로드 주소 — 검사 ${rows.length}개 · 실패 ${bad} · 원복 ${removed}/${created.length}`);
  rows.forEach((x) => console.log(`  ${x.fail ? '✗' : '✓'} ${x.route} — ${x.detail}`));
  return rows;
}

module.exports = { name: '에디터 업로드 주소', run };

if (require.main === module) {
  run().then((rows) => {
    const bad = rows.reduce((a, x) => a + (x.fail || 0), 0);
    console.log('\n' + (bad === 0 ? '✓ PASS' : `✗ FAIL — ${bad}건`));
    process.exit(bad === 0 ? 0 : 1);
  }).catch((e) => { console.error('검사기 자체 오류:', e.message); process.exit(2); });
}
