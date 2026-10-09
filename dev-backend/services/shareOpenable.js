// services/shareOpenable.js — 공개 공유 링크가 **지금 열리는가** 를 판정하는 단일 술어.
//
//   왜 한 곳인가: 카드(채팅에 붙은 자료)는 "열어보기" 를 그릴지 말지 정해야 하고,
//   공개 라우트는 실제로 열지 말지 정해야 한다. **두 판정이 갈리면 화면이 거짓말한다** —
//   "열어보기" 를 눌렀는데 만료 페이지가 뜬다.
//
//   실제로 갈려 있었다 (2026-09-02 Fable 실증):
//     · `share_expires_at` 과거  → 카드 state=ok / 공개 API 410
//     · post `status='draft'`    → 카드 state=ok / 공개 API 404
//   카드 쪽이 `deleted_at`·`security_level`·토큰 유무만 보고 나머지를 안 봤다.
//
//   그래서 **양쪽이 이 함수를 부른다.** 주석으로 "같은 술어" 라고 쓰면 다음 사람이 확인하지
//   않는다 (memory feedback_comment_lies_predicate_drifts) — 같은 함수를 부르게 한다.
//
//   ★ 보안등급(`blocksExternalShare`)은 **여기 넣지 않는다.** 그것은 "밖으로 내보내도 되는가"
//     라는 다른 축이고, 공개 라우트는 토큰을 가진 사람에게 이미 열기로 한 것이다.
//     카드 쪽만 그 축을 추가로 본다(cardResolver).

/**
 * 자원 종류별 "발행/유효" 규칙.
 *
 * 여기 없는 종류(task·file·kb_document)는 **공개 라우트를 읽어 확인한 결과** 토큰·만료·비밀번호
 * 외에 추가 조건이 없다 (2026-09-02 전수 확인: `tasks.js:2548` · `files.js:151`(deleted_at) ·
 * `kb.js:1612`(paranoid)). 새 공개 라우트를 만들면 **여기부터 확인**할 것 —
 * 조건을 라우트에만 두면 카드가 "열어보기" 를 그려 놓고 404 가 뜬다.
 */
const OPEN_RULES = {
  // 초안·비공개 글은 공개 라우트가 404 를 낸다 (`routes/posts.js` where status:'published')
  post: (e) => (e.status !== 'published' ? 'not_published' : null),
  // 발행 전(draft)·취소된 청구서는 공개 결제 페이지가 404 (`routes/invoices.js:132`)
  invoice: (e) => (e.status === 'draft' || e.status === 'canceled' ? 'not_issued' : null),
  // #104 방어심층 — 개인(L1)·팀 비공개(L2)로 전환됐거나 레거시 토큰이 남은 일정은 공개 미제공.
  //   이 규칙이 여기 없어서 카드가 L1 일정에 "열어보기" 를 그리고 누르면 404 였다
  //   (Fable 실증 2026-09-02: vlevel=L1 → 카드 ok / 공개 404).
  calendar_event: (e) => (e.vlevel === 'L1' || e.vlevel === 'L2' || e.visibility === 'personal'
    ? 'not_published' : null),
};

/**
 * @param {string} kind  'post' | 'invoice' | 'file' | 'task' | 'kb_document' | 'calendar_event'
 * @param {object|null} entity
 * @returns {null|'missing'|'deleted'|'no_token'|'expired'|'not_published'|'not_issued'}
 *   null 이면 **열린다**. 그 외는 왜 못 여는지.
 */
function shareOpenReason(kind, entity) {
  if (!entity) return 'missing';
  if (entity.deleted_at) return 'deleted';
  if (!entity.share_token) return 'no_token';
  if (entity.share_expires_at && new Date(entity.share_expires_at) < new Date()) return 'expired';
  const rule = OPEN_RULES[kind];
  return rule ? rule(entity) : null;
}

/**
 * 공개 링크에 **실어도 되는 파일**인가 — 외부 공개(L4)로 표시된 파일만.
 *   문서 공유(목록·다운로드)와 업무 공유가 **이 함수 하나**를 쓴다. 전에는 posts.js 두 곳에
 *   같은 식이 따로 적혀 있었다(한쪽만 고치면 목록과 다운로드가 갈라진다).
 *   ★ 판정은 원본 File 인스턴스로 한다 — 직렬화본은 vlevel 을 빼서 "전부 비공개" 로 읽힌다.
 */
function isPublicFile(f) {
  if (!f) return false;
  // 보안등급(internal·confidential)은 L4 여도 밖으로 내보내지 않는다 — L4 인 채로 등급만 올린 파일이
  //   문서·업무 공개 첨부로 무인증 다운로드되던 구멍(2026-09-27 점검).
  if (f.security_level && f.security_level !== 'general') return false;
  return f.vlevel === 'L4' || (!f.vlevel && f.visibility === 'L4');
}

/**
 * 공개 링크의 **워크스페이스가 살아 있는가** — router.param('token') 에 거는 문 (2026-10-09 보안점검).
 *
 *   왜: 워크스페이스가 지워져도(계정 탈퇴 → 혼자 쓰던 워크스페이스 삭제) 그 안의 공유 링크가 계속 열렸다.
 *   로그인 경로는 middleware/auth 의 workspaceAliveCheck 가 막지만 공개 경로는 인증을 안 탄다.
 *   토큰을 지우지 않고 **열 때 보는** 이유: 탈퇴는 30일 안에 되돌릴 수 있다 — 되돌리면 링크도 돌아와야 한다.
 *   router.param 이라 그 라우터의 :token 하위 주소(PDF·다운로드·첨부·결제)가 전부 같은 문을 지난다.
 *
 * @param {Array<[Model, string]>} sources  [모델, 토큰 칼럼] — 먼저 찾은 행의 business_id 로 판정
 */
function workspaceAliveParam(sources) {
  return async (req, res, next, token) => {
    try {
      const t = String(token || '').trim();
      if (!t) return next();
      for (const [Model, col] of sources) {
        const row = await Model.findOne({ where: { [col]: t }, attributes: ['business_id'] });
        if (!row) continue;
        if (!row.business_id) return next();
        const { Business } = require('../models');
        const alive = await Business.findOne({ where: { id: row.business_id, deleted_at: null }, attributes: ['id'] });
        if (!alive) return res.status(404).json({ success: false, message: 'not_found' });
        return next();
      }
      return next();   // 못 찾으면 라우트가 원래대로 404 를 낸다
    } catch (e) { return next(e); }
  };
}

module.exports = { OPEN_RULES, shareOpenReason, isPublicFile, workspaceAliveParam };
