// services/mailAutoExtract.js — 메일 업무 자동추출 트리거 (#235 Phase 1, Fable 판정 이행)
//
// ── Fable 이 정한 것 (이 파일이 그 정본) ─────────────────────────────────────
// ① 단위는 **계정 컬럼** `email_accounts.auto_extract_scope`:
//      'off'(기본) · 'reply_needed'(답변 필요만) · 'recommended'(확인 권장까지)
//    탭 단위 컬럼을 두지 않는다 — 탭은 reply_needed/status 의 **파생 뷰**라
//    스레드가 탭을 옮기면 의미가 깨진다. 발신자 규칙은 이미 reply_needed 를 조작하므로
//    규칙 → reply_needed → 자동추출로 공짜로 연동된다.
// ② 트리거는 **분류 직후**(emailImapCron 착지점), 스레드당 **10분 디바운스**.
//    메일은 채팅보다 느린 매체라 60초가 아니라 10분이면 충분하다.
// ③ **백필 제외** — 계정 첫 연동 시 옛 메일 수백 통에 LLM 이 폭주하는 사고를 여기서 막는다.
//    (reply_needed·알림이 같은 이유로 backfill 을 제외하는 것과 같은 선)
// ④ 쿼터 풀은 채팅과 **공유**(task_extractor 안의 checkUsageLimit 그대로 — 공식 2벌 금지).
//    그 위에 **워크스페이스별 하루 20스레드** 캡을 따로 둔다 — 메일 폭주가 채팅 쿼터를
//    태우는 것만 막는 목적이다.
// ⑤ 보관·스팸·마케팅·자동발송은 어떤 scope 에서도 제외.
//
// ★ 채팅 스케줄러(taskExtractorScheduler)를 재사용하지 않는다 — 그쪽은 Conversation 컬럼에
//   결합돼 있어 재사용하면 오히려 얽힌다. **추출 파이프라인은 공유**하고(extractEmailTaskCandidates)
//   트리거만 매체별로 둔다 — 공식이 두 벌이 아니라 착지점이 하나다.
const DEBOUNCE_MS = 10 * 60 * 1000;      // 10분
const DAILY_THREAD_CAP = 20;             // 워크스페이스당 하루 자동추출 스레드 수

// per-thread timer (in-memory). 유실돼도 다음 수신이나 수동 버튼이 회복하므로 cron fallback 없음.
const timers = new Map();
// 워크스페이스별 오늘 자동추출 스레드 수 — { [businessId]: { day: 'YYYY-MM-DD', ids: Set } }
const dailyCount = new Map();

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** 이 스레드가 scope 조건을 충족하는가. 판정은 여기 한 곳. */
function matchesScope(scope, thread) {
  if (!scope || scope === 'off') return false;
  const status = String(thread.status || '');
  // 손 뗀 대화·스팸은 어떤 scope 에서도 제외
  if (['archived', 'spam'].includes(status)) return false;
  // 사람이 쓴 메일만 — 마케팅·자동발송에서 업무를 뽑으면 쓰레기 후보가 쌓인다
  //   (실측: WordPress 알림 메일에서 "[   ] upload" 가 나왔다)
  if (thread.triage && thread.triage !== 'human') return false;
  if (scope === 'reply_needed') return !!thread.reply_needed;
  if (scope === 'recommended') {
    if (thread.reply_needed) return true;
    // '확인 권장' 중에서도 **의도가 불분명한 사람 메일**까지만. 자동발송류는 위에서 걸렸다.
    return status === 'uncertain' && thread.uncertain_reason === 'unclear_intent';
  }
  return false;
}

/** 오늘 이 워크스페이스에서 자동추출을 더 해도 되는가 (스레드 기준). */
function underDailyCap(businessId, threadId, now = new Date()) {
  const day = todayKey(now);
  let e = dailyCount.get(businessId);
  if (!e || e.day !== day) { e = { day, ids: new Set() }; dailyCount.set(businessId, e); }
  if (e.ids.has(threadId)) return true;           // 같은 스레드 재시도는 새 소비가 아니다
  return e.ids.size < DAILY_THREAD_CAP;
}
function markDaily(businessId, threadId, now = new Date()) {
  const day = todayKey(now);
  let e = dailyCount.get(businessId);
  if (!e || e.day !== day) { e = { day, ids: new Set() }; dailyCount.set(businessId, e); }
  e.ids.add(threadId);
}

