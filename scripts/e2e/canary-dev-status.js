// scripts/e2e/canary-dev-status.js — 개발 현황(/admin/dev-status) 이 **내용을 보여주는가**.
//
// ★ 2026-09-18 신고 (Irene): "관리자에서 개발현황이 제대로 저장이 안되는데. 내용들이. 다 비어서 나와."
//   저장은 멀쩡했다. `docs/dev-status/next.json` 이 대부분 섹션을 **문자열 배열**로 적었는데
//   화면은 `it.title || it.area || … || '—'` 로 **객체 필드**를 읽어 전부 '—' 로 떨어졌다.
//   건수(3·3·1·3·4)는 맞고 내용만 비는 모양이라 사용자에게는 «저장이 안 됐다» 로 보인다.
//   발행 검증도 `verified`·`severity` 같은 **선택 필드만** 보고 「제목이 있는가」 를 안 봤다.
//
// ★ 왜 정적 검사로 안 되는가 — 이 결함은 «JSON 의 모양» 과 «화면이 읽는 필드» 가 **합쳐진 뒤에만**
//   존재한다. 두 파일을 각각 읽으면 둘 다 멀쩡해 보인다. 그래서 실 API + 실화면으로 잰다.
//   그리고 **'—' 가 아니라 심은 문장이 실제로 보이는지**를 판정한다(존재 검사로는 안 잡힌다).
const b = require('./lib/browser');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';

// 운영 v1.52.11 이 실제로 저장하고 있던 모양 — 대부분 섹션이 **문자열**이다.
const PROBE = '자동검사 문장-DEVSTATUS';
const STRING_SECTIONS = {
  completed: [{ title: `${PROBE} 완료항목`, verified: 'fable_pass' }],
  issues: [`${PROBE} 이슈항목`],
  behavior_changes: [`${PROBE} 동작변경항목`],
  check_areas: [`${PROBE} 체크영역항목`],
  blocked_on_human: [`${PROBE} 사람손항목`],
  backlog: [`${PROBE} 앞으로할것`],
  tooling_health: [`${PROBE} 도구상태항목`],
};

async function seedRow(commitTo) {
  await sequelize.query(
    `INSERT INTO dev_status_reports
       (commit_to, commit_from, version, deployed_at, backup_dir, closed_feedback_ids, kept_open_ids,
        pdf_check, release_note_published, schema_changed, sections, created_at, updated_at)
     VALUES (?, 'aaaaaaa', '0.0.0-canary', NOW(), '/tmp/canary', '[]', '[]', 'OK', 0, 0, ?, NOW(), NOW())`,
    { replacements: [commitTo, JSON.stringify(STRING_SECTIONS)] },
  );
}

