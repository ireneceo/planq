// services/fileUsage.js — «이 파일이 어디에 쓰이고 있나» 의 단일 원천 (2026-11-25)
//
// Irene: *"파일 위치를 이동하거나 해도 연결해둔 문서에서 끊기지 않게 하거나 꼭 구조상 끊어야 하면 알려줘야 할 것 같아.
//   그리고 파일이나 문서들이 서로 어디에 연결되어 있는지 제대로 다 알게 통합적인 UI가 되고 있나"*
// 설계: docs/FILE_USAGE_DESIGN.md (Fable 설계 DESIGN-CHANGE 반영)
//
// 두 부류:
//   live — 원본 File 을 거쳐 열리는 곳. 원본을 지우거나 범위를 좁히면 그곳에서 빠진다.
//          문서 첨부 · 문서 본문 그림 · 일정 미팅자료 · 프로젝트 연결(project_refs) · 청구 증빙 · 연락처 사진
//   copy — 자기 행에 바이트 경로를 복사해 둔 곳. 원본을 지워도 그대로 열린다(fileRefs.countLiveRefs 가 바이트를 지킨다).
//          업무 첨부 · 채팅 첨부
// 빼는 것: 메일 첨부(출처이지 사용처가 아니다 — 출처 칩) · Q info(자동 색인과 수동 가져오기를 가를 수 없다) · 문서 버전 기록.
//
// 보여 주기: 보는 사람이 그곳을 볼 수 있을 때만 {kind, id, title, link}. 제목은 저장하지 않고 매번 읽는다.
//   못 보는 곳은 멤버 이상에게만 숫자(hidden). 고객·게스트에게는 숫자도 주지 않는다(존재 노출).
const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { pathVariants } = require('./fileRefs');
const { bodyHasImage } = require('./imageCtx');

const LIVE_KINDS = ['post', 'post_image', 'event', 'project', 'invoice', 'contact'];
const COPY_KINDS = ['task', 'chat'];
const MAX_FILES = 200;
const TOP = 5;

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const basename = (p) => String(p || '').replace(/\\/g, '/').split('/').pop();

/**
 * 파일 여러 개의 «사용처 행» 을 DB 에서 모은다(권한 판정 전). 모든 쿼리는 business_id 로 묶는다.
 * @returns Map<fileId, Array<{kind, id, file_id}>>  (같은 곳 중복 제거됨)
 */
