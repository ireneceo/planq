// Q Bill 이벤트 타임라인 writer — 청구서/견적 생애주기 계측 단일 진입점.
//   발행·고객열람·(부분)결제·세금계산서·정정·취소 등을 bill_events 에 시간순으로 쌓는다.
//   라우트는 본 흐름을 깨지 않도록 항상 try/catch 로 감싸 best-effort 기록(실패해도 본 응답은 정상).
const { BillEvent, User } = require('../models');
const { Op } = require('sequelize');
const { getMemberNameMap } = require('./displayName');

// 단일 이벤트 기록. dedupeWindowMs 가 주어지면 같은 (entity,event) 가 그 시간 안에 이미 있으면 skip.
//   (예: 고객이 공개 링크를 새로고침 도배해도 'viewed' 가 한 세션에 한 번만 쌓이게)
async function logBillEvent(entityType, entityId, eventType, opts = {}) {
  const { actorUserId = null, detail = null, dedupeWindowMs = 0 } = opts;
  try {
    if (!entityId) return null;
    if (dedupeWindowMs > 0) {
      const since = new Date(Date.now() - dedupeWindowMs);
      const exists = await BillEvent.findOne({
        where: {
          entity_type: entityType,
          entity_id: entityId,
          event_type: eventType,
          created_at: { [Op.gte]: since },
        },
        order: [['created_at', 'DESC']],
      });
      if (exists) return null;
    }
    return await BillEvent.create({
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      actor_user_id: actorUserId,
      detail,
    });
  } catch (e) {
    console.warn('[billEvent]', entityType, eventType, e.message);
    return null;
  }
}

// invoice 한 건의 타임라인 조회 — actor(내부 사용자) 표시명은 워크스페이스 닉네임 우선.
//   actor 없는 이벤트(viewed/payment_notified 등)는 고객·시스템 행위로 actor=null.
async function listBillEvents(entityType, entityId, businessId) {
  const events = await BillEvent.findAll({
    where: { entity_type: entityType, entity_id: entityId },
    order: [['created_at', 'ASC'], ['id', 'ASC']],
  });
  const actorIds = [...new Set(events.map(e => e.actor_user_id).filter(Boolean))];
  let nameMap = new Map();      // userId → 워크스페이스 표시명
  let acctMap = new Map();      // userId → 계정 이름(fallback)
  if (actorIds.length) {
    const users = await User.findAll({ where: { id: actorIds }, attributes: ['id', 'name'] });
    acctMap = new Map(users.map(u => [u.id, u.name]));
    if (businessId) nameMap = await getMemberNameMap(businessId, actorIds);
  }
  return events.map(e => {
    let actor = null;
    if (e.actor_user_id) {
      const m = nameMap.get(e.actor_user_id);
      actor = { id: e.actor_user_id, name: (m && m.name) || acctMap.get(e.actor_user_id) || null };
    }
    return {
      id: e.id,
      event_type: e.event_type,
      actor,
      detail: e.detail || null,
      created_at: e.created_at,
    };
  });
}

module.exports = { logBillEvent, listBillEvents };
