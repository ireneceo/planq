// 사람 이름을 누르면 뜨는 카드 한 벌 — 이메일·직책·소속·프로필·1:1 메시지·명함 보기 (2026-11-16)
//   Irene: «아이디들 클릭하면 이메일, 1:1 메시지 보내기 그리고 명함보기 등 기본 내용 나오게 해줘»
//   UserInfoPopover 는 채팅 발신자에만 붙어 있었다. 명함 드로어는 팝오버가 닫혀도 남아야 해서 부르는 쪽이 들고 있었는데,
//   그 두 상태를 화면마다 베끼지 않게 여기 한 곳에 둔다. 쓰는 곳: const { openPerson, personNode } = usePersonPopover(bizId)
//   → 이름 요소 onClick={(e) => openPerson(userId, e.currentTarget)} · JSX 어딘가에 {personNode}.
import { useCallback, useState } from 'react';
import styled from 'styled-components';
import UserInfoPopover from './UserInfoPopover';
import NameCardViewDrawer from '../NameCard/NameCardViewDrawer';

export function usePersonPopover(businessId: number | null | undefined) {
  const [pop, setPop] = useState<{ userId: number; anchorEl: HTMLElement | null } | null>(null);
  const [cardUserId, setCardUserId] = useState<number | null>(null);
  const openPerson = useCallback((userId: number, anchorEl: HTMLElement | null) => {
    setPop((prev) => (prev && prev.userId === userId ? null : { userId, anchorEl }));
  }, []);
  const biz = Number(businessId || 0);
  const personNode = biz ? (
    <>
      {pop && (
        <UserInfoPopover open userId={pop.userId} businessId={biz} anchorEl={pop.anchorEl}
          onClose={() => setPop(null)} onOpenCard={setCardUserId} />
      )}
      {cardUserId && <NameCardViewDrawer businessId={biz} userId={cardUserId} onClose={() => setCardUserId(null)} />}
    </>
  ) : null;
  return { openPerson, personNode };
}

/** 이름 글자 자리 — 누르면 카드. 모양은 부모 글자 그대로(밑줄은 hover 때만) */
export const PersonNameButton = styled.button`
  all: unset; cursor: pointer; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-radius: 4px;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