async function collectRaw(files) {
  const out = new Map(files.map((f) => [f.id, []]));
  if (!files.length) return out;
  const businessId = files[0].business_id;
  const ids = files.map((f) => f.id);
  const push = (fid, kind, id) => {
    const arr = out.get(fid);
    if (arr && id && !arr.some((r) => r.kind === kind && r.id === Number(id))) arr.push({ kind, id: Number(id), file_id: fid });
  };

  // live — 문서 첨부
  for (const r of await q(
    `SELECT pa.file_id, pa.post_id FROM post_attachments pa JOIN posts p ON p.id = pa.post_id
      WHERE pa.file_id IN (:ids) AND p.business_id = :b AND p.deleted_at IS NULL`, { ids, b: businessId })) push(r.file_id, 'post', r.post_id);

  // live — 문서 본문 그림: 저장 이름(UUID)이 본문에 박힌다. LIKE 로 후보 → bodyHasImage 로 확정(접미사 오탐 방지).
  const byName = new Map();
  for (const f of files) { const n = basename(f.file_path); if (n && n.length >= 8) byName.set(n, f.id); }
  const names = [...byName.keys()];
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    const likes = chunk.map((_, j) => `content_json LIKE :n${j}`).join(' OR ');
    const rep = { b: businessId };
    chunk.forEach((n, j) => { rep[`n${j}`] = `%${n.replace(/[%_\\]/g, '\\$&')}%`; });
    const rows = await q(`SELECT id, content_json FROM posts WHERE business_id = :b AND deleted_at IS NULL AND (${likes})`, rep);
    for (const p of rows) for (const n of chunk) if (bodyHasImage([p.content_json], n)) push(byName.get(n), 'post_image', p.id);
  }

  // live — 일정 미팅자료
  for (const r of await q(
    `SELECT file_id, event_id FROM calendar_event_attachments WHERE file_id IN (:ids) AND business_id = :b`, { ids, b: businessId })) push(r.file_id, 'event', r.event_id);

  // live — 프로젝트 연결
  for (const r of await q(
    `SELECT entity_id AS file_id, project_id FROM project_refs WHERE entity_type = 'file' AND entity_id IN (:ids) AND business_id = :b`, { ids, b: businessId })) push(Number(r.file_id), 'project', r.project_id);

  // live — 청구 증빙(청구서·분할 회차의 세금계산서·현금영수증)
  for (const r of await q(
    `SELECT id, cash_receipt_file_id AS a, tax_invoice_file_id AS c FROM invoices
      WHERE business_id = :b AND (cash_receipt_file_id IN (:ids) OR tax_invoice_file_id IN (:ids))`, { ids, b: businessId })) {
    if (out.has(r.a)) push(r.a, 'invoice', r.id);
    if (out.has(r.c)) push(r.c, 'invoice', r.id);
  }
  for (const r of await q(
    `SELECT i.id, ii.cash_receipt_file_id AS a, ii.tax_invoice_file_id AS c FROM invoice_installments ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.business_id = :b AND (ii.cash_receipt_file_id IN (:ids) OR ii.tax_invoice_file_id IN (:ids))`, { ids, b: businessId })) {
    if (out.has(r.a)) push(r.a, 'invoice', r.id);
    if (out.has(r.c)) push(r.c, 'invoice', r.id);
  }

  // live — 고객 연락처 사진
  for (const r of await q(
    `SELECT photo_file_id AS file_id, client_id FROM client_contacts WHERE business_id = :b AND photo_file_id IN (:ids)`, { ids, b: businessId })) push(r.file_id, 'contact', r.client_id);

  // copy — 업무 첨부(같은 바이트 경로 · 두 표기) · 채팅 첨부(file_id 또는 경로)
  const varToFile = new Map();
  for (const f of files) for (const v of pathVariants(f.file_path)) varToFile.set(v, f.id);
  const variants = [...varToFile.keys()];
  if (variants.length) {
    for (const r of await q(
      `SELECT task_id, file_path FROM task_attachments WHERE business_id = :b AND post_id IS NULL AND file_path IN (:v)`, { b: businessId, v: variants })) push(varToFile.get(r.file_path), 'task', r.task_id);
  }
  for (const r of await q(
    `SELECT ma.file_id, ma.file_path, m.conversation_id FROM message_attachments ma
       JOIN messages m ON m.id = ma.message_id JOIN conversations c ON c.id = m.conversation_id
      WHERE c.business_id = :b AND ${require('../middleware/access_scope').notPlatformSql('c')} AND (m.is_deleted IS NULL OR m.is_deleted = 0)
        AND (ma.file_id IN (:ids) ${variants.length ? 'OR ma.file_path IN (:v)' : ''})`, { b: businessId, ids, v: variants.length ? variants : [''] })) {
    const fid = out.has(r.file_id) ? r.file_id : varToFile.get(r.file_path);
    push(fid, 'chat', r.conversation_id);
  }
  return out;
}

/** 보는 사람 기준으로 곳마다 판정 → 통과한 곳만 제목·주소. memo 로 같은 곳을 두 번 판정하지 않는다. */
function makeResolver(viewer, businessId, scope) {
  const as = require('../middleware/access_scope');
  const { Post, Task, Conversation, CalendarEvent, Project, Invoice, Client } = require('../models');
  const { canReadPost } = require('./postAccess');
  const memo = new Map();
  let calWhere;
  const resolveOne = async (kind, id) => {
    switch (kind) {
      case 'post': case 'post_image': {
        const p = await Post.findOne({ where: { id, business_id: businessId }, attributes: ['id', 'title', 'business_id', 'project_id', 'author_id', 'vlevel', 'visibility', 'target_member_ids', 'status', 'security_level', 'conversation_id'] });
        if (!p || !(await canReadPost(viewer, p))) return null;
        return { title: p.title || '', link: `/docs?post=${p.id}` };
      }
      case 'task': {
        const t = await Task.findOne({ where: { id, business_id: businessId } });
        if (!t || !(await as.canAccessTask(viewer.id, t, scope))) return null;
        return { title: t.title || '', link: `/tasks?task=${t.id}` };
      }
      case 'chat': {
        const c = await Conversation.findOne({ where: { id, business_id: businessId } });
        if (!c || !(await as.canAccessConversation(viewer.id, c, scope))) return null;
        return { title: c.display_name || c.title || '', link: `/talk?conv=${c.id}` };
      }
      case 'event': {
        if (calWhere === undefined) calWhere = await as.calendarListWhere(viewer.id, businessId, scope);
        if (!calWhere) return null;
        const e = await CalendarEvent.findOne({ where: { [Op.and]: [calWhere, { id }] }, attributes: ['id', 'title'] });
        if (!e) return null;
        return { title: e.title || '', link: `/calendar?event=${e.id}` };
      }
      case 'project': {
        const p = await Project.findOne({ where: { id, business_id: businessId }, attributes: ['id', 'name', 'business_id'] });
        if (!p || !(await as.canAccessProject(viewer.id, p, scope))) return null;
        return { title: p.name || '', link: `/projects/p/${p.id}?tab=docs` };
      }
      case 'invoice': {
        // 청구 증빙은 재무 화면 몫 — 대표·관리자만 제목을 본다(그 밖은 «볼 수 없는 곳» 숫자)
        if (!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) return null;
        const inv = await Invoice.findOne({ where: { id, business_id: businessId }, attributes: ['id', 'title', 'invoice_number'] });
        if (!inv) return null;
        return { title: [inv.invoice_number, inv.title].filter(Boolean).join(' · '), link: `/bills?tab=invoices&invoice=${inv.id}` };
      }
      case 'contact': {
        if (!as.isMemberOrAbove(scope)) return null;
        const c = await Client.findOne({ where: { id, business_id: businessId }, attributes: ['id', 'display_name', 'company_name'] });
        if (!c) return null;
        return { title: c.display_name || c.company_name || '', link: `/sale/${c.id}` };
      }
      default: return null;
    }
  };
  return async (kind, id) => {
    const k = `${kind}:${id}`;
    if (!memo.has(k)) memo.set(k, await resolveOne(kind, id).catch(() => null));
    return memo.get(k);
  };
}

