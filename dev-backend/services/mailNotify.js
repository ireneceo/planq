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
// 같은 메일이 연결된 두 계정(예: help@ · irene@)으로 동시에 오면 **저장은 2건이 맞다** —
//   각 사서함에 실제로 도착한 메일이라 양쪽 인박스에 보여야 한다. 그러나 사용자에겐 한 통이므로
//   **알림은 1번**이어야 한다. 계정이 다르면 스레드도 달라 OS 알림 tag(`mail-{thread_id}`)가 갈리는 탓에
//   여태 배너가 따로 떴다 (2026-07-27 Irene 보고 "배너가 3번 떴다").
//   RFC Message-ID 기준으로 **사용자별** 중복을 제거한다 — 사용자 단위라 help@ 만 보는 다른 멤버는
//   자기 알림을 정상적으로 받는다. 시간당 캡(counters)과 같은 인메모리 방식(PM2 fork_mode 단일 인스턴스).
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
const recentNotified = new Map();   // `${userId}|${messageId}` → ts

function seenRecently(userId, messageId, now) {
  if (!messageId) return false;                       // Message-ID 없으면 중복 판정 불가 — 알린다
  const key = `${userId}|${messageId}`;
  const prev = recentNotified.get(key);
  if (prev && now - prev < DEDUP_WINDOW_MS) return true;
  recentNotified.set(key, now);
  // 무한 증식 방지 — 가끔 낡은 항목을 쓸어낸다 (맵이 커졌을 때만)
  if (recentNotified.size > 2000) {
    for (const [k, ts] of recentNotified) if (now - ts >= DEDUP_WINDOW_MS) recentNotified.delete(k);
  }
  return false;
}

// 운영 #278·#214 — **PlanQ 가 보낸 알림 메일이 되돌아와 다시 알림이 되던 루프**를 끊는다.
//
//   증상: "확인 권장 — PlanQ" 라는 알림이 업무 알림과 나란히 도착. 사용자는 같은 사건에 대한
//   알림을 2개로 겪는다. 실제로 운영 notifications 에 이 제목이 계속 쌓이고 있었다.
//   기전: 알림 메일이 사용자의 **연결된 메일함**으로 들어오고, emailTriage 가 플랫폼 발신 메일을
//   일부러 '확인 권장'(uncertain)으로 올린다. 그런데 알림 계층엔 발신자 차단이 없었다.
//   (기존 루프 가드는 email 채널만 막아서 인앱·푸시로 그대로 샜다.)
//
//   ★ 주소만 보고 막으면 안 된다 — SMTP_FROM 은 noreply 가 아니라 **사람이 쓰는 지원 사서함**
//     (help@irenewp.com)이다. 그 주소에서 사람이 보낸 진짜 메일의 알림까지 삼키면 더 나쁘다.
//     그래서 `주소 정확일치 AND 자동발송 판정(triage='automated')` 이중 조건으로 가른다.
//     사람이 보낸 메일엔 Auto-Submitted 헤더가 없어 triage 가 automated 로 안 떨어진다.
//   ★ 도메인 서픽스 매치(isFromOurPlatform)를 재사용하면 안 된다 — irene@irenewp.com 같은
//     같은 도메인의 사람 주소까지 전부 잡힌다.
//   ★ 메일 자체는 막지 않는다. **그 메일에 대한 알림만** 만들지 않는다
//     (알림을 지운 사용자가 메일함에서 다시 찾을 수 있어야 한다).
function isSelfSentPlatformMail(fromEmail, triage) {
  const platformFrom = String(process.env.SMTP_FROM || '').trim().toLowerCase();
  if (!platformFrom) return false;
  const from = String(fromEmail || '').trim().toLowerCase();
  return from === platformFrom && triage === 'automated';
}

async function notifyInboundMail({ account, thread, fromName, fromEmail, subject, messageId, fields = {}, ioApp }) {
  if (!account || !thread) return { sent: 0, reason: 'no_target' };

  const replyNeeded = fields.reply_needed !== undefined ? !!fields.reply_needed : !!thread.reply_needed;
  const status = fields.status || thread.status;
  const triage = fields.triage || thread.triage;

  // #278·#214 — 우리가 보낸 알림 메일이면 알림을 만들지 않는다 (자기수신 루프 차단).
  //   scope='all' 계정도 여기서 걸린다 — 아래 allowedByScope 보다 **먼저** 판정한다.
  if (isSelfSentPlatformMail(fromEmail, triage)) {
    return { sent: 0, reason: 'self_sent_platform_mail' };
  }

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
  // #281 — 제목 첫 토큰이 기능명이어야 "채팅인지 메일인지" 가 바로 읽힌다.
  //   제목은 수신자별 언어로 만들어야 하므로 아래 루프 안에서 buildTitle 을 호출한다.
  const titleAction = kind === 'reply' ? 'mail_reply_needed' : 'mail_review';
  const body = subj;                                     // 제목까지만 (본문 미포함)
  // ★ 폴더를 같이 싣는다 (2026-08-30).
  //   여태 `?thread=` 만 보내서, 링크를 눌러도 목록은 **지난번에 보던 탭**에 서 있었다
  //   (MailPage: folder = URL → 없으면 지난 선택 → 없으면 'reply_needed'. 자동 전환은
  //   지금 탭이 비어 있을 때만 발동하는데 답변 필요에 42건이 있어 안 바뀐다).
  //   확인 권장 메일 알림을 눌렀는데 "답변 필요" 탭이 열리는 어긋남의 정체다.
  //   kind 는 위 classify 와 같은 축이므로 여기서 폴더로 바로 옮긴다.
  const folder = kind === 'reply' ? 'reply_needed' : 'uncertain';
  const link = `/mail?folder=${folder}&thread=${thread.id}`;

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
  let deduped = 0;
  const now = Date.now();
  for (const uid of userIds) {
    // 같은 Message-ID 로 이 사용자에게 이미 알렸으면 건너뛴다 (다른 계정으로 온 같은 메일).
    if (seenRecently(uid, messageId, now)) { deduped += 1; continue; }
    const skipChannels = [];
    if (kind !== 'reply') skipChannels.push('email');
    else {
      try {
        const u = await User.findByPk(uid, { attributes: ['email'] });
        if (String(u?.email || '').toLowerCase() === accountAddr) skipChannels.push('email');
      } catch { skipChannels.push('email'); }
    }
    try {
      // #281 — 제목은 **수신자 언어로 발송 시점에** 만든다.
      //   notifications.title 은 DB 에 문자열로 박제되고 push payload 로 그대로 나가므로
      //   프론트 t() 로는 번역할 수 없다 (Fable 게이트 치명-3).
      const { buildTitle, recipientLang } = require('./notifyTitle');
      const title = buildTitle({
        feature: 'mail', action: titleAction, subject: sender,
        lang: await recipientLang(uid),
      });
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
  return { sent, deduped, kind, scope };
}

module.exports = { notifyInboundMail, classify, allowedByScope, seenRecently, HOURLY_CAP, DEDUP_WINDOW_MS };
