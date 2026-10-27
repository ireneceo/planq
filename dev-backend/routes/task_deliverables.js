// 업무 결과물 회차(deliverable versions) 라우트 — /api/tasks/:id/deliverable-versions*
//   2026-10-27 task_workflow.js 에서 그대로 옮겼다(500줄 상한 — 참조자 라우트가 들어가며 넘었다). 동작 변경 없음.
//   볼 권한·주체·결과 변환은 task_workflow.js 의 같은 함수를 쓴다(베끼지 않는다).
const express = require('express');
const router = express.Router();
const { TaskStatusHistory, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');
const actions = require('../services/actions/task_actions');
const { loadTaskOrFail, actorFrom, sendResult, canAccessTask } = require('./task_workflow').helpers;

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// POST /api/tasks/:id/deliverable-versions — **지금 결과물을 한 버전으로 남긴다**
//
// Irene 2026-09-07: *"업무상세 결과물에 새버전 결과 추가버튼 만들어달라고.
//   자꾸 직원이 댓글에 달잖아. 결과물을 추가해서 계속 남기는 걸 알기 쉽게 해달라니까."*
//
// 여태 버전이 생기는 문은 **"확인 요청 보내기" 하나뿐**이었다(services/taskTransition.submitForReview).
// 그래서 중간 결과를 남길 자리가 없어 담당자가 **댓글**에 결과물을 붙였다 — 그러면 무엇이
// 결과물이고 무엇이 대화인지 섞이고, 버전 이력에도 안 남는다.
//
// 규칙(기존 박제와 같게 유지):
//   · **버전은 명시적으로 만든다.** 저장할 때마다 박제하면 수십 개가 되어 "무엇이 제출본인가" 가 흐려진다.
//   · 회차 번호는 **박제 목록의 최대치 +1** — review_round 로 구하면 되돌리기 백업과 번호가 겹친다.
//   · 첨부는 id 만 담는다(파일 복제 X).
//   · 결과물은 담당자만 쓴다 — 책임선에 직급 예외 없음(FIELD_RULES.body 와 같은 술어).
// Body: { note?: string, start_new?: boolean }  start_new=true 면 남긴 뒤 입력란을 비운다.
// ─────────────────────────────────────────────
router.post('/:id/deliverable-versions', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 행동 계층(services/actions/task_actions.js audit())이 남긴다 — 라우트에서 또 쓰면 한 사건이 두 행
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);
    // 라우트는 파싱·응답만 — 권한·트랜잭션·박제·감사·broadcast 는 행동 계층이 한다.
    const result = await actions.saveDeliverableVersion(task, actorFrom(req), {
      note: req.body?.note || null,
      startNew: req.body?.start_new === true,
    });
    return sendResult(res, result, (v) => successResponse(res, v, 'created', 201));
  } catch (err) { next(err); }
});

