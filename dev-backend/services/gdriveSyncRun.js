// services/gdriveSyncRun.js — Drive 변경 «커서 읽기 → 변경 목록 → 적용 → 커서 저장» 을 **워크스페이스당 한 줄로** (§4.3 D-1)
//
// 설계 docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md §4.3 (Fable DESIGN-READY, 2026-11-18)
//
// 왜:
//   ① 웹훅 두 개가 동시에 오면(구글은 짧게 여러 번 보낸다) 같은 변경을 **두 번 적용**한다 — 이름변경은 멱등이라
//      참았지만, 이제는 지움이 쿼터를 **두 번 뺀다**(과소 계수 = 한도 우회 방향).
//   ② 옛 웹훅·크론은 커서를 **먼저 저장하고** 적용했다 — 적용 중 서버가 죽으면 그 변경은 영영 안 온다.
//      이제 커서는 **적용이 끝난 뒤** 저장한다. 적용은 멱등이고 건별 실패는 applyChanges 가 삼키고 표시를
//      남기므로, 독이 든 변경 하나가 줄을 막지 않는다.
// 범위: 프로세스 안 Map — PM2 fork 1개(ecosystem 확인). 여러 프로세스로 늘리면 이 잠금을 DB 로 옮긴다.
const { Op } = require('sequelize');
const gdrive = require('./gdrive');

const chains = new Map();   // business_id → 지금 도는 Promise

/** 같은 워크스페이스의 실행을 줄 세운다. 앞 실행이 끝나면 뒤 실행이 **새 커서로** 돈다. */
function serialize(businessId, fn) {
  const prev = chains.get(businessId) || Promise.resolve();
  const next = prev.catch(() => null).then(fn);
  chains.set(businessId, next);
  next.finally(() => { if (chains.get(businessId) === next) chains.delete(businessId); }).catch(() => null);
  return next;
}

/**
 * 밀린 변경을 읽어 적용하고, 끝난 뒤 커서를 저장한다.
 * @returns {{scanned:number, applied:object|null, note?:string}}
 */
async function runChanges(businessId, opts = {}) {
  return serialize(businessId, async () => {
    const { BusinessCloudToken } = require('../models');
    // 줄을 선 동안 앞 실행이 커서를 옮겼을 수 있다 — 반드시 DB 에서 다시 읽는다
    const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gdrive' } });
    if (!token) return { scanned: 0, applied: null, note: 'no_token' };
    let pageToken = token.watch_page_token;
    if (!pageToken) return { scanned: 0, applied: null, note: 'no_cursor' };
    const drive = opts.drive || await gdrive.getDriveClient(token);

    const changes = [];
    let nextCursor = null;
    let guard = 0;
    while (pageToken && guard < 50) {   // 상한 — 페이지가 끝없이 이어져도 한 번에 50쪽까지만
      guard += 1;
      const data = await gdrive.listChanges(drive, pageToken);
      (data.changes || []).forEach((c) => changes.push(c));
      if (data.nextPageToken) { pageToken = data.nextPageToken; nextCursor = data.nextPageToken; continue; }
      if (data.newStartPageToken) nextCursor = data.newStartPageToken;
      break;
    }

    let applied = null;
    if (changes.length) {
      const ga = require('./gdriveApply');
      applied = await ga.applyChanges(businessId, changes, ga.buildApplyCtx(drive, token));
    }
    // ★ 적용이 **끝난 뒤** 저장한다. 50쪽에서 끊겼으면 다음 쪽 토큰을 저장해 다음 실행이 잇는다.
    if (nextCursor && nextCursor !== token.watch_page_token) {
      await BusinessCloudToken.update({ watch_page_token: nextCursor }, { where: { id: token.id } });
    }
    return { scanned: changes.length, applied };
  });
}

/**
 * D-2 — 내려받기에 실패한 고침을 다시 시도한다(30분 크론 틱). 워크스페이스당 최대 20건.
 *   Changes 는 지나갔으므로 파일을 다시 읽어 «같은 모양의 변경» 으로 넣는다. 같은 줄에서 돈다.
 */
async function retryFailedEdits(businessId, limit = 20) {
  return serialize(businessId, async () => {
    const { File } = require('../models');
    const rows = await File.findAll({
      where: {
        business_id: businessId, deleted_at: null, storage_provider: 'planq',
        drive_sync_issue: 'edit_download_failed', gdrive_mirror_id: { [Op.ne]: null },
      },
      attributes: ['id', 'gdrive_mirror_id'], order: [['id', 'ASC']], limit,
    });
    if (!rows.length) return { retried: 0 };
    const token = await gdrive.getTokenForBusiness(businessId);
    if (!token) return { retried: 0, note: 'no_token' };
    const drive = await gdrive.getDriveClient(token);
    const changes = [];
    for (const r of rows) {
      try {
        const file = await gdrive.getChangeShapedFile(drive, r.gdrive_mirror_id);
        changes.push({ fileId: r.gdrive_mirror_id, removed: false, file });
      } catch (e) {
        // 다시 읽지도 못하면 다음 틱에 또 본다(접근 상실이면 Changes 가 따로 알려 준다)
        console.warn('[gdrive-retry] 다시 읽기 실패', r.id, e.message);
      }
    }
    const ga = require('./gdriveApply');
    const applied = changes.length ? await ga.applyChanges(businessId, changes, ga.buildApplyCtx(drive, token)) : null;
    return { retried: changes.length, applied };
  });
}

module.exports = { runChanges, retryFailedEdits, _serialize: serialize };
