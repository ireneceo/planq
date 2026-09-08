// canary-series-scope — 반복업무 수정이 **세 범위 모두** 내용까지 적용되는가 (2026-09-08)
//
//   Irene: "반복업무 내용 수정을 모든 업무 수정하기, 이 업무만 수정하기, 이 업무부터 뒤의 업무들
//          수정하기 적용해서 반복설정 및 내용 다 적용하게 해야해. 업무가 반복된다는 건 내용도
//          반복관리가 되어야 하잖아. 이게 계속 요구하는데 안되네."
//
//   본문 필드(PUT)에는 범위가 붙어 있었는데 **태그는 별도 라우트**라 범위 개념이 아예 없었다.
//   그래서 제목은 시리즈 전체에 반영되는데 태그만 이 회차에 남았다 — 사용자에겐 둘 다 "내용" 이다.
//
//   여기서 재는 것:
//     ① single — 이 회차만 (음성 대조군: 다른 회차가 안 바뀐다)
//     ② all    — 취소 제외 전 회차
//     ③ future — 이 회차 + 마감일이 뒤인 회차 + 부모. **앞 회차는 그대로**(음성 대조군)
//     ④ 태그도 같은 범위를 지난다 (별도 라우트가 갈라지지 않았는가)
//     ⑤ 프론트/백엔드 공유 필드 목록이 어긋나지 않았는가 — 어긋나면 화면이 묻지 않아 도달 불가
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');

