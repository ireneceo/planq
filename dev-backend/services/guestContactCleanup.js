// services/guestContactCleanup.js — 게스트가 남긴 연락처를 **약속한 날짜에 지운다** (#259 A안)
//
// ★ 개인정보처리방침에 이렇게 썼다:
//     "게스트 채팅 알림 정보(이름·이메일): 해당 대화 링크가 만료·회수된 후 30일 이내 삭제."
//   써 놓고 지우는 코드가 없으면 그 문장은 거짓이다. 이 파일이 그 문장의 구현이다.
//
// ★ 지우는 것은 **연락처**다. 과거 메시지의 표시명(messages.meta.guest.name 박제)은 그대로 둔다 —
//   그것은 대화 기록이고, 지우면 남이 쓴 글처럼 보이게 만든다.
//
// 두 가지를 지운다:
//   ① **확인 안 된 채 방치된 행** — 남의 주소를 적어 넣은 경우가 여기 남는다. 수집 근거가
//      없는 개인정보이므로 24시간이면 지운다. 코드 유효기간(10분)보다 넉넉히 잡되 하루를 넘기지 않는다.
//   ② **회수·만료 후 30일** — 방침에 쓴 그대로.
//   그리고 EmailLog 에 남은 수신 주소도 같이 가린다 — 본체를 지우고 로그에 남기면 안 지운 것이다.
const { Op } = require('sequelize');

const UNVERIFIED_TTL_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 연락처만 비운다. 링크 자체는 회수 상태로 남겨 감사 흔적을 지키되, PII 는 없다. */
const PII_CLEARED = {
  contact_name: null,
  contact_email: null,
  email_verified_at: null,
  otp_hash: null,
  otp_sent_at: null,
  otp_expires_at: null,
  otp_attempts: 0,
  otp_locked_until: null,
  consent_at: null,
  consent_privacy_version: null,
  last_notified_at: null,
  last_used_ip: null,
};

/** EmailLog 의 수신 주소를 가린다 — 도메인만 남겨 발송 통계는 유지한다. */
async function maskEmailLogs(addresses) {
  if (!addresses.length) return 0;
  const { EmailLog } = require('../models');
  const rows = await EmailLog.findAll({
    where: {
      to_email: { [Op.in]: addresses },
      template: { [Op.in]: ['guest_verify_otp', 'guest_reply_notify'] },
    },
    attributes: ['id', 'to_email'],
    limit: 5000,
  });
  let n = 0;
  for (const r of rows) {
    const at = String(r.to_email || '').indexOf('@');
    const masked = at > 0 ? `deleted@${String(r.to_email).slice(at + 1)}` : 'deleted@-';
    await r.update({ to_email: masked }).catch(() => null);
    n += 1;
  }
  return n;
}

async function runGuestContactCleanup(now = new Date()) {
  const { GuestLink } = require('../models');
  const stats = { unverified: 0, expired: 0, email_logs: 0 };

  // ① 확인 안 된 채 24시간 — 신청만 있고 확인이 없었던 행
  const staleUnverified = await GuestLink.findAll({
    where: {
      kind: 'personal',
      email_verified_at: null,
      contact_email: { [Op.ne]: null },
      // ★ 속성 이름은 `createdAt` 이다(underscored 는 **컬럼** 이름만 바꾼다). `created_at` 으로
      //   쓰면 Sequelize 가 모르는 키라 조건이 엉뚱하게 나가고 **아무것도 안 지워진다** —
      //   그리고 "0건 정리" 는 정상처럼 보인다(실측으로 잡았다).
      createdAt: { [Op.lt]: new Date(now.getTime() - UNVERIFIED_TTL_MS) },
    },
    limit: 1000,
  });

  // ② 회수됐거나 만료된 지 30일 — 방침에 쓴 보관기간
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const staleClosed = await GuestLink.findAll({
    where: {
      kind: 'personal',
      contact_email: { [Op.ne]: null },
      [Op.or]: [
        { revoked_at: { [Op.lt]: cutoff } },
        { expires_at: { [Op.lt]: cutoff } },
      ],
    },
    limit: 1000,
  });

  const addresses = [];
  for (const l of staleUnverified) {
    addresses.push(l.contact_email);
    // 확인도 안 된 링크는 존재 이유가 없다 — 같이 닫는다.
    await l.update({ ...PII_CLEARED, revoked_at: l.revoked_at || now }).catch(() => null);
    stats.unverified += 1;
  }
  for (const l of staleClosed) {
    addresses.push(l.contact_email);
    await l.update(PII_CLEARED).catch(() => null);
    stats.expired += 1;
  }

  stats.email_logs = await maskEmailLogs([...new Set(addresses.filter(Boolean))]).catch(() => 0);
  return stats;
}

/**
 * **지금 이 자리에서** 한 사람의 흔적을 지운다 — 본인이 화면에서 "지우기" 를 눌렀을 때.
 *
 * ★ cron 에 맡길 수 없다. cron 은 `contact_email` 이 남아 있는 행에서 주소를 모으는데,
 *   삭제는 그 컬럼을 즉시 NULL 로 만든다 — 그러면 그 주소는 **영원히 마스킹 대상이 아니다**
 *   (Fable 실측: 삭제 31일 뒤에도 email_logs 에 주소가 그대로 남았다).
 *   본체를 지우고 로그에 남기면 안 지운 것이다.
 */
async function purgeContactNow(link) {
  if (!link) return { email_logs: 0 };
  const email = link.contact_email;
  await link.update({ ...PII_CLEARED, revoked_at: link.revoked_at || new Date() });
  const n = email ? await maskEmailLogs([email]).catch(() => 0) : 0;
  return { email_logs: n };
}

module.exports = { runGuestContactCleanup, purgeContactNow, UNVERIFIED_TTL_MS, RETENTION_MS };
