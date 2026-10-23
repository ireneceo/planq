/**
 * 사람의 «최근 접속» — 마지막 로그인과 마지막 세션 갱신 중 늦은 쪽.
 *
 * users.last_login_at 은 **비밀번호·외부 로그인 순간에만** 찍힌다. 그런데 세션은 30일(웹)·365일(앱)
 * 동안 refresh 로 이어지므로(services/authTokens) 매일 쓰는 사람도 그 값은 몇 주 전에 멈춘다.
 * 2026-10-23 Irene: «플랫폼 관리자에서 … 최근로그인 날짜가 안맞아» — 오늘 쓰고 있는 계정이 10월 19일로 보였다.
 * 앱이 열려 있으면 access 토큰(15분)이 갱신될 때마다 새 refresh 행이 생기고 그 행의 last_used_at 이 NOW 다
 * → 그 최댓값이 «마지막으로 PlanQ 를 쓴 때» 다(15분 단위). 대리 로그인(impersonate)은 refresh 를 안 타므로 세지 않는다.
 */
const { Op, fn, col } = require('sequelize');
const { RefreshToken } = require('../models');

// userIds → Map<userId, Date|null>(세션 갱신 최댓값). 없는 사람은 키가 없다.
async function lastSessionUseMap(userIds) {
  const ids = [...new Set((userIds || []).filter((x) => x != null).map(Number))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await RefreshToken.findAll({
    where: { user_id: { [Op.in]: ids } },
    attributes: ['user_id', [fn('MAX', col('last_used_at')), 'last_used']],
    group: ['user_id'],
    raw: true,
  });
  for (const r of rows) if (r.last_used) out.set(Number(r.user_id), new Date(r.last_used));
  return out;
}

function laterOf(a, b) {
  const da = a ? new Date(a) : null;
  const db = b ? new Date(b) : null;
  if (!da) return db;
  if (!db) return da;
  return da > db ? da : db;
}

// 사람 객체(plain)들에 last_active_at 을 붙인다. last_login_at 은 그대로 둔다(«로그인» 과 «접속» 은 다른 사실).
async function attachLastActive(users) {
  const list = (users || []).filter(Boolean);
  const map = await lastSessionUseMap(list.map((u) => u.id));
  for (const u of list) u.last_active_at = laterOf(u.last_login_at, map.get(Number(u.id)));
  return users;
}

module.exports = { lastSessionUseMap, attachLastActive, laterOf };
