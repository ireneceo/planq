// 못 보는 제한 자료의 «잠금 줄» — 검색에서 존재만 알리고 열람은 요청으로 (2026-11-25, Irene «권고대로» · 설계 docs/FILE_SEARCH_DISCOVERY_DESIGN.md §2)
//
// ★ 판정은 여기 한 곳이다. «잠금으로 보이는가» = 아래를 모두 만족:
//   ① 워크스페이스 설정 `businesses.permissions.restricted_discoverable === true`(대표·관리자, 기본 꺼짐 = 지금과 같음)
//   ② 보는 사람이 그 워크스페이스 멤버·관리자(고객·게스트·플랫폼 관리자·AI 아님)
//   ③ 항목이 L2(프로젝트·지정 멤버 제한) — L1 «나만 보기» 는 영구 비공개, L3·L4 는 원래 보인다
//   ④ `hide_existence = 0`(올린 사람·대표·관리자가 «검색에서 숨김» 을 안 켰다) · 지우지 않음 · 남이 올린 것
//   ⑤ 이름으로 맞았다(설명·태그·본문 매칭은 안 낸다 — 탐지기 축소)
//   ⑥ 읽기 술어(access_scope.canAccessFileByLevel / canAccessPostByLevel — 열람 요청 승인 포함)가 **거절**한다
// ★ 싣는 것은 화이트리스트: id · 이름 · 종류 · 올린 사람(표시명) · locked · 내 요청 상태. 크기·설명·태그·스니펫·프로젝트 이름 없음.
// ★ 쓰는 곳: 통합 검색(routes/search.js) · Q file 검색(routes/access_requests.js locked). 목록·최근·건수·AI·Cue 에는 싣지 않는다.
const { Op } = require('sequelize');
const { File, Post, Business } = require('../models');
const { canAccessFileByLevel, canAccessPostByLevel } = require('../middleware/access_scope');
const { isGrantableScope } = require('./accessGrants');

const CANDIDATE_CAP = 40;
const MIN_QUERY = 2;   // 한 글자 검색으로 이름을 훑지 않게(Fable 비차단 6)
// 잠금 후보에서 빼는 것 — 메일 첨부 보관분(메일 화면의 것) · 문서 초안(작성 중) (Fable 비차단 4)
const notMail = () => require('./mailAttachmentFiles').notMailAttachmentLiteral('File');
const NOT_DRAFT = { status: { [Op.ne]: 'draft' } };

async function isEnabled(businessId) {
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
  return !!(biz && biz.permissions && biz.permissions.restricted_discoverable === true);
}

/** 이 사람에게 잠금 줄을 보여 줄 수 있는가(①②). */
async function viewerEligible(scope, businessId) {
  if (!isGrantableScope(scope) || Number(scope.businessId) !== Number(businessId)) return false;
  return isEnabled(businessId);
}

const L2_FILE = { [Op.or]: [{ vlevel: 'L2' }, { vlevel: null, visibility: 'L2' }] };

/** 이 항목이 지금 이 사람에게 «잠금» 인가(③④⑥ — 단건, 열람 요청 API 의 문지기). 행을 돌려준다(아니면 null). */
async function lockedRow(scope, businessId, type, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (!(await viewerEligible(scope, businessId))) return null;
  if (type === 'file') {
    const f = await File.findOne({ where: { id: n, business_id: businessId, deleted_at: null, hide_existence: false, [Op.and]: [L2_FILE, notMail()] } });
    if (!f || Number(f.uploader_id) === Number(scope.userId)) return null;
    return (await canAccessFileByLevel(scope.userId, f, scope)) ? null : f;
  }
  if (type === 'post') {
    const p = await Post.findOne({ where: { id: n, business_id: businessId, vlevel: 'L2', hide_existence: false, ...NOT_DRAFT } });
    if (!p || Number(p.author_id) === Number(scope.userId)) return null;
    return (await canAccessPostByLevel(scope.userId, p, scope)) ? null : p;
  }
  return null;
}

