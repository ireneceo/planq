// 채팅 «+» → [고객·멤버 정보 보내기] 고르기 창. 설계 docs/CHAT_PROFILE_CARDS_DESIGN.md (Fable 2026-11-25)
//   팀 방에서만 열린다(+ 메뉴가 서버 판정 profile-card-room 으로 막는다 — 고객 방은 명함으로).
//   목록 API 를 새로 만들지 않는다 — 고객은 Q sale 목록(같은 권한 사슬), 멤버는 /members.
//   고르면 한 번에 보낸다(중복 제출 가드). 카드에는 id 만 실리고 이름·연락처는 보는 사람 권한으로 다시 읽힌다.
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import LetterAvatar from '../../components/Common/LetterAvatar';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { listSaleClients, type SaleClient } from '../../services/sale';
import { listMembers, type WorkspaceMember } from '../../services/workspace';
import { sendProfileCard, type ProfileCardKind } from '../../services/profileCards';

interface Props {
  open: boolean; onClose: () => void; businessId: number; conversationId: number;
  /** Q sale 읽기 권한이 있으면 고객 탭이 보인다 */
  canSendClient: boolean;
}

const SendProfileCardModal: React.FC<Props> = ({ open, onClose, businessId, conversationId, canSendClient }) => {
  const { t } = useTranslation('qtalk');
  const [tab, setTab] = useState<ProfileCardKind>(canSendClient ? 'client' : 'member');
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<SaleClient[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setTab(canSendClient ? 'client' : 'member'); setQ(''); setErr(null); } }, [open, canSendClient]);

  // 고객 — 서버 검색(목록이 클 수 있다). 300ms 기다렸다 묻는다.
  useEffect(() => {
    if (!open || tab !== 'client' || !canSendClient) return undefined;
    let alive = true;
    const h = window.setTimeout(() => {
      listSaleClients(businessId, { q: q.trim() || undefined, status: 'active', limit: 50 })
        .then((r) => { if (alive) setClients(r.items); })
        .catch(() => { if (alive) { setClients([]); setErr(t('chat.profile.loadListFailed', '목록을 불러오지 못했어요') as string); } });
    }, 300);
    return () => { alive = false; window.clearTimeout(h); };
  }, [open, tab, q, businessId, canSendClient, t]);

  useEffect(() => {
    if (!open || tab !== 'member' || members) return undefined;
    let alive = true;
    listMembers(businessId)
      .then((rows) => { if (alive) setMembers(rows); })
      .catch(() => { if (alive) { setMembers([]); setErr(t('chat.profile.loadListFailed', '목록을 불러오지 못했어요') as string); } });
    return () => { alive = false; };
  }, [open, tab, businessId, members, t]);

  const memberRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (members || [])
      .filter((m) => m.user_id && m.role !== 'ai' && m.user && !m.user.is_ai)
      .map((m) => ({ id: Number(m.user_id), name: m.user?.display_name || m.user?.name || '', sub: [m.job_title || m.user?.job_title, m.team?.name || m.department?.name].filter(Boolean).join(' · ') }))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.sub.toLowerCase().includes(needle));
  }, [members, q]);

  const send = async (type: ProfileCardKind, id: number) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await sendProfileCard(businessId, conversationId, type, id); onClose(); }
    catch (e) {
      const code = (e as { code?: string })?.code;
      setErr(code === 'room_has_external'
        ? t('chat.profile.roomExternal', '고객·게스트가 있는 방에는 보낼 수 없어요. 사람을 소개하려면 명함을 보내세요.') as string
        : t('chat.profile.sendFailed', '보내지 못했어요. 다시 시도해 주세요.') as string);
    } finally { setBusy(false); }
  };

  const list = tab === 'client'
    ? (clients || []).map((c) => ({ id: c.id, name: c.display_name || c.company_name || '', sub: [c.company_name !== c.display_name ? c.company_name : null, c.job_title].filter(Boolean).join(' · ') }))
    : memberRows;
  const loading = tab === 'client' ? clients === null : members === null;

  return (
    <StandardModal open={open} onClose={onClose} title={t('chat.profile.sendTitle', '고객·멤버 정보 보내기')} size="sm">
      <Hint>{t('chat.profile.sendHint', '이 팀 방에 정보 카드를 보냅니다. 받은 사람은 자기 권한으로 보이는 만큼만 봅니다.')}</Hint>
      <Bar>
        {canSendClient && (
          <SegmentedToggle role="tablist">
            <SegmentedBtn type="button" role="tab" aria-selected={tab === 'client'} $active={tab === 'client'} onClick={() => setTab('client')} data-testid="send-profile-tab-client">{t('chat.profile.tabClient', '고객')}</SegmentedBtn>
            <SegmentedBtn type="button" role="tab" aria-selected={tab === 'member'} $active={tab === 'member'} onClick={() => setTab('member')} data-testid="send-profile-tab-member">{t('chat.profile.tabMember', '멤버')}</SegmentedBtn>
          </SegmentedToggle>
        )}
        <Search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chat.profile.search', '이름·회사로 찾기') as string} aria-label={t('chat.profile.search', '이름·회사로 찾기') as string} data-testid="send-profile-search" />
      </Bar>
      {loading && <Muted aria-busy="true">…</Muted>}
      {!loading && list.length === 0 && <Muted data-testid="send-profile-empty">{t('chat.profile.empty', '찾는 사람이 없어요')}</Muted>}
      <Rows>
        {list.map((r) => (
          <Row key={`${tab}${r.id}`} type="button" disabled={busy} onClick={() => void send(tab, r.id)} data-testid={`send-profile-${tab}-${r.id}`}>
            <LetterAvatar name={r.name} size={32} />
            <Main><Name>{r.name || t('chat.profile.noName', '(이름 없음)')}</Name>{r.sub && <Sub>{r.sub}</Sub>}</Main>
          </Row>
        ))}
      </Rows>
      {err && <Err role="alert">{err}</Err>}
    </StandardModal>
  );
};
export default SendProfileCardModal;

const Hint = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.5; margin-bottom: 12px;`;
const Bar = styled.div`display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;`;
const Search = styled.input`
  flex: 1; min-width: 160px; height: 36px; box-sizing: border-box; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 1rem; color: #0F172A; background: #FFFFFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.2); }
`;
const Muted = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 8px 0;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C; margin-top: 8px;`;
const Rows = styled.div`display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow-y: auto;`;
const Row = styled.button`
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 6px 10px; box-sizing: border-box;
  border: 1px solid #E2E8F0; border-radius: 10px; background: #FFFFFF; text-align: left; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; background: #F0FDFA; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const Main = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Name = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const Sub = styled.div`font-size: 0.75rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
