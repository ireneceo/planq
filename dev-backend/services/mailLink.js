// 메일 ↔ 고객·프로젝트 **연결 술어 단일 원천**.
//
// ★ 왜 생겼나 (2026-09-10)
//   Irene: "프로젝트에 연결된 프로젝트 메일 버튼 누르면 이상한 리스트업 되고 있어.
//           프로젝트나 고객이 메일에 자동연결 되는 거 맞지?"
//   아니었다. 실측 — dev `email_threads` 4,879건 중 `project_id` 연결 **0건**, `client_id` **1건**.
//     · `project_id` 를 쓰는 코드가 **저장소에 0곳**(사람이 우측 패널에서 손으로 거는 것뿐)
//     · `client_id` 자동 매칭은 있었지만 **받은 메일 + 새 스레드 + 발신자 주소**일 때만 돌았다.
//       우리가 보낸 메일은 수신자가 고객이어도 안 걸리고, 고객을 나중에 등록하면 기존 스레드는
//       영영 안 붙는다. 그래서 두 화면(프로젝트 메일·고객 타임라인)이 늘 비어 있었다.
//
// ★ 방향 (Irene 2026-09-10): *"둘다 연결해야 하는 거잖아. 프로젝트 중심이지만 고객을 누르면
//   고객 페이지에 고객 이메일 다 나와야지."*
//     · 프로젝트 메일 = `project_id` 가 걸린 것만
//     · 고객 페이지   = `client_id` 로 그 고객의 메일 **전부** (프로젝트 무관)
//
// ★ 매칭은 **주소 완전일치만.** 부분일치를 허용하면 `a@b.com` 이 `xa@b.com` 에 붙는 식으로
//   조용히 오배치된다 — 남의 고객 메일이 남의 프로젝트에 뜨는 것은 되돌리기 어려운 사고다.
//   못 찾으면 **미배치가 옳다**(담당자 매칭·워크스트림 매칭과 같은 규칙).
const { Op } = require('sequelize');
const { Client, ProjectClient, Project } = require('../models');
const { sequelize } = require('../config/database');

const norm = (v) => String(v || '').toLowerCase().trim();

