// services/gdriveWatchCron.js — Drive watch 채널 갱신 + 공백 backstop (#379 B1-2)
//
// 왜 필요한가: Google Drive 의 push 채널은 **약 1주 뒤 만료**된다. 갱신하는 곳이 없으면
//   배포 직후엔 잘 되다가 **일주일 뒤 조용히 멈춘다.** 에러도 안 난다 — 그냥 알림이 안 온다.
//   "동기화가 언제부턴가 안 돼요" 는 이렇게 만들어진다.
//
// ★ 커서 부트스트랩 함정 (memory feedback_sync_cursor_bootstrap_swallows):
//   채널이 죽어 있던 동안의 변경은 push 로 영영 안 온다. 그래서 갱신할 때 **커서로 한 번 훑어
//   밀린 변경을 적용**한다. "증분 0건" 은 정상이 아니라 커서가 지나갔다는 신호일 수 있다 —
//   0건이어도 로그를 남겨 나중에 구분할 수 있게 한다.
const { BusinessCloudToken } = require('../models');
const { Op } = require('sequelize');
const gdrive = require('./gdrive');
const gdriveApply = require('./gdriveApply');

const INTERVAL_MS = 30 * 60 * 1000;          // 30분마다 점검
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // 만료 24시간 전에 미리 갱신

async function catchUp(token, drive) {
  // 채널 공백 동안 밀린 변경을 커서로 훑는다. push 가 못 준 것을 여기서 줍는다.
  let pageToken = token.watch_page_token;
  if (!pageToken) return { scanned: 0, applied: null, note: 'no_cursor' };
  const changes = [];
  let guard = 0;
  while (pageToken && guard < 50) {
    guard += 1;
    const data = await gdrive.listChanges(drive, pageToken);
    (data.changes || []).forEach((c) => changes.push(c));
    if (data.nextPageToken) { pageToken = data.nextPageToken; continue; }
    if (data.newStartPageToken) await token.update({ watch_page_token: data.newStartPageToken });
    break;
  }
  const applied = changes.length
    ? await gdriveApply.applyChanges(token.business_id, changes, gdriveApply.buildApplyCtx(drive, token))
    : null;
  return { scanned: changes.length, applied };
}

async function runGdriveWatchCron() {
  const soon = new Date(Date.now() + RENEW_BEFORE_MS);
  // ★ 채널이 **없는** 연동도 대상이다. `startChangesWatch` 는 수동 엔드포인트(/watch/start)에서만
  //   불리고 OAuth 연결 콜백은 채널을 열지 않는다 — 즉 사용자가 Drive 를 연결해도
  //   **아무도 감시하지 않아 역방향 동기화가 시작조차 안 된다.** 크론이 그 자리를 메운다.
  const rows = await BusinessCloudToken.findAll({
    where: {
      provider: 'gdrive',
      [Op.or]: [
        { watch_channel_id: null },                                   // 아직 한 번도 안 열림
        { watch_expires_at: null },                                   // 만료 시각 불명 — 갱신해 확정
        { watch_expires_at: { [Op.lt]: soon } },                      // 곧 만료
      ],
    },
  });
  const out = { checked: rows.length, opened: 0, renewed: 0, caught: 0, failed: 0 };
  for (const token of rows) {
    try {
      const drive = await gdrive.getDriveClient(token);
      // ① 공백 동안 밀린 변경 먼저 — 채널을 새로 열면 옛 커서가 의미를 잃을 수 있다
      const c = await catchUp(token, drive);
      if (c.scanned > 0) out.caught += c.scanned;
      // "0건" 도 남긴다 — 정상인지 커서가 지나간 것인지 나중에 구분하려면 기록이 있어야 한다
      console.log(`[gdrive-watch] biz${token.business_id} catchUp scanned=${c.scanned}`
        + (c.applied ? ` applied=${c.applied.applied} skipped=${c.applied.skipped}` : ''));
      // ② 옛 채널 정리 후 재개설
      if (token.watch_channel_id && token.watch_resource_id) {
        await gdrive.stopChannel(drive, { channelId: token.watch_channel_id, resourceId: token.watch_resource_id }).catch(() => null);
      }
      // ★ 규약은 { channelId, webhookUrl, tokenHint } 다 (routes/cloud.js:195 와 동일).
      //   { businessId } 를 넘기면 channelId 가 undefined 라 구글이 거부한다 — 조용히 안 열린다.
      const crypto = require('crypto');
      const channelId = crypto.randomUUID();
      const webhookUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/api/cloud/webhook/gdrive`;
      const tokenHint = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`biz:${token.business_id}`).digest('hex').slice(0, 32);
      const wasOpen = !!token.watch_channel_id;
      const { channel, startPageToken } = await gdrive.startChangesWatch(drive, { channelId, webhookUrl, tokenHint });
      await token.update({
        watch_channel_id: channel.id,
        watch_resource_id: channel.resourceId,
        watch_expires_at: channel.expiration ? new Date(Number(channel.expiration)) : null,
        watch_page_token: startPageToken || token.watch_page_token,
      });
      if (wasOpen) out.renewed += 1; else out.opened += 1;
    } catch (e) {
      out.failed += 1;
      console.warn(`[gdrive-watch] biz${token.business_id} 갱신 실패`, e.message);
      await gdrive.recordTokenError(token, e).catch(() => null);
    }
  }
  if (out.checked > 0) console.log('[gdrive-watch]', JSON.stringify(out));
  return out;
}

function initGdriveWatchCron() {
  // 기동 직후 한 번 — 서버가 죽어 있던 동안 만료됐을 수 있다.
  setTimeout(() => { runGdriveWatchCron().catch((e) => console.warn('[gdrive-watch] init', e.message)); }, 60 * 1000);
  setInterval(() => { runGdriveWatchCron().catch((e) => console.warn('[gdrive-watch]', e.message)); }, INTERVAL_MS);
}

module.exports = { initGdriveWatchCron, runGdriveWatchCron };
