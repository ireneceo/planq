// GET /api/projects/conversations/:id/messages/search?q= — 대화 안 메시지 검색 (2026-11-12, 채널톡 쓰는 고객사 점검 A)
//
// ★ 읽기 판정은 메시지 목록과 **같은 함수**(services/convReadAccess) — 검색이 목록보다 넓으면 그게 곧 누수다.
// ★ 고객은 목록과 같은 술어(utils/messageVisibility CLIENT_VISIBLE_MESSAGE_WHERE) — 내부 메모·미승인 초안은 안 나온다.
// ★ 지운 메시지는 누구에게도 나오지 않는다(자리만 남기는 마스킹 정책 — 검색으로 원문이 되살아나면 안 된다).
//   거절된 Cue 초안도 뺀다(화면이 본문을 비워 그리는 것).
// ★ 응답은 **스니펫(≤160자 평문 창)** 만 — 본문 전체·첨부·번역 캐시를 싣지 않는다(utils/searchMatch 계약).
// ★ 검색 규칙은 서버·화면 한 벌(utils/searchMatch — NFC · 공백 무시 · 토큰 ≤4).
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const { Conversation, Message, User } = require('../models');
const { errorResponse } = require('../middleware/errorHandler');
const { convReadDenied } = require('./convReadAccess');
const { CLIENT_VISIBLE_MESSAGE_WHERE } = require('../utils/messageVisibility');
const { parseSearchQuery, makeSnippet } = require('../utils/searchMatch');
const { applyMemberDisplayName, applyGuestDisplayName } = require('./displayName');

const LIMIT = 50;
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

async function searchConversationMessages(req, res, next) {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    const denied = await convReadDenied(conv, req.user.id);
    if (denied) return errorResponse(res, denied.message, denied.code);

    const { raw, tokens, squashed } = parseSearchQuery(req.query.q);
    if (!squashed) return res.json({ success: true, data: [], has_more: false });

    const contentNoSpace = fn('REPLACE', col('Message.content'), ' ', '');
    const match = { [Op.or]: [
      sqlWhere(contentNoSpace, { [Op.like]: `%${likeEscape(squashed)}%` }),
      ...(tokens.length > 1 ? [{ [Op.and]: tokens.map((tk) => ({ content: { [Op.like]: `%${likeEscape(tk)}%` } })) }] : []),
    ] };
    const { getUserScope } = require('../middleware/access_scope');
    const viewer = await getUserScope(req.user.id, conv.business_id).catch(() => null);
    const and = [
      { conversation_id: conv.id },
      { is_deleted: { [Op.not]: true } },
      // 거절된 Cue 초안 제외 — 긍정형(NULL 이 행을 죽이지 않게, messageVisibility 머리말)
      { [Op.or]: [{ is_ai: { [Op.not]: true } }, { ai_draft_approved: null }, { ai_draft_approved: true }] },
      match,
    ];
    if (viewer?.isClient) and.push(CLIENT_VISIBLE_MESSAGE_WHERE);

    const rows = await Message.findAll({
      where: { [Op.and]: and },
      attributes: ['id', 'content', 'created_at', 'sender_id', 'is_ai', 'meta'],
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest'] }],
      order: [['id', 'DESC']],
      limit: LIMIT + 1,
    });
    const hasMore = rows.length > LIMIT;
    const list = rows.slice(0, LIMIT).map((m) => m.toJSON());
    await applyMemberDisplayName(list, conv.business_id, ['sender']);
    applyGuestDisplayName(list);
    // 화이트리스트 — 남길 것만 남긴다(본문 전체·meta 는 내보내지 않는다)
    const data = list.map((m) => ({
      id: m.id,
      created_at: m.created_at || m.createdAt,
      sender_id: m.sender_id,
      sender_name: m.is_ai ? 'Cue' : (m.sender?.name || ''),
      snippet: makeSnippet(m.content, raw, { plain: true })?.display || String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 158),   // 평문 창(강조는 화면 HighlightText)
    }));
    return res.json({ success: true, data, has_more: hasMore });
  } catch (err) { next(err); }
}

module.exports = { searchConversationMessages };
