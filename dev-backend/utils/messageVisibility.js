// utils/messageVisibility.js — 고객(Client)에게 보이는 메시지의 술어 **한 벌**.
//
// ★ 왜 SQL where 인가 — 이 술어를 "가져온 뒤 걸러내는" 방식으로 쓰면 **삭제·내부 메모·미승인 초안이
//   페이지 slot 을 먹는다.** 실측(2026-09-02): `limit=2` 로 부르면 직원은 2건을 받는데
//   고객은 **빈 배열 + has_more=true** 를 받았다. 프론트는 "받은 개수가 페이지 크기면 더 있다" 로
//   더보기를 판정하므로, **최근 50건에 삭제가 1건이라도 있으면 고객은 그 이전 대화를 영영 못 올린다.**
//   내부 메모를 쓰는 고객 대화는 #368 이후 계속 그 상태였다.
//   가져오기 전에 거르면 페이지가 항상 "보이는 것" 으로 꽉 차고 has_more 도 참말이 된다.
//
// ★ 게스트(routes/guest.js `visibleToGuest`)와 **같은 규칙**이다. 로그인 고객과 링크 게스트가
//   다른 것을 보면 그 차이가 곧 사고다. 술어를 바꾸면 양쪽을 같이 바꾼다.
const { Op, where, fn, json } = require('sequelize');

// Sequelize where 조각 — 고객 조회 쿼리에 그대로 spread 한다.
//
// ★ NULL 삼치논리 — **부정(NOT)으로 쓰면 NULL 이 통째로 탈락한다.**
//   `NOT (is_ai AND ai_mode_used='draft' AND …)` 는 `ai_mode_used` 가 NULL 이면
//   `true AND NULL` = NULL → `NOT NULL` = NULL → **보여야 할 메시지가 사라진다.**
//   (2026-09-02 Fable 검증: 진리표 42행 중 7행이 옛 post-filter 와 갈렸다.)
//   그래서 **긍정형(OR)** 으로 푼다 — NULL 이 어느 가지에서도 행을 죽이지 않는다.
//   `is_deleted` 도 `= false` 가 아니라 `IS NOT true` — 이 코드베이스의 unread/preview SQL 이
//   `(is_deleted IS NULL OR is_deleted = 0)` 로 NULL 을 "안 지움" 으로 읽는 것과 같은 해석이다.
// 팀 방 전용 «사람 정보» 카드(docs/CHAT_PROFILE_CARDS_DESIGN.md · Fable 2026-11-25) — 고객·게스트에게는 자리도 없다.
//   팀 방에만 보낼 수 있지만, 방에 나중에 고객이 들어오거나 링크가 걸려도 이 술어 한 곳이 닫는다(목록·미리보기·안읽음·검색·Cue·방송·게스트).
const STAFF_ONLY_CARD_TYPES = ['client_profile', 'member_profile'];
const CLIENT_VISIBLE_MESSAGE_WHERE = {
  is_deleted: { [Op.not]: true },   // IS NOT true — NULL 은 "안 지움"
  is_internal: false,
  [Op.or]: [                        // 미승인 Cue 초안이 아닌 것
    { is_ai: false },
    { ai_mode_used: null },
    { ai_mode_used: { [Op.ne]: 'draft' } },
    { ai_draft_approved: true },
  ],
  [Op.and]: [{
    [Op.or]: [                      // 직원 전용 카드가 아닌 것 (kind 는 NOT NULL)
      { kind: { [Op.ne]: 'card' } },
      // ★ COALESCE 로 종류 없는 카드(meta NULL·card_type 없음)도 «보임» 으로 — raw SQL·메모리 판과 같은 결과(Fable 2026-11-25 실측).
      //   중첩 JSON where(`{ meta: { card_type: null } }`)는 IS NULL 이 아니라 문자열 'null' 비교를 낸다 — 쓰지 않는다.
      //   열 이름은 별칭 없이 `meta` — 이 술어가 붙는 조회에서 meta 칸은 messages 하나뿐이다(Invoice·CueKnowledge 등과 조인하는 곳에 붙이지 말 것).
      where(fn('COALESCE', json('meta.card_type'), ''), { [Op.notIn]: STAFF_ONLY_CARD_TYPES }),
    ],
  }],
};