async function viewerScope(viewer, businessId) {
  const { getUserScope } = require('../middleware/access_scope');
  return getUserScope(viewer.id, businessId, viewer.platform_role);
}

/**
 * 파일 하나의 사용처 — 파일 상세 «연결된 곳» 칸.
 * @returns {live:[{kind,id,title,link}], copy:[...], hidden?:number}
 */
async function listUsage(file, viewer, scope) {
  if (!scope) scope = await viewerScope(viewer, file.business_id);
  const raw = (await collectRaw([file])).get(file.id) || [];
  const resolve = makeResolver(viewer, file.business_id, scope);
  const live = []; const copy = []; let hidden = 0;
  for (const r of raw) {
    const v = await resolve(r.kind, r.id);
    if (!v) { hidden += 1; continue; }
    (COPY_KINDS.includes(r.kind) ? copy : live).push({ kind: r.kind, id: r.id, ...v });
  }
  // 청구 증빙을 맨 위로 — 지우면 증빙이 빠진다는 것을 먼저 보게(설계 15)
  live.sort((a, b) => (a.kind === 'invoice' ? -1 : 0) - (b.kind === 'invoice' ? -1 : 0));
  const out = { live, copy };
  if (!scope.isClient) out.hidden = hidden;   // 고객·게스트에게는 칸 자체가 없다
  return out;
}

/**
 * 여러 파일의 요약 — 지우기(여러 개·폴더째)·범위 변경 확인창.
 *   «곳» 은 (kind, id) 로 중복 제거한다 — 같은 문서에 파일 둘이 붙어 있으면 한 곳이다.
 * @returns {files_with_live, live_places, copy_places, hidden_places?, top:[{kind,id,title,link}], truncated}
 */
async function summarize(files, viewer, scope) {
  const list = files.slice(0, MAX_FILES);
  const out = { files_with_live: 0, live_places: 0, copy_places: 0, top: [], truncated: files.length > MAX_FILES };
  if (!list.length) { if (!scope || !scope.isClient) out.hidden_places = 0; return out; }
  const businessId = list[0].business_id;
  if (!scope) scope = await viewerScope(viewer, businessId);
  const raw = await collectRaw(list);
  const resolve = makeResolver(viewer, businessId, scope);
  const seen = new Map();   // key → {visible, row}
  for (const [, rows] of raw) {
    let anyLive = false;
    for (const r of rows) {
      if (LIVE_KINDS.includes(r.kind)) anyLive = true;
      const key = `${r.kind === 'post_image' ? 'post' : r.kind}:${r.id}`;
      if (!seen.has(key)) seen.set(key, { row: r, v: await resolve(r.kind, r.id) });
    }
    if (anyLive) out.files_with_live += 1;
  }
  let hidden = 0;
  const live = [];
  for (const { row, v } of seen.values()) {
    const isCopy = COPY_KINDS.includes(row.kind);
    if (isCopy) out.copy_places += 1; else out.live_places += 1;
    if (!v) { if (!isCopy) hidden += 1; continue; }
    if (!isCopy) live.push({ kind: row.kind, id: row.id, ...v });
  }
  live.sort((a, b) => (a.kind === 'invoice' ? -1 : 0) - (b.kind === 'invoice' ? -1 : 0));
  out.top = live.slice(0, TOP);
  if (!scope.isClient) out.hidden_places = hidden;
  return out;
}

module.exports = { listUsage, summarize, collectRaw, LIVE_KINDS, COPY_KINDS, MAX_FILES };
