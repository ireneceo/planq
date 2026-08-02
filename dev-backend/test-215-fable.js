// #215 Fable 구현 검증 게이트 — 실 HTTP + 실 DB (검증 후 삭제)
require('dotenv').config();
const { sequelize } = require('./config/database');

const BASE = 'http://localhost:3003';
let PASS = 0, FAIL = 0;
function check(name, ok, extra) {
  if (ok) { PASS++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { FAIL++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('login failed: ' + JSON.stringify(j));
  return j.data.accessToken || j.data.access_token || j.data.token;
}

(async () => {
  await sequelize.authenticate();
  const q = async (sql, repl) => (await sequelize.query(sql, { replacements: repl }))[0];

  // ── 표본 발굴 ──
  const [att1222] = await q(`SELECT a.id, a.file_id, a.filename, a.size_bytes, a.mime_type, a.is_inline, a.content_id,
        m.id AS msg_id, m.thread_id, t.business_id
      FROM email_attachments a JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
      WHERE a.id=1222`);
  console.log('att1222:', JSON.stringify(att1222));

  // SVG cid 메시지 (biz 5) — inline_images 기대
  const [svgMsg] = await q(`SELECT a.id AS att_id, a.file_id, a.content_id, m.id AS msg_id, m.thread_id, t.business_id
      FROM email_attachments a JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
      WHERE a.mime_type='image/svg+xml' AND t.business_id=5 AND a.is_inline=1 LIMIT 1`);
  console.log('svgMsg:', JSON.stringify(svgMsg));

  // rfc822-headers 표본 (biz 5)
  const [noise] = await q(`SELECT a.id AS att_id, m.id AS msg_id, m.thread_id
      FROM email_attachments a JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
      WHERE a.mime_type='text/rfc822-headers' AND t.business_id=5 LIMIT 1`);
  console.log('noise:', JSON.stringify(noise));

  // 경계: content_id NULL 첨부 (biz 5)
  const [cidNull] = await q(`SELECT a.id AS att_id, m.id AS msg_id, m.thread_id
      FROM email_attachments a JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
      WHERE a.content_id IS NULL AND t.business_id=5
        AND a.mime_type NOT IN ('text/rfc822-headers','message/delivery-status','text/x-amp-html') LIMIT 1`);
  console.log('cidNull:', JSON.stringify(cidNull));

  // 경계: body_html NULL(text-only) 메일의 첨부 (전 biz — biz 5 우선)
  const bodyNullRows = await q(`SELECT a.id AS att_id, a.content_id, m.id AS msg_id, m.thread_id, t.business_id
      FROM email_attachments a JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
      WHERE m.body_html IS NULL
        AND a.mime_type NOT IN ('text/rfc822-headers','message/delivery-status','text/x-amp-html')
      ORDER BY (t.business_id=5) DESC LIMIT 3`);
  console.log('bodyNull:', JSON.stringify(bodyNullRows));

  const token = await login();
  const H = { Authorization: 'Bearer ' + token };
  const detail = async (biz, tid) => {
    const r = await fetch(`${BASE}/api/businesses/${biz}/email-threads/${tid}`, { headers: H });
    return { status: r.status, j: await r.json().catch(() => null) };
  };

  // ── 시나리오 1: 옛 데이터 att 1222 출현 ──
  console.log('\n[1] att 1222 (옛 is_inline=1 이력, PDF) 칩 출현');
  {
    const { status, j } = await detail(att1222.business_id, att1222.thread_id);
    const msg = j?.data?.messages?.find(m => m.id === att1222.msg_id);
    const hit = msg?.attachments?.find(a => a.id === 1222);
    check('GET detail 200', status === 200, 'status=' + status);
    check('att 1222 attachments 에 출현', !!hit, hit ? `file_name=${hit.file_name} mime=${hit.mime_type}` : 'msg atts=' + JSON.stringify(msg?.attachments?.map(a => a.id)));
    check('file_id 존재(다운로드 가능)', !!hit?.file_id, 'file_id=' + hit?.file_id);
  }

  // ── 시나리오 2: SVG cid — 칩 부재 + inline_images 존재 ──
  console.log('\n[2] 본문 cid 참조 SVG — 칩 숨김 + inline_images');
  {
    const { j } = await detail(svgMsg.business_id, svgMsg.thread_id);
    const msg = j?.data?.messages?.find(m => m.id === svgMsg.msg_id);
    const inAtt = msg?.attachments?.some(a => a.id === svgMsg.att_id);
    const inl = (msg?.inline_images || []).find(x => x.file_id === svgMsg.file_id);
    check('attachments 에 부재', !inAtt);
    check('inline_images 에 존재 (file_id+content_id)', !!inl && !!inl.content_id, JSON.stringify(inl));
  }

  // ── 시나리오 3: rfc822-headers 칩 부재 ──
  console.log('\n[3] 반송 헤더(rfc822-headers) 노이즈 숨김');
  {
    const { j } = await detail(5, noise.thread_id);
    const msg = j?.data?.messages?.find(m => m.id === noise.msg_id);
    const inAtt = msg?.attachments?.some(a => a.id === noise.att_id);
    check('노이즈 칩 부재', msg ? !inAtt : false, 'msg found=' + !!msg);
  }

  // ── 시나리오 4: 다운로드 게이트 생존 (att 1222 file) ──
  console.log('\n[4] GET /api/files/5/{fid}/download — 200 + mime + 바이트 일치');
  {
    const r = await fetch(`${BASE}/api/files/5/${att1222.file_id}/download`, { headers: H });
    const buf = Buffer.from(await r.arrayBuffer());
    const [frow] = await q(`SELECT file_size, mime_type FROM files WHERE id=:id`, { id: att1222.file_id });
    check('200', r.status === 200, 'status=' + r.status);
    check('Content-Type PDF', String(r.headers.get('content-type') || '').includes('pdf'), r.headers.get('content-type'));
    check('바이트 수 = files.file_size', buf.length === Number(frow.file_size), `${buf.length} vs ${frow.file_size}`);
    check('PDF 매직바이트', buf.slice(0, 4).toString() === '%PDF', buf.slice(0, 8).toString());
  }

  // ── 시나리오 5: 멀티테넌트 — biz5 토큰으로 biz3 파일 ──
  console.log('\n[5] 멀티테넌트 격리 — biz 3 파일 다운로드 거부');
  {
    const [b3f] = await q(`SELECT f.id FROM files f JOIN email_attachments a ON a.file_id=f.id
        JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
        WHERE t.business_id=3 AND f.deleted_at IS NULL LIMIT 1`);
    const r = await fetch(`${BASE}/api/files/3/${b3f.id}/download`, { headers: H });
    check('403/404 거부', r.status === 403 || r.status === 404, 'status=' + r.status + ' (file ' + b3f.id + ')');
    // 스레드도
    const r2 = await fetch(`${BASE}/api/businesses/3/email-threads/1`, { headers: H });
    check('biz3 스레드 접근 거부', r2.status === 403 || r2.status === 404, 'status=' + r2.status);
  }

  // ── 시나리오 6: F — 개인 L1 스코프 실측 (함수 직접) ──
  console.log('\n[6] Part F — canAccessFileByLevel 실측 (file 2699 개인 / file 84 회사)');
  {
    const { canAccessFileByLevel } = require('./middleware/access_scope');
    const { File } = require('./models');
    const f2699 = await File.findByPk(2699);
    const f84 = await File.findByPk(84);
    console.log('  file2699:', JSON.stringify({ biz: f2699.business_id, vlevel: f2699.vlevel, vis: f2699.visibility, up: f2699.uploader_id }));
    const r3 = await canAccessFileByLevel(3, f2699);
    const r7 = await canAccessFileByLevel(7, f2699);
    const r16 = await canAccessFileByLevel(16, f2699);
    const r17 = await canAccessFileByLevel(17, f2699);
    check('user 3 (계정 주인) ALLOW', !!r3);
    check('user 7 DENY', !r7);
    check('user 16 DENY', !r16);
    check('user 17 DENY', !r17);
    check('회사 파일 84 L3 불변', f84.vlevel === 'L3' && f84.visibility === 'L3', `${f84.vlevel}/${f84.visibility}`);
    const c3 = await canAccessFileByLevel(1000024, f84);   // file 84 = biz 5 — biz 5 의 비업로더 멤버로 판정
    check('회사 파일 84(biz5 L3) 멤버 ALLOW 유지', !!c3);
    // 회사 계정(owner_user_id NULL) 첨부 파일 L1 오염 0 확인
    const [cnt] = await q(`SELECT COUNT(*) n FROM files f JOIN email_attachments a ON a.file_id=f.id
        JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
        JOIN email_accounts ea ON ea.id=t.account_id
        WHERE ea.owner_user_id IS NULL AND f.vlevel='L1'`);
    check('회사 계정 첨부 중 L1 = 0건', Number(cnt.n) === 0, 'n=' + cnt.n);
    const [pcnt] = await q(`SELECT SUM(f.vlevel='L1') l1, COUNT(*) total FROM files f JOIN email_attachments a ON a.file_id=f.id
        JOIN email_messages m ON m.id=a.message_id JOIN email_threads t ON t.id=m.thread_id
        JOIN email_accounts ea ON ea.id=t.account_id
        WHERE ea.owner_user_id IS NOT NULL AND f.deleted_at IS NULL`);
    check('개인 계정 첨부 L1 전환 완료', Number(pcnt.l1) === Number(pcnt.total), `${pcnt.l1}/${pcnt.total}`);
  }

  // ── 시나리오 7: 경계 fail-open ──
  console.log('\n[7] 경계 — content_id NULL / body_html NULL → 표시');
  {
    const { j } = await detail(5, cidNull.thread_id);
    const msg = j?.data?.messages?.find(m => m.id === cidNull.msg_id);
    check('content_id NULL 첨부 표시', !!msg?.attachments?.some(a => a.id === cidNull.att_id));
    const bn = bodyNullRows.find(r => r.business_id === 5);
    if (bn) {
      const { j: j2 } = await detail(5, bn.thread_id);
      const m2 = j2?.data?.messages?.find(m => m.id === bn.msg_id);
      check('body_html NULL 메일 첨부 표시', !!m2?.attachments?.some(a => a.id === bn.att_id), 'att ' + bn.att_id);
    } else if (bodyNullRows.length) {
      // biz 5 에 표본 없음 — 술어 직접 실측 (본문 없으면 무조건 false=표시)
      const { isEmbedded } = require('./services/emailAttachments');
      check('body_html NULL → isEmbedded=false (타 biz 표본, 술어 직접)', isEmbedded(bodyNullRows[0].content_id, null) === false, 'att ' + bodyNullRows[0].att_id + ' biz ' + bodyNullRows[0].business_id);
    } else {
      check('body_html NULL 표본', false, '표본 자체가 없음');
    }
  }

  // ── DB 분포 재확인 ──
  console.log('\n[8] 백필 후 분포');
  {
    const [dist] = await q(`SELECT SUM(is_inline=1) i1, SUM(is_inline=0) i0, COUNT(*) total FROM email_attachments`);
    console.log('  is_inline 분포:', JSON.stringify(dist));
    check('is_inline=1 이 6건 (본문 실참조만)', Number(dist.i1) === 6, `i1=${dist.i1} i0=${dist.i0}`);
  }

  console.log(`\n════ 결과: PASS ${PASS} / FAIL ${FAIL} ════`);
  await sequelize.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('스크립트 오류:', e); process.exit(2); });
