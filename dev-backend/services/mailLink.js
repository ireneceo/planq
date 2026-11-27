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
  // 주소 순서(from → to → cc)대로 가장 앞선 주소를 본다.
  // ★ 2026-09-11 (Fable 게이트 경고) — 같은 주소가 **프로젝트 여럿**에 초대돼 있으면 여태 DB 순서상
  //   첫 행에 붙였다. 아래 resolveSoleProject 의 "여럿이면 걸지 않는다" 규칙을 이 경로만 우회하고
  //   있었고, 연결은 sticky(이미 값이 있으면 안 덮는다)라 한 번 붙으면 사람이 손으로만 뗄 수 있다.
  //   → 그 주소가 가리키는 **고객이 하나일 때만** 고객을 확정하고, **프로젝트도 하나일 때만** 건다.
  //     고객이 여럿이면 초대 기록으로는 판정하지 않는다(null → 고객 등록 주소 판정으로 내려간다).
  for (const a of addresses) {
    const hits = mine.filter((r) => norm(r.contact_email) === a);
    if (!hits.length) continue;
    const clientIds = [...new Set(hits.map((r) => Number(r.client_id)))];
    if (clientIds.length !== 1) return null;
    const projectIds = [...new Set(hits.map((r) => Number(r.project_id)))];
    return { clientId: clientIds[0], projectId: projectIds.length === 1 ? projectIds[0] : null, via: 'project_invite' };
  }
  return null;
}

/**
 * 주소 하나의 **주인 고객들** — 단계 순서 ① 대표·청구 주소 → ② 담당자 이메일 → ③ 별칭. 앞 단계에서 나오면 거기서 끝낸다.
 * ★ 2026-11-27 (Fable 설계 P3 · docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md) — 여태 ①은 findOne, ③은 LIMIT 1 이라
 *   두 고객이 같은 주소를 가지면 **아무 쪽에나** 붙었다(연결은 sticky 라 되돌리기 어렵다). 이제 주인 목록을 돌려주고
 *   «하나일 때만» 은 부르는 쪽(matchClientByAddresses)이 정한다.
 * @returns {Promise<{tier: string|null, ids: number[]}>}
 */
async function claimantsOfAddress(businessId, address) {
  const a = norm(address);
  if (!a || !a.includes('@')) return { tier: null, ids: [] };
  const direct = await Client.findAll({
    where: { business_id: businessId, [Op.or]: [{ invite_email: a }, { billing_contact_email: a }] },
    attributes: ['id'], limit: 20, raw: true,
  });
  if (direct.length) return { tier: 'client', ids: [...new Set(direct.map((r) => Number(r.id)))] };
  // 담당자 이메일 — 같은 회사 두 번째 사람의 메일이 **새 고객이 아니라 그 고객에** 붙는다(docs/NAME_CARD_V3_STRATEGY.md 9절 결정 2)
  const { ClientContact } = require('../models');
  const contacts = await ClientContact.findAll({
    where: { business_id: businessId, email: a }, attributes: ['client_id'], limit: 50, raw: true,
  });
  if (contacts.length) return { tier: 'contact', ids: [...new Set(contacts.map((r) => Number(r.client_id)))] };
  // 별칭 — JSON_SEARCH. ★ 값은 **반드시 바인딩**한다(같은 파일 계열의 옛 코드가 손으로 따옴표를 바꾸다 백슬래시를 못 막아 인젝션이었던 전례).
  //   ★ JSON_SEARCH 의 검색 문자열은 **LIKE 패턴이다** — `%`·`_`·`\` 를 이스케이프하고 escape_char 를 넘긴다(2026-09-10 Fable 실측).
  //   ★ JSON 문자열 비교는 binary 라 대소문자를 가린다 — 저장된 별칭 쪽도 소문자로 맞춰서 본다.
  try {
    const pattern = a.replace(/[\\%_]/g, (m) => `\\${m}`);
    const [rows] = await sequelize.query(
      `SELECT id FROM clients
        WHERE business_id = ? AND email_aliases IS NOT NULL
          AND JSON_SEARCH(CAST(LOWER(CAST(email_aliases AS CHAR)) AS JSON), 'one', ?, '\\\\') IS NOT NULL
        LIMIT 20`,
      { replacements: [businessId, pattern] },
    );
    if (rows.length) return { tier: 'alias', ids: [...new Set(rows.map((r) => Number(r.id)))] };
  } catch (e) {
    console.warn('[mailLink] alias match skipped:', e.message);
  }
  return { tier: null, ids: [] };
}

