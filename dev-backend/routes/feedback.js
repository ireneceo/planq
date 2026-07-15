// 사이클 P6 — 사용자 → 운영팀 피드백 라우트
//   POST   /api/feedback              (자기 제출)
//   GET    /api/feedback/mine         (내 제출 이력)
//   GET    /api/feedback/admin        (platform_admin 전체 — 상태/카테고리 필터)
//   PATCH  /api/feedback/:id/respond  (platform_admin — 상태 변경 + 답변)
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { FeedbackItem, User } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const ALLOWED_CATS = ['bug', 'improve', 'feature', 'other'];
const ALLOWED_STATUS = ['pending', 'reviewing', 'done', 'wontfix'];
const ALLOWED_PRIORITY = ['normal', 'high'];

// POST — 사용자 제출 (자동 메타 page_url, user_agent 수집)
//   parent_id 동봉 시 = 답변 받은 원 피드백에 대한 추가 문의(스레드 자식, #70)
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { category, priority, title, body, page_url, attachments, parent_id, client_env, is_popout } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body_required', 400);

    // 추가 문의(parent_id) 검증 — 본인 소유 + 답변 받은 최상위 부모만
    let parent = null;
    if (parent_id != null) {
      parent = await FeedbackItem.findByPk(parent_id);
      if (!parent || parent.user_id !== req.user.id) return errorResponse(res, 'parent_not_found', 404);
      if (parent.parent_id) return errorResponse(res, 'cannot_nest_followup', 400); // 1단계만
      if (!parent.admin_response) return errorResponse(res, 'parent_not_answered', 400); // 답변 후에만 추가문의
    }

    // 추가 문의는 제목 생략 가능 — 본문 첫 줄 또는 부모 제목 prefix 로 자동 생성
    let finalTitle = title && String(title).trim() ? String(title).trim() : '';
    if (!finalTitle) {
      if (parent) {
        const firstLine = (String(body).trim().split('\n')[0] || '').slice(0, 60);
        finalTitle = firstLine || `추가 문의: ${parent.title}`.slice(0, 200);
      } else {
        return errorResponse(res, 'title_required', 400);
      }
    }

    // 추가 문의는 부모의 분류/워크스페이스 상속, 신규는 사용자 선택값
    const finalCategory = parent ? parent.category : (ALLOWED_CATS.includes(category) ? category : 'other');
    const finalPriority = parent ? parent.priority : (ALLOWED_PRIORITY.includes(priority) ? priority : 'normal');
    const finalBizId = parent ? parent.business_id : (req.user.business_id || null);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const item = await FeedbackItem.create({
      user_id: req.user.id,
      business_id: finalBizId,
      parent_id: parent ? parent.id : null,
      category: finalCategory,
      priority: finalPriority,
      title: finalTitle.slice(0, 200),
      body: String(body),
      attachments: Array.isArray(attachments) ? attachments.slice(0, 5) : null,
      page_url: page_url ? String(page_url).slice(0, 500) : null,
      user_agent: ua,
      client_env: (client_env && typeof client_env === 'object' && !Array.isArray(client_env)) ? client_env : null,
      is_popout: !!is_popout,
      status: 'pending',
    });

    // 플랫폼 관리자 알림 — fan-out 비동기 (추가 문의는 스레드 맥락 표기)
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      const catLabel = { bug: '버그', improve: '개선', feature: '기능 요청', other: '기타' }[finalCategory] || finalCategory;
      const prioMark = finalPriority === 'high' ? '⚠ 긴급 ' : '';
      const titlePrefix = parent ? '추가 문의' : '새 피드백';
      notifyPlatformAdmins({
        eventKind: 'feedback',
        title: `${prioMark}${titlePrefix} — [${catLabel}] ${item.title}`,
        body: `${req.user.email || ''} 가 ${parent ? `"${parent.title}" 에 추가 문의를` : '피드백을'} 제출했습니다.\n\n${String(body).slice(0, 400)}${String(body).length > 400 ? '…' : ''}`,
        link: `${APP_URL}/admin/feedback?id=${parent ? parent.id : item.id}`,
        ctaLabel: '피드백 보기',
        relatedEntityId: parent ? parent.id : item.id,
      }).catch(() => null);
    });

    return successResponse(res, item, 'Submitted', 201);
  } catch (err) { next(err); }
});

