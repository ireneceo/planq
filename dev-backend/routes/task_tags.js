// 업무 태그 — 사전 CRUD + 업무별 태그 지정 (#250 ③청크, Fable 설계 게이트 2026-08-08)
//
// 운영 신고 원문: "업무태그는 아예 개발이 안되어 있네. 리스트에도 태그들 볼 수 있게 하기로 하지 않았어?"
//
// tasks.js 는 2,449줄 godfile 이라 신규 엔드포인트를 얹지 않는다.
// ★ mount 는 `/api/tasks` 체인 최상단(task_priority 바로 뒤, task_estimations 앞).
//   `/tags` 리터럴이 tasks.js 의 `GET /:id`(id='tags' → NaN 오동작) 나 task_workflow 의
//   `/:id/*` 패턴에 먹히기 전에 잡혀야 한다.
//
// ★ `tasks.category`(STRING(100)) 는 **동결**이다 — QTask UI 에 노출된 적 없는 컬럼이라
//   지금은 혼란이 없지만, 새 UI 에 절대 노출하지 말 것. 태그로의 승격(백필)/폐기는
//   share 직렬화·Cue 생성 경로까지 얽혀 이 청크의 절단면 밖 — **후속 결정 항목**이다.
//
// ★ client 봉쇄: tasks.js 의 `assertBusinessAccess` 는 **client 도 통과**시킨다(PERMISSION_MATRIX §5/§7).
//   태그는 내부 운영 라벨이라 고객이 읽어선 안 된다 — 공용 `assertMemberOrAbove` 를 쓴다.
//   응답 차단은 `utils/taskClientView.js` BLOCKED_FIELDS 가 한 겹 더 담당한다(이중 방어).
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { assertMemberOrAbove, getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { Task, TaskTag, TaskTagLink } = require('../models');
// ★ models/index.js 는 sequelize 인스턴스를 export 하지 않는다 — config 에서 직접 가져온다.
//   (`require('../models').sequelize` 는 undefined 라 사용 수 집계가 500 으로 죽는다)
const { sequelize } = require('../config/database');
const { logAudit } = require('../services/auditService');

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TAGS_PER_TASK = 10;      // 업무당 상한 — payload 비대 + 칩 UI 파괴 차단
const MAX_TAGS_PER_BIZ = 100;      // 워크스페이스 사전 상한

// ─────────────────────────────────────────────────────────────
// 조회 헬퍼 — **belongsToMany include 를 쓰지 않는다.**
//   all-tasks 는 findAndCountAll + limit 인 pagination 라우트라 M:N include 를 끼우면
//   count 가 조인 행 수로 오염되고 Sequelize 가 subquery 를 끼워 예측 불가가 된다.
//   task_id IN (...) 배치 2차 쿼리 후 머지 — 쿼리 1회로 N+1 도 없다.
//   ★ 다른 라우트에서 태그를 실을 때도 반드시 이 함수를 쓸 것 (사본 금지).
// ─────────────────────────────────────────────────────────────
// @param businessId  워크스페이스 격리 축. 호출자가 이미 business 로 좁힌 task 만 넘기더라도
//                    태그 쪽에도 같은 조건을 건다 — 링크 행이 어쩌다 오염돼도 남의 워크스페이스
//                    태그 이름이 새지 않게 하는 이중 방어 (CLAUDE.md 멀티테넌트: JOIN 시에도 business_id 유지).
async function attachTagsTo(rows, businessId) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows.map(r => Number(r.id)).filter(Boolean);
  if (ids.length === 0) return rows;
  const links = await TaskTagLink.findAll({
    where: { task_id: { [Op.in]: ids } },
    include: [{
      model: TaskTag, as: 'tag', attributes: ['id', 'name', 'color', 'sort_order'],
      required: true,
      ...(businessId ? { where: { business_id: Number(businessId) } } : {}),
    }],
  });
  const byTask = new Map();
  for (const l of links) {
    if (!l.tag) continue;
    if (!byTask.has(l.task_id)) byTask.set(l.task_id, []);
    byTask.get(l.task_id).push({ id: l.tag.id, name: l.tag.name, color: l.tag.color });
  }
  // 이름 사전순 고정 — 대표 태그(사전순 최소)가 첫 원소가 되게. 프론트가 [0] 만 봐도 대표다.
  for (const list of byTask.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of rows) r.tags = byTask.get(Number(r.id)) || [];
  return rows;
}

async function requireMember(req, res) {
  const businessId = Number(req.body?.business_id || req.query?.business_id || req.user.active_business_id);
  if (!businessId) { errorResponse(res, 'business_id required', 400); return null; }
  if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  return businessId;
}

