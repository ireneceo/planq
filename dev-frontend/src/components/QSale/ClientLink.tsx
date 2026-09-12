// ClientLink — 고객 이름을 **어디서나 같은 방식으로** 여는 문
//
// Irene 2026-09-12: *"고객들 이름 여기 저기 나오면 고객페이지 보기 기능이 있어서 누르면
//   전체보기 형태로 다 보게 해줘."*
//
// ★ 화면마다 손으로 붙이면 반드시 빠뜨리는 곳이 생긴다(실제로 Q project 는 ClientChip 을 따로 만들어
//   갖고 있었다). 이름을 그리는 곳은 이 컴포넌트를 쓴다 — 그러면 새 화면이 생겨도 동작이 따라온다.
//
// 두 가지 방식 중 하나로 연다:
//   · onOpen 을 주면 **우측 패널**(부모가 ClientPanel 을 띄운다) — 목록 안에서 맥락을 잃지 않는다
//   · 안 주면 **전체보기**(/sale/:id) — 패널을 띄울 수 없는 화면(알림·검색 결과 등)의 기본값
//
// ★ 버튼으로 그린다(span+onClick 금지) — 키보드로 닿아야 하고, 스크린리더가 "누를 수 있는 것" 으로 읽어야 한다.
import React, { useCallback } from 'react';
import styled from 'styled-components';
import { useChromeNav } from '../../hooks/useChromeNav';

interface Props {
  clientId: number;
  name: string | null;
  /** 주면 우측 패널로 연다. 없으면 전체보기로 이동 */
  onOpen?: (clientId: number) => void;
  /** 회사 등 보조 문구 — 이름 옆에 흐리게 */
  sub?: string | null;
  className?: string;
}

const ClientLink: React.FC<Props> = ({ clientId, name, onOpen, sub, className }) => {
  const navigate = useChromeNav();
  const label = name || `#${clientId}`;

  const open = useCallback((e: React.MouseEvent) => {
    // 행 전체가 클릭 대상인 목록 안에 있을 수 있다 — 이름 클릭이 행 클릭으로 번지지 않게.
    e.stopPropagation();
    if (onOpen) onOpen(clientId);
    else navigate(`/sale/${clientId}`);
  }, [clientId, onOpen, navigate]);

  return (
    <Btn type="button" className={className} onClick={open}
      data-testid={`client-link-${clientId}`} title={label}>
      <Name>{label}</Name>
      {sub && <Sub>{sub}</Sub>}
    </Btn>
  );
};

export default ClientLink;

const Btn = styled.button`
  display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%;
  padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
  color: inherit; font: inherit;
  &:hover > span:first-child { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; border-radius: 4px; }
`;
const Name = styled.span`
  font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
`;
const Sub = styled.span`font-size: 0.75rem; color: #94A3B8; flex-shrink: 0;`;