/** 주소 목록에서 유효한 것만 소문자로. 중복 제거하되 **순서는 지킨다**(앞이 더 강한 신호다). */
function normalizeAddresses(list) {
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(list) ? list : [list])) {
    // "이름 <a@b.com>" 형태도 받는다
    const m = /<([^>]+)>/.exec(String(raw || ''));
    const a = norm(m ? m[1] : raw);
    if (!a || !a.includes('@') || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

/**
 * **1순위 — 프로젝트 초대 주소.** `project_clients.contact_email` 은 "이 사람을 이 프로젝트에
 * 초대했다" 는 기록이므로 고객과 프로젝트를 **한 번에** 확정한다. 추측이 아니라 사실이다.
 */
async function matchByProjectInvite(businessId, addresses) {
  if (!addresses.length) return null;
  const rows = await ProjectClient.findAll({
    where: { contact_email: { [Op.in]: addresses } },
    include: [{ model: Project, attributes: ['id', 'business_id'], required: true }],
    attributes: ['project_id', 'client_id', 'contact_email'],
  });
  const mine = rows.filter((r) => r.Project && Number(r.Project.business_id) === Number(businessId) && r.client_id);
  if (!mine.length) return null;
  // 주소 순서(from → to → cc)대로 가장 앞선 것을 고른다.
  for (const a of addresses) {
    const hit = mine.find((r) => norm(r.contact_email) === a);
    if (hit) return { clientId: hit.client_id, projectId: hit.project_id, via: 'project_invite' };
  }
  return null;
}

/** **2순위 — 고객 등록 주소.** 초대 기록이 없어도 고객은 알 수 있다. 프로젝트는 별도 판정. */
async function matchClientByAddresses(businessId, addresses) {
  if (!addresses.length) return null;
  const exact = await Client.findOne({
    where: {
      business_id: businessId,
      [Op.or]: [
        { invite_email: { [Op.in]: addresses } },
        { billing_contact_email: { [Op.in]: addresses } },
      ],
    },
    attributes: ['id', 'invite_email', 'billing_contact_email'],
  });
  if (exact) return exact.id;
  // 별칭 — JSON_SEARCH. ★ 값은 **반드시 바인딩**한다(같은 파일 계열의 옛 코드가 손으로
  //   따옴표를 바꾸다 백슬래시를 못 막아 인젝션이었던 전례).
  for (const a of addresses) {
    try {
      // ★ `JSON_SEARCH` 의 검색 문자열은 **LIKE 패턴이다.** 주소를 그대로 넘기면
      //   `a_b@d` 가 별칭 `axb@d` 에 걸리고 `%@d` 는 전부에 걸린다 — "완전일치만" 이라는
      //   이 파일의 불변식이 여기서만 깨져 있었다(2026-09-10 Fable 게이트 실측).
      //   그래서 `%`·`_`·`\` 를 이스케이프하고 escape_char 를 넘긴다.
      // ★ 그리고 JSON 문자열 비교는 **binary** 라 대소문자를 가린다. 주소는 이미 소문자로
      //   정규화돼 오므로 저장된 별칭 쪽도 소문자로 맞춰서 본다.
      const pattern = a.replace(/[\\%_]/g, (m) => `\\${m}`);
      const [rows] = await sequelize.query(
        `SELECT id FROM clients
          WHERE business_id = ? AND email_aliases IS NOT NULL
            AND JSON_SEARCH(CAST(LOWER(CAST(email_aliases AS CHAR)) AS JSON), 'one', ?, '\\\\') IS NOT NULL
          LIMIT 1`,
        { replacements: [businessId, pattern] },
      );
      if (rows[0]) return rows[0].id;
    } catch (e) {
      console.warn('[mailLink] alias match skipped:', e.message);
      break;   // 별칭 검색이 불가하면 더 돌 이유가 없다
    }
  }
  return null;
}

/**
 * 고객이 정해졌을 때의 프로젝트 — **정확히 하나일 때만** 건다.
 *
 * ★ 여럿이면 걸지 않는다. 같은 고객이 프로젝트 두 개에 걸쳐 있을 때 아무 쪽에나 붙이면
 *   프로젝트 메일 목록이 조용히 오염되고, 사용자는 왜 그 메일이 거기 있는지 알 길이 없다.
 *   그럴 때는 사람이 우측 맥락 패널에서 고른다(그 경로는 이미 있다).
 */
async function resolveSoleProject(businessId, clientId) {
  if (!clientId) return null;
  const rows = await ProjectClient.findAll({
    where: { client_id: clientId },
    include: [{ model: Project, attributes: ['id', 'business_id'], required: true }],
    attributes: ['project_id'],
  });
  const ids = [...new Set(rows
    .filter((r) => r.Project && Number(r.Project.business_id) === Number(businessId))
    .map((r) => r.project_id))];
  return ids.length === 1 ? ids[0] : null;
}

/**
 * 스레드에 연결을 **채운다**. 이미 값이 있으면 건드리지 않는다 —
 * 사람이 손으로 건 것을 자동이 뒤엎으면 그 결정이 사라진다.
 *
 * @param {object} thread  EmailThread 인스턴스 (또는 {id, business_id, client_id, project_id})
 * @param {string[]} addresses  이 스레드에 등장한 주소들. **from → to → cc 순서**로 넘길 것.
 * @returns {{changed: boolean, client_id: number|null, project_id: number|null, via: string|null}}
 */
async function linkThread(thread, { addresses, transaction = null } = {}) {
  if (!thread) return { changed: false, client_id: null, project_id: null, via: null };
  const businessId = Number(thread.business_id);
  const have = { client_id: thread.client_id || null, project_id: thread.project_id || null };
  if (have.client_id && have.project_id) return { changed: false, ...have, via: null };

  const addrs = normalizeAddresses(addresses);
  const patch = {};
  let via = null;

  const invite = await matchByProjectInvite(businessId, addrs);
  // ★ 초대 기록은 **그 고객의** 프로젝트를 말한다. 사람이 이미 다른 고객을 걸어 둔 스레드에
  //   이 프로젝트를 채우면 고객과 프로젝트가 **서로 다른 고객의 것**이 된다 —
  //   프로젝트 메일 목록에 남의 고객 스레드가 뜬다(2026-09-10 Fable 게이트 재현).
  //   고객이 이미 정해져 있으면 그 고객의 초대 기록일 때만 쓴다.
  //   ★ `===` 로 두면 한쪽이 문자열일 때(예: 라우트가 req.body 값을 그대로 넘길 때) 같은 고객인데도
  //     다르다고 읽어 초대 기록을 버린다 — 조용히 sole_project 로 떨어진다(2026-09-10 Fable 지적).
  //     지금 호출부 3곳은 전부 Sequelize INTEGER 라 도달 불가하지만, 타입이 섞이는 순간 틀어진다.
  const inviteUsable = invite && (!have.client_id || Number(have.client_id) === Number(invite.clientId));
  if (inviteUsable) {
    if (!have.client_id) patch.client_id = invite.clientId;
    if (!have.project_id) patch.project_id = invite.projectId;
    via = invite.via;
  } else {
    const clientId = have.client_id || await matchClientByAddresses(businessId, addrs);
    if (clientId) {
      if (!have.client_id) { patch.client_id = clientId; via = 'client_address'; }
      if (!have.project_id) {
        const pid = await resolveSoleProject(businessId, clientId);
        if (pid) { patch.project_id = pid; via = via || 'sole_project'; }
      }
    }
  }

  if (!Object.keys(patch).length) return { changed: false, ...have, via: null };
  if (typeof thread.update === 'function') await thread.update(patch, transaction ? { transaction } : undefined);
  return { changed: true, client_id: patch.client_id ?? have.client_id, project_id: patch.project_id ?? have.project_id, via };
}

/**
 * 주소 여러 개 → **그 주소로 알아볼 수 있는 고객 행들.** 목록 화면용(주소별 보기).
 *
 * ★ 왜 여기 있나 (2026-09-10 Fable 게이트 지적): `routes/email_addresses.js` 가 같은 판정을
 *   손으로 다시 쓰고 있었고, 주석은 "emailImapCron.matchClient 와 **같은 필드**를 본다" 고
 *   말하는데 실제로는 **별칭(email_aliases)을 안 봤다.** 그래서 메일은 고객으로 붙는데
 *   그 화면에서는 "고객 아님" 으로 보이는 어긋남이 생긴다.
 *   주석으로 "같은 술어" 를 약속하지 말고 **같은 함수를 부르게** 한다.
 *
 * @returns {Promise<Map<string, {id:number, name:string|null}>>} 주소(소문자) → 고객
 */
async function findClientsByAddresses(businessId, addresses) {
  const out = new Map();
  const addrs = normalizeAddresses(addresses);
  if (!addrs.length) return out;
  const rows = await Client.findAll({
    where: {
      business_id: businessId,
      [Op.or]: [
        { invite_email: { [Op.in]: addrs } },
        { billing_contact_email: { [Op.in]: addrs } },
      ],
    },
    attributes: ['id', 'invite_email', 'billing_contact_email', 'display_name', 'company_name'],
  });
  const label = (c) => c.display_name || c.company_name || null;
  for (const c of rows) {
    for (const e of [c.invite_email, c.billing_contact_email]) {
      if (e) out.set(norm(e), { id: c.id, name: label(c) });
    }
  }
  // 별칭은 완전일치 검색을 주소별로 한 번씩 — 위에서 이미 잡힌 것은 건너뛴다.
  for (const a of addrs) {
    if (out.has(a)) continue;
    const id = await matchClientByAddresses(businessId, [a]);
    if (!id) continue;
    const c = await Client.findByPk(id, { attributes: ['id', 'display_name', 'company_name'] });
    if (c) out.set(a, { id: c.id, name: label(c) });
  }
  return out;
}

module.exports = {
  normalizeAddresses,
  matchByProjectInvite,
  matchClientByAddresses,
  findClientsByAddresses,
  resolveSoleProject,
  linkThread,
};
