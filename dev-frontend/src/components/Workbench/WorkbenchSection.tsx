// 작업대 섹션 — Q Talk 우측 패널 · Q Mail 맥락 패널 공통 골격.
//
// 두 화면은 PlanQ 의 유일한 소통 창구(채팅·메일)다. 같은 일을 하는 패널이 서로 다른 모양이면
// 사용자는 화면마다 새로 배운다. 섹션의 접힘·카운트·헤더 액션을 여기 하나로 고정한다.
import { useState, type ReactNode } from 'react';
import styled from 'styled-components';

interface Props {
  title: string;
  count?: number;
  /** 헤더 우측 액션 (AI 버튼 등) */
  action?: ReactNode;
  /** 처음에 펼쳐 둘지 — 보통 "내용이 있으면 펼침" */
  defaultOpen?: boolean;
  /** 접기 없이 항상 열린 섹션 (예: 한 줄 등록) */
  static?: boolean;
  children: ReactNode;
}

export default function WorkbenchSection({
  title, count, action, defaultOpen = true, static: isStatic, children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = isStatic ? true : open;

  return (
    <Section>
      <Head>
        {isStatic ? (
          <TitleStatic>{title}</TitleStatic>
        ) : (
          <TitleBtn type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded}>
            <Chevron $open={expanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </Chevron>
            {title}
            {typeof count === 'number' && count > 0 && <Count>{count}</Count>}
          </TitleBtn>
        )}
        {action && <Action onClick={(e) => e.stopPropagation()}>{action}</Action>}
      </Head>
      {expanded && <Body>{children}</Body>}
    </Section>
  );
}

const Section = styled.section`
  display: flex; flex-direction: column;
  padding: 12px 0;
  border-bottom: 1px solid #F1F5F9;
  &:last-of-type { border-bottom: none; }
`;
const Head = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 28px;
`;
const TitleBtn = styled.button`
  display: flex; align-items: center; gap: 6px;
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
  &:hover { color: #0D9488; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 3px; border-radius: 4px; }
`;
const TitleStatic = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
`;
const Chevron = styled.svg<{ $open: boolean }>`
  width: 13px; height: 13px; flex-shrink: 0; color: #94A3B8;
  transform: rotate(${(p) => (p.$open ? 90 : 0)}deg);
  transition: transform 0.15s ease;
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;
const Count = styled.span`
  padding: 1px 7px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #0F766E; background: #F0FDFA;
`;
const Action = styled.div`display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const Body = styled.div`display: flex; flex-direction: column; gap: 8px; padding-top: 10px;`;
