// [1:1 메시지] — 그 멤버와 둘만의 대화방을 새 탭으로(있으면 그 방 · 서버 POST /api/conversations/:biz/direct).
//   2026-11-16 Irene «아이디들 클릭하면 이메일, 1:1 메시지 보내기 그리고 명함보기». 멤버 상세 드로어가 쓴다(팝오버는 같은 함수를 직접 부른다).
//   보이는 조건 = 서버 판정과 같은 선: 나도 상대도 워크스페이스 사람 멤버(owner·admin·member), 내가 아님.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { openDirectConversation } from '../../services/qtalk';
import { tabStore } from '../../stores/tabStore';

interface Props { businessId: number; userId: number; targetRole?: string | null }

export default function DirectMessageButton({ businessId, userId, targetRole }: Props) {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const people = ['owner', 'admin', 'member'];
  if (!people.includes(String(user?.business_role || '')) || Number(user?.id) === Number(userId)) return null;
  if (targetRole && !people.includes(targetRole)) return null;
  const go = async () => {
    if (busy) return;
    setBusy(true); setFailed(false);
    try {
      const conv = await openDirectConversation(businessId, userId);
      tabStore.openInNewTab(`/talk?conv=${conv.id}`);
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  return (
    <Btn type="button" onClick={() => void go()} disabled={busy} data-testid={`member-dm-btn-${userId}`}
      title={failed ? t('userInfo.dmFailed', '1:1 대화를 열지 못했어요') as string : undefined} $failed={failed}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      {failed ? t('userInfo.dmFailed', '1:1 대화를 열지 못했어요') : t('userInfo.directMessage', '1:1 메시지')}
    </Btn>
  );
}

// 명함 보기 버튼(NameCard MemberCardButton)과 같은 모양
const Btn = styled.button<{ $failed?: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid #E2E8F0; background: #FFFFFF; color: ${(p) => (p.$failed ? '#B91C1C' : '#0F766E')};
  font-size: 0.75rem; font-weight: 600; cursor: pointer; flex-shrink: 0;
  &:hover:not(:disabled) { border-color: #14B8A6; background: #F0FDFA; }
  &:disabled { opacity: 0.6; cursor: default; }
  @media (max-width: 640px) { min-height: 36px; }
`;