function normalizeName(raw) {
  // 앞뒤 공백 제거 + 내부 연속 공백 1칸 — "긴급 " 과 "긴급" 이 다른 태그가 되지 않게.
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function serializeTag(t, usage) {
  return {
    id: t.id, name: t.name, color: t.color || null, sort_order: t.sort_order,
    usage_count: usage != null ? Number(usage) : undefined,
  };
}

// 사전 변경 broadcast — 프론트가 debounce reload 한다.
//   ★ 멱등 no-op 에는 발화하지 않는다(②청크 교훈: 화면을 열기만 해도 소켓이 울려 무한 reload).
function broadcastTagDict(req, businessId) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`business:${businessId}`).emit('task_tag:updated', { business_id: businessId, actor_user_id: req.user.id });
}

// ─── GET /api/tasks/tags — 사전 + 사용 수 ───
router.get('/tags', authenticateToken, async (req, res, next) => {
  try {
    const businessId = await requireMember(req, res);
    if (!businessId) return;
    // 신규 GET list 표준 (CLAUDE.md — parsePagination + paginatedResponse).
    //   사전은 워크스페이스당 100개 상한이라 실무상 1 page 지만, 표준을 벗어나면
    //   가드가 잡고 다음 사람이 unbounded list 를 복사해 간다.
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows: tags, count } = await TaskTag.findAndCountAll({
      where: { business_id: businessId },
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
      limit, offset,
    });
    // 사용 수는 링크 집계 1회 (태그마다 COUNT 하면 N+1)
    const [counts] = await sequelize.query(
      `SELECT l.tag_id AS tag_id, COUNT(*) AS c
         FROM task_tag_links l
         JOIN task_tags t ON t.id = l.tag_id
        WHERE t.business_id = :biz
        GROUP BY l.tag_id`,
      { replacements: { biz: businessId } }
    );
    const usage = new Map(counts.map(r => [Number(r.tag_id), Number(r.c)]));
    return paginatedResponse(res, tags.map(t => serializeTag(t, usage.get(t.id) || 0)), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── POST /api/tasks/tags — 생성 ───
router.post('/tags', authenticateToken, async (req, res, next) => {
  try {
    const businessId = await requireMember(req, res);
    if (!businessId) return;
    const name = normalizeName(req.body.name);
    if (!name) return errorResponse(res, '태그 이름을 입력하세요', 400);
    if (name.length > 30) return errorResponse(res, '태그 이름은 30자 이내입니다', 400);
    const color = req.body.color ? String(req.body.color) : null;
    if (color && !COLOR_RE.test(color)) return errorResponse(res, 'color 는 #RRGGBB 형식이어야 합니다', 400);

    const total = await TaskTag.count({ where: { business_id: businessId } });
    if (total >= MAX_TAGS_PER_BIZ) {
      return errorResponse(res, `워크스페이스 태그는 최대 ${MAX_TAGS_PER_BIZ}개입니다`, 400);
    }
    // UNIQUE(business_id, name) 이 ai_ci 라 대소문자만 다른 중복도 여기서 걸린다.
    const dup = await TaskTag.findOne({ where: { business_id: businessId, name } });
    if (dup) return errorResponse(res, '같은 이름의 태그가 이미 있습니다', 409);

    const tag = await TaskTag.create({
      business_id: businessId, name, color,
      sort_order: Number(req.body.sort_order) || 0,
      created_by: req.user.id,
    });
    logAudit(req, { action: 'task_tag.create', targetType: 'task_tag', targetId: tag.id, newValue: { name, color } });
    broadcastTagDict(req, businessId);
    return successResponse(res, serializeTag(tag, 0), 'Tag created', 201);
  } catch (err) { next(err); }
});

// ─── PUT /api/tasks/tags/:tagId — 이름/색/정렬 ───
router.put('/tags/:tagId', authenticateToken, async (req, res, next) => {
  try {
    const tag = await TaskTag.findByPk(Number(req.params.tagId));
    if (!tag) return errorResponse(res, 'tag_not_found', 404);
    if (!(await assertMemberOrAbove(req.user.id, tag.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const patch = {};
    if (req.body.name !== undefined) {
      const name = normalizeName(req.body.name);
      if (!name) return errorResponse(res, '태그 이름을 입력하세요', 400);
      if (name.length > 30) return errorResponse(res, '태그 이름은 30자 이내입니다', 400);
      if (name !== tag.name) {
        const dup = await TaskTag.findOne({ where: { business_id: tag.business_id, name } });
        if (dup) return errorResponse(res, '같은 이름의 태그가 이미 있습니다', 409);
      }
      patch.name = name;
    }
    if (req.body.color !== undefined) {
      const color = req.body.color ? String(req.body.color) : null;
      if (color && !COLOR_RE.test(color)) return errorResponse(res, 'color 는 #RRGGBB 형식이어야 합니다', 400);
      patch.color = color;
    }
    if (req.body.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
    if (Object.keys(patch).length === 0) return successResponse(res, serializeTag(tag));

    const old = { name: tag.name, color: tag.color, sort_order: tag.sort_order };
    await tag.update(patch);
    logAudit(req, { action: 'task_tag.update', targetType: 'task_tag', targetId: tag.id, oldValue: old, newValue: patch });
    broadcastTagDict(req, tag.business_id);
    return successResponse(res, serializeTag(tag), 'Tag updated');
  } catch (err) { next(err); }
});

// ─── DELETE /api/tasks/tags/:tagId — 삭제 (링크 CASCADE) ───
//   차단하지 않는 이유: 태그는 레코드가 아니라 라벨이다. 사용 중이면 못 지우게 하면
//   "빈 태그를 먼저 만들 수 없는" 닭·달걀이 된다. 대신 프론트 확인 모달이 usage_count 를 보여준다.
router.delete('/tags/:tagId', authenticateToken, async (req, res, next) => {
  try {
    const tag = await TaskTag.findByPk(Number(req.params.tagId));
    if (!tag) return errorResponse(res, 'tag_not_found', 404);
    if (!(await assertMemberOrAbove(req.user.id, tag.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const businessId = tag.business_id;
    const usage = await TaskTagLink.count({ where: { tag_id: tag.id } });
    const snapshot = { name: tag.name, color: tag.color, usage_count: usage };
    await tag.destroy();   // task_tag_links 는 FK ON DELETE CASCADE
    logAudit(req, { action: 'task_tag.delete', targetType: 'task_tag', targetId: Number(req.params.tagId), oldValue: snapshot });
    broadcastTagDict(req, businessId);
    return successResponse(res, { id: Number(req.params.tagId), deleted: true, removed_links: usage });
  } catch (err) { next(err); }
});

// ─── PUT /api/tasks/:id/tags — 업무의 태그 지정 ───
// body: { tag_ids: number[] }
//   권한은 **title/category 축**(작성자/담당자/owner/admin) — tasks.js FIELD_RULES.category 와 동일 분기.
//   태그는 "이 업무가 무엇에 관한 것인가" 라 의뢰자와 수행자 둘 다 손댈 수 있어야 한다.
router.put('/:id/tags', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(Number(req.params.id));
    if (!task) return errorResponse(res, 'task_not_found', 404);
    if (!(await assertMemberOrAbove(req.user.id, task.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const isCreator = task.created_by === req.user.id;
    const isAssignee = task.assignee_id === req.user.id;
    const canEdit = isCreator || isAssignee || isPlatformAdmin || scope.isOwner || scope.isAdmin;
    if (!canEdit) return errorResponse(res, 'forbidden_field_tags', 403);

    const raw = Array.isArray(req.body.tag_ids) ? req.body.tag_ids : [];
    const wanted = [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0))];
    if (wanted.length > MAX_TAGS_PER_TASK) {
      return errorResponse(res, `업무당 태그는 최대 ${MAX_TAGS_PER_TASK}개입니다`, 400);
    }
    // ★ 멀티테넌트 — 같은 워크스페이스 태그만. 남의 워크스페이스 tag_id 를 보내도 걸러진다.
    const valid = wanted.length
      ? await TaskTag.findAll({ where: { id: { [Op.in]: wanted }, business_id: task.business_id }, attributes: ['id'] })
      : [];
    const validIds = valid.map(t => t.id);
    if (validIds.length !== wanted.length) {
      return errorResponse(res, '이 워크스페이스에 없는 태그가 포함됐습니다', 400);
    }

    const existing = await TaskTagLink.findAll({ where: { task_id: task.id } });
    const before = existing.map(l => l.tag_id).sort((a, b) => a - b);
    const after = [...validIds].sort((a, b) => a - b);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      // 멱등 no-op — 감사도 broadcast 도 하지 않는다.
      const [row] = await attachTagsTo([{ id: task.id }], task.business_id);
      return successResponse(res, { id: task.id, tags: row.tags });
    }

    const toAdd = after.filter(id => !before.includes(id));
    const toRemove = before.filter(id => !after.includes(id));
    if (toRemove.length) await TaskTagLink.destroy({ where: { task_id: task.id, tag_id: { [Op.in]: toRemove } } });
    if (toAdd.length) await TaskTagLink.bulkCreate(toAdd.map(tag_id => ({ task_id: task.id, tag_id })));

    const [row] = await attachTagsTo([{ id: task.id }], task.business_id);
    logAudit(req, {
      action: 'task.tags_update', targetType: 'task', targetId: task.id,
      businessId: task.business_id,
      oldValue: { tag_ids: before }, newValue: { tag_ids: after },
    });
    // 실시간 (CLAUDE.md §16 b) — 리스트·팝아웃이 태그 칩을 즉시 갱신한다.
    const io = req.app.get('io');
    if (io) {
      // #277 — 표시명 포함 직렬화 단일 지점. tags 는 이 경로 고유 부가 필드라 caller 가 얹는다.
      const { serializeTaskForBroadcast } = require('../services/taskBroadcast');
      const base = await serializeTaskForBroadcast(task.id, task.business_id);
      const payload = { ...(base || task.toJSON()), tags: row.tags, actor_user_id: req.user.id };
      if (task.project_id) io.to(`project:${task.project_id}`).emit('task:updated', payload);
      io.to(`business:${task.business_id}`).emit('task:updated', payload);
    }
    return successResponse(res, { id: task.id, tags: row.tags });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.attachTagsTo = attachTagsTo;
