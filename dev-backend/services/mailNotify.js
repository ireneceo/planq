// services/mailNotify.js — #203/#207 Q Mail 새 메일 알림 단일 착지점
//
//   여태 메일이 도착해도 socket broadcast 만 하고 notify() 호출이 **아예 없었다** (CLAUDE.md §13 위반).
//   그래서 "답변 필요" 메일이 와도 인앱 종·모바일 push·메일 어디에도 안 떴다.
//
//   설계(Fable 게이트) 요약:
//     · 범위는 계정 속성(email_accounts.notify_scope) — 전체 / 확인권장+답변필요(기본) / 답변필요만
//     · 채널은 사용자 속성(notification_prefs 의 event_kind='mail') — 기존 매트릭스 그대로
//     · 수신자: 개인 계정(owner_user_id) = 본인만 / 회사 계정 = 워크스페이스 멤버 전원
//       ★ 개인 메일 격리가 이 기능의 최대 리스크다. accessibleAccountIds 와 같은 술어를 쓴다.
//     · 이메일 채널은 **답변 필요만** — 확인 권장까지 메일로 보내면 메일함이 메일 알림으로 찬다.
//       게다가 수신자 로그인 주소 == 그 메일이 도착한 주소면 자기 메일함에 되돌아오므로 무조건 차단.
//     · 알림 폭주 차단: 계정×시간당 상한. 넘으면 개별 알림을 멈춘다(요약 1건만).
//     · 알림 본문에 메일 **내용은 넣지 않는다** — 발신자·제목까지만 (push 는 외부 중계를 탄다).

const HOURLY_CAP = 20;                 // 계정당 시간당 개별 알림 상한
const counters = new Map();            // accountId → { hourKey, count, capNotified }

function bump(accountId) {
  const hourKey = new Date().toISOString().slice(0, 13);   // yyyy-mm-ddThh
  const cur = counters.get(accountId);
  if (!cur || cur.hourKey !== hourKey) {
    counters.set(accountId, { hourKey, count: 1, capNotified: false });
    return { count: 1, capNotified: false };
  }
  cur.count += 1;
  return cur;
}

/** 이 메일이 어떤 성격인가 — 폴더 정의(routes/email_threads.js folderWhere)와 같은 술어. */
function classify({ replyNeeded, status, triage }) {
  if (status === 'spam' || triage === 'spam') return 'spam';
  if (replyNeeded && (status === 'open' || status === 'uncertain')) return 'reply';
  if (status === 'uncertain') return 'review';
  if (status === 'open' && triage !== 'automated' && triage !== 'marketing') return 'review';
  return 'other';   // 자동·마케팅
}

/** 범위 설정이 이 성격의 메일을 허용하는가. */
function allowedByScope(kind, scope) {
  if (kind === 'spam') return false;
  if (kind === 'reply') return true;                       // 답변 필요는 어느 범위에서도 알린다
  if (kind === 'review') return scope === 'all' || scope === 'recommended';
  return scope === 'all';                                  // 자동·마케팅
}

/**
 * 새 inbound 메일 1통에 대한 알림. 실패해도 메일 수집을 막지 않는다(호출부에서 catch).
 * @param {object} p.account  EmailAccount 인스턴스
 * @param {object} p.thread   EmailThread 인스턴스 (triage 반영 후)
 * @param {object} p.fields   이번 inbound 로 계산된 triage 필드 (없으면 thread 값 사용)
 */
async function notifyInboundMail({ account, thread, fromName, fromEmail, subject, fields = {}, ioApp }) {
  if (!account || !thread) return { sent: 0, reason: 'no_target' };

  const replyNeeded = fields.reply_needed !== undefined ? !!fields.reply_needed : !!thread.reply_needed;
  const status = fields.status || thread.status;
  const triage = fields.triage || thread.triage;
  const kind = classify({ replyNeeded, status, triage });
  const scope = account.notify_scope || 'recommended';
  if (!allowedByScope(kind, scope)) return { sent: 0, reason: `scope_${scope}_skip_${kind}` };

  // 시간당 캡 — 넘으면 개별 알림 중단 (스팸성 대량 유입이 push 로 새는 것 차단)
  const c = bump(account.id);
  if (c.count > HOURLY_CAP) {
    if (!c.capNotified) { c.capNotified = true; console.warn(`[mailNotify] account #${account.id} 시간당 ${HOURLY_CAP}건 초과 — 개별 알림 중단`); }
    return { sent: 0, reason: 'hourly_cap' };
  }

  // 수신자 — 개인 계정은 본인만, 회사 계정은 워크스페이스 멤버 전원
  const { BusinessMember, Business, User } = require('../models');
  let userIds = [];
  if (account.owner_user_id) {
    userIds = [account.owner_user_id];
  } else {
    const members = await BusinessMember.findAll({
      where: { business_id: account.business_id },
      attributes: ['user_id'],
    });
    userIds = members.map((m) => m.user_id).filter(Boolean);
  }
  if (!userIds.length) return { sent: 0, reason: 'no_recipients' };

  const sender = fromName || (fromEmail || '').split('@')[0] || 'unknown';
  const subj = String(subject || '(제목 없음)').slice(0, 120);
  const title = kind === 'reply'
    ? `답변 필요 — ${sender}`
    : `확인 권장 — ${sender}`;
  const body = subj;                                     // 제목까지만 (본문 미포함)
  const link = `/mail?thread=${thread.id}`;

  // 이메일 채널: 답변 필요만. 그리고 수신자 로그인 주소가 이 메일 계정 주소면 자기 메일함으로
  //   되돌아오므로 그 사람만 email 을 끈다(루프 가드).
  const accountAddr = String(account.email || '').toLowerCase();
  const { notify } = require('../routes/notifications');
  let bizName = null;
  try {
    const biz = await Business.findByPk(account.business_id, { attributes: ['name'] });
    bizName = biz?.name || null;
  } catch { /* 표시용이라 실패해도 진행 */ }

  let sent = 0;
  for (const uid of userIds) {
    const skipChannels = [];
    if (kind !== 'reply') skipChannels.push('email');
    else {
      try {
        const u = await User.findByPk(uid, { attributes: ['email'] });
        if (String(u?.email || '').toLowerCase() === accountAddr) skipChannels.push('email');
      } catch { skipChannels.push('email'); }
    }
    try {
      await notify({
        userId: uid,
        businessId: account.business_id,
        eventKind: 'mail',
        title, body, link,
        workspaceName: bizName,
        tag: `mail-${thread.id}`,                        // 같은 스레드 연속 메일은 OS 알림 1개로 대체
        entityType: 'email_thread',
        entityId: thread.id,
        skipChannels,
        ioApp,
      });
      sent += 1;
    } catch (e) {
      console.error('[mailNotify]', e.message);
    }
  }
  return { sent, kind, scope };
}

module.exports = { notifyInboundMail, classify, allowedByScope, HOURLY_CAP };