// GET /mine — 내 제출 이력 (자기 추적) — #70 스레드 그룹핑
//   최상위 피드백(parent_id=null) 배열, 각 항목에 replies[](추가 문의, 시간순) + last_activity_at 동봉.
//   하위호환: 각 부모 row 는 기존 필드 그대로 + replies 만 추가 (드로어 myhistory 는 replies 무시하고 동작).
router.get('/mine', authenticateToken, async (req, res, next) => {
  try {
    const rows = await FeedbackItem.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'ASC']],
      limit: 400,
    });

    const byId = {};
    const parents = [];
    rows.forEach((r) => { const o = r.toJSON(); o.replies = []; byId[o.id] = o; });
    rows.forEach((r) => {
      const o = byId[r.id];
      if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].replies.push(o);
      else parents.push(o); // parent_id 없음 또는 부모 유실 → 최상위 취급
    });

    // 스레드 최근 활동 시각 = 부모/자식 생성·답변 중 가장 늦은 것
    const ts = (o) => {
      let m = new Date(o.created_at).getTime();
      if (o.responded_at) m = Math.max(m, new Date(o.responded_at).getTime());
      return m;
    };
    parents.forEach((p) => {
      let last = ts(p);
      p.replies.forEach((c) => { last = Math.max(last, ts(c)); });
      p.last_activity_at = new Date(last).toISOString();
      // 스레드 마지막 항목이 미답변이면 대기 중 (추가문의 후 답변 전 등)
      const lastItem = p.replies.length ? p.replies[p.replies.length - 1] : p;
      p.awaiting_reply = !lastItem.admin_response;
    });
    parents.sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at));

    return successResponse(res, parents.slice(0, 50));
  } catch (err) { next(err); }
});

// GET /admin — platform_admin 전체 (상태/카테고리 필터)
router.get('/admin', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status && ALLOWED_STATUS.includes(req.query.status)) where.status = req.query.status;
    if (req.query.category && ALLOWED_CATS.includes(req.query.category)) where.category = req.query.category;
    if (req.query.q) {
      const q = String(req.query.q).slice(0, 80);
      where[Op.or] = [
        { title: { [Op.like]: `%${q}%` } },
        { body: { [Op.like]: `%${q}%` } },
      ];
    }
    const items = await FeedbackItem.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'responder', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    return successResponse(res, items);
  } catch (err) { next(err); }
});

// GET /admin/counts — 상태별 카운트 (탭 뱃지용)
router.get('/admin/counts', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const counts = {};
    for (const status of ALLOWED_STATUS) {
      counts[status] = await FeedbackItem.count({ where: { status } });
    }
    counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
    return successResponse(res, counts);
  } catch (err) { next(err); }
});

// PATCH /:id/respond — 상태 변경 + 답변 작성
router.patch('/:id/respond', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { status, admin_response } = req.body || {};
    const item = await FeedbackItem.findByPk(req.params.id);
    if (!item) return errorResponse(res, 'not_found', 404);

    const updates = {};
    if (status && ALLOWED_STATUS.includes(status)) updates.status = status;
    if (typeof admin_response === 'string') updates.admin_response = admin_response.slice(0, 5000);
    if (Object.keys(updates).length > 0) {
      updates.responded_by = req.user.id;
      updates.responded_at = new Date();
    }
    await item.update(updates);

    // 보고자에게 회신 알림 — 상태 변경 또는 답변 시. myhistory(#21)에서 답변 확인 + 인박스 즉시 인지.
    if (item.user_id && (updates.status || typeof updates.admin_response === 'string')) {
      setImmediate(() => {
        const { notify } = require('./notifications');
        const statusLabel = item.status === 'done' ? '완료'
          : item.status === 'wontfix' ? '보류'
          : item.status === 'reviewing' ? '검토 중' : '접수';
        notify({
          userId: item.user_id,
          businessId: item.business_id || null,
          eventKind: 'feedback',
          title: `피드백 ${statusLabel} — ${item.title}`,
          body: item.admin_response ? String(item.admin_response).slice(0, 300) : '운영팀이 회신했습니다.',
          link: '/me/feedback',
          ctaLabel: '내역 보기',
          actorUserId: req.user.id,
          ioApp: req.app,
        }).catch(() => null);
      });
    }

    return successResponse(res, item, 'Updated');
  } catch (err) { next(err); }
});

module.exports = router;
