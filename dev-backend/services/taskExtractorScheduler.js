// taskExtractorScheduler — 채팅 자동 업무 추출 디바운스 트리거 (사이클 N+27 Phase 5-1)
//
// 정책:
//   - in-memory per-conversation timer (debounce)
//   - 메시지 발송 시 schedule(convId) 호출 → 60초 setTimeout
//   - 같은 대화 추가 메시지 → timer reset (진짜 디바운스)
//   - 5+ 메시지 burst → 즉시 처리 (timer cancel + run)
//   - cron 1분 fallback — PM2 restart 시 timer 잃은 대화 복구
//
// LLM 호출 조건 (run 시점):
//   - conversation.auto_extract_enabled === true
//   - conversation.extraction_in_progress_at null OR 10분 경과
//   - 새 메시지 (last_extracted_message_id 이후) ≥ 3개
//   - cue_usage 한도 미초과
//
// 결과: candidates:created socket emit → 사용자 인박스 실시간 갱신

const { Conversation, Message, Business } = require('../models');
const taskExtractor = require('./task_extractor');
const { Op } = require('sequelize');
const cron = require('node-cron');

const DEBOUNCE_MS = 60 * 1000;       // 60초 무활동 후 추출
const BURST_THRESHOLD = 5;           // 5+ 메시지 누적 시 즉시
const MIN_NEW_MESSAGES = 3;          // 3개 미만이면 LLM 호출 skip
const FALLBACK_CRON = '* * * * *';   // 매 분 fallback

// per-conversation timer
const timers = new Map();
// per-conversation 누적 메시지 수 (burst 감지)
const messageCounters = new Map();

let ioRef = null;
function setIo(io) { ioRef = io; }

/** 메시지 발송 시점에 호출 — debounce schedule */
function scheduleExtract(conversationId) {
  if (!conversationId) return;
  const cid = Number(conversationId);

  // burst counter ++
  const cur = (messageCounters.get(cid) || 0) + 1;
  messageCounters.set(cid, cur);

  // 5+ 메시지 누적 — 즉시 실행
  if (cur >= BURST_THRESHOLD) {
    const t = timers.get(cid);
    if (t) clearTimeout(t);
    timers.delete(cid);
    messageCounters.delete(cid);
    // 즉시 비동기 실행 (setImmediate 보다 짧은 microtask)
    queueMicrotask(() => runExtract(cid).catch(() => null));
    return;
  }

  // 기존 timer reset
  const existing = timers.get(cid);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(cid);
    messageCounters.delete(cid);
    runExtract(cid).catch((e) => console.warn('[taskExtractorScheduler] run error', e.message));
  }, DEBOUNCE_MS);
  timers.set(cid, t);
}

/** 실제 추출 실행 */
async function runExtract(conversationId) {
  const conv = await Conversation.findByPk(conversationId);
  if (!conv) return;
  if (!conv.auto_extract_enabled) return;
  if (conv.archived_at) return;

  // 동시 추출 방지 — task_extractor 자체에도 가드 있지만 race 단축
  if (conv.extraction_in_progress_at) {
    const elapsed = Date.now() - new Date(conv.extraction_in_progress_at).getTime();
    if (elapsed < 10 * 60 * 1000) return;
  }

  // 새 메시지 수 확인 — 3개 미만이면 LLM 호출 안 함
  const where = {
    conversation_id: conv.id,
    is_deleted: false,
    is_ai: false,
    [Op.or]: [{ kind: null }, { kind: { [Op.ne]: 'card' } }],
  };
  if (conv.last_extracted_message_id) {
    where.id = { [Op.gt]: conv.last_extracted_message_id };
  }
  const newCount = await Message.count({ where });
  if (newCount < MIN_NEW_MESSAGES) return;

  // 추출 실행 — userId 는 null (auto trigger 표시). extracted_by_user_id 에 null OK (FK nullable).
  let result;
  try {
    result = await taskExtractor.extractTaskCandidates({
      conversationId: conv.id, userId: null, businessId: conv.business_id,
    });
  } catch (e) {
    console.warn('[taskExtractorScheduler] extract failed', conv.id, e.message);
    return;
  }

  if (result?.candidates?.length > 0) {
    // 인박스 새로고침 신호 — workspace room broadcast
    if (ioRef) {
      ioRef.to(`business:${conv.business_id}`).emit('candidates:created', {
        conversation_id: conv.id,
        project_id: conv.project_id || null,
        candidates: result.candidates,
      });
      // 인박스 silent refresh 트리거
      ioRef.to(`business:${conv.business_id}`).emit('inbox:refresh');
    }
    console.log(`[taskExtractorScheduler] conv=${conv.id} extracted=${result.candidates.length}`);
  }
}

/** cron fallback — PM2 restart 시 in-memory timer 잃은 대화 복구 */
function initCronFallback() {
  cron.schedule(FALLBACK_CRON, async () => {
    try {
      // 마지막 추출 후 60초+ 경과 + auto_extract_enabled + 추출 진행 중 아님
      const targets = await Conversation.findAll({
        where: {
          auto_extract_enabled: true,
          archived_at: null,
          [Op.or]: [
            { last_extracted_at: null },
            { last_extracted_at: { [Op.lt]: new Date(Date.now() - DEBOUNCE_MS) } },
          ],
          [Op.or]: [
            { extraction_in_progress_at: null },
            { extraction_in_progress_at: { [Op.lt]: new Date(Date.now() - 10 * 60 * 1000) } },
          ],
        },
        attributes: ['id', 'business_id', 'last_extracted_message_id'],
        limit: 50,
      });
      for (const c of targets) {
        // 이미 in-memory timer 있으면 skip
        if (timers.has(c.id)) continue;
        // 새 메시지 ≥ 3 이면 run (조건 미충족이면 runExtract 안에서 skip)
        runExtract(c.id).catch(() => null);
      }
    } catch (e) {
      console.warn('[taskExtractorScheduler] cron fallback error', e.message);
    }
  });
  console.log('[taskExtractorScheduler] cron fallback 1min initialized');
}

module.exports = { scheduleExtract, setIo, initCronFallback };