/**
 * 수신 메일 착지 직후 호출. 조건을 만족하면 10분 뒤 추출을 예약한다.
 * @param {object} ctx { thread, account, isBackfill, io }
 */
function scheduleFromInbound({ thread, account, isBackfill, io }) {
  try {
    if (isBackfill) return;                                   // ③
    if (!thread || !account) return;
    const scope = account.auto_extract_scope;
    if (!matchesScope(scope, thread)) return;

    const tid = Number(thread.id);
    const prev = timers.get(tid);
    if (prev) clearTimeout(prev);                             // 진짜 디바운스 — 연속 수신은 뒤로 민다
    const t = setTimeout(() => {
      timers.delete(tid);
      runExtract(tid, account.business_id, io).catch((e) =>
        console.warn('[mailAutoExtract] run failed', tid, e.message));
    }, DEBOUNCE_MS);
    if (t.unref) t.unref();                                   // 종료를 막지 않는다
    timers.set(tid, t);
  } catch (e) {
    console.warn('[mailAutoExtract] schedule failed', e.message);
  }
}

/** 실제 추출. 조건은 실행 시점에 **다시** 확인한다 — 10분 사이에 상태가 바뀔 수 있다. */
async function runExtract(threadId, businessId, io) {
  const { EmailThread, EmailAccount, EmailMessage } = require('../models');
  const thread = await EmailThread.findByPk(threadId);
  if (!thread) return;
  const account = await EmailAccount.findByPk(thread.account_id,
    { attributes: ['id', 'business_id', 'auto_extract_scope'] });
  if (!account || !matchesScope(account.auto_extract_scope, thread)) return;

  // 새 메시지가 없으면 돌지 않는다 — 없으면 스레드 전체를 매번 다시 추출하게 된다.
  const { Op } = require('sequelize');
  const where = { thread_id: threadId, direction: 'inbound' };
  if (thread.last_extracted_email_message_id) {
    where.id = { [Op.gt]: thread.last_extracted_email_message_id };
  }
  const newCount = await EmailMessage.count({ where });
  if (newCount === 0) return;

  if (!underDailyCap(businessId, threadId)) {
    console.warn(`[mailAutoExtract] 일일 상한(${DAILY_THREAD_CAP}) 도달 — biz ${businessId} thread ${threadId} skip`);
    return;
  }

  const taskExtractor = require('./task_extractor');
  let result;
  try {
    result = await taskExtractor.extractEmailTaskCandidates({
      emailThreadId: threadId, userId: null, businessId,
    });
  } catch (e) {
    console.warn('[mailAutoExtract] extract failed', threadId, e.message);
    return;
  }
  markDaily(businessId, threadId);

  // 어디까지 봤는지 기록 — 다음 수신 때 그 뒤만 본다.
  const last = await EmailMessage.findOne({
    where: { thread_id: threadId }, order: [['id', 'DESC']], attributes: ['id'],
  });
  if (last) await thread.update({ last_extracted_email_message_id: last.id });

  const made = result?.candidates?.length || 0;
  if (made > 0) {
    console.log(`[mailAutoExtract] thread ${threadId} → 후보 ${made}건`);
    // 실시간 반영 (CLAUDE.md 운영 규칙 16) — 수동 경로와 같은 신호를 쓴다.
    try {
      const sock = io || global.__planqIo || null;
      if (sock) sock.to(`business:${businessId}`).emit('candidate:new', {
        email_thread_id: threadId, count: made,
      });
    } catch { /* 브로드캐스트 실패가 추출을 죽이면 안 된다 */ }
  }
}

module.exports = {
  scheduleFromInbound, runExtract, matchesScope, underDailyCap, markDaily,
  DEBOUNCE_MS, DAILY_THREAD_CAP,
  __test: { timers, dailyCount },
};
