// 채팅의 «고객 정보·멤버 정보» 카드 한 장 — 설계 docs/CHAT_PROFILE_CARDS_DESIGN.md (Fable 2026-11-25)
//   메시지에는 id 만 있다. 이름·연락처는 볼 때 서버가 **보는 사람 권한으로** 다시 준다(권한 없으면 이름도 없다).
//   누르면 내부 상세를 새 탭으로(대화를 잃지 않게) — 고객 /sale/:id · 멤버 /business/members?member=:userId.
//   상태는 셋 다 보이게 그린다(ok / no_permission / not_available) — 모르는 값을 기본값으로 떨어뜨리지 않는다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { tabStore } from '../../stores/tabStore';
import {
  getProfileCard, type ProfileCardKind, type ProfileCardResolved, type ClientProfileView, type MemberProfileView,
} from '../../services/profileCards';
import { SharedCard, SharedCardIcon, DocCardBody, DocCardTitle, DocCardLabel, DocCardArrow } from './chatCardShell';

interface Props { businessId: number; kind: ProfileCardKind; targetId: number }

const ProfileCardBubble: React.FC<Props> = ({ businessId, kind, targetId }) => {
  const { t, i18n } = useTranslation('qtalk');
  const [res, setRes] = useState<ProfileCardResolved | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRes(null); setFailed(false);
    getProfileCard(businessId, kind, targetId)
      .then((r) => { if (alive) setRes(r); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [businessId, kind, targetId]);

  const kindLabel = kind === 'client' ? t('chat.profile.clientLabel', '고객 정보') : t('chat.profile.memberLabel', '멤버 정보');
  const en = (i18n.language || '').startsWith('en');

  let title: string;
  let sub: string | null = null;
  let contact: string | null = null;
  let open: (() => void) | null = null;
  const state = failed ? 'load_failed' : res ? res.state : 'loading';
  if (state === 'ok' && res?.view) {
    if (kind === 'client') {
      const v = res.view as ClientProfileView;
      title = v.name || v.company || t('chat.profile.noName', '(이름 없음)');
      sub = [v.company && v.company !== title ? v.company : null, v.job_title, v.department].filter(Boolean).join(' · ') || null;
      contact = [v.phone, v.email, v.assigned_member ? t('chat.profile.assigned', { name: v.assigned_member.name, defaultValue: '담당 {{name}}' }) : null].filter(Boolean).join(' · ') || null;
      open = () => tabStore.openInNewTab(`/sale/${v.id}`);
    } else {
      const v = res.view as MemberProfileView;
      title = v.name || t('chat.profile.noName', '(이름 없음)');
      const unit = v.team ? (en && v.team.name_en ? v.team.name_en : v.team.name) : v.department ? (en && v.department.name_en ? v.department.name_en : v.department.name) : v.organization;
      sub = [v.job_title, unit].filter(Boolean).join(' · ') || null;
      contact = [v.phone, v.email].filter(Boolean).join(' · ') || null;
      open = () => tabStore.openInNewTab(`/business/members?member=${v.user_id}`);
    }
  } else if (state === 'no_permission') {
    title = kind === 'client' ? t('chat.profile.noPermissionClient', '볼 권한이 없는 고객 정보') : t('chat.profile.noPermissionMember', '볼 권한이 없는 멤버 정보');
  } else if (state === 'not_available') {
    title = t('chat.profile.notAvailable', '지금은 볼 수 없는 정보 (삭제·보관·퇴사)');
  } else if (state === 'load_failed') {
    title = t('chat.profile.loadFailed', '정보를 불러오지 못했어요');
  } else {
    title = '…';
  }

  return (
    <SharedCard type="button" data-testid={`chat-profile-card-${kind}`} data-state={state} disabled={!open}
      aria-busy={state === 'loading' ? true : undefined}
      onClick={() => { if (open) open(); }}>
      <SharedCardIcon $tone={kind === 'client' ? 'kb' : 'task'}>
        {kind === 'client' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 21V7l9-4 9 4v14" /><path d="M9 21v-6h6v6" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
        )}
      </SharedCardIcon>
      <DocCardBody>
        <DocCardTitle>{title}</DocCardTitle>
        <DocCardLabel>{kindLabel}{sub && <> · {sub}</>}</DocCardLabel>
        {contact && <Contact>{contact}</Contact>}
      </DocCardBody>
      {open && (
        <DocCardArrow>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 18 15 12 9 6" /></svg>
        </DocCardArrow>
      )}
    </SharedCard>
  );
};

const Contact = styled.span`
  font-size: 0.6875rem; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;

export default ProfileCardBubble;