const API = process.env.E2E_API || 'http://localhost:3003';
const BIZ = 5;

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  const made = { userId: null, taskIds: [], tagId: null };
  try {
    // ── ⑤ 두 목록 대조 (DB 없이도 성립하는 정적 검사) ─────────────
    const back = require('/opt/planq/dev-backend/services/taskSeriesScope').SERIES_CONTENT_FIELDS;
    const src = fs.readFileSync('/opt/planq/dev-frontend/src/utils/taskSeries.ts', 'utf-8');
    const m = src.match(/export const TASK_SERIES_FIELDS = \[([\s\S]*?)\];/);
    const front = m ? (m[1].match(/'([a-z_]+)'/g) || []).map((x) => x.replace(/'/g, '')) : [];
    const onlyBack = back.filter((f) => !front.includes(f));
    const onlyFront = front.filter((f) => !back.includes(f));
    push('시리즈 공유 필드 목록이 프론트·백엔드에서 같다',
      onlyBack.length === 0 && onlyFront.length === 0,
      `백엔드만: [${onlyBack}] · 프론트만: [${onlyFront}] — 백엔드에만 있으면 화면이 안 물어 도달 불가다`);

    // ── 시드: 부모 1 + 회차 3 ────────────────────────────────
    const stamp = Date.now();
    const cred = { email: `ss-canary-${stamp}@test.planq.kr`, password: 'SeriesScope2026!' };
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'SeriesScope Canary', ?, 'user', NOW(), NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `sscan${stamp}`] });
    made.userId = uid;
    await sequelize.query("INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', NOW(), NOW())",
      { replacements: [BIZ, uid] });

    const [pid] = await sequelize.query(
      `INSERT INTO tasks (business_id, title, created_by, assignee_id, status, due_date, recurrence_rule, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'not_started', '2026-10-05', 'FREQ=WEEKLY;INTERVAL=1', NOW(), NOW())`,
      { replacements: [BIZ, `시리즈카나리 ${stamp}`, uid, uid] });
    made.taskIds.push(pid);
    const instIds = [];
    for (const d of ['2026-10-12', '2026-10-19', '2026-10-26']) {
      const [iid] = await sequelize.query(
        `INSERT INTO tasks (business_id, title, created_by, assignee_id, status, due_date, recurrence_parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'not_started', ?, ?, NOW(), NOW())`,
        { replacements: [BIZ, `시리즈카나리 ${stamp}`, uid, uid, d, pid] });
      instIds.push(iid); made.taskIds.push(iid);
    }
    const token = await (async () => {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred),
      });
      const j = await r.json();
      return j?.data?.token || j?.data?.accessToken;
    })();
    const put = (id, body) => fetch(`${API}/api/tasks/by-business/${BIZ}/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const titles = async () => (await sequelize.query(
      'SELECT id, due_date, title FROM tasks WHERE id = ? OR recurrence_parent_id = ? ORDER BY due_date',
      { replacements: [pid, pid], type: sequelize.QueryTypes.SELECT }));

    // ① single
    let r = await put(pid, { title: `T-single-${stamp}` });
    let rows = await titles();
    push('single — 이 회차만 바뀐다 (음성 대조군)',
      r.status === 200 && rows.filter((x) => x.title === `T-single-${stamp}`).length === 1,
      `status=${r.status} · 바뀐 행 ${rows.filter((x) => x.title === `T-single-${stamp}`).length}건 (1 이어야 한다)`);

    // ② all
    r = await put(pid, { title: `T-all-${stamp}`, series_scope: 'all' });
    rows = await titles();
    push('all — 전 회차가 바뀐다',
      r.status === 200 && rows.every((x) => x.title === `T-all-${stamp}`),
      `status=${r.status} · ${rows.filter((x) => x.title === `T-all-${stamp}`).length}/${rows.length}건`);

    // ③ future — 가운데 회차(2026-10-19)에서
    const mid = instIds[1];
    r = await put(mid, { title: `T-future-${stamp}`, series_scope: 'future' });
    rows = await titles();
    const byId = Object.fromEntries(rows.map((x) => [x.id, x.title]));
    const earlier = byId[instIds[0]];                       // 2026-10-12 — 바뀌면 안 된다
    const later = [byId[mid], byId[instIds[2]]];            // 이 회차 + 뒤
    push('future — 이 회차와 뒤 회차만 바뀐다',
      r.status === 200 && later.every((t) => t === `T-future-${stamp}`),
      `이 회차·뒤: ${JSON.stringify(later)}`);
    push('future — 앞 회차는 그대로다 (음성 대조군)',
      earlier === `T-all-${stamp}`,
      `앞 회차 "${earlier}" — 바뀌었으면 "이 업무부터 뒤" 가 아니라 전체를 고친 것이다`);
    push('future — 부모(앞으로 생길 회차의 원본)도 따라간다',
      byId[pid] === `T-future-${stamp}`,
      `부모 "${byId[pid]}" — 안 따라가면 다음 회차가 옛 내용으로 태어난다`);

    // ④ 태그 — 별도 라우트도 같은 범위를 지나는가
    const [tagId] = await sequelize.query(
      'INSERT INTO task_tags (business_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      { replacements: [BIZ, `카나리태그${stamp}`, uid] });
    made.tagId = tagId;
    const tr = await fetch(`${API}/api/tasks/${pid}/tags`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tag_ids: [tagId], series_scope: 'all' }),
    });
    const [linked] = await sequelize.query(
      'SELECT COUNT(*) n FROM task_tag_links WHERE tag_id = ?', { replacements: [tagId] });
    push('태그도 시리즈 범위를 지난다',
      tr.status === 200 && Number(linked[0].n) === rows.length,
      `status=${tr.status} · 연결 ${linked[0].n}건 / 회차 ${rows.length}건 — 1건이면 이 라우트만 갈라진 것`);

    // 음성 대조군 — scope 없이 태그를 빼면 이 회차만 빠져야 한다
    const tr2 = await fetch(`${API}/api/tasks/${instIds[0]}/tags`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tag_ids: [] }),
    });
    const [after] = await sequelize.query(
      'SELECT COUNT(*) n FROM task_tag_links WHERE tag_id = ?', { replacements: [tagId] });
    push('태그 — 범위를 안 주면 이 회차만 (음성 대조군)',
      tr2.status === 200 && Number(after[0].n) === rows.length - 1,
      `status=${tr2.status} · 남은 연결 ${after[0].n}건 (${rows.length - 1} 이어야 한다)`);
    // ⑦ 못 한 회차 정책 — **시리즈 값**이다 (2026-09-08 신고).
    //   Irene: "저장하지 말고 넘기기 설정해도 안바뀌고 있어."
    //   화면은 열려 있는 **회차**에서 이 값을 고치는데, 정리 엔진
    //   (`recurringTaskGenerator.skipMissedOccurrences`)은 **부모의** 값만 읽는다.
    //   여태 회차 행에 저장돼서 아무 일도 일어나지 않았다 —
    //   운영 실측: 자식 12건 auto_skip · 그 부모 7개는 전부 carry · 지난 미수행 22건.
    //   여기서 재는 것: 회차에서 고쳐도 **부모가 바뀌고**, 회차 행은 오염되지 않는다.
    const missOf = async (id) => (await sequelize.query(
      'SELECT miss_policy FROM tasks WHERE id = ?',
      { replacements: [id], type: sequelize.QueryTypes.SELECT }))[0].miss_policy;
    const beforeParent = await missOf(pid);
    r = await put(instIds[1], { miss_policy: 'auto_skip' });
    const afterParent = await missOf(pid);
    const afterChild = await missOf(instIds[1]);
    push('miss_policy — 회차에서 고쳐도 **부모(시리즈)** 에 저장된다',
      r.status === 200 && afterParent === 'auto_skip',
      `status=${r.status} · 부모 ${beforeParent} → ${afterParent} (auto_skip 이어야 한다)`);
    push('miss_policy — 회차 행은 오염되지 않는다 (음성 대조군)',
      afterChild !== 'auto_skip',
      `회차 miss_policy=${afterChild} — auto_skip 이면 옛 버그(아무도 안 읽는 자리에 저장)`);

  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    for (const id of made.taskIds) {
      await sequelize.query('DELETE FROM task_tag_links WHERE task_id = ?', { replacements: [id] }).catch(() => {});
      await sequelize.query('DELETE FROM task_status_history WHERE task_id = ?', { replacements: [id] }).catch(() => {});
      await sequelize.query('DELETE FROM task_reviewers WHERE task_id = ?', { replacements: [id] }).catch(() => {});
    }
    // 회차 먼저, 부모 나중 (FK)
    for (const id of [...made.taskIds].reverse()) {
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [id] }).catch(() => {});
    }
    if (made.tagId) await sequelize.query('DELETE FROM task_tags WHERE id = ?', { replacements: [made.tagId] }).catch(() => {});
    if (made.userId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [made.userId] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [made.userId] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
