#!/usr/bin/env node
// 업무 «산출물» 회귀 검사 — 실제 HTTP(3003) + dev DB (docs/TASK_DELIVERABLES_DESIGN.md §10)
//
// Irene 2026-11-19: «업무설명에 필요한 산출물 선택하게 하는 거 어때? 기본 산출물들 자동 검색되게 미리 넣어두고
//   없는 건 입력되게 해서 저장되게.»
// 시험 계정(owner·member1·member2·client, ws 6) + 격리 상대(ws 7) — dev-login 서명 코드로 들어간다(개발 .env DEV_LOGIN_SECRET).
// 만든 업무·사전 행은 끝에 지운다(--keep 이면 «[확인용]» 업무 1건을 남긴다).
// 사용: node scripts/check-task-output-kinds.js [--keep]
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { Op } = require('sequelize');
const M = require('../models');
const { sequelize } = require('../config/database');

const BASE = process.env.API_BASE || 'http://127.0.0.1:3003';
const KEEP = process.argv.includes('--keep');
const WS = 6; const WS_OTHER = 7;
let fail = 0; let pass = 0;
const madeTasks = []; const madeKinds = new Set();
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (ok) pass += 1; else fail += 1;
}

function devCode(as, ws) {
  const S = process.env.DEV_LOGIN_SECRET;
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = b64u(JSON.stringify({ as, scope: ws ? { ws } : {}, exp: Date.now() + 60000, n: crypto.randomBytes(8).toString('hex'), next: '/' }));
  return `v1.${payload}.${b64u(crypto.createHmac('sha256', S).update(payload).digest())}`;
}
async function api(tok, m, p, b, ws) {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(ws ? { 'X-Workspace-Id': String(ws) } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  return [r.status, await r.json().catch(() => null)];
}
async function login(as, ws) {
  const [s, j] = await api(null, 'POST', '/api/auth/dev-login', { code: devCode(as, ws) });
  if (s !== 200) throw new Error(`dev-login ${as} ${s} ${JSON.stringify(j)}`);
  const d = j.data;
  return { tok: d.access_token || d.accessToken || d.token, id: Number((d.user || d.userData || {}).id) };
}
const ids = (arr) => (arr || []).map((k) => k.id).sort((a, b) => a - b).join(',');

(async () => {
  const owner = await login('owner', WS);
  const m1 = await login('member', WS);
  const m2 = await login('member2', WS);
  const client = await login('client', WS);
  const auditCount = async (action) => M.AuditLog.count({ where: { action, created_at: { [Op.gte]: t0 } } });
  const t0 = new Date(Date.now() - 1000);
  try {
    // ② 기본 목록
    let [s, j] = await api(owner.tok, 'GET', `/api/tasks/output-kinds/presets?business_id=${WS}`);
    check('② 기본 목록 22개', s === 200 && j.data.length === 22, `${s} ${j?.data?.length}`);

    // ③ 이름 판정 — 제안서 / proposal / preset_key 가 같은 행
    const r1 = await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: '제안서' });
    const r2 = await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: 'proposal' });
    const r3 = await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, preset_key: 'proposal' });
    const proposal = r1[1].data;
    check('③ ko/en/key 같은 행', proposal && r2[1].data.id === proposal.id && r3[1].data.id === proposal.id && proposal.preset_key === 'proposal',
      JSON.stringify([r1[1]?.data, r2[1]?.data, r3[1]?.data]));
    check('③ 기본 항목 행 1개', (await M.TaskOutputKind.count({ where: { business_id: WS, preset_key: 'proposal' } })) === 1);
    const design = (await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, preset_key: 'design_draft' }))[1].data;

    // ④ 직접 입력 — 저장·정리·멱등·길이·빈값
    const c1 = await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: '  [확인용]  브랜드  북 ' });
    const c2 = await api(m1.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: '[확인용] 브랜드 북' });
    const custom = c1[1].data; madeKinds.add(custom.id);
    check('④ 첫 201 · 이름 정리', c1[0] === 201 && custom.name === '[확인용] 브랜드 북' && custom.preset_key === null, JSON.stringify(c1));
    check('④ 둘째 200 같은 id', c2[0] === 200 && c2[1].data.id === custom.id, JSON.stringify(c2));
    check('④ 41자 400', (await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: 'x'.repeat(41) }))[0] === 400);
    check('④ 빈 이름 400', (await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: '   ' }))[0] === 400);
    check('④ 모르는 preset_key 400', (await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, preset_key: 'nope' }))[0] === 400);

    // ⑤ 생성에 붙는다 — 업무 / 요청
    [s, j] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, title: '[확인용] 산출물 업무', output_kind_ids: [custom.id, proposal.id] });
    const tA = j?.data?.id; madeTasks.push(tA);
    [s, j] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, title: '[확인용] 산출물 요청', assignee_id: m1.id, as_request: true, output_kind_ids: [design.id] });
    const tB = j?.data?.id; madeTasks.push(tB);
    let dA = (await api(owner.tok, 'GET', `/api/tasks/${tA}/detail`))[1]?.data;
    const dB = (await api(owner.tok, 'GET', `/api/tasks/${tB}/detail`))[1]?.data;
    check('⑤ 업무 생성 연결', ids(dA?.output_kinds) === [custom.id, proposal.id].sort((a, b) => a - b).join(','), JSON.stringify(dA?.output_kinds));
    check('⑤ 순서 기본 → 직접', dA?.output_kinds?.[0]?.id === proposal.id && dA.output_kinds[0].labels?.en === 'Proposal');
    check('⑤ 요청 생성 연결', ids(dB?.output_kinds) === String(design.id) && !!dB?.request_by_user_id, JSON.stringify(dB?.output_kinds));
    [s, j] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, title: '[확인용] 11개', output_kind_ids: Array.from({ length: 11 }, (_, i) => i + 1) });
    check('⑤ 생성 11개 400', s === 400, `${s} ${j?.message}`);

    // ⑥ 교체 PUT — 상세가 준 목록 + 1 → 3개
    [s, j] = await api(owner.tok, 'PUT', `/api/tasks/${tA}/output-kinds`, { output_kind_ids: [...dA.output_kinds.map((k) => k.id), design.id] });
    dA = (await api(owner.tok, 'GET', `/api/tasks/${tA}/detail`))[1]?.data;
    check('⑥ 교체 뒤 3개', s === 200 && dA.output_kinds.length === 3, `${s} ${JSON.stringify(j)}`);

    // ⑦ 권한 축 — tB: 작성 owner · 담당 m1
    const put = (who, list) => api(who.tok, 'PUT', `/api/tasks/${tB}/output-kinds`, { output_kind_ids: list });
    check('⑦ owner 200', (await put(owner, [design.id, proposal.id]))[0] === 200);
    check('⑦ 담당자 200', (await put(m1, [design.id]))[0] === 200);
    check('⑦ 무관 멤버 403', (await put(m2, [proposal.id]))[0] === 403);
    check('⑦ 고객 403', (await put(client, [proposal.id]))[0] === 403);
    check('⑦ 11개 400', (await put(owner, Array.from({ length: 11 }, (_, i) => i + 1)))[0] === 400);

    // ⑧ 격리 — ws 7 사전 행
    const other = await M.TaskOutputKind.create({ business_id: WS_OTHER, name: `[확인용] 남의 산출물 ${Date.now() % 100000}`, created_by: owner.id });
    madeKinds.add(other.id);
    check('⑧ 남의 id PUT 400', (await put(owner, [other.id]))[0] === 400);
    const before = await M.Task.count({ where: { business_id: WS } });
    [s] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, title: '[확인용] 격리', output_kind_ids: [other.id] });
    check('⑧ 남의 id 생성 거절 · 업무 안 생김', s === 400 && (await M.Task.count({ where: { business_id: WS } })) === before, String(s));
    check('⑧ ws6 멤버가 ws7 행 PUT 403', (await api(m2.tok, 'PUT', `/api/tasks/output-kinds/${other.id}`, { name: 'x' }))[0] === 403);
    check('⑧ ws6 멤버가 ws7 행 DELETE 403', (await api(m2.tok, 'DELETE', `/api/tasks/output-kinds/${other.id}`))[0] === 403);
    check('⑧ ws6 멤버가 ws7 사전 GET 403', (await api(m2.tok, 'GET', `/api/tasks/output-kinds?business_id=${WS_OTHER}`))[0] === 403);
    const [[cross]] = await sequelize.query(`SELECT COUNT(*) c FROM task_output_kind_links l JOIN tasks t ON t.id=l.task_id JOIN task_output_kinds k ON k.id=l.output_kind_id WHERE t.business_id<>k.business_id`);
    check('⑧ DB 교차 연결 0행', Number(cross.c) === 0, String(cross.c));

    // ⑨⑩ 고객 — 자기 프로젝트 업무
    const pc = await M.ProjectClient.findOne({ where: { contact_user_id: client.id }, include: [{ model: M.Project, where: { business_id: WS }, required: true }] });
    if (pc) {
      [s, j] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, project_id: pc.project_id, title: '[확인용] 고객 산출물', output_kind_ids: [proposal.id] });
      const tC = j?.data?.id; madeTasks.push(tC);
      const [cs, cj] = await api(client.tok, 'GET', `/api/tasks/${tC}/detail`);
      check('⑨ 고객이 그 업무 산출물을 본다', cs === 200 && cj.data.output_kinds?.[0]?.id === proposal.id && cj.data.output_kinds[0].usage_count === undefined && cj.data.tags === undefined,
        `${cs} ${JSON.stringify(cj?.data?.output_kinds)} tags=${JSON.stringify(cj?.data?.tags)}`);
      [s] = await api(client.tok, 'POST', '/api/tasks', { business_id: WS, project_id: pc.project_id, title: '[확인용] 고객 생성', output_kind_ids: [proposal.id] });
      check('⑩ 고객이 산출물 실어 생성 403', s === 403, String(s));
    } else check('⑨ 고객 프로젝트 없음', false);
    check('⑩ 고객 사전 GET 403', (await api(client.tok, 'GET', `/api/tasks/output-kinds?business_id=${WS}`))[0] === 403);
    check('⑩ 고객 기본 목록 403', (await api(client.tok, 'GET', `/api/tasks/output-kinds/presets?business_id=${WS}`))[0] === 403);
    check('⑩ 고객 POST 403', (await api(client.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: 'x' }))[0] === 403);

    // ⑫ 목록에는 싣지 않는다
    [s, j] = await api(owner.tok, 'GET', `/api/tasks/by-business/${WS}?limit=1000`);
    const rowA = (Array.isArray(j?.data) ? j.data : (j?.data?.tasks || [])).find((t) => t.id === tA);
    check('⑫ 업무 목록에 output_kinds 없음', s === 200 && !!rowA && rowA.output_kinds === undefined, `${s} ${rowA ? Object.keys(rowA).length : 'no row'}`);

    // ⑬ 반복 상속
    [s, j] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, title: '[확인용] 반복 산출물', due_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), recurrence_rule: 'FREQ=DAILY', output_kind_ids: [proposal.id, custom.id] });
    const tR = j?.data?.id; madeTasks.push(tR);
    await require('../services/recurringTaskGenerator').generateOneSeries(await M.Task.findByPk(tR), new Date());
    const occ = await M.Task.findAll({ where: { recurrence_parent_id: tR, id: { [Op.ne]: tR } }, attributes: ['id'] });
    occ.forEach((o) => madeTasks.push(o.id));
    let inherit = occ.length > 0;
    for (const o of occ) { const n = await M.TaskOutputKindLink.count({ where: { task_id: o.id } }); if (n !== 2) inherit = false; }
    check('⑬ 회차가 부모 산출물 2개를 받는다', inherit, `회차 ${occ.length}`);

    // ⑭ 반복 범위 — 회차 하나에 고유분, 부모에서 all 로 +design −custom
    if (occ.length >= 2) {
      const solo = occ[occ.length - 1].id;
      await api(owner.tok, 'PUT', `/api/tasks/${solo}/output-kinds`, { output_kind_ids: [proposal.id, custom.id, (await M.TaskOutputKind.findOne({ where: { business_id: WS, preset_key: 'design_draft' } })).id], series_scope: 'single' });
      const other1 = occ[0].id;
      check('⑭ single 은 다른 회차 불변', (await M.TaskOutputKindLink.count({ where: { task_id: other1 } })) === 2);
      [s] = await api(owner.tok, 'PUT', `/api/tasks/${tR}/output-kinds`, { output_kind_ids: [proposal.id, (await M.TaskOutputKind.findOne({ where: { business_id: WS, preset_key: 'quote' } }) || (await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, preset_key: 'quote' }))[1].data).id], series_scope: 'all' });
      const quoteId = (await M.TaskOutputKind.findOne({ where: { business_id: WS, preset_key: 'quote' } })).id;
      const soloSet = (await M.TaskOutputKindLink.findAll({ where: { task_id: solo } })).map((l) => l.output_kind_id);
      const o1Set = (await M.TaskOutputKindLink.findAll({ where: { task_id: other1 } })).map((l) => l.output_kind_id);
      check('⑭ all: 추가분 생기고 제거분만 빠짐(고유분 유지)', s === 200 && soloSet.includes(quoteId) && !soloSet.includes(custom.id) && soloSet.includes(design.id) && o1Set.includes(quoteId) && !o1Set.includes(custom.id),
        `solo=${soloSet} o1=${o1Set}`);
    }

    // ⑮ 복사
    [s, j] = await api(owner.tok, 'POST', `/api/tasks/${tA}/copy`, {});
    const tCopy = j?.data?.id; madeTasks.push(tCopy);
    const dCopy = (await api(owner.tok, 'GET', `/api/tasks/${tCopy}/detail`))[1]?.data;
    const dA2 = (await api(owner.tok, 'GET', `/api/tasks/${tA}/detail`))[1]?.data;
    check('⑮ 복사본 같은 집합 · 원본 불변', s < 300 && ids(dCopy?.output_kinds) === ids(dA2?.output_kinds) && dA2.output_kinds.length === 3, `${s} ${ids(dCopy?.output_kinds)} vs ${ids(dA2?.output_kinds)}`);

    // ⑯ 템플릿 왕복(서비스 함수 — 저장 collect → 적용 materialize). 지운 직접 입력 이름은 다시 만들어진다.
    const td = require('../services/templateDetails');
    const ex = await td.collectTaskExtras([await M.Task.findByPk(tA)], WS);
    const names = ex.get(tA).output_names || [];
    check('⑯ 저장: output_names 수집', names.length === 3 && names.includes('[확인용] 브랜드 북'), JSON.stringify(names));
    const norm = td.normalizeItemDetails({ output_names: [...names, ' 영상 ', '영상'] }, 0).output_names;
    check('⑯ 정리: 중복 제거', JSON.stringify(norm) === JSON.stringify([...names, '영상']), JSON.stringify(norm));
    [s, j] = await api(owner.tok, 'POST', '/api/tasks', { business_id: WS, title: '[확인용] 템플릿 적용' });
    const tT = j?.data?.id; madeTasks.push(tT);
    await M.TaskOutputKind.destroy({ where: { id: custom.id } });   // 직접 입력을 지운 뒤 적용 → 다시 만들어져야 한다
    const res = await td.materializeItemExtras([{ task: { id: tT }, item: { output_names: names } }], { businessId: WS, actorUserId: owner.id, indexOf: () => 0 });
    const dT = (await api(owner.tok, 'GET', `/api/tasks/${tT}/detail`))[1]?.data;
    const recreated = await M.TaskOutputKind.findOne({ where: { business_id: WS, name: '[확인용] 브랜드 북' } });
    if (recreated) madeKinds.add(recreated.id);
    check('⑯ 적용: 같은 이름 3개 · 지운 이름 다시 생김 · 기본은 preset 유지',
      res.outputs === 3 && dT.output_kinds.length === 3 && !!recreated && dT.output_kinds.some((k) => k.preset_key === 'proposal'), JSON.stringify(dT?.output_kinds));
    custom.id = recreated ? recreated.id : custom.id;

    // ⑰⑱ AI 도구(같은 핸들러를 직접 — execute.runTool 과 같은 actor 모양)
    const tools = require('../services/agent/tools/tasks');
    const p = { businessId: WS, userId: owner.id, platformRole: null, provider: 'check', grantId: null };
    const actor = { kind: 'user', userId: owner.id, platformRole: null, req: null, channel: { kind: 'agent', provider: 'check', grant_id: null } };
    const kindsBefore = await M.TaskOutputKind.count({ where: { business_id: WS } });
    const ai1 = await tools.createTask(p, { title: '[확인용] AI 산출물', output_names: ['Proposal', '[확인용] 브랜드 북'] }, actor);
    madeTasks.push(ai1.task.task_id);
    check('⑰ AI 만들기: 영어 라벨이 같은 행으로', JSON.stringify(ai1.task.outputs) === JSON.stringify(['제안서', '[확인용] 브랜드 북']), JSON.stringify(ai1.task.outputs));
    const tasksBefore = await M.Task.count({ where: { business_id: WS } });
    let aiErr = null;
    try { await tools.createTask(p, { title: '[확인용] AI 없는 이름', output_names: ['없는이름XYZ'] }, actor); } catch (e) { aiErr = e; }
    check('⑰ 없는 이름 거절 · 업무 안 생김 · 사전 불변', aiErr && /unknown_outputs/.test(aiErr.message || aiErr.code || '') && Array.isArray(aiErr.details?.available_outputs || aiErr.data?.available_outputs || aiErr.extra?.available_outputs)
      && (await M.Task.count({ where: { business_id: WS } })) === tasksBefore && (await M.TaskOutputKind.count({ where: { business_id: WS } })) === kindsBefore,
      aiErr ? JSON.stringify({ m: aiErr.message, c: aiErr.code, keys: Object.keys(aiErr) }) : 'no error');
    let prevErr = null;
    try { await tools.previewCreateTask(p, { title: 'x', output_names: ['없는이름XYZ'] }); } catch (e) { prevErr = e; }
    check('⑰ 미리보기도 먼저 거절', !!prevErr && /unknown_outputs/.test(prevErr.message || prevErr.code || ''));
    const up = await tools.updateTask(p, { task_id: ai1.task.task_id, output_names: ['영상'] }, actor);
    const got = await tools.getTask(p, { task_id: ai1.task.task_id });
    check('⑱ AI 고치기 교체 · get_task outputs', JSON.stringify(up.task.outputs) === '["영상"]' && JSON.stringify(got.task.outputs) === '["영상"]', JSON.stringify([up.task.outputs, got.task.outputs]));
    const pM2 = { ...p, userId: m2.id };
    let permErr = null;
    try { await tools.previewUpdateTask(pM2, { task_id: ai1.task.task_id, output_names: ['제안서'] }); } catch (e) { permErr = e; }
    check('⑱ 무관 멤버 AI 고치기 거절', !!permErr && /PERMISSION|forbidden|NOT_FOUND/i.test(`${permErr.code} ${permErr.message}`), permErr ? `${permErr.code} ${permErr.message}` : 'no error');
    const aud = await M.AuditLog.findOne({ where: { action: 'task.output_kinds_update', target_id: ai1.task.task_id }, order: [['id', 'DESC']] });
    const nv = aud && (typeof aud.new_value === 'string' ? JSON.parse(aud.new_value) : aud.new_value);
    check('⑱ 감사 행 via agent', !!nv && String(nv.via || '').startsWith('agent:'), JSON.stringify(nv));

    // ⑲ 사전 관리
    [s] = await api(owner.tok, 'PUT', `/api/tasks/output-kinds/${custom.id}`, { name: '[확인용] 브랜드 가이드' });
    const dT2 = (await api(owner.tok, 'GET', `/api/tasks/${tT}/detail`))[1]?.data;
    check('⑲ 이름 변경이 업무에 보임', s === 200 && dT2.output_kinds.some((k) => k.name === '[확인용] 브랜드 가이드'));
    check('⑲ 기본 라벨로 변경 409', (await api(owner.tok, 'PUT', `/api/tasks/output-kinds/${custom.id}`, { name: 'Proposal' }))[0] === 409);
    check('⑲ 기본 항목 PUT 400', (await api(owner.tok, 'PUT', `/api/tasks/output-kinds/${proposal.id}`, { name: 'zz' }))[0] === 400);
    check('⑲ 기본 항목 DELETE 400', (await api(owner.tok, 'DELETE', `/api/tasks/output-kinds/${proposal.id}`))[0] === 400);
    const usage = await M.TaskOutputKindLink.count({ where: { output_kind_id: custom.id } });
    [s, j] = await api(owner.tok, 'DELETE', `/api/tasks/output-kinds/${custom.id}`);
    check('⑲ 삭제 · removed_links = 사용 수 · 연결 0', s === 200 && j.data.removed_links === usage && (await M.TaskOutputKindLink.count({ where: { output_kind_id: custom.id } })) === 0, `${s} ${JSON.stringify(j?.data)} usage=${usage}`);

    // ⑳ 상한 100 — 직접 입력 채우고 101번째 / 기본 항목은 성공
    const have = await M.TaskOutputKind.count({ where: { business_id: WS, preset_key: null } });
    const fill = [];
    for (let i = have; i < 100; i++) fill.push({ business_id: WS, name: `[확인용] 상한 ${i}`, created_by: owner.id });
    const filled = await M.TaskOutputKind.bulkCreate(fill);
    filled.forEach((r) => madeKinds.add(r.id));
    [s, j] = await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: '[확인용] 101번째' });
    check('⑳ 101번째 400 output_kind_limit', s === 400 && j?.message === 'output_kind_limit', `${s} ${j?.message}`);
    [s] = await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, preset_key: 'video' });
    check('⑳ 상한이어도 기본 항목은 성공', s === 200 || s === 201, String(s));
    await M.TaskOutputKind.destroy({ where: { id: filled.map((r) => r.id) } });

    // ㉑ 감사 — 같은 목록 PUT 두 번이면 한 번만 / find 로 끝난 POST 는 감사 없음
    const a0 = await auditCount('task.output_kinds_update');
    await api(owner.tok, 'PUT', `/api/tasks/${tB}/output-kinds`, { output_kind_ids: [proposal.id] });
    await api(owner.tok, 'PUT', `/api/tasks/${tB}/output-kinds`, { output_kind_ids: [proposal.id] });
    const c0 = await auditCount('task_output_kind.create');
    await api(owner.tok, 'POST', '/api/tasks/output-kinds', { business_id: WS, name: '제안서' });
    check('㉑ 같은 목록 두 번 → 감사 +1 · find POST 감사 0', (await auditCount('task.output_kinds_update')) - a0 === 1 && (await auditCount('task_output_kind.create')) === c0);
  } catch (e) {
    console.error('ERROR', e && (e.stack || e.message), e && e.code, e && JSON.stringify(e.details || e.data || null));
    fail += 1;
  } finally {
    const keep = KEEP ? madeTasks[0] : null;
    const del = madeTasks.filter((id) => id && id !== keep);
    if (del.length) {
      // 회차(자식) 먼저 — 부모를 먼저 지우면 recurrence_parent_id FK 에 걸린다
      await M.Task.destroy({ where: { recurrence_parent_id: del, id: { [Op.notIn]: del } }, force: true }).catch((e) => console.warn('cleanup occ', e.message));
      await M.Task.destroy({ where: { id: del, recurrence_parent_id: { [Op.ne]: null } }, force: true }).catch((e) => console.warn('cleanup tasks', e.message));
      await M.Task.destroy({ where: { id: del }, force: true }).catch((e) => console.warn('cleanup tasks', e.message));
    }
    const kinds = [...madeKinds];
    if (kinds.length) await M.TaskOutputKind.destroy({ where: { id: kinds, name: { [Op.like]: '[확인용]%' } } }).catch((e) => console.warn('cleanup kinds', e.message));
    console.log(`\n${pass} PASS / ${fail} FAIL${keep ? ` · 남긴 확인용 업무 ${keep}` : ''}`);
    await sequelize.close();
    process.exit(fail ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(2); });
