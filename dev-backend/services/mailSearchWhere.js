// Q Mail 검색 조건 — **한 벌** (2026-10-04 AI 에이전트 M3-a 에서 routes/email_threads.js 목록 라우트에서 옮겼다).
//
//   설계 docs/AI_AGENT_M3_DESIGN.md §1.1 — 사람의 메일 목록 검색과 AI 앱의 search_mail 이 **같은 조건**을 쓴다.
//   라우트 안 인라인으로 두고 베끼면 한쪽만 고쳐진다(memory feedback_same_value_multiple_formulas).
//   동작 무변경 이동이다 — 아래 주석은 라우트에 있던 그대로다.
//
//   ★ 계정 격리는 이 함수가 걸지 않는다 — 부르는 쪽 where 의 account_id IN (accessibleAccountIds) 가 건다.
//   ★ business_id 는 메시지·첨부 서브쿼리를 그 워크스페이스로 잠그는 데 쓴다(바깥 where 에도 따로 건다).
'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

const escLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * @param {string} q           사용자 검색어(≤100자로 자른다)
 * @param {number} businessId
 * @returns {{ cond: object, relevanceOrder: object } | null}  검색어가 비면 null
 */
function mailSearchCondition(q, businessId) {
  if (!q || !String(q).trim()) return null;
  const rawQuery = String(q).trim().slice(0, 100);
  const tokens = rawQuery.split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 4);
  const andConds = [];
  // 사용자 입력의 LIKE 와일드카드(% _ \)는 리터럴로 — 검색어 "50%" 가 전건 매칭되지 않게
  const esc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  // 띄어쓰기 무시 매칭용 — 검색어와 대상 양쪽에서 공백을 지우고 비교한다.
  //   운영 요청: "띄어쓰기 해도 같이 검색되어야 하는 거 아냐?"
  //   ① 검색어에 공백 없음 / 대상에 있음 ("워드프레스" → "워드 프레스") : REPLACE(대상,' ','') 로 해결
  //   ② 검색어에 공백 있음 / 대상에 없음 ("워드 프레스" → "워드프레스") : 아래 squashed OR 로 해결
  const squashed = esc(rawQuery.replace(/\s+/g, ''));

  // 토큰별 메시지 매칭 — 제목/미리보기에 없어도 내용·발신자·수신자·첨부로 찾는다.
  //
  // ★ 2026-09-15 (Irene: "보낸 사람이 Purple Here 인데 검색해도 이 이름이 안 나와.")
  //   여기는 원래 `SELECT DISTINCT thread_id ... LIMIT 1000` 으로 **목록을 먼저 만들고**
  //   바깥에서 `id IN (그 목록)` 을 걸었다. 그런데 그 LIMIT 에는 **ORDER BY 가 없었다.**
  //   "here" 처럼 본문에 흔한 단어("click here")는 수천~수만 건이 맞고, 그중 **임의의
  //   1000건**만 남는다. 찾던 메일이 그 1000 안에 없으면 **오류도 경고도 없이 탈락**한다.
  //   실제로 그 메일의 from_name 에는 "Purple Here" 가 멀쩡히 들어 있었는데도 안 나왔다.
  //   제목이 "New Purchase Order Received" 라 제목·미리보기 경로로도 못 걸렸다.
  //   → **상관 서브쿼리 EXISTS** 로 바꾼다. 중간 목록이 없으니 **자를 것이 없다**.
  //     행마다 조기 종료라 LIKE 전수 스캔보다 오히려 싸다.
  //   (memory feedback_silent_no_output_paths — 조용히 줄어드는 산출물)
  //
  // ★ 계정 격리는 **바깥 where 의 account_id** 가 이미 건다. 여기서 다시 걸지 않는다
  //   (두 곳에 적으면 한쪽만 고쳐진다).
  const bizLit = Number(businessId);
  const msgExists = (needle) => {
    const kw = sequelize.escape(`%${needle}%`);
    return sequelize.literal(`EXISTS (
      SELECT 1 FROM email_messages em
       WHERE em.thread_id = \`EmailThread\`.\`id\`
         AND em.business_id = ${bizLit}
         AND ( em.body_text LIKE ${kw}
            OR em.subject LIKE ${kw}
            OR em.from_name LIKE ${kw}
            OR em.from_email LIKE ${kw}
            OR REPLACE(em.subject, ' ', '') LIKE ${kw}
            OR REPLACE(COALESCE(em.from_name, ''), ' ', '') LIKE ${kw}
            -- 받는사람·참조 — 보낸메일함에서 "누구에게 보냈더라" 로 찾는 길이 없었다.
            --   JSON 컬럼이라 문자열로 훑는다(주소와 이름이 같이 들어 있다).
            OR CAST(em.to_emails AS CHAR) LIKE ${kw}
            OR CAST(COALESCE(em.cc_emails, JSON_ARRAY()) AS CHAR) LIKE ${kw} )
    )`);
  };
  // 첨부 파일명 — "그 견적서 파일" 로 찾는 길. 여태 검색 대상이 아니었다.
  const attachExists = (needle) => {
    const kw = sequelize.escape(`%${needle}%`);
    return sequelize.literal(`EXISTS (
      SELECT 1 FROM email_attachments ea
        JOIN email_messages em2 ON em2.id = ea.message_id
       WHERE em2.thread_id = \`EmailThread\`.\`id\`
         AND em2.business_id = ${bizLit}
         AND ea.filename LIKE ${kw}
    )`);
  };

  const threadOr = (needle) => {
    const conds = [
      { subject: { [Op.like]: `%${needle}%` } },
      { last_message_preview: { [Op.like]: `%${needle}%` } },
      sequelize.literal(`REPLACE(\`EmailThread\`.\`subject\`, ' ', '') LIKE ${sequelize.escape(`%${needle}%`)}`),
      // 라벨도 검색 대상 (Irene 2026-08-23: "라벨 붙이면 그것도 검색되어야 하는데 안되네").
      //   labels 는 JSON 문자열 배열 — JSON_SEARCH 로 부분 일치. NULL 이면 NULL 이라 자동 제외.
      //   needle 은 위 esc() 로 LIKE 와일드카드가 escape 된 상태이고, JSON_SEARCH 의 기본
      //   escape 문자도 백슬래시라 그대로 통한다.
      sequelize.literal(`JSON_SEARCH(\`EmailThread\`.\`labels\`, 'one', ${sequelize.escape(`%${needle}%`)}) IS NOT NULL`),
      // 참여자 JSON — **목록이 보여주는 발신자 이름의 fallback 원천**인데 검색 대상이 아니었다.
      //   화면에 그 이름이 떠 있는데 그 이름으로 검색하면 안 나오는 상태였다
      //   (mailSerialize.serializeThreadRow 의 fromParts). 보이는 것은 찾을 수 있어야 한다.
      sequelize.literal(`JSON_SEARCH(\`EmailThread\`.\`participants\`, 'one', ${sequelize.escape(`%${needle}%`)}) IS NOT NULL`),
    ];
    return conds;
  };

  for (const raw of tokens) {
    const tk = esc(raw);
    const orConds = threadOr(tk);
    orConds.push(msgExists(tk));
    orConds.push(attachExists(tk));
    andConds.push({ [Op.or]: orConds });
  }

  // ② 검색어에 공백이 있고 대상은 붙어 있는 경우 — 토큰 AND 와 **OR** 로 묶는다.
  let searchCond = andConds.length ? { [Op.and]: andConds } : null;
  if (tokens.length > 1 && squashed) {
    const sqOr = threadOr(squashed);
    sqOr.push(msgExists(squashed));
    sqOr.push(attachExists(squashed));
    searchCond = { [Op.or]: [searchCond, { [Op.or]: sqOr }] };
  }

  // 관련도 정렬 — 제목 > 보낸사람(참여자) > 그 외. 같은 등급이면 최신순.
  //   운영 요청: "제목에서나 보내는 사람 등의 키워드에 있는 게 우선시되고 제대로 나와야지".
  //   여태 무조건 최신순이라, 제목에 정확히 있는 메일이 한참 아래에 묻혔다.
  const likeFull = sequelize.escape(`%${esc(rawQuery)}%`);
  const likeSquashed = sequelize.escape(`%${squashed}%`);
  const firstTk = tokens.length ? sequelize.escape(`%${esc(tokens[0])}%`) : likeFull;
  const relevanceOrder = sequelize.literal(`(
    CASE WHEN \`EmailThread\`.\`subject\` LIKE ${likeFull} THEN 400
         WHEN REPLACE(\`EmailThread\`.\`subject\`, ' ', '') LIKE ${likeSquashed} THEN 380
         WHEN \`EmailThread\`.\`subject\` LIKE ${firstTk} THEN 300
         WHEN JSON_SEARCH(\`EmailThread\`.\`participants\`, 'one', ${likeFull}) IS NOT NULL THEN 200
         WHEN JSON_SEARCH(\`EmailThread\`.\`participants\`, 'one', ${firstTk}) IS NOT NULL THEN 180
         ELSE 0 END
  ) DESC`);
  return searchCond ? { cond: searchCond, relevanceOrder } : null;
}

/**
 * 메시지 한 칸으로 좁힌 EXISTS — AI 도구의 from/to 필터(설계 §4.2.2 «msgExists 를 필드별로 좁힌 변형»).
 *   field: 'from' → from_name·from_email / 'to' → to_emails·cc_emails
 */
function mailFieldExists(field, needle, businessId) {
  const n = String(needle || '').trim().slice(0, 100);
  if (!n) return null;
  const kw = sequelize.escape(`%${escLike(n)}%`);
  const bizLit = Number(businessId);
  const cols = field === 'to'
    ? `CAST(em.to_emails AS CHAR) LIKE ${kw} OR CAST(COALESCE(em.cc_emails, JSON_ARRAY()) AS CHAR) LIKE ${kw}`
    : `em.from_name LIKE ${kw} OR em.from_email LIKE ${kw}`;
  return sequelize.literal(`EXISTS (
    SELECT 1 FROM email_messages em
     WHERE em.thread_id = \`EmailThread\`.\`id\`
       AND em.business_id = ${bizLit}
       AND ( ${cols} )
  )`);
}

module.exports = { mailSearchCondition, mailFieldExists, escLike };