/**
 * **2순위 — 고객 등록 주소.** 주소 순서(from → to → cc)대로 첫 «주인 있는 주소» 를 본다.
 *   주인이 하나면 그 id · 여럿이면 `ambiguous:'none'`(기본) = null, `'first'` = 가장 작은 id.
 *   ★ 여럿일 때 **다음 주소로 넘어가지 않는다**(matchByProjectInvite 와 같은 규칙).
 *   `'first'` 는 중복 판정(saleCommon.findExistingByContact)만 쓴다 — null 이면 세 번째 중복 고객이 생긴다.
 */
async function matchClientByAddresses(businessId, addresses, { ambiguous = 'none' } = {}) {
  const addrs = normalizeAddresses(addresses);
  for (const a of addrs) {
    const { ids } = await claimantsOfAddress(businessId, a);
    if (!ids.length) continue;
    if (ids.length === 1) return ids[0];
    return ambiguous === 'first' ? Math.min(...ids) : null;
  }
  return null;
}

/**
 * 이 워크스페이스의 «우리 주소» — 메일함 주소·별칭(+ 플랫폼 발신 주소). 60초 캐시.
 * ★ P4 — 고객 주소가 우리 메일함 주소와 같으면 그 메일함에 온 메일이 to 매칭으로 전부 그 고객에 붙는다. 매칭에서 뺀다.
 */