/** publish 스크립트를 돌려 종료코드를 본다 — 검증이 실제로 막는가. */
function publishDryRun(sections) {
  const f = path.join(os.tmpdir(), `devstatus-canary-${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify(sections));
  try {
    execFileSync('node', ['scripts/publish-dev-status.js', f, '--dry-run'],
      { cwd: '/opt/planq/dev-backend', stdio: 'pipe' });
    return { code: 0 };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stderr || '').slice(0, 200) };
  } finally { try { fs.unlinkSync(f); } catch { /* ignore */ } }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: msg ? [msg] : [] });
  const commitTo = 'fedcba9' + String(Date.now()).slice(-8) + '0'.repeat(25);
  const cred = { email: `devstatus-${Date.now()}@test.planq.kr`, password: 'DevStatus2026!' };
  let uid = null;

  try {
    // ① 발행 검증 — 제목 없는 항목은 **막힌다**(음성 대조군: 문자열 항목은 통과한다)
    const bad = publishDryRun({ issues: [{ severity: 'high' }] });       // 제목 없음
    const good = publishDryRun({ issues: [`${PROBE} 문자열`] });          // 문자열 = 정식 입력
    push('발행 검증 — 제목 없는 항목 차단', bad.code !== 0,
      `제목 없음 exit=${bad.code}${bad.code === 0 ? ' ← ❌ 통과해 버렸다' : ''}`);
    push('발행 검증 — 문자열 항목 통과(음성 대조군)', good.code === 0,
      `문자열 exit=${good.code}${good.code !== 0 ? ` ← ❌ 정상 입력을 막았다 ${good.out || ''}` : ''}`);

    // ② 임시 platform_admin — 약관 **버전**까지 채운다(재동의 모달이 화면 판정을 위조한다)
    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'DevStatus Canary', ?, 'platform_admin', ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `dvst${Date.now()}`,
                       (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;

    await seedRow(commitTo);

    // ③ API — 저장된 **문자열** 행이 읽을 때 정규화되는가 (이미 나간 행이 재발행 없이 치유되는 길)
    const lr = await fetch(`${BACKEND}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred),
    });
    const token = (await lr.json())?.data?.token;
    if (!token) { push('API — 로그인', false, `login ${lr.status}`); return results; }

    const dr = await fetch(`${BACKEND}/api/admin/dev-status/${commitTo.slice(0, 12)}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const detail = (await dr.json())?.data;
    const secs = detail?.sections || {};
    const TITLE_KEYS = ['title', 'area', 'what', 'tool', 'script', 'subject'];
    let items = 0, titled = 0;
    for (const k of Object.keys(STRING_SECTIONS)) {
      for (const it of (secs[k] || [])) {
        items++;
        if (it && typeof it === 'object' && TITLE_KEYS.some((t) => typeof it[t] === 'string' && it[t].trim())) titled++;
      }
    }
    // ★ 「0건이라 통과」 를 막는다 — 심은 항목 수만큼 와야 한다(빈 fixture 거짓 판정 차단)
    const expected = Object.values(STRING_SECTIONS).reduce((n, a) => n + a.length, 0);
    if (items !== expected) {
      results.push({ name: 'API — 문자열 항목 정규화', unmeasured: true,
        details: [`항목 ${items} ≠ 심은 ${expected} — 검사가 대상을 못 집었다(판정 불가)`] });
    } else {
      push('API — 문자열 항목 정규화', titled === items, `제목 있는 항목 ${titled}/${items}`);
    }

    // ④ 화면 — 실제로 **글자가 보이는가**. '—' 로 떨어진 행이 있으면 실패.
    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page, cred);
      await b.goto(page, '/admin/dev-status');   // 가장 최근 배포가 자동 선택된다(심은 행이 NOW())
      await b.sleep(3500);
      const st = await page.evaluate((probe) => {
        const txt = document.body.innerText || '';
        // 섹션 행 제목 — 데이터가 들어간 행만 센다
        const rows = Array.from(document.querySelectorAll('section div'))
          .map((el) => (el.textContent || '').trim());
        return {
          probeHits: (txt.match(new RegExp(probe, 'g')) || []).length,
          hasDash: /(^|\n)\s*—\s*(\n|$)/.test(txt),
          // 「이전 — 이후 —」 빈 diff 칸이 떴는가 (문자열 항목엔 전/후가 없다)
          emptyDiff: /이전\s*—/.test(txt) && /이후\s*—/.test(txt),
          len: txt.length,
          rowsSampled: rows.length,
        };
      }, PROBE);

      if (!st.len) {
        results.push({ name: '화면 — 항목 글자 가시', unmeasured: true, details: ['화면이 비었다 — 판정 불가'] });
      } else {
        push('화면 — 항목 글자 가시', st.probeHits >= expected,
          `심은 문장 ${st.probeHits}회 노출 / 기대 ${expected}회${st.probeHits < expected ? " ← ❌ '—' 로 떨어졌다" : ''}`);
        push('화면 — 빈 「이전/이후」 칸 없음', !st.emptyDiff,
          st.emptyDiff ? '❌ 문자열 항목에 빈 diff 칸이 떴다' : '전/후 없는 항목은 칸을 안 만든다');
      }
    } finally { try { await browser.close(); } catch { /* ignore */ } }
  } catch (e) {
    results.push({ name: 'canary-dev-status', fail: 1, details: [String(e.message).slice(0, 160)] });
  } finally {
    // 남긴 상태가 다음 검사를 죽인다 — 반드시 치운다
    try { await sequelize.query('DELETE FROM dev_status_reports WHERE commit_to = ?', { replacements: [commitTo] }); } catch { /* ignore */ }
    try { if (uid) await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }); } catch { /* ignore */ }
  }
  return results;
}

module.exports = { run, name: 'canary-dev-status' };
