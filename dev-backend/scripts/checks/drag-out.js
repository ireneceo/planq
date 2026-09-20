// 드래그로 OS 에 꺼내기 — 출처별(직접·채팅·업무)로 열리는가 · 남의 것은 막히는가.
//
// Irene 2026-09-20: *"나머지도 고쳐."* (드래그 다운로드가 «직접 올린 파일» 에만 되던 것)
//
// ★ 무인증 서명 URL 이라 **음성 대조군이 본검사보다 중요하다**:
//   · chat 으로 받은 서명을 direct 로 상환 → 403 이어야 한다(서명에 출처가 들어 있다)
//   · 남의 워크스페이스 번호로 발급 → 404
//   · 남의 워크스페이스 파일 → 막힌다. **단 platform_admin 은 모든 워크스페이스에 접근한다(설계)** —
//     그 계정으로 재면 «누수» 로 잘못 읽는다. 일반 사용자만 대조군이 된다(실제로 한 번 틀렸다).
// ★ 물리 파일이 없는 행을 집으면 410 이 나고 그걸 코드 결함으로 읽는다 — **있는 것만** 고르고,
//   없으면 픽스처를 만든다(dev 의 유일한 task 첨부가 옛 테스트 잔해였다).
//
// 실행: cd dev-backend && node scripts/checks/drag-out.js
// 드래그 아웃 — 출처별로 열리는가 · 남의 것은 막히는가 · 서명이 출처에 묶였는가.
const db = require('../../config/database'); const s = db.sequelize || db;
const { generateAccessToken } = require('../../services/authTokens');
const API = 'http://localhost:3003';
const tok = async (id) => { const [r] = await s.query('SELECT * FROM users WHERE id=:i', { replacements: { i: id } }); return generateAccessToken(r[0]); };
const post = async (t, p) => { const r = await fetch(API + p, { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); return { s: r.status, j: await r.json().catch(() => null) }; };
const get = async (u) => { const r = await fetch(API + u); return { s: r.status, n: r.ok ? (await r.arrayBuffer()).byteLength : 0, ct: r.headers.get('content-type'), cd: r.headers.get('content-disposition') }; };

async function crossWorkspace(judge) {
  // A 워크스페이스의 파일을, A 에 속하지 않은 B 사용자가 꺼내려 한다
  // ★ 워크스페이스별로 **따로** 뽑는다. 한 번에 LIMIT 을 걸면 앞 워크스페이스가 다 채워
  //   뒤 워크스페이스가 «없음» 으로 나오고, 그걸 «미측정» 으로 잘못 읽는다(실제로 그랬다).
  const one = async (biz) => (await s.query("SELECT id fid FROM files WHERE deleted_at IS NULL AND storage_provider='planq' AND business_id=:b LIMIT 1", { replacements: { b: biz } }))[0][0];
  const a = await one(3), b = await one(5);
  if (!a || !b) { console.log('⬜ 미측정 — 두 워크스페이스의 파일을 못 찾았다'); return; }
  // ★ platform_admin 은 **모든 워크스페이스에 접근한다**(설계). 대조군이 못 된다 —
  //   한 번 그 계정으로 재서 «누수» 로 잘못 읽었다. 일반 사용자만 고른다.
  const [mA] = await s.query("SELECT bm.user_id FROM business_members bm JOIN users u ON u.id=bm.user_id WHERE bm.business_id=3 AND bm.removed_at IS NULL AND u.status='active' AND (u.platform_role IS NULL OR u.platform_role<>'platform_admin') AND bm.user_id NOT IN (SELECT user_id FROM business_members WHERE business_id=5) LIMIT 1");
  if (!mA.length) { console.log('⬜ 미측정 — biz3 에만 속한 **일반** 사용자가 없다'); return; }
  const [u] = await s.query('SELECT * FROM users WHERE id=:i', { replacements: { i: mA[0].user_id } });
  const t = generateAccessToken(u[0]);
  const call = async (biz, cid) => {
    const r = await fetch(`${API}/api/files/${biz}/${cid}/drag-url`, { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
    return r.status;
  };
  judge('자기 워크스페이스 파일은 발급된다 (양성 대조군)', (await call(3, `direct-${a.fid}`)) === 200, `biz3 file ${a.fid}`);
  judge('남의 워크스페이스 파일은 막힌다', [403, 404].includes(await call(5, `direct-${b.fid}`)), `biz5 file ${b.fid}`);
  judge('내 워크스페이스 번호에 남의 파일 id 를 붙여도 막힌다', [403, 404].includes(await call(3, `direct-${b.fid}`)), `biz3 + biz5 file ${b.fid}`);
}

(async () => {
  let fail = 0; const judge = (n, ok, d) => { console.log(`${ok ? '✅' : '❌'} ${n} — ${d}`); if (!ok) fail++; };
  const BIZ = 3;
  const [ms] = await s.query("SELECT user_id, role FROM business_members WHERE business_id=:b AND removed_at IS NULL AND role<>'ai'", { replacements: { b: BIZ } });
  const owner = ms.find(m => m.role === 'owner').user_id;
  const t = await tok(owner);

  // 출처별 대상 찾기
  const [df] = await s.query("SELECT id FROM files WHERE business_id=:b AND deleted_at IS NULL AND storage_provider='planq' AND (security_level IS NULL OR security_level='general') LIMIT 1", { replacements: { b: BIZ } });
  // ★ 물리 파일이 **실제로 있는** 것만 고른다. 없는 행을 집으면 410 이 나고 그걸 코드 결함으로
  //   잘못 읽는다(실제로 그랬다 — dev 의 유일한 task 첨부가 옛 테스트 잔해라 파일이 없었다).
  const fsx = require('fs');
  const [taAll] = await s.query("SELECT id, file_path FROM task_attachments WHERE business_id=:b AND storage_provider='planq'", { replacements: { b: BIZ } });
  let ta = taAll.filter(x => x.file_path && fsx.existsSync(x.file_path));
  let madeTask = null;
  if (!ta.length) {
    // 픽스처 — 실제 파일이 있는 direct 파일의 바이트를 빌려 task 첨부 1건을 만든다
    const [src] = await s.query("SELECT id, file_path, file_name, mime_type, file_size FROM files WHERE business_id=:b AND deleted_at IS NULL AND storage_provider='planq' LIMIT 20", { replacements: { b: BIZ } });
    const good = src.find(x => x.file_path && fsx.existsSync(x.file_path));
    const [tk] = await s.query('SELECT id FROM tasks WHERE business_id=:b LIMIT 1', { replacements: { b: BIZ } });
    if (good && tk.length) {
      await s.query(`INSERT INTO task_attachments (task_id,business_id,original_name,stored_name,file_path,file_size,mime_type,storage_provider,uploaded_by,created_at)
        VALUES (:t,:b,:n,:sn,:p,:sz,:m,'planq',:u,NOW())`,
        { replacements: { t: tk[0].id, b: BIZ, n: 'ZDRG-' + good.file_name, sn: require('path').basename(good.file_path), p: good.file_path, sz: good.file_size, m: good.mime_type, u: owner } });
      const [nw] = await s.query("SELECT id FROM task_attachments WHERE original_name LIKE 'ZDRG-%' ORDER BY id DESC LIMIT 1");
      ta = nw; madeTask = nw[0].id;
    }
  }
  const [ca] = await s.query(`SELECT ma.id FROM message_attachments ma JOIN messages m ON m.id=ma.message_id
      JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=:b AND ma.storage_provider='planq' LIMIT 1`, { replacements: { b: BIZ } });
  console.log(`대상 — direct ${df[0]?.id || '없음'} · task ${ta[0]?.id || '없음'} · chat ${ca[0]?.id || '없음'}`);

  const urls = {};
  for (const [src, row] of [['direct', df], ['task', ta], ['chat', ca]]) {
    if (!row.length) { console.log(`⬜ 미측정 — ${src} 대상이 없다`); continue; }
    const r = await post(t, `/api/files/${BIZ}/${src}-${row[0].id}/drag-url`);
    judge(`${src} 발급`, r.s === 200 && !!r.j?.data?.url, `HTTP ${r.s}`);
    if (r.j?.data?.url) urls[src] = r.j.data.url;
  }
  for (const [src, u] of Object.entries(urls)) {
    const g = await get(u);
    judge(`${src} 상환 — 실제 바이트가 나온다`, g.s === 200 && g.n > 0, `HTTP ${g.s} · ${g.n}b · ${g.cd ? 'attachment' : 'disposition 없음'}`);
    judge(`${src} 는 inline 이 아니다 (XSS 방어)`, /attachment/.test(g.cd || ''), String(g.cd).slice(0, 40));
  }
  // ★ 서명이 출처에 묶였는가 — chat 서명을 direct 로 상환
  if (urls.chat && df.length) {
    const swapped = urls.chat.replace(/\/drag\/(\d+)\/chat-(\d+)/, `/drag/$1/direct-${df[0].id}`);
    const g = await get(swapped);
    judge('chat 서명을 direct 로 상환할 수 없다 (음성 대조군)', g.s === 403, `HTTP ${g.s}`);
  }
  // ★ 남의 워크스페이스 번호로 꺼낼 수 없는가
  if (ca.length) {
    const r = await post(t, `/api/files/9999/chat-${ca[0].id}/drag-url`);
    judge('남의 워크스페이스 번호로는 발급 안 된다', r.s === 403 || r.s === 404, `HTTP ${r.s}`);
  }
  // ★ 비멤버는 발급 못 한다
  const [other] = await s.query("SELECT id FROM users WHERE status='active' AND id NOT IN (SELECT user_id FROM business_members WHERE business_id=:b) LIMIT 1", { replacements: { b: BIZ } });
  if (other.length && df.length) {
    const r = await post(await tok(other[0].id), `/api/files/${BIZ}/direct-${df[0].id}/drag-url`);
    judge('비멤버는 발급 못 한다 (음성 대조군)', r.s === 403 || r.s === 404, `HTTP ${r.s}`);
  }
  if (madeTask) { await s.query('DELETE FROM task_attachments WHERE id=:i', { replacements: { i: madeTask } }); console.log('픽스처 원복 완료'); }
  console.log('');
  await crossWorkspace(judge);
  console.log(`\n실패 ${fail}건`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