const OWN_TTL_MS = 60 * 1000;
const ownCache = new Map();
async function ownAddressSet(businessId) {
  const key = Number(businessId);
  const hit = ownCache.get(key);
  if (hit && Date.now() - hit.at < OWN_TTL_MS) return hit.set;
  let set;
  try {
    const m = await require('./emailTriage').buildOwnAddressMatcher(key);
    set = m && m.emails ? new Set(m.emails.map(norm)) : new Set();
  } catch { set = new Set(); }
  ownCache.set(key, { at: Date.now(), set });
  return set;
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
 * 연결 **판정만** 한다(쓰기 없음). linkThread·지난 메일 연결·백필 미리보기가 같은 함수를 쓴다.
 * ★ P1 — 백필 미리보기가 linkThread 를 불러 메일 이슈 프로젝트를 실제로 옮겼다. 판정과 쓰기를 가른다.
 * @param have {client_id, project_id} 지금 값
 * @returns {{patch: object, via: string|null}}
 */
async function resolveLink(businessId, have, addresses) {
  const own = await ownAddressSet(businessId);
  const addrs = normalizeAddresses(addresses).filter((a) => !own.has(a));
  const patch = {};
  let via = null;
  if (have.client_id && have.project_id) return { patch, via };

  const invite = await matchByProjectInvite(businessId, addrs);
  // ★ 초대 기록은 **그 고객의** 프로젝트를 말한다. 사람이 이미 다른 고객을 걸어 둔 스레드에
  //   이 프로젝트를 채우면 고객과 프로젝트가 **서로 다른 고객의 것**이 된다(2026-09-10 Fable 게이트 재현).
  //   ★ `===` 로 두면 한쪽이 문자열일 때 같은 고객인데도 다르다고 읽는다 — Number 로 비교(2026-09-10 Fable 지적).
  const inviteUsable = invite && (!have.client_id || Number(have.client_id) === Number(invite.clientId));
  if (inviteUsable) {
    if (!have.client_id) patch.client_id = invite.clientId;
    // 초대 주소가 프로젝트 여럿을 가리키면 projectId 가 null 이다 — 프로젝트는 비워 둔다(사람이 고른다).
    if (!have.project_id && invite.projectId) patch.project_id = invite.projectId;
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
  return { patch, via };
}

/**
 * 스레드에 연결을 **채운다**. 이미 값이 있으면 건드리지 않는다 —
 * 사람이 손으로 건 것을 자동이 뒤엎으면 그 결정이 사라진다.
 *
 * @param {object} thread  EmailThread 인스턴스
 * @param {string[]} addresses  이 스레드에 등장한 주소들. **from → to → cc 순서**로 넘길 것.
 * @returns {{changed: boolean, client_id: number|null, project_id: number|null, via: string|null}}
 */
async function linkThread(thread, { addresses, transaction = null } = {}) {
  if (!thread) return { changed: false, client_id: null, project_id: null, via: null };
  const businessId = Number(thread.business_id);
  const have = { client_id: thread.client_id || null, project_id: thread.project_id || null };
  const { patch, via } = await resolveLink(businessId, have, addresses);
  if (!Object.keys(patch).length) return { changed: false, ...have, via: null };
  if (typeof thread.update !== 'function') throw new Error('linkThread needs a model instance — use resolveLink to preview');
  await thread.update(patch, transaction ? { transaction } : undefined);
  if (patch.project_id) {
    // 히스토리 신호는 메시지가 저장된 뒤 호출부가 쏜다(여기서 쏘면 새 메시지 전에 다시 읽는다).
    await syncThreadIssuesProject(thread.id, patch.project_id, { transaction });
  }
  return { changed: true, client_id: patch.client_id ?? have.client_id, project_id: patch.project_id ?? have.project_id, via };
}

/**
 * 스레드에 등장한 주소 — 받은 메일 from → to → cc → 보낸 메일 from(우리 주소 — resolveLink 가 뺀다).
 *   백필 스크립트와 지난 메일 연결이 같은 함수를 쓴다.
 */
async function threadAddresses(businessId, threadId) {
  const { EmailMessage } = require('../models');
  const msgs = await EmailMessage.findAll({
    where: { business_id: businessId, thread_id: threadId },
    attributes: ['from_email', 'to_emails', 'cc_emails', 'direction'],
    order: [['sent_at', 'ASC']], limit: 20,
  });
  const addrs = [];
  for (const m of msgs) {
    if (m.direction === 'inbound' && m.from_email) addrs.push(m.from_email);
    for (const t of (Array.isArray(m.to_emails) ? m.to_emails : [])) addrs.push(t && (t.email || t));
    for (const c of (Array.isArray(m.cc_emails) ? m.cc_emails : [])) addrs.push(c && (c.email || c));
    if (m.direction === 'outbound' && m.from_email) addrs.push(m.from_email);
  }
  return addrs;
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
  // ★ P3 — 두 고객이 같은 대표·청구 주소를 가지면 **어느 쪽도 아니다**(연결 판정 matchClientByAddresses 와 같은 답).
  const byAddr = new Map();
  for (const c of rows) {
    for (const e of [c.invite_email, c.billing_contact_email]) {
      if (!e) continue;
      const k = norm(e);
      if (!byAddr.has(k)) byAddr.set(k, new Map());
      byAddr.get(k).set(c.id, c);
    }
  }
  const settled = new Set();
  for (const [k, m] of byAddr) {
    settled.add(k);
    if (m.size === 1) { const c = [...m.values()][0]; out.set(k, { id: c.id, name: label(c) }); }
  }
  // 담당자·별칭은 주소별로 한 번씩 — 위에서 판정이 끝난 주소(주인이 여럿인 것 포함)는 건너뛴다.
  for (const a of addrs) {
    if (settled.has(a)) continue;
    const id = await matchClientByAddresses(businessId, [a]);
    if (!id) continue;
    const c = await Client.findByPk(id, { attributes: ['id', 'display_name', 'company_name'] });
    if (c) out.set(a, { id: c.id, name: label(c) });
  }
  return out;
}

/**
 * 메일 이슈(project_issues.email_thread_id)는 **스레드의 프로젝트를 따라간다** (2026-11-20 · docs/PROJECT_HISTORY_MAIL_ISSUE_DESIGN.md).
 *   만들 때 thread.project_id 를 복사해 두므로, 스레드 프로젝트가 바뀌면 같이 옮긴다 — 읽을 때 따로 계산하면
 *   개요의 이슈 목록(/issues)과 히스토리의 술어가 갈린다. 부르는 곳: linkThread(채울 때) · PUT 스레드(project_id 변경).
 */
async function syncThreadIssuesProject(threadId, projectId, { transaction = null } = {}) {
  if (!threadId) return 0;
  const { ProjectIssue } = require('../models');
  const [n] = await ProjectIssue.update(
    { project_id: projectId || null },
    { where: { email_thread_id: Number(threadId) }, ...(transaction ? { transaction } : {}) },
  );
  return n;
}

/**
 * 프로젝트 히스토리 탭 «다시 읽어» 신호 — 내용 없이 {project_id} 만, 멤버 방에만(CLIENT_VIEW 미등록 → 고객 방 안 감).
 *   메일이 프로젝트에 걸리거나 풀리거나, 걸린 스레드에 메시지·이슈가 생길 때 부른다.
 */
function signalProjectHistory(io, projectIds) {
  const sock = io || global.__planqIo;
  if (!sock) return;
  const ids = [...new Set((Array.isArray(projectIds) ? projectIds : [projectIds]).filter(Boolean).map(Number))];
  for (const pid of ids) require('./projectRoom').emitProject(sock, pid, 'history:refresh', { project_id: pid });
}

/**
 * 고객의 메일 주소 집합 — 대표(invite) + 청구 + 담당자 이메일 + 별칭. 소문자·중복 없음.
 *   (계정 이메일 user.email·project_clients.contact_email 은 범위 밖 — docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md B ⑥)
 */
async function addressesOfClient(businessId, clientId) {
  const c = await Client.findOne({
    where: { id: clientId, business_id: businessId },
    attributes: ['id', 'invite_email', 'billing_contact_email', 'email_aliases'],
  });
  if (!c) return [];
  const { ClientContact } = require('../models');
  const contacts = await ClientContact.findAll({
    where: { business_id: businessId, client_id: clientId }, attributes: ['email'], raw: true, limit: 50,
  });
  const aliases = Array.isArray(c.email_aliases) ? c.email_aliases : [];
  return normalizeAddresses([c.invite_email, c.billing_contact_email, ...contacts.map((r) => r.email), ...aliases]);
}

const PAST_MAX_THREADS = 2000;
const PAST_MAX_ADDRESSES = 10;

/**
 * **고객을 먼저 등록해도 지난 메일이 붙게** (2026-11-27 · Fable 설계 B · docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md).
 *   Irene: «이 이메일로 오는 모든 문의는 이제 고객의 이메일이 되는거지.»
 *
 * ★ 범위 = 워크스페이스 전체(수신 크론과 같다) — 보는 쪽이 계정 축(accessibleAccountIds)으로 가린다.
 *   그래서 **붙인 수는 응답에 싣지 않는다**(남의 개인 메일함에 몇 통 있는지가 샌다) — 감사 로그에만(thread_ids = 되돌리기 근거).
 * ★ «이 고객 하나만» 2단: ① 주소 선검사(그 주소의 주인이 이 고객 하나) ② 스레드별 resolveLink 가 이 고객을 고를 때만.
 *   우리 메일함 주소·활성 멤버 계정 주소·자동 발송 주소는 건너뛴다. 스팸은 빼고(해제 때 linkThread 가 붙인다) 확인완료는 넣는다.
 * ★ 쓰기는 `client_id IS NULL` 조건 UPDATE 만(sticky — 사람이 건 연결을 덮지 않는다). 프로젝트도 비었을 때만.
 * @returns {Promise<{linked:number, capped:boolean}>}  ← 호출부는 이 값을 응답에 싣지 않는다
 */
async function linkPastThreadsForClient(businessId, clientId, { addresses = null, actorUserId = null, req = null, reason = null } = {}) {
  const { EmailThread } = require('../models');
  const biz = Number(businessId);
  const cid = Number(clientId);
  if (!biz || !cid) return { linked: 0, capped: false };
  let addrs = normalizeAddresses(addresses == null ? await addressesOfClient(biz, cid) : addresses);
  let capped = false;
  if (addrs.length > PAST_MAX_ADDRESSES) { addrs = addrs.slice(0, PAST_MAX_ADDRESSES); capped = true; }

  const own = await ownAddressSet(biz);
  const { isWorkspaceMemberEmail } = require('./clientToMember');
  const { isAutomatedSenderAddress } = require('./emailTriage');
  const usable = [];
  for (const a of addrs) {
    if (own.has(a) || isAutomatedSenderAddress(a)) continue;
    if (await isWorkspaceMemberEmail(biz, a)) continue;
    if (await matchClientByAddresses(biz, [a]) !== cid) continue;   // ① 그 주소의 주인이 이 고객 하나일 때만
    usable.push(a);
  }

  const linkedIds = [];
  const projectIds = new Set();
  for (const a of usable) {
    const like = `%"${a.replace(/[\\%_]/g, (m) => `\\${m}`)}"%`;
    const [cands] = await sequelize.query(
      `SELECT t.id, t.client_id, t.project_id FROM email_threads t
        WHERE t.business_id = :biz AND t.client_id IS NULL AND t.status <> 'spam'
          AND EXISTS (SELECT 1 FROM email_messages m
                       WHERE m.thread_id = t.id AND m.business_id = :biz
                         AND (LOWER(m.from_email) = :email
                              OR LOWER(CAST(m.to_emails AS CHAR)) LIKE :like
                              OR LOWER(CAST(COALESCE(m.cc_emails, JSON_ARRAY()) AS CHAR)) LIKE :like))
        ORDER BY t.last_message_at DESC
        LIMIT ${PAST_MAX_THREADS + 1}`,
      { replacements: { biz, email: a, like } },
    );
    if (cands.length > PAST_MAX_THREADS) { capped = true; cands.length = PAST_MAX_THREADS; }
    for (const t of cands) {
      if (linkedIds.includes(t.id)) continue;
      const { patch } = await resolveLink(biz, { client_id: null, project_id: t.project_id || null }, await threadAddresses(biz, t.id));
      if (Number(patch.client_id) !== cid) continue;          // ② 이 스레드는 다른 고객(또는 아무도) — 건드리지 않는다
      const [n] = await EmailThread.update({ client_id: cid }, { where: { id: t.id, business_id: biz, client_id: null } });
      if (!n) continue;
      linkedIds.push(t.id);
      if (patch.project_id) {
        const [pn] = await EmailThread.update({ project_id: patch.project_id }, { where: { id: t.id, business_id: biz, project_id: null } });
        if (pn) { await syncThreadIssuesProject(t.id, patch.project_id); projectIds.add(patch.project_id); }
      }
    }
  }

  if (linkedIds.length || capped) {
    require('./auditService').createAuditLog({
      userId: actorUserId, businessId: biz,
      action: 'client.link_past_mail', targetType: 'client', targetId: cid,
      newValue: { reason, threads_linked: linkedIds.length, capped, thread_ids: linkedIds.slice(0, 500) },
    });
  }
  if (linkedIds.length) {
    emitMailUpdated(req, biz, { bulk: true });
    require('./saleCommon').broadcast(req, biz, 'client:updated', { id: cid, business_id: biz });
    if (projectIds.size) signalProjectHistory(req && req.app && req.app.get('io'), [...projectIds]);
  }
  return { linked: linkedIds.length, capped };
}

/** `mail:updated` 신호 — req 가 있으면 메일 방송 한 문(mailBroadcast), 없으면(AI 도구 경로) 전역 io 로. 내용 없이 신호만. */
function emitMailUpdated(req, businessId, payload) {
  if (req && req.app) return require('./mailBroadcast').broadcastMail(req, businessId, 'mail:updated', payload);
  const io = global.__planqIo;
  if (io) io.to(`business:${businessId}`).emit('mail:updated', { ...payload, business_id: Number(businessId) });
  return undefined;
}

/**
 * 고객이 생기거나 주소가 바뀐 **뒤** 부르는 얇은 문 — 실패가 고객 저장을 막지 않는다.
 *   부르는 곳: save-as-client · /invite · /managed · Q sale PATCH · clients PUT · 담당자 문 · prospect 생성 · 프로젝트 고객 초대.
 */
async function afterClientAddressesChanged(businessId, clientId, opts = {}) {
  try {
    return await linkPastThreadsForClient(businessId, clientId, opts);
  } catch (e) {
    console.warn('[mailLink] linkPastThreadsForClient', e.message);
    return { linked: 0, capped: false };
  }
}

module.exports = {
  syncThreadIssuesProject, signalProjectHistory,
  normalizeAddresses,
  matchByProjectInvite,
  matchClientByAddresses,
  claimantsOfAddress,
  ownAddressSet,
  findClientsByAddresses,
  resolveSoleProject,
  resolveLink,
  linkThread,
  threadAddresses,
  linkPastThreadsForClient,
  addressesOfClient,
  afterClientAddressesChanged,
  emitMailUpdated,
};