// 같은 술어의 **raw SQL 판** — 원시 SQL 집계(안읽음 카운트·목록 미리보기)에 AND 로 붙인다.
//
// ★ 왜 필요한가 — 목록 SQL 이 이 술어를 안 쓰면 **상세와 목록이 갈라진다.**
//   실측(2026-09-02 Fable): 고객 목록의 `last_message_preview` 에 **내부 메모 본문이 그대로** 실렸고
//   ("이 고객 단가 올리자"), 안읽음도 내부 메모를 세어 목록엔 2인데 열면 1건이었다.
//   고객에게 보이지 않는 글은 **세지도, 미리 보여주지도 않는다.**
function clientVisibleSql(alias = 'm') {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) throw new Error('bad alias');  // 문자열 조립 — 화이트리스트
  const a = `${alias}.`;
  return `(${a}is_deleted IS NULL OR ${a}is_deleted = 0)
            AND (${a}is_internal IS NULL OR ${a}is_internal = 0)
            AND (${a}is_ai IS NULL OR ${a}is_ai = 0
                 OR ${a}ai_mode_used IS NULL OR ${a}ai_mode_used <> 'draft'
                 OR ${a}ai_draft_approved = 1)
            AND NOT (${a}kind = 'card'
                 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${a}meta, '$.card_type')), '') IN (${STAFF_ONLY_CARD_TYPES.map((x) => `'${x}'`).join(',')}))`;
}

// 같은 술어의 메모리 판정판 — 이미 가져온 배열을 거를 때(소켓 payload 등) 쓴다.
//   ★ SQL 쪽과 갈라지지 않게 **여기 한 곳만** 고친다.
// ★ `!== true` 로 비교하지 말 것 — MySQL TINYINT 은 경로에 따라 boolean 이 아니라 **1/0** 으로 온다
//   (raw:true 조회·원시 SQL). 그러면 **승인된 초안을 숨기는** 반대 방향 오류가 난다
//   (2026-09-02: 내 판정 스크립트가 바로 이것으로 거짓 FAIL 을 냈다). 숫자로 환산해 본다.
const truthy = (v) => v === true || v === 1 || v === '1';
function isStaffOnlyCard(m) {
  if (!m || m.kind !== 'card') return false;
  let meta = m.meta;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
  return !!meta && STAFF_ONLY_CARD_TYPES.includes(meta.card_type);
}
function isVisibleToClient(m) {
  if (!m) return false;
  if (truthy(m.is_deleted)) return false;
  if (truthy(m.is_internal)) return false;
  if (truthy(m.is_ai) && m.ai_mode_used === 'draft' && !truthy(m.ai_draft_approved)) return false;
  if (isStaffOnlyCard(m)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────
// 직원(멤버 이상)에게 보이는 메시지 — **거절한 Cue 초안은 대화에서 빠진다** (2026-11-25).
//   거절은 행을 지우지 않는다(감사·누가 언제 거절했나). 그런데 직원 목록이 그 행을 그대로 주고
//   화면이 본문을 비워 그려서 «Cue: (빈칸)» 줄이 대화에 박혔다(Irene «거절을 했더니 내용없이 입력이 되었어»).
//   삭제 메시지는 직원에게 마스킹으로 남기므로 Sequelize 판은 **거절 초안만** 뺀다. 긍정형 OR(위 NULL 주석 그대로).
const NOT_REJECTED_DRAFT_WHERE = {
  [Op.or]: [
    { is_ai: false },
    { is_ai: null },
    { ai_draft_approved: null },
    { ai_draft_approved: true },
  ],
};
// raw SQL 판 — 직원 안읽음·목록 미리보기(삭제도 빼던 자리)에 그대로 쓴다: 삭제 아님 + 거절 초안 아님.
function staffVisibleSql(alias = 'm') {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) throw new Error('bad alias');
  const a = `${alias}.`;
  return `(${a}is_deleted IS NULL OR ${a}is_deleted = 0)
            AND (${a}is_ai IS NULL OR ${a}is_ai = 0 OR ${a}ai_draft_approved IS NULL OR ${a}ai_draft_approved = 1)`;
}
// 메모리 판 — 소켓 payload 등. TINYINT 1/0 은 truthy 로 환산(위 주석).
function isRejectedDraft(m) {
  if (!m || !truthy(m.is_ai)) return false;
  return m.ai_draft_approved === false || m.ai_draft_approved === 0 || m.ai_draft_approved === '0';
}

module.exports = {
  CLIENT_VISIBLE_MESSAGE_WHERE, isVisibleToClient, clientVisibleSql, STAFF_ONLY_CARD_TYPES, isStaffOnlyCard,
  NOT_REJECTED_DRAFT_WHERE, staffVisibleSql, isRejectedDraft,
};
