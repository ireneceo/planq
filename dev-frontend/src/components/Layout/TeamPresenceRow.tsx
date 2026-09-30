// 사이드바 근태 카드 아래 «팀 N명 근무 중» 한 줄 → 누르면 멤버·오늘 상태 목록 (2026-09-30, 운영 #429)
//   결정: 멤버 전원이 서로의 **상태만** 본다(시각·기록 없음) · 고객에게는 이 줄 자체가 없다.
//   상태는 useTeamPresence 한 저장소 — 채팅 이름 옆 점과 같은 값이다(따로 세면 갈라진다).
//   ★ 목록은 body 로 포털한다 — 사이드바가 transform(폰 슬라이드)을 가져 fixed 가 사이드바 기준이 된다.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useTeamPresence, PRESENCE_DOT, type PresenceState } from '../../hooks/useTeamPresence';
import { listMembers, type WorkspaceMember } from '../../services/workspace';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import LetterAvatar from '../Common/LetterAvatar';

const ORDER: Record<PresenceState, number> = { working: 0, on_break: 1, leave: 2, done: 3, none: 4 };

function memberName(m: WorkspaceMember, lang: string): string {
  const u = m.user;
  if (!u) return m.invite_email || '';
  return (u.display_name_localized && u.display_name_localized[lang]) || u.display_name || u.name || u.email || '';
}

const TeamPresenceRow: React.FC = () => {
  const { t, i18n } = useTranslation('attendance');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const bizId = (!isClient && user?.business_id) ? Number(user.business_id) : null;
  const presence = useTeamPresence(bizId);
  const myId = user?.id ? Number(user.id) : 0;
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 이름은 열 때만 읽는다 — 줄 하나 때문에 모든 화면에서 멤버 목록을 부르지 않는다
  useEffect(() => {
    if (!open || !bizId) return;
    let alive = true;
    listMembers(bizId).then((rows) => { if (alive) setMembers(rows); }).catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, [open, bizId]);
  useEffect(() => { setMembers(null); setOpen(false); }, [bizId]);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, bottom: Math.max(8, window.innerHeight - r.top + 6), width });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const tgt = e.target as Node;
      if (popRef.current?.contains(tgt) || btnRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);
  useEscapeStack(open, () => setOpen(false));

  if (!bizId || presence.forbidden || !presence.loaded) return null;

  const others = (members || [])
    .filter((m) => m.user_id && m.role !== 'ai' && !(m.user && m.user.is_ai) && Number(m.user_id) !== myId)
    .map((m) => ({ m, st: (presence.map.get(Number(m.user_id))?.state || 'none') as PresenceState }))
    .sort((a, b) => ORDER[a.st] - ORDER[b.st] || memberName(a.m, i18n.language).localeCompare(memberName(b.m, i18n.language)));
  // 한 줄의 숫자는 저장소에서 바로 센다(이름을 읽기 전에도 보인다). 나는 뺀다 — 동료 현황이다.
  const working = Array.from(presence.map.entries())
    .filter(([uid, p]) => uid !== myId && (p.state === 'working' || p.state === 'on_break')).length;

  return (
    <>
      <Row ref={btnRef} type="button" data-testid="sidebar-team-presence" aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}>
        <Dot style={{ background: working > 0 ? PRESENCE_DOT.working : PRESENCE_DOT.none }} aria-hidden="true" />
        <span>{t('presence.summary', { count: working, defaultValue: '팀 {{count}}명 근무 중' }) as string}</span>
      </Row>
      {open && pos && createPortal(
        <Pop ref={popRef} role="dialog" aria-label={t('presence.title', '오늘 팀 상태') as string}
          data-testid="team-presence-popover"
          style={{ left: pos.left, bottom: pos.bottom, width: pos.width }}>
          <PopHead>
            <PopTitle>{t('presence.title', '오늘 팀 상태')}</PopTitle>
            <PopHint>{t('presence.hint', '상태만 보입니다')}</PopHint>
          </PopHead>
          <List>
            {members === null && <Empty>{t('presence.loading', '불러오는 중…')}</Empty>}
            {members !== null && others.length === 0 && <Empty>{t('presence.empty', '다른 멤버가 없습니다')}</Empty>}
            {others.map(({ m, st }) => (
              <Item key={m.id} data-testid="team-presence-item">
                <LetterAvatar name={memberName(m, i18n.language)} src={m.user?.avatar_url || undefined} size={24} />
                <Name>{memberName(m, i18n.language)}</Name>
                <St><Dot style={{ background: PRESENCE_DOT[st] }} aria-hidden="true" />{t(`state.${st}`) as string}</St>
              </Item>
            ))}
          </List>
        </Pop>,
        document.body,
      )}
    </>
  );
};

export default TeamPresenceRow;

const Row = styled.button`
  display: flex; align-items: center; gap: 6px;
  width: 100%; min-height: 32px; padding: 6px 8px; margin: 0 0 4px; border-radius: 8px;
  background: transparent; border: 1px solid transparent; cursor: pointer;
  color: rgba(255, 255, 255, 0.72); font-size: 0.75rem; font-weight: 500; text-align: left;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  &:focus-visible { outline: none; border-color: rgba(255, 255, 255, 0.3); }
  @media (max-width: 1024px) { min-height: 40px; }
`;
const Dot = styled.span`width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; display: inline-block;`;
const Pop = styled.div`
  position: fixed; z-index: 1100; max-height: min(60vh, 420px);
  display: flex; flex-direction: column;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18); overflow: hidden;
`;
const PopHead = styled.div`padding: 12px 14px 8px; border-bottom: 1px solid #F1F5F9;`;
const PopTitle = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const PopHint = styled.div`font-size: 0.75rem; color: #94A3B8; margin-top: 2px;`;
const List = styled.div`overflow-y: auto; padding: 4px;`;
const Empty = styled.div`padding: 20px 12px; text-align: center; font-size: 0.8125rem; color: #94A3B8;`;
const Item = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; min-height: 36px;
`;
const Name = styled.span`flex: 1; min-width: 0; font-size: 0.8125rem; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const St = styled.span`display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; color: #475569; flex-shrink: 0;`;
