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
// ★ 2026-09-01 — 검사 대상을 **프론트 소스에서 유도**한다.
//   여태 TARGETS 가 손으로 쓴 고정 목록이라, 프론트가 다시 죽은 주소로 바뀌어도 검사기는
//   통과했다(백엔드 라우트 삭제만 잡혔다). 즉 정작 일어난 그 사고를 다시 못 잡는다.
//   이제 `uploadUrl={...}` 를 전부 긁어 모양을 뽑고, **모르는 모양이 나오면 실패**한다 —
//   새 에디터 화면을 붙이면 검사기가 먼저 손을 든다. (memory feedback_detector_must_report_coverage:
//   검사기는 자기가 무엇을 얼마나 덮었는지 말해야 한다.)
//
// 판정: 404/405 면 실패(주소가 없다). 4xx 라도 400·413·403 은 통과 — 라우트는 존재한다는 뜻이다
//   (검증·쿼터·권한에서 걸린 것이라 이 검사기의 관심사가 아니다).
const fs = require('fs');
const path = require('path');
const { BASE, CREDS } = require('./lib/browser');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);
const SRC = path.join(__dirname, '..', '..', 'dev-frontend', 'src');
// 1x1 PNG — 실제 이미지여야 mime 판정을 지난다
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// 프론트에서 발견된 주소 "모양" → 어떻게 실제로 불러볼 것인가.
// `${...}` 는 `:var` 로 정규화된 뒤 여기에서 실제 값으로 바뀐다.
//   needsTask: 실제 task 하나를 잡아 :var 자리에 넣는다(없으면 검사 못 함 = 실패).
const RECIPES = {
  '/api/files/:var': {
    label: 'Q info · Q Task 본문 이미지 (RichEditor → files)',
    build: (ctx) => ({ url: `/api/files/${BIZ}`, field: 'file', extra: {} }),
  },
  '/api/posts/editor-image': {
    label: 'Q docs 본문 이미지 (PostEditor)',
    build: () => ({ url: '/api/posts/editor-image', field: 'file', extra: { business_id: String(BIZ) } }),
  },
  '/api/tasks/:var/attachments?context=description': {
    label: '업무 결과물 본문 이미지 (RichEditor → task attachments)',
    needsTask: true,
    build: (ctx) => ({ url: `/api/tasks/${ctx.taskId}/attachments?context=description`, field: 'file', extra: {} }),
  },
};

