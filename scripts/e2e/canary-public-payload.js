// canary-public-payload — **무인증 공개 응답은 화면이 쓰는 것만 싣는다** (2026-09-09)
//
// 왜: 오늘 같은 계열 결함이 두 곳에서 나왔다.
//   ① Q info 공개 문서(#408) — `custom_values` 를 통째로 실어 **지운 항목의 값**이 나갔다.
//      게다가 항목으로 합성한 `body` 가 재계산되지 않아 거기로도 나갔다.
//   ② Q docs 공개 문서 — `toJSON()` 에서 두 필드만 지우는 **블랙리스트**라
//      **서명자 이메일·IP·손글씨 서명 이미지·서명 메모**와 내부 AI 프롬프트가 그대로 나갔다.
//
//   둘 다 화면에는 안 그려진다. **보이지 않는 것과 나가지 않는 것은 다르다** —
//   그래서 이 카나리는 렌더 결과가 아니라 **응답 raw 문자열**을 스캔한다.
//
//   ★ 가릴 때는 지울 것을 열거하지 말고 남길 것만 남긴다(화이트리스트).
//     열거 방식은 컬럼이 늘 때마다 조용히 새므로, 이 카나리는 **컬럼이 늘어도** 잡는다
//     (내부 FK·security_level 같은 "있으면 안 되는 이름" 을 함께 본다).
//
//   음성 대조군을 반드시 같이 잰다 — 전부 지워 버리면 공개 페이지가 빈 화면이 된다.
//   "안 나간다" 만 재면 그 사고를 통과로 읽는다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const API = process.env.E2E_API || 'http://localhost:3003';
const CRED = {
  email: process.env.E2E_EMAIL || 'health-check@planq.kr',
  password: process.env.E2E_PASSWORD || 'HealthCheck2026!',
};

// 새면 안 되는 값 — 씨앗에 심어 두고 응답 raw 에서 찾는다.
const SEC = {
  email: 'signer-secret@example.test',
  note: 'NOTE-DO-NOT-LEAK-9911',
  img: 'data:image/png;base64,AAAASIGNATUREIMAGE9911',
  removedVal: 'https://example.test/removed-9911',
};
// 이름만으로도 새면 안 되는 내부 필드
const FORBIDDEN_KEYS = /"(signed_ip|ai_prompt|search_text|security_level|created_by|updated_by|share_password_hash|business_id|client_id|conversation_id)"/;

