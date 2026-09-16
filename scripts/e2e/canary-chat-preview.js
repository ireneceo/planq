// canary-chat-preview — 채팅 첨부 **미리보기**가 실제로 그려지는가 (2026-09-16)
//
//   Irene: *"채팅에서 png 받으면 미리보기가 안돼. 왜 미리보기가 안나와?
//           클릭해도 미리보기 안나와. 이미지들 pdf 다 미리보기 최대한 모두 나오게 해"*
//
//   결함이 둘이었고 **둘 다 "받는" 쪽**이었다:
//     ① 실시간 수신 매퍼가 `preview_url` 을 버렸다(`QTalkPage` socket `message:attachment`).
//        2026-09-07 에 **조회** 매퍼의 같은 결함을 고쳤는데 소켓 경로는 그대로였다 —
//        그래서 "받으면 안 되고 새로고침하면 된다" 가 됐다. 화면만 보면 간헐로 읽힌다.
//     ② 서버 판정이 mime 만 봤다. 브라우저가 mime 을 모르고 보낸 PNG
//        (`application/octet-stream` — 드래그앤드롭·모바일 공유시트)는 preview_url 이
//        **영영** 없었다. 프론트 `isImage(mime, name)` 는 확장자도 보는데 서버는 안 봤다.
//
//   그래서 **서버 판정**과 **화면에 실제로 <img> 가 그려지는가**를 같이 잰다.
//   판정만 재면 ①을 구조적으로 못 잡는다(서버는 처음부터 옳았다).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { launch, login } = require('./lib/browser');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const API = process.env.E2E_API || 'http://localhost:3003';
const CREDS = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };
// 1x1 PNG — 바이트를 지어내지 않고 실제 PNG 를 쓴다(판정이 이미지 디코드까지 간다).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function api(path, opts = {}) {
  return fetch(API + path, opts);
}
async function getToken() {
  const r = await api('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDS),
  });
  const j = await r.json();
  if (!j?.data?.token) throw new Error('login failed');
  return { token: j.data.token, user: j.data.user };
}
async function postMessage(H, biz, conv, content) {
  const r = await api(`/api/conversations/${biz}/${conv}/messages`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('message failed: ' + JSON.stringify(j).slice(0, 160));
  return j.data.id;
}
async function upload(H, conv, msgId, buf, name, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  const r = await api(`/api/message-attachments/${conv}/${msgId}`, { method: 'POST', headers: H, body: fd });
  return { status: r.status, body: await r.json() };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const created = { msgIds: [], attIds: [], paths: [] };
  let browser = null;
  try {
    const { token, user } = await getToken();
    const H = { Authorization: 'Bearer ' + token };
    const biz = user.active_business_id || user.business_id;
    // 이미 있는 대화방 하나를 쓴다 — 새로 만들면 목록에 찌꺼기가 남는다(정리 실패 시 더 아프다).
    const cj = await (await api(`/api/conversations/${biz}`, { headers: H })).json();
    const conv = (cj.data || [])[0];
    if (!conv) throw new Error('대화방이 없다 — 이 워크스페이스로는 잴 수 없다');

    // ── ① 평범한 PNG — 기준선(이것이 깨지면 나머지 판정은 의미가 없다)
    const m1 = await postMessage(H, biz, conv.id, '[canary] png');
    created.msgIds.push(m1);
    const u1 = await upload(H, conv.id, m1, PNG, 'canary-plain.png', 'image/png');
    created.attIds.push(u1.body?.data?.id);
    push('평범한 PNG 에 preview_url 이 실린다',
      !!u1.body?.data?.preview_url, `preview_url=${u1.body?.data?.preview_url || '없음'}`);

    // ── ② 브라우저가 mime 을 모르고 보낸 PNG (이번 세션의 결함 ②)
    const m2 = await postMessage(H, biz, conv.id, '[canary] octet png');
    created.msgIds.push(m2);
    const u2 = await upload(H, conv.id, m2, PNG, 'canary-octet.png', 'application/octet-stream');
    created.attIds.push(u2.body?.data?.id);
    const pv2 = u2.body?.data?.preview_url;
    push('mime 을 모르고 올라온 PNG 도 preview_url 을 받는다',
      !!pv2, `mime=${u2.body?.data?.mime_type} preview_url=${pv2 || '❌ 없음 — 확장자 폴백이 죽었다'}`);
    if (pv2) {
      const r = await api(pv2);
      const ct = r.headers.get('content-type') || '';
      push('그 주소가 **이미지 Content-Type** 으로 응답한다',
        r.status === 200 && ct.startsWith('image/'),
        `status=${r.status} content-type=${ct} — octet-stream 으로 내보내면 <img> 는 안 그린다`);
    }

    // ── ③ 음성 대조군 — PDF 는 이미지가 아니다 (넓히다가 아무거나 열면 안 된다)
    const m3 = await postMessage(H, biz, conv.id, '[canary] pdf');
    created.msgIds.push(m3);
    const u3 = await upload(H, conv.id, m3, PDF, 'canary.pdf', 'application/pdf');
    created.attIds.push(u3.body?.data?.id);
    push('음성 대조군 — PDF 에는 preview_url 이 없다 (파일 카드로 간다)',
      !u3.body?.data?.preview_url, `preview_url=${u3.body?.data?.preview_url || '없음'}`);
    push('음성 대조군 — PDF 는 내려받을 수 있다 (미리보기 드로어의 재료)',
      (await api(`/api/message-attachments/${u3.body?.data?.id}/download`, { headers: H })).status === 200,
      'download 200');

    // ── ④ 음성 대조군 — HEIC 는 브라우저가 못 그린다. 확장자 폴백이 이걸 열면 깨진 아이콘이 뜬다.
    const { serializeMessageAttachment } = require('/opt/planq/dev-backend/services/filePreview');
    const heic = serializeMessageAttachment({
      id: 0, file_name: 'x.heic', mime_type: 'application/octet-stream',
      file_path: 'uploads/x/x.heic', storage_provider: 'planq',
    });
    push('음성 대조군 — HEIC 는 여전히 미리보기 대상이 아니다',
      !heic.preview_url, `preview_url=${heic.preview_url || '없음'}`);

    // ── ⑤ ★ 화면 — **열어 둔 채 받으면** <img> 가 그려지는가 (이번 세션의 결함 ①)
    //    서버는 처음부터 옳았다. 버린 것은 화면의 소켓 매퍼다 — 그래서 여기서만 잡힌다.
    const b = await launch();
    browser = b.browser;
    const page = b.page;
    await login(page);
    await page.goto(`${BASE}/talk?conv=${conv.id}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 4000));
    const before = await page.evaluate(() =>
      document.querySelectorAll('img[src*="/api/message-attachments/public/"]').length);

    const m5 = await postMessage(H, biz, conv.id, '[canary] live png');
    created.msgIds.push(m5);
    const u5 = await upload(H, conv.id, m5, PNG, 'canary-live.png', 'image/png');
    created.attIds.push(u5.body?.data?.id);
    // 소켓으로만 도달해야 한다 — 새로고침하지 않는다(새로고침하면 조회 경로라 늘 통과한다).
    let after = before;
    for (let i = 0; i < 20 && after <= before; i++) {
      await new Promise((r) => setTimeout(r, 500));
      after = await page.evaluate(() =>
        document.querySelectorAll('img[src*="/api/message-attachments/public/"]').length);
    }
    push('★ 열어 둔 채 받은 PNG 가 **새로고침 없이** <img> 로 그려진다',
      after > before,
      `before=${before} after=${after} — 늘지 않으면 소켓 매퍼가 preview_url 을 버린 것이다`);

    // 그려진 이미지가 실제로 **보이는가** (rect 0 이면 그린 것이 아니다 — memory 참조)
    if (after > before) {
      const vis = await page.evaluate(() => {
        const im = [...document.querySelectorAll('img[src*="/api/message-attachments/public/"]')].pop();
        if (!im) return null;
        const r = im.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), complete: im.complete, nw: im.naturalWidth };
      });
      push('그 <img> 가 자리를 차지하고 실제로 디코드됐다',
        !!vis && vis.w > 0 && vis.h > 0 && vis.nw > 0,
        `rect=${vis ? vis.w + 'x' + vis.h : '없음'} naturalWidth=${vis ? vis.nw : '-'}`);
    }
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (browser) { try { await browser.close(); } catch { /* 이미 닫힘 */ } }
    // 만든 것만 지운다. 파일 실체도 같이 — 안 지우면 쿼터 집계에 남는다.
    for (const id of created.attIds.filter(Boolean)) {
      const [[row]] = await sequelize.query('SELECT file_path FROM message_attachments WHERE id = ?', { replacements: [id] }).catch(() => [[]]);
      if (row && row.file_path) {
        const abs = row.file_path.startsWith('/') ? row.file_path : '/opt/planq/dev-backend/' + row.file_path;
        try { fs.unlinkSync(abs); } catch { /* 이미 없음 */ }
      }
      await sequelize.query('DELETE FROM message_attachments WHERE id = ?', { replacements: [id] }).catch(() => {});
    }
    for (const id of created.msgIds.filter(Boolean)) {
      await sequelize.query('DELETE FROM messages WHERE id = ?', { replacements: [id] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run, name: 'chatpreview' };