// PostEditor 는 uploadUrl prop 을 받지 않고 자기 안에서 주소를 정한다 — 소스 스캔으로는 안 잡히므로
// 모양 목록에 항상 포함시킨다(위 RECIPES 에 있고, 아래 discover 결과에 합류시킨다).
const ALWAYS = ['/api/posts/editor-image'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 프론트 소스에서 uploadUrl 로 넘기는 주소 모양을 뽑는다.
function discover() {
  const found = new Map();   // shape -> [ 'file:line', ... ]
  const re = /uploadUrl=\{([^}]*(?:\}[^}]*)*?)\}\s*(?:\/?>|\n)/g;
  for (const f of walk(SRC)) {
    const text = fs.readFileSync(f, 'utf8');
    if (!text.includes('uploadUrl=')) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('uploadUrl=')) return;
      // 백틱 템플릿 안의 경로만 본다 — `/api/...` 로 시작하는 것
      const m = [...line.matchAll(/`(\/api\/[^`]*)`/g)];
      for (const mm of m) {
        const shape = mm[1].replace(/\$\{[^}]*\}/g, ':var');
        const at = `${path.relative(path.join(__dirname, '..', '..'), f)}:${i + 1}`;
        if (!found.has(shape)) found.set(shape, []);
        found.get(shape).push(at);
      }
    });
  }
  for (const a of ALWAYS) if (!found.has(a)) found.set(a, ['(컴포넌트 내부 고정 — PostEditor)']);
  return found;
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
  });
  const j = await r.json();
  return j.data?.accessToken || j.data?.token || null;
}

async function pickTask(tok) {
  try {
    // 목록 라우트는 `/by-business/:id` 다 — `?business_id=` 가 아니다.
    //   (2026-09-01: 틀린 주소로 물어보고 "업무가 없다" 는 **거짓 실패**를 냈다.
    //    memory feedback_false_fail_suspect_the_judge — 빨간불이 뜨면 판정 기계부터 의심한다.)
    const r = await fetch(`${BASE}/api/tasks/by-business/${BIZ}?limit=1`, { headers: { Authorization: 'Bearer ' + tok } });
    const j = await r.json().catch(() => ({}));
    const list = Array.isArray(j.data) ? j.data : (Array.isArray(j.data?.tasks) ? j.data.tasks : []);
    return list[0]?.id || null;
  } catch { return null; }
}

async function run() {
  const rows = [];
  const shapes = discover();
  const siteCount = [...shapes.values()].reduce((a, v) => a + v.length, 0);

  const tok = await login();
  if (!tok) return [{ route: '로그인', detail: '실패 — 검사 못 함', fail: 1 }];

  // 모양 ↔ 레시피 대조 — 모르는 모양이 있으면 그 자체가 실패다.
  for (const [shape, sites] of shapes) {
    if (!RECIPES[shape]) {
      rows.push({
        route: `미등록 업로드 주소`,
        detail: `${shape} — ${sites.join(', ')} 에서 쓰는데 검사기가 모른다. RECIPES 에 추가할 것`,
        fail: 1,
      });
    }
  }

  const needTask = [...shapes.keys()].some((s) => RECIPES[s]?.needsTask);
  const ctx = { taskId: needTask ? await pickTask(tok) : null };
  if (needTask && !ctx.taskId) {
    rows.push({ route: '업무 결과물 본문 이미지', detail: `biz ${BIZ} 에 업무가 없어 **검사 못 함** (빈 결과를 정상으로 읽지 않는다)`, fail: 1 });
  }

  const createdFiles = [];
  const createdAttach = [];
  for (const [shape] of shapes) {
    const recipe = RECIPES[shape];
    if (!recipe) continue;
    if (recipe.needsTask && !ctx.taskId) continue;
    const t = recipe.build(ctx);
    try {
      const fd = new FormData();
      fd.append(t.field, new Blob([PNG], { type: 'image/png' }), 'canary.png');
      for (const [k, v] of Object.entries(t.extra || {})) fd.append(k, v);
      const r = await fetch(BASE + t.url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
      const gone = r.status === 404 || r.status === 405;
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        // RichEditor 계약: { data: { preview_url } } · PostEditor 계약: { data: { url } }
        const usable = !!(j.data?.preview_url || j.data?.url);
        const note = usable ? ' · 삽입 가능한 URL 반환' : ' · ⚠ URL 이 없어 에디터가 삽입 못 한다';
        // ★ 검사기가 파일을 남기면 안 된다 — 정기 실행될 것이라 매번 쌓인다.
        // 응답의 id 필드명이 라우트마다 다르다 — files 는 `id`, posts/editor-image 는 `file_id`,
        //   task attachments 는 첨부 id 라 지우는 라우트도 다르다.
        //   한쪽만 보면 원복이 조용히 반쪽이 된다(실제로 1/2 만 지워졌다).
        if (shape.includes('/attachments')) { if (j.data?.id) createdAttach.push(Number(j.data.id)); }
        else { const id = j.data?.id ?? j.data?.file_id; if (id) createdFiles.push(Number(id)); }
        rows.push({ route: recipe.label, detail: `${t.url} → ${r.status}${note}`, fail: usable ? 0 : 1 });
        continue;
      }
      rows.push({ route: recipe.label, detail: `${t.url} → ${r.status}${gone ? ' ← 주소가 없다' : ' (라우트는 존재)'}`, fail: gone ? 1 : 0 });
    } catch (e) {
      rows.push({ route: recipe.label, detail: `${t.url} → 호출 오류 ${e.message}`, fail: 1 });
    }
  }

  // 원복 — 검사기가 만든 것을 지운다.
  // ★ 2026-09-01 — DELETE 만 부르면 **휴지통에 넣을 뿐 바이트가 남는다**.
  //   실측: 58행이 쌓여 있었고 물리 파일도 그대로였다. 그런데도 검사기는 "원복 3/3" 이라고 보고했다.
  //   purge 까지 불러야 바이트가 사라진다(행 자체는 감사용 묘비로 남는 것이 이 제품의 설계다 —
  //   사용자가 지웠을 때와 같은 종착 상태이므로 그것이 정상이다).
  //   (memory feedback_soft_delete_without_trash_ui · feedback_test_data_restore)
  const H = { Authorization: 'Bearer ' + tok };
  const purge = async (id) => {
    try { await fetch(`${BASE}/api/files/${BIZ}/${id}`, { method: 'DELETE', headers: H }); } catch { /* 이미 지워졌으면 그만 */ }
    try { const r = await fetch(`${BASE}/api/files/${BIZ}/${id}/purge`, { method: 'DELETE', headers: H }); return r.ok; } catch { return false; }
  };
  const total = createdFiles.length + createdAttach.length;
  let removed = 0;
  for (const id of createdFiles) { if (await purge(id)) removed += 1; }
  for (const id of createdAttach) {
    // ★ 업무 첨부는 `task_attachments` 에 산다 — `files` 가 **아니다**.
    //   그래서 여기에 files purge 를 부르면 **id 가 우연히 겹치는 남의 파일을 지운다.** 절대 부르지 않는다.
    try { const r = await fetch(`${BASE}/api/tasks/attachments/${id}`, { method: 'DELETE', headers: H }); if (r.ok) removed += 1; } catch { /* noop */ }
  }
  if (removed < total) {
    rows.push({ route: '검사기 원복', detail: `만든 ${total}건 중 ${removed}건만 지워졌다 — 남기면 매 실행마다 쌓인다`, fail: 1 });
  }

  const bad = rows.reduce((a, x) => a + (x.fail || 0), 0);
  console.log(`\n에디터 업로드 주소 — 소스에서 ${siteCount}곳 발견 · 주소 모양 ${shapes.size}종 · 검사 ${rows.length}건 · 실패 ${bad} · 원복 ${removed}/${total}`);
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