/** 검색 — 이름으로 맞은 잠금 줄. M = searchScope.makeMatcher(q). */
async function searchLocked(scope, businessId, M, { types = ['file', 'post'], limit = 8 } = {}) {
  if (!M || String(M.q || '').replace(/\s/g, '').length < MIN_QUERY || !(await viewerEligible(scope, businessId))) return { files: [], posts: [] };
  await require('./accessRequests').expireStale(businessId).catch(() => {});   // 14일 지난 대기 → 만료(내 요청 상태가 맞게)
  const out = { files: [], posts: [] };
  if (types.includes('file')) {
    const rows = await File.findAll({
      where: { business_id: businessId, deleted_at: null, hide_existence: false, uploader_id: { [Op.ne]: scope.userId },
        [Op.and]: [L2_FILE, notMail(), { [Op.or]: M.likeAny('file_name') }] },
      attributes: ['id', 'business_id', 'file_name', 'uploader_id', 'project_id', 'vlevel', 'visibility', 'target_member_ids', 'mime_type'],
      order: [M.relevance('file_name'), ['created_at', 'DESC']], limit: CANDIDATE_CAP,
    });
    for (const f of rows) {
      if (out.files.length >= limit) break;
      if (await canAccessFileByLevel(scope.userId, f, scope)) continue;   // 볼 수 있는 것은 보통 결과에 있다
      out.files.push({ id: f.id, name: f.file_name, kind: 'file', owner_id: f.uploader_id, locked: true });
    }
  }
  if (types.includes('post')) {
    const rows = await Post.findAll({
      where: { business_id: businessId, vlevel: 'L2', hide_existence: false, author_id: { [Op.ne]: scope.userId }, ...NOT_DRAFT,
        [Op.and]: [{ [Op.or]: M.likeAny('title') }] },
      attributes: ['id', 'business_id', 'title', 'author_id', 'project_id', 'vlevel', 'target_member_ids'],
      order: [M.relevance('title'), ['created_at', 'DESC']], limit: CANDIDATE_CAP,
    });
    for (const p of rows) {
      if (out.posts.length >= limit) break;
      if (await canAccessPostByLevel(scope.userId, p, scope)) continue;
      out.posts.push({ id: p.id, name: p.title, kind: 'post', owner_id: p.author_id, locked: true });
    }
  }
  await decorate(scope, businessId, [...out.files, ...out.posts]);
  return out;
}

/** 올린 사람 표시명 + 내 요청 상태(대기·거절) — 화면이 «요청함» 을 그린다. */
async function decorate(scope, businessId, items) {
  if (!items.length) return;
  const names = await require('./accessRequests').peopleOf(businessId, items.map((i) => i.owner_id)).catch(() => new Map());
  const { AccessRequest } = require('../models');
  const reqs = await AccessRequest.findAll({
    where: { business_id: businessId, requester_id: scope.userId, status: { [Op.in]: ['pending', 'denied'] },
      [Op.or]: items.map((i) => ({ entity_type: i.kind, entity_id: i.id })) },
    attributes: ['id', 'entity_type', 'entity_id', 'status', 'created_at', 'decided_at'], order: [['id', 'DESC']],
  });
  const reqOf = new Map();
  for (const r of reqs) { const k = `${r.entity_type}:${r.entity_id}`; if (!reqOf.has(k)) reqOf.set(k, r); }
  for (const i of items) {
    const nm = names.get(Number(i.owner_id));
    i.owner = { id: i.owner_id, name: (nm && nm.name) || null };   // name = 워크스페이스 표시명(없으면 계정 이름)
    delete i.owner_id;
    const r = reqOf.get(`${i.kind}:${i.id}`);
    i.request = r ? { id: r.id, status: r.status } : null;
  }
}

/** 종류별 메뉴 — Q file·Q docs 가 숨겨진 멤버에게는 그 종류의 잠금 줄·요청도 없다(통합 검색과 같은 축 · Fable 비차단 5). */
const MENU_OF = { file: 'qfile', post: 'qdocs' };
async function allowedTypes(businessId, user, types) {
  const mp = require('../middleware/menu_permission');
  const out = [];
  for (const t of types) if (MENU_OF[t] && await mp.menuAllows(businessId, user, MENU_OF[t], 'read').catch(() => false)) out.push(t);
  return out;
}

module.exports = { isEnabled, viewerEligible, lockedRow, searchLocked, allowedTypes, L2_FILE, MIN_QUERY };
