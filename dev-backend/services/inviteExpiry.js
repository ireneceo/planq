// services/inviteExpiry.js — 초대 만료 규칙의 **단일 원천**.
//
// Fable 감사 F2 (2026-08-28): 미수락 초대가 멤버 쿼터를 영구히 잠식했다.
//   30일이 지나 `POST /api/invites/:token/accept` 가 410 으로 거부하는 — 즉 **수락 자체가
//   불가능한** 행이, 한도 계산에는 실멤버와 똑같이 잡혀 자리를 영원히 붙들고 있었다.
//   owner 는 자리를 비울 방법이 없다(초대는 지워야 하는데 그 존재를 화면에서 보지도 못한다).
//
// ★ 규칙을 여기 한 곳에만 둔다. invites.js(수락 가능 판정)와 plan.js(쿼터 카운트)가
//   각자 30일을 들고 있으면 반드시 갈라진다 — "수락은 안 되는데 자리는 먹는" 구간이 생긴다.
const { Op } = require('sequelize');

const INVITE_EXPIRY_DAYS = 30;
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 86400000;

// 미수락 초대가 만료됐는가. invited_at 이 없으면 만료로 보지 않는다(옛 데이터 보호).
//   nowMs 는 **검증용 시간 주입구**다. 실호출은 인자 없이 쓴다(= 현재 시각).
//   30일짜리 규칙은 실데이터로 재현하려면 행을 30일 늙혀야 하는데, 그건 운영 데이터 조작이다.
//   시계를 넣을 수 있으면 **실제 함수 그대로** 양방향(만료 전/후)을 칠 수 있다.
function isExpired(invitedAt, nowMs = Date.now()) {
  if (!invitedAt) return false;
  return nowMs - new Date(invitedAt).getTime() > INVITE_EXPIRY_MS;
}

// 쿼터 카운트용 WHERE 조각 — "만료된 미수락 초대는 빼고" 를 SQL 로 옮긴 것.
//   ★ 위 isExpired 와 **정확히 같은 규칙**이어야 한다:
//     ① **joined_at** 이 있으면 이미 합류한 실멤버 → 만료 무관하게 센다
//     ② invited_at 이 NULL 이면 isExpired(null)===false → 만료 아님 → 센다
//        (옛 경로로 직접 추가된 멤버·워크스페이스 생성 시 owner 는 invited_at 이 NULL 이다 — 여기서 지켜진다)
//     ③ 그 외에는 30일 안쪽 초대만 센다
//
// ★ 분기 ① 의 판별자는 user_id 가 아니라 **joined_at** 이다 (Fable 재검증 F2b, 2026-08-28).
//   `businesses.js` 의 초대 발행은 대상이 **이미 가입된 사용자**면 그 자리에서 user_id 를 채운다
//   (joined_at 은 수락 때 채워진다). 그래서 user_id 로 "실멤버" 를 판정하면, 기존 가입자에게 보낸
//   초대가 만료돼도(accept 는 410) 자리를 영원히 붙든다 — F2 가 고치려던 바로 그 증상이 이 클래스에
//   그대로 남아 있었다. 수락 판정(invites.js resolveToken)이 `isExpired && !joined_at` 을 쓰므로
//   **같은 판별자를 써야** "수락은 410 인데 자리는 먹는" 구간이 안 생긴다.
function activeMemberSeatWhere(nowMs = Date.now()) {
  return {
    [Op.or]: [
      { joined_at: { [Op.ne]: null } },
      { invited_at: null },
      { invited_at: { [Op.gt]: new Date(nowMs - INVITE_EXPIRY_MS) } },
    ],
  };
}

module.exports = { INVITE_EXPIRY_DAYS, INVITE_EXPIRY_MS, isExpired, activeMemberSeatWhere };
