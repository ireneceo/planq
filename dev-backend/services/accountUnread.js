// services/accountUnread.js — 같은 기기의 **다른 계정** 안읽음 수 한 곳(계정 목록 점 · 푸시 앱 숫자 합).
//   정의: 그 사람의 안 읽은 알림(종) 수 — 모든 워크스페이스 + 플랫폼 공지, 최근 30일.
//   (지금 계정의 앱 숫자는 기존 정의 그대로 — 채팅 안읽음 + 확인 필요. 다른 계정은 소켓이 없어 이 가벼운 정의로 센다.)
//   30초 메모리 캐시 — 계정 목록 열기·푸시 발송마다 같은 사람을 다시 세지 않게.
//   설계: docs/MULTI_ACCOUNT_DESIGN.md 7절 5 · 비차단 메모(30초 캐시).
const { Op } = require('sequelize');

const TTL_MS = 30 * 1000;
const cache = new Map();   // userId → { n, at }

async function unreadFor(userId) {
  const id = Number(userId);
  if (!id) return 0;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.n;
  const { Notification } = require('../models');
  let n = 0;
  try {
    n = await Notification.count({
      where: { user_id: id, read_at: null, created_at: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    });
  } catch { n = 0; }
  cache.set(id, { n, at: Date.now() });
  if (cache.size > 5000) cache.clear();
  return n;
}

function invalidate(userId) { cache.delete(Number(userId)); }

module.exports = { unreadFor, invalidate };
