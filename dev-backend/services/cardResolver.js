// services/cardResolver.js — 카드 메시지의 **지금** 공개 주소를 해석한다 (#259 게스트 자료 1단계).
//
//   왜 필요한가: 카드(`messages.kind='card'`)의 `meta.share_url`·`meta.share_token` 은
//   **발급 당시 값의 스냅샷**이다. `services/shareTokenCleanup.js` 가 30일 미사용 토큰을
//   NULL 로 만들기 때문에 시간이 지나면 카드의 주소가 죽는다.
//   실측(2026-09-02, 운영): 카드 8건 중 **5건이 404** — 게스트만이 아니라 **멤버 화면도** 그렇다.
//
//   그래서 주소를 응답에 실어 보내지 않고, **누를 때 서버가 entity 행에서 다시 해석**한다.
//     · 멤버가 다시 공유하면 옛 카드가 그 자리에서 되살아난다
//     · 목록 한 번에 토큰을 전부 살포하지 않는다 (클릭당 1개, 그것도 302 로만)
//     · 죽은 카드를 서버가 알므로 화면이 **왜 못 여는지**를 말할 수 있다
//
//   ★ 게스트 클릭이 토큰을 **새로 발급(mint)하게 하지 않는다.** 게스트의 클릭이 우리 데이터를
//     바꾸는 순간, 링크를 아는 사람이 우리 자원의 상태를 움직일 수 있게 된다.
const { Task, File, KbDocument, CalendarEvent, Invoice, Post } = require('../models');
const { blocksExternalShare } = require('./securityLevel');
const { shareOpenReason } = require('./shareOpenable');

// card_type → 어떤 행을 보고, 공개 경로가 무엇인가.
//   `share.js` 의 ENTITY_CONFIG + invoices.js · posts.js 가 만드는 카드까지 한 표에 모은다.
const CARD_TARGETS = {
  task:           { model: Task,          idKey: 'task_id',    publicPath: 'tasks' },
  file:           { model: File,          idKey: 'file_id',    publicPath: 'files' },
  kb_document:    { model: KbDocument,    idKey: 'kb_id',      publicPath: 'kb' },
  calendar_event: { model: CalendarEvent, idKey: 'event_id',   publicPath: 'calendar' },
  invoice:        { model: Invoice,       idKey: 'invoice_id', publicPath: 'invoices' },
  post:           { model: Post,          idKey: 'post_id',    publicPath: 'posts' },
  // signature_request 는 의도적으로 없다 — OTP 서명은 법적 행위이고 서명자 이메일 OTP 와
  //   묶여 있다. 카드는 "이메일로 받은 서명 링크에서 진행" 만 말한다.
};

/**
 * 카드의 현재 상태와 열 주소.
 *
 * @returns {Promise<{ state: 'ok'|'share_revoked'|'share_expired'|'not_available'|'security_blocked'|'unsupported', url: string|null }>}
 *   state 는 화면이 **왜 못 여는지**를 말하기 위한 값이다. 알 수 없는 값을 기본값으로
 *   조용히 떨어뜨리지 않는다 (CLAUDE.md "상태값 규약").
 */
async function resolveCard(meta, { businessId, appUrl }) {
  const cardType = meta && meta.card_type;
  const cfg = CARD_TARGETS[cardType];
  if (!cfg) return { state: 'unsupported', url: null };

  const id = meta[cfg.idKey];
  if (!id) return { state: 'not_available', url: null };

  const entity = await cfg.model.findByPk(id);
  if (!entity) return { state: 'not_available', url: null };
  // 테넌트 이중 검증 — 카드가 다른 워크스페이스 자원을 가리키면 데이터가 어긋난 것이다.
  if (businessId != null && entity.business_id !== businessId) return { state: 'not_available', url: null };

  // 보안등급 — 채팅 공유 시점(`routes/share.js:139`)과 **같은 함수**로 다시 본다.
  //   공유한 뒤에 등급이 올라갔을 수 있고, 그때 옛 카드가 계속 열리면 안 된다.
  if (blocksExternalShare(entity)) return { state: 'security_blocked', url: null };

  // ★ "지금 열리는가" 는 **공개 라우트와 같은 함수**로 판정한다.
  //   전에는 여기서 토큰 유무만 봐서, 만료됐거나 초안인 자료에 "열어보기" 를 그리고
  //   누르면 410/404 가 떴다 (Fable 실증 2026-09-02).
  const why = shareOpenReason(cardType, entity);
  if (why === 'no_token') return { state: 'share_revoked', url: null };
  if (why === 'expired') return { state: 'share_expired', url: null };
  if (why) return { state: 'not_available', url: null };   // missing·deleted·not_published·not_issued

  return { state: 'ok', url: `${appUrl}/public/${cfg.publicPath}/${entity.share_token}` };
}

/** 화면에 내보낼 카드 요약 — 토큰·주소는 넣지 않는다(누를 때 서버가 302 로만 준다). */
function summarizeCard(meta, state) {
  return {
    card_type: (meta && meta.card_type) || null,
    title: (meta && (meta.title || meta.invoice_number)) || null,
    note: (meta && meta.note) || null,
    state,
  };
}

module.exports = { CARD_TARGETS, resolveCard, summarizeCard };
