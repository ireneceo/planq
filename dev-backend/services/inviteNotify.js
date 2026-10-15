// 초대받는 사람이 이미 PlanQ 계정이면 앱 안(종·푸시)에서도 알린다 — 메일만 보내면 앱만 쓰는 사람은 모른다.
//   Irene 2026-10-12: «초대메일 보낸 사람이 우리 솔루션 사용하는 유저라면 플랜큐 안에서도 알림을 보내야 하지 않아?»
//   설계 docs/INVITE_INAPP_NOTIFY_DESIGN.md §4 (Fable 2026-10-15 DESIGN-OK).
//
// ★ 다섯 초대 문(멤버 · 워크스페이스 고객 + 재초대 · 프로젝트 고객 + 재발송)이 이 한 벌을 부른다. 베끼면 한쪽만 고쳐진다.
// ★ 범위 — 아직 그 워크스페이스에 없는 사람(멤버·고객 대기)은 business_id NULL 로 저장한다.
//   종 목록(notificationScope)은 «현재 워크스페이스 + NULL» 만 주므로 초대한 워크스페이스 id 로 두면 어느 창에서도 안 보인다.
//   프로젝트 고객(기존 계정)은 초대 순간 이미 그 프로젝트가 열린다(projects.js — 의도) → 그 워크스페이스 · 프로젝트 주소 · 토큰 없음.
// ★ 메일은 초대 메일이 따로 나간다 — skipChannels email + 미읽음 재알림 메일도 끈다(suppressEscalation). 안 그러면 두 통·세 통.
// ★ 토큰은 링크에만 싣는다(제목·본문 금지). 푸시로 Apple/Google 을 지나지만 메일(SMTP)이 이미 같은 토큰을 더 약한 길로 보낸다(Fable 판정).
const { Op } = require('sequelize');

const EVENT_KIND = 'invite';

function wsLabel(biz) { return biz?.brand_name || biz?.name || 'PlanQ'; }

/**
 * @param {object} p
 * @param {string} [p.email]          초대 이메일 — 초대 라우트와 같은 조회(User.findOne({email}))
 * @param {number} [p.userId]         이미 붙은 계정(프로젝트 고객 추가)이면 이것
 * @param {'workspace_member'|'workspace_client'|'project_client_pending'|'project_client_added'} p.kind
 * @param {number} p.businessId       초대한 워크스페이스
 * @param {string} p.entityType       'business_member' | 'client' | 'project_client'
 * @param {number} p.entityId
 * @param {string} [p.token]          대기 초대(수락이 필요한 것)만
 * @param {number} [p.projectId]
 * @param {string} [p.projectName]
 * @param {number} p.actorUserId
 * @param {object} [p.io]
 */
async function notifyExistingInvitee(p) {
  try {
    const { User, Business, Notification } = require('../models');
    let user = null;
    if (p.userId) user = await User.findByPk(p.userId, { attributes: ['id'] });
    else {
      const email = String(p.email || '').trim();
      if (!email) return { sent: false, reason: 'no_email' };
      user = await User.findOne({ where: { email }, attributes: ['id'] });
    }
    if (!user) return { sent: false, reason: 'no_account' };
    if (Number(user.id) === Number(p.actorUserId)) return { sent: false, reason: 'self' };

    // 재초대·재발송 — 같은 초대의 안 읽은 알림이 있으면 새로 만들지 않는다(종에 같은 줄이 쌓인다)
    const dup = await Notification.findOne({
      where: { user_id: user.id, event_kind: EVENT_KIND, entity_type: p.entityType, entity_id: p.entityId, read_at: null },
      attributes: ['id'],
    });
    if (dup) return { sent: false, reason: 'already_unread', userId: user.id };

    const [biz, inviter] = await Promise.all([
      Business.findByPk(p.businessId, { attributes: ['name', 'brand_name'] }),
      User.findByPk(p.actorUserId, { attributes: ['name', 'email'] }),
    ]);
    const ws = wsLabel(biz);
    const who = inviter?.name || inviter?.email || '';
    const proj = p.projectName || '';

    const pending = p.kind !== 'project_client_added';
    if (pending && !p.token) return { sent: false, reason: 'no_token' };

    const TEXT = {
      workspace_member: {
        title: (l) => (l === 'en' ? `Invitation to ${ws}` : `${ws} 워크스페이스 초대`),
        body: (l) => (l === 'en' ? `${who} invited you as a team member. Open to accept.` : `${who} 님이 팀원으로 초대했습니다. 열어서 수락하세요.`),
      },
      workspace_client: {
        title: (l) => (l === 'en' ? `Invitation from ${ws}` : `${ws} 고객 초대`),
        body: (l) => (l === 'en' ? `${who} invited you as a client. Open to accept.` : `${who} 님이 고객으로 초대했습니다. 열어서 수락하세요.`),
      },
      project_client_pending: {
        title: (l) => (l === 'en' ? `Project invitation: ${proj}` : `프로젝트 초대 · ${proj}`),
        body: (l) => (l === 'en' ? `${who} (${ws}) invited you to the project. Open to accept.` : `${who} 님(${ws})이 프로젝트에 초대했습니다. 열어서 수락하세요.`),
      },
      project_client_added: {
        title: (l) => (l === 'en' ? `Added to project: ${proj}` : `프로젝트에 추가됨 · ${proj}`),
        body: (l) => (l === 'en' ? `${who} (${ws}) added you to the project.` : `${who} 님(${ws})이 프로젝트에 추가했습니다.`),
      },
    }[p.kind];
    if (!TEXT) return { sent: false, reason: 'unknown_kind' };

    const { notify } = require('../routes/notifications');
    await notify({
      userId: user.id,
      businessId: pending ? null : p.businessId,
      eventKind: EVENT_KIND,
      title: TEXT.title,
      body: TEXT.body,
      link: pending ? `/invite/${p.token}` : `/projects/p/${p.projectId}`,
      ctaLabel: (l) => (pending ? (l === 'en' ? 'View invitation' : '초대 보기') : (l === 'en' ? 'Open project' : '프로젝트 열기')),
      workspaceName: ws,
      actorUserId: p.actorUserId,
      entityType: p.entityType,
      entityId: p.entityId,
      ioApp: p.io || null,
      skipChannels: ['email'],
      suppressEscalation: true,
    });
    return { sent: true, userId: user.id };
  } catch (e) {
    console.warn('[inviteNotify]', e.message);
    return { sent: false, reason: 'error' };
  }
}

/** 수락·취소·삭제 — 그 초대의 안 읽은 알림을 읽음으로. 누가 수락했든 entity 로 지운다(D3). */
async function dismissInviteNotice(entityType, entityId, opts = {}) {
  if (!entityType || !entityId) return 0;
  try {
    const { Notification } = require('../models');
    const ids = Array.isArray(entityId) ? entityId : [entityId];
    const [n] = await Notification.update(
      { read_at: new Date() },
      { where: { event_kind: EVENT_KIND, entity_type: entityType, entity_id: { [Op.in]: ids }, read_at: null }, transaction: opts.transaction },
    );
    return n;
  } catch (e) {
    console.warn('[inviteNotify dismiss]', e.message);
    return 0;
  }
}

module.exports = { notifyExistingInvitee, dismissInviteNotice };
