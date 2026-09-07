// canary-responsibility-line — 업무의 **책임선이 화면에서도 지켜지는가** (2026-09-07)
//
//   Irene: "작성자가 아니면 업무설명을 수정못하게 하고, 결과물은 담당자만 작성하게 해야 하는데
//           지금 내가 관리자라서 다 되거든." / "owner든 admin이든 누구든 그 기준이 맞는 거 아냐?"
//   그리고: "업무담당자가 아니면 이 멘트 안보여야 하는데 — 확인 요청 중이라 잠겨 있습니다."
//
//   서버(FIELD_RULES)만 막으면 화면은 열려 있고 저장만 실패하는 "저장 실패" 가 된다.
//   여기서는 **화면이 무엇을 보여 주는가**를 잰다 — 편집 가능 여부와 잠금 안내 노출까지.
//   (memory feedback_predicate_must_match_both_sides · feedback_backend_done_ui_missing)
const b = require('./lib/browser');
// ★ dev-backend 의 .env 를 **먼저** 읽는다 — config/database 는 로드 시점에 환경변수를 보고,
//   없으면 "Required DB environment variables not set" 으로 죽는다(실측).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BIZ = 5;
const OTHER_A = 1000024;   // business 5 의 다른 멤버 (작성자 역)
const OTHER_B = 1000287;   // business 5 의 또 다른 멤버 (담당자 역)

// ★ **Irene 이 겪은 조합으로 본다** — platform_admin + 워크스페이스 admin.
//   기본 하니스 계정(health-check)은 owner 이고 `platform_role='user'` 라
//   옛 백도어(`isPlatformAdmin`)를 밟지 않는다 → 옛 규칙을 되살려도 판정이 안 뒤집혔다(실측).
//   그래서 임시 계정을 만들어 그 계정으로 본다. 끝나면 지운다.
const TMP = { email: `rl-canary-${Date.now()}@test.planq.kr`, password: 'RespLineCanary2026!', name: 'RespLine Canary' };

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let taskId = null;
  let tmpId = null;
  const { browser, page } = await b.launch();
  try {
    const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
    const hash = await bcrypt.hash(TMP.password, 12);
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'platform_admin', NOW(), NOW())`,
      { replacements: [TMP.email, hash, TMP.name, `rlcan${Date.now()}`] });
    tmpId = uid;
    await sequelize.query(
      "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'admin', NOW(), NOW())",
      { replacements: [BIZ, tmpId] });
    // 로그인 계정(health-check)은 이 워크스페이스의 **owner** 다. 그런데 이 업무의
    // 작성자도 담당자도 아니다 — 예외 없이 둘 다 읽기 전용이어야 한다.
    const [id] = await sequelize.query(
      `INSERT INTO tasks (business_id, title, description, body, created_by, assignee_id, status, created_at, updated_at)
       VALUES (?, 'RL 카나리 — 제3자 읽기전용', '원본 의뢰', '원본 결과물', ?, ?, 'reviewing', NOW(), NOW())`,
      { replacements: [BIZ, OTHER_A, OTHER_B] });
    taskId = id;

    await b.login(page, TMP);
    await b.goto(page, `/tasks?task=${taskId}`);
    await b.sleep(3500);

    const seen = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const roEditors = Array.from(document.querySelectorAll('[contenteditable]'))
        .map(e => e.getAttribute('contenteditable'));
      const bodyBox = document.querySelector('[data-testid="task-body-editor"]');
      const bodyEditable = bodyBox
        ? Array.from(bodyBox.querySelectorAll('[contenteditable]')).some(e => e.getAttribute('contenteditable') === 'true')
        : null;
      return {
        opened: /원본 의뢰|원본 결과물|RL 카나리/.test(txt),
        lockNotice: /확인 요청 중이라 잠겨 있습니다/.test(txt),
        readOnlyBadge: (txt.match(/읽기 전용/g) || []).length,
        anyEditable: roEditors.includes('true'),
        bodyEditable,
      };
    });

    push('상세가 열렸다', seen.opened, seen.opened ? '업무 상세 렌더 확인' : '상세가 안 열렸다 — 아래 판정은 무의미');
    push('담당자 아닌 사람에게 잠금 안내 없음', !seen.lockNotice,
      seen.lockNotice ? '🔴 "확인 요청 중이라 잠겨 있습니다" 가 담당자도 아닌 사람에게 떴다' : '잠금 안내 미노출 (담당자에게 하는 말이므로 정상)');
    push('결과물 입력 불가', seen.bodyEditable === false,
      `결과물 에디터 editable=${seen.bodyEditable}`);
    push('읽기 전용 표시가 있다', seen.readOnlyBadge > 0,
      `"읽기 전용" 뱃지 ${seen.readOnlyBadge}개 — 왜 못 쓰는지 화면이 말해야 한다`);
    push('편집 가능한 칸이 하나도 없다', !seen.anyEditable,
      seen.anyEditable ? '🔴 contenteditable=true 인 칸이 남아 있다' : 'contenteditable=true 0개');
  } finally {
    // ★ 원복은 브라우저를 닫기 **전에**. 카나리가 남긴 데이터가 뒤 스위트의 판정을 바꾸면
    //   게이트 전체를 못 믿는다(memory feedback_guard_restore_races_with_ui).
    if (taskId) await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [taskId] }).catch(() => null);
    if (tmpId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [tmpId] }).catch(() => null);
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [tmpId] }).catch(() => null);
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [tmpId] }).catch(() => null);
    }
    await browser.close().catch(() => null);
    // ★ 2026-09-07 — **DB 풀을 닫는다.** 안 닫으면 이 카나리가 연결을 쥔 채 끝나고,
    //   같은 실행의 뒤 스위트가 "Too many connections"(dev max_connections=50)로 죽는다.
    //   실측: 전체 스위트 끝에서 FATAL. 검사기가 다른 검사를 죽이면 게이트 전체를 못 믿는다.
    await sequelize.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'respline', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
