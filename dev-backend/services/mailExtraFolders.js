// 업체 보낸편지함(sent)·스팸함(spam) 가져오기 — 계정 설정 화면이 읽는 상태 한 벌.
//   설계: docs/MAIL_SENT_SPAM_SYNC_DESIGN.md. 수집은 services/emailImapCron(syncExtraFolders), 여기는 «보여 줄 모양» 만.
//   목록(GET)·수정(PUT 계정)·토글(PUT folders) 세 응답이 같은 함수를 쓴다 — 응답 모양이 갈라지면
//   화면이 응답을 대입하는 순간 값이 사라진다(가드 savemerge 계열).
const { Op } = require('sequelize');

const EXTRA_FOLDER_ROLES = ['sent', 'spam'];

// 역할마다 { enabled, folder, found, discovered, last_synced_at, has_error }.
//   행이 아직 없으면(첫 동기화 전) enabled=true(기본 켜짐)·discovered=false 로 그린다.
//   global_off — 전역 비상 스위치(QMAIL_EXTRA_FOLDERS=0)가 꺼 두었다(화면이 그 사실을 말한다).
//   ★ 내부 오류 문구(last_error)는 싣지 않는다 — 있는지만.
function serializeExtraFolders(rows) {
  const out = { global_off: !require('./emailImapCron').extraFoldersEnabled() };
  for (const role of EXTRA_FOLDER_ROLES) {
    const r = (rows || []).find((x) => x.role === role);
    out[role] = r ? {
      enabled: !!r.enabled,
      folder: r.folder || null,
      found: !!r.folder,
      discovered: !!r.discovered_at,
      last_synced_at: r.last_synced_at || null,
      has_error: !!(r.last_error && r.folder && r.last_error !== 'platform_sender'),
      // 플랫폼 발송 계정의 보낸편지함은 가져오지 않는다 — 화면이 그 사실을 말한다(emailImapCron.isPlatformSenderAccount)
      platform_sender: r.last_error === 'platform_sender',
    } : { enabled: true, folder: null, found: false, discovered: false, last_synced_at: null, has_error: false, platform_sender: false };
  }
  return out;
}

/** accountId → 상태. 계정이 그 워크스페이스 것인지 조인으로 한 번 더 묶는다(호출부가 이미 걸렀어도). */
async function extraFoldersByAccount(businessId, accountIds) {
  const map = new Map();
  if (!accountIds.length) return map;
  try {
    const { EmailAccountFolder, EmailAccount } = require('../models');
    const rows = await EmailAccountFolder.findAll({
      where: { account_id: { [Op.in]: accountIds } },
      include: [{ model: EmailAccount, as: 'account', where: { business_id: Number(businessId) }, attributes: [] }],
    });
    for (const id of accountIds) map.set(id, serializeExtraFolders(rows.filter((r) => r.account_id === id)));
  } catch (e) { console.warn('[mailExtraFolders] load', e.message); }
  return map;
}

module.exports = { EXTRA_FOLDER_ROLES, serializeExtraFolders, extraFoldersByAccount };
