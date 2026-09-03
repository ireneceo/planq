// 배포별 개발 현황 — platform_admin 전용. routes/admin.js 에서 분리(god-file 래칫 877줄 동결).
//
// 무엇인가: 사용자용 릴리즈노트가 아니라 **개발자/관리자가 보는 배포 장부**다.
//   무엇을 고쳤고, 무엇이 열려 있고, 무엇이 사람 손을 기다리고, 이번 배포로 무엇이 달라지는지.
//   여기에는 미공개 취약점 서술이 실리므로 Q위키(모든 로그인 사용자)에 절대 두지 않는다.
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { DevStatusReport, User, FeedbackItem } = require('../models');

// ★ 라우터 전역 가드 — admin_credits.js 와 같은 형태. 파일 단위로 닫아 둬야
//   나중에 라우트를 하나 추가할 때 가드를 빠뜨리지 않는다.
router.use(authenticateToken, requireRole('platform_admin'));

const SECTION_KEYS = [
  'working_on', 'completed', 'in_progress', 'issues', 'backlog',
  'behavior_changes', 'check_areas', 'migrations', 'blocked_on_human',
  'tooling_health', 'undeployed',
];

// 응답 직렬화 — sections 는 없는 키를 빈 배열로 채워 화면이 분기하지 않게 한다.
function serialize(row, extra = {}) {
  const s = row.sections || {};
  const sections = {};
  for (const k of SECTION_KEYS) sections[k] = Array.isArray(s[k]) ? s[k] : [];
  return {
    id: row.id,
    commit_to: row.commit_to,
    commit_from: row.commit_from,
    version: row.version,
    deployed_at: row.deployed_at,
    backup_dir: row.backup_dir,
    closed_feedback_ids: row.closed_feedback_ids || [],
    kept_open_ids: row.kept_open_ids || [],
    pdf_check: row.pdf_check,
    release_note_published: !!row.release_note_published,
    schema_changed: !!row.schema_changed,
    author_name: row.author?.name || null,
    created_at: row.created_at,
    sections,
    ...extra,
  };
}

// 목록 — 요약만. sections 전문은 상세에서.
router.get('/dev-status', async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const { rows, count } = await DevStatusReport.findAndCountAll({
      order: [['deployed_at', 'DESC']],
      limit, offset,
      include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
      distinct: true,
    });
    const data = rows.map((r) => {
      const full = serialize(r);
      // 목록은 섹션별 건수만 — 본문을 다 실으면 배포 200회쯤에서 응답이 수 MB 가 된다
      const counts = {};
      for (const k of SECTION_KEYS) counts[k] = full.sections[k].length;
      return { ...full, sections: undefined, section_counts: counts };
    });
    return paginatedResponse(res, data, count, { limit, page, offset });
  } catch (err) { next(err); }
});

// 상세 — commit_to(전체 또는 짧은 해시) 로 찾는다. 사람이 로그에서 복사해 넣는 값이 짧은 해시다.
router.get('/dev-status/:commit', async (req, res, next) => {
  try {
    const raw = String(req.params.commit || '').trim();
    if (!/^[0-9a-f]{7,40}$/i.test(raw)) return errorResponse(res, '커밋 해시 형식이 아닙니다', 400);
    const { Op } = require('sequelize');
    const row = await DevStatusReport.findOne({
      where: { commit_to: { [Op.like]: `${raw}%` } },
      order: [['deployed_at', 'DESC']],
      include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
    });
    if (!row) return errorResponse(res, '해당 배포 기록이 없습니다', 404);

    // ★ 이슈의 처리 상태는 여기 적힌 글이 아니라 **피드백 원장**이 정본이다.
    //   수기 status 를 두면 신고가 닫혀도 이 화면은 영영 "열림" 이라고 말한다.
    const ids = (row.sections?.issues || []).map((i) => Number(i.feedback_id)).filter(Boolean);
    let liveStatus = {};
    if (ids.length && FeedbackItem) {
      const fbs = await FeedbackItem.findAll({ where: { id: ids }, attributes: ['id', 'status'] });
      liveStatus = Object.fromEntries(fbs.map((f) => [f.id, f.status]));
    }
    return successResponse(res, serialize(row, { feedback_status: liveStatus }));
  } catch (err) { next(err); }
});

module.exports = router;