async function run() {
  const results = [];
  const push = (name, ok, details) => results.push({ name, fail: ok ? 0 : 1, details: [details] });
  const made = { docs: [], kb: [] };
  let H = null;

  try {
    const lr = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CRED, client_kind: 'web' }),
    });
    const login = await lr.json();
    const token = login.data && (login.data.accessToken || login.data.access_token || login.data.token);
    if (!token) throw new Error('로그인 실패: ' + JSON.stringify(login).slice(0, 160));
    H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    const me = await (await fetch(`${API}/api/auth/me`, { headers: H })).json();
    const biz = (me.data.businesses && me.data.businesses[0] && me.data.businesses[0].id) || me.data.active_business_id;
    if (!biz) throw new Error('워크스페이스 없음');

    // ───────── ① Q docs 공개 문서 — 서명자 개인정보 ─────────
    let r = await fetch(`${API}/api/docs/documents`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        business_id: biz, kind: 'custom', title: '[카나리] 공개 응답',
        body_json: { blocks: [{ type: 'p', text: 'BODY-KEEP-9911' }] },
      }),
    });
    const doc = (await r.json()).data;
    made.docs.push(doc.id);
    const sh = await (await fetch(`${API}/api/docs/documents/${doc.id}/share`, {
      method: 'POST', headers: H, body: JSON.stringify({}),
    })).json();
    const dTok = (sh.data && (sh.data.share_token
      || (sh.data.share && sh.data.share.share_token)
      || String(sh.data.share_url || '').split('/').pop())) || null;
    push('① 공유 토큰 발급(전제)', !!dTok, JSON.stringify(sh).slice(0, 100));

    if (dTok) {
      await fetch(`${API}/api/docs/public/${dTok}/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_name: '서명자카나리', signer_email: SEC.email, accept: true,
          note: SEC.note, signature_image_b64: SEC.img,
        }),
      });
      const raw = await (await fetch(`${API}/api/docs/public/${dTok}`)).text();
      push('① 서명자 이메일이 안 나간다', !raw.includes(SEC.email), raw.includes(SEC.email) ? '유출!' : 'ok');
      push('① 서명 메모가 안 나간다', !raw.includes(SEC.note), raw.includes(SEC.note) ? '유출!' : 'ok');
      push('① 손글씨 서명 이미지가 안 나간다', !raw.includes('SIGNATUREIMAGE9911'), raw.includes('SIGNATUREIMAGE9911') ? '유출!' : 'ok');
      const hit = raw.match(FORBIDDEN_KEYS);
      push('① 내부 필드 이름이 안 나간다(IP·프롬프트·내부FK 등)', !hit, hit ? '유출 키: ' + hit[0] : 'ok');
      // 음성 대조군 — 화면이 쓰는 것은 나가야 한다
      push('① 음성 대조군 — 본문·제목·서명자 이름은 나간다',
        raw.includes('BODY-KEEP-9911') && raw.includes('공개 응답') && raw.includes('서명자카나리'),
        '전부 지워 버리면 공개 페이지가 빈 화면이 된다');
    }

    // ───────── ② Q info 공개 문서 — 지운 항목의 값 ─────────
    const cols = [
      { id: 'cpp_gone', name: '지울항목', type: 'url', show_in_list: true },
      { id: 'cpp_keep', name: '남을항목', type: 'text', show_in_list: true },
    ];
    r = await fetch(`${API}/api/businesses/${biz}/kb/documents`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        title: '[카나리] 공개 응답 kb', category: 'manual', scope: 'workspace',
        custom_columns: cols, custom_values: { cpp_gone: SEC.removedVal, cpp_keep: 'KEEP-9911' },
      }),
    });
    const kb = (await r.json()).data;
    made.kb.push(kb.id);
    // 항목만 지운다(값은 머지 저장이라 DB 에 남는다 — 그게 이 검사의 전제다)
    await fetch(`${API}/api/businesses/${biz}/kb/documents/${kb.id}`, {
      method: 'PUT', headers: H, body: JSON.stringify({ custom_columns: [cols[1]] }),
    });
    const kTok = 'cpp' + Math.random().toString(36).slice(2, 12);
    await sequelize.query(
      "UPDATE kb_documents SET share_token = ?, security_level = 'general', shared_at = NOW(), share_expires_at = NULL, share_password_hash = NULL WHERE id = ?",
      { replacements: [kTok, kb.id] },
    );
    const [chk] = await sequelize.query(
      "SELECT JSON_EXTRACT(custom_values, '$.cpp_gone') v FROM kb_documents WHERE id = ?",
      { replacements: [kb.id], type: sequelize.QueryTypes.SELECT },
    );
    push('② 전제 — 지운 값이 DB 에는 남아 있다', String(chk && chk.v).includes('removed-9911'), JSON.stringify(chk));

    const kRaw = await (await fetch(`${API}/api/kb-documents/public/by-token/${kTok}`)).text();
    push('② 지운 항목의 값이 안 나간다', !kRaw.includes(SEC.removedVal), kRaw.includes(SEC.removedVal) ? '유출!' : 'ok');
    push('② 예약키(__removed_cols)가 안 나간다', !kRaw.includes('__removed_cols'), 'ok');
    push('② 음성 대조군 — 남은 항목 값은 나간다', kRaw.includes('KEEP-9911'), '필터가 전부를 지운 게 아니다');
  } catch (e) {
    results.push({ name: 'public-payload:하니스', error: true, fatal: 1, details: [e.message] });
  } finally {
    try {
      for (const id of made.kb) await sequelize.query('DELETE FROM kb_documents WHERE id = ?', { replacements: [id] });
      for (const id of made.docs) await sequelize.query('DELETE FROM documents WHERE id = ?', { replacements: [id] });
    } catch { /* */ }
    // ★ 공유 DB 풀은 닫지 않는다 — 러너가 다음 카나리에서도 쓴다(전에 닫아서 뒤 suite 를 죽인 적이 있다).
  }
  return results;
}

module.exports = { name: 'public-payload — 무인증 응답은 화면이 쓰는 것만 싣는다', run };
if (require.main === module) {
  run().then((r) => {
    r.forEach((x) => console.log((x.fail || x.fatal ? '❌' : '✅'), x.name, '—', (x.details || []).join(' ')));
    process.exit(r.some((x) => x.fail || x.fatal) ? 1 : 0);
  });
}