// GET /api/tasks/:id/deliverable-versions — 회차별 결과물 이력 (#271·#307)
//   결과물이 tasks.body 한 칸이라 다시 제출하면 이전 것이 덮이던 것 → 제출 시점마다 박제한 이력.
//   권한은 업무 상세와 같다(loadTaskOrFail 이 접근 검사를 이미 지난다).
// ─────────────────────────────────────────────
router.get('/:id/deliverable-versions', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    // ★ 2026-08-25 격리 결함 수정 — 옛 주석은 "loadTaskOrFail 이 격리를 끝냈다" 고 했으나 **사실이 아니었다.**
    //   그 함수는 `Task.findByPk` 만 한다(이 파일 상단). 다른 라우트는 행동 계층(actions.*)이 내부에서
    //   권한을 보지만 이 라우트는 읽기 전용이라 행동 계층을 거치지 않아 **아무 검사도 없이 통과했다.**
    //   실측: 타 워크스페이스 task 의 결과물 본문이 200 으로 반환됐다(같은 task 에 /workflow 는 403).
    //   이 표는 task_id 로만 매여 있어 where 에 business_id 를 넣을 자리가 없다 → /workflow 와 같은 술어를 부른다.
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);

    const { TaskDeliverableVersion } = require('../models');
    // 목록에 본문을 담지 않는다 — 회차가 쌓이면 응답이 수 MB 가 된다(포스트 이력과 같은 규칙,
    //   routes/post_revisions.js). 본문은 아래 단건 조회로 그 회차를 열 때만 가져온다.
    const rows = await TaskDeliverableVersion.findAll({
      where: { task_id: task.id },
      attributes: ['id', 'round', 'review_round', 'note', 'attachment_ids', 'submitted_by', 'created_at',
        [require('sequelize').fn('CHAR_LENGTH', require('sequelize').col('body')), 'body_len']],
      include: [{ model: User, as: 'submitter', attributes: ['id', 'name', 'name_localized'], required: false }],
      order: [['round', 'DESC'], ['id', 'DESC']],
    });

    // 회차별 결과(승인/수정요청) — 사용자가 알고 싶은 건 "무엇이 반려된 버전인가" 다.
    //   approve·revision 이력은 **컨펌 라운드**를 들고 있다(task_status_history.round).
    // ★ 2026-09-10 — 이 맵의 키는 컨펌 라운드이므로 **버전의 `review_round`** 로만 찾는다.
    //   목록 번호(`round`)로 찾던 옛 코드는 두 숫자가 어긋난 순간부터 남의 결과를 달았다
    //   (운영 task#257: 버전 3 에 09-08 수정요청, 아직 검토 대기인 버전 4 에 09-09 수정요청).
    const outcomes = await TaskStatusHistory.findAll({
      where: { task_id: task.id, event_type: ['approve', 'revision'] },
      attributes: ['event_type', 'round', 'created_at'],
      order: [['created_at', 'ASC']],
    });
    const byRound = new Map();
    for (const h of outcomes) {
      if (h.round == null) continue;
      const cur = byRound.get(h.round) || { approved: 0, revision: 0, at: null };
      if (h.event_type === 'approve') cur.approved += 1;
      else cur.revision += 1;
      cur.at = h.created_at;
      byRound.set(h.round, cur);
    }

    const items = rows.map(r => r.toJSON());
    await applyMemberDisplayName(items, task.business_id, ['submitter']);
    return successResponse(res, {
      current_round: task.review_round ?? null,
      versions: items.map(j => {
        // 제출본만 컨펌 결과를 가진다. 저장본·되돌리기 백업은 review_round 가 NULL 이다.
        const submitted = j.review_round != null;
        const o = submitted ? byRound.get(j.review_round) : null;
        return {
          id: j.id,
          round: j.round,
          // ★ 2026-09-10 — 제출 메모(note)·수정요청 글(outcome_note)은 **내려보내지 않는다.**
          //   Irene: "결과물 버전은 댓글내용이 들어가면 안돼. 결과물을 남기는 것과 실시간으로
          //   댓글로 소통하는 건 다른 목적이야." 그 글은 전부 댓글로도 남는다
          //   (submitReview·requestRevision 이 TaskComment 를 같이 만든다 — 운영 #257 실측
          //   버전 메모 = 댓글 #186, 수정요청 4건 = 댓글 #188·192·199·203).
          //   컬럼은 감사 목적으로 그대로 두고, 화면에는 결과물만 보낸다.
          review_round: j.review_round ?? null,
          submitted,
          attachment_ids: Array.isArray(j.attachment_ids) ? j.attachment_ids : [],
          // 본문 유무 — #271 이전 회차는 스냅샷이 없다. 화면이 "고장" 으로 보이지 않게 구분해 준다.
          has_body: Number(j.body_len || 0) > 0,
          body_len: Number(j.body_len || 0),
          outcome: o ? (o.revision > 0 ? 'revision' : (o.approved > 0 ? 'approved' : 'pending')) : 'pending',
          submitted_at: j.created_at,
          submitter: j.submitter ? { id: j.submitter.id, name: j.submitter.name } : null,
        };
      }),
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// GET /api/tasks/:id/deliverable-versions/:vid — 그 회차 결과물 본문
//   목록이 본문을 빼고 오므로, 사용자가 회차를 펼칠 때만 이걸 부른다.
// ─────────────────────────────────────────────
router.get('/:id/deliverable-versions/:vid', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);
    const { TaskDeliverableVersion } = require('../models');
    const v = await TaskDeliverableVersion.findOne({
      where: { id: req.params.vid, task_id: task.id },   // task_id 를 같이 걸어 남의 회차 조회 차단
    });
    if (!v) return errorResponse(res, 'version_not_found', 404);
    return successResponse(res, {
      id: v.id, round: v.round, body: v.body,   // note 는 대화(댓글)의 것이다 — 위 목록 라우트 주석
      attachment_ids: Array.isArray(v.attachment_ids) ? v.attachment_ids : [],
      submitted_at: v.created_at,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/deliverable-versions/:vid/restore — 그 회차 본문을 현재 결과물로 되돌리기
//   비파괴적이다 — 되돌리기 **직전의 현재 본문을 새 회차로 먼저 박제**한 뒤 덮는다.
//   그래서 "되돌렸다가 다시 원래대로" 도 된다. (포스트 복원과 같은 계약, routes/post_revisions.js)
//   권한 = 결과물 편집 권한과 동일 (담당자 · 플랫폼관리자 · 워크스페이스 admin — routes/tasks.js FIELD_RULES.body)
// ─────────────────────────────────────────────
router.post('/:id/deliverable-versions/:vid/restore', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);
    // 되돌리기 규칙(권한·비파괴 박제·트랜잭션)은 행동 계층 단일 착지점에 있다.
    //   라우트가 트랜잭션을 열면 도메인 로직이 새고, 같은 판정이 Cue 경로와 갈라진다.
    const result = await actions.restoreDeliverable(task, actorFrom(req), { versionId: req.params.vid });
    return sendResult(res, result, (d) => {
      require('../services/auditService').logAudit(req, {
        action: 'task.deliverable_restore',
        targetType: 'task',
        targetId: d.task.id,
        businessId: d.task.business_id,
        oldValue: { restored_from_round: d.restored_from_round, version_id: d.version_id },
        newValue: { title: d.task.title },
      });
      return successResponse(res, {
        id: d.task.id, body: d.task.body, restored_from_round: d.restored_from_round,
      });
    });
  } catch (err) { next(err); }
});


module.exports = router;
