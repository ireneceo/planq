// 운영 #338 — "문서에 목차 추가하는 기능이 가능할까? 노션처럼. 상단에 목차. 긴 페이지물 같은 것도"
//
// 설계 원칙: **목차는 저장하지 않고 본문에서 파생한다.**
//   문서 안에 목차 블록을 넣어 두면 (a) 제목을 고칠 때마다 목차가 낡고 (b) 이미 있는 문서 전부에
//   블록을 심는 마이그레이션이 필요하고 (c) 목차 자체를 사람이 잘못 지울 수 있다.
//   본문에서 매번 뽑으면 셋 다 사라진다 — 옛 문서에서도 즉시 동작한다.
//
// 이동은 렌더된 제목 DOM 을 **문서 순서 index** 로 찾는다. 제목 텍스트로 찾으면 같은 제목이
//   두 번 나오는 문서(“개요”가 장마다 있는 문서)에서 첫 번째로만 가버린다.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Heading { level: number; text: string; index: number }

interface Props {
  /** TipTap content JSON (문서 본문) */
  content: unknown;
  /** 본문이 렌더된 컨테이너 — 여기서 h1~h3 을 찾아 이동한다 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 목차를 띄울 최소 제목 수 (기본 2 — 하나뿐이면 목차가 의미 없다) */
  minHeadings?: number;
}

type TipTapNode = { type?: string; attrs?: { level?: number }; content?: TipTapNode[]; text?: string };

function nodeText(n: TipTapNode): string {
  if (typeof n.text === 'string') return n.text;
  return (n.content || []).map(nodeText).join('');
}

export function extractHeadings(content: unknown): Heading[] {
  const root = content as TipTapNode | null;
  if (!root || !Array.isArray(root.content)) return [];
  const out: Heading[] = [];
  let index = 0;
  // 최상위만 훑는다 — 제목은 문서 최상위 블록이다(표·인용 안의 제목은 목차 대상이 아니다).
  //   렌더 쪽 querySelectorAll('h1,h2,h3') 과 순서·개수가 어긋나면 엉뚱한 곳으로 이동하므로
  //   두 집합의 정의를 같게 유지하는 것이 핵심이다.
  for (const n of root.content) {
    if (n?.type !== 'heading') continue;
    const text = nodeText(n).trim();
    if (!text) { index += 1; continue; }   // 빈 제목도 DOM 에는 있다 — index 는 반드시 같이 센다
    out.push({ level: Number(n.attrs?.level) || 1, text, index });
    index += 1;
  }
  return out;
}

const DocToc: React.FC<Props> = ({ content, containerRef, minHeadings = 2 }) => {
  const { t } = useTranslation('qdocs');
  const [open, setOpen] = useState(true);
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length < minHeadings) return null;

  const go = (index: number) => {
    const el = containerRef.current?.querySelectorAll('h1, h2, h3')[index] as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Box>
      <Head type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <Chevron $open={open} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </Chevron>
        {t('toc.title', { defaultValue: '목차' }) as string}
        <Count>{headings.length}</Count>
      </Head>
      {open && (
        <List>
          {headings.map((h) => (
            <Row key={h.index} type="button" $level={h.level} onClick={() => go(h.index)} title={h.text}>
              {h.text}
            </Row>
          ))}
        </List>
      )}
    </Box>
  );
};

export default DocToc;

const Box = styled.nav`
  margin: 0 0 14px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const Head = styled.button`
  display: flex; align-items: center; gap: 6px; width: 100%;
  background: transparent; border: none; padding: 2px 0; cursor: pointer;
  font-size: 12px; font-weight: 700; color: #475569;
`;
const Chevron = styled.svg<{ $open: boolean }>`
  width: 14px; height: 14px; color: #94A3B8; flex-shrink: 0;
  transition: transform 0.15s; transform: rotate(${p => (p.$open ? 0 : -90)}deg);
`;
const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; margin-left: 2px;
  background: #E2E8F0; color: #64748B; border-radius: 8px; font-size: 10px; font-weight: 700;
`;
const List = styled.div` display: flex; flex-direction: column; margin-top: 6px; `;
const Row = styled.button<{ $level: number }>`
  display: block; width: 100%; text-align: left;
  padding: 4px 6px 4px ${p => 6 + (p.$level - 1) * 14}px;
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  font-size: ${p => (p.$level === 1 ? 13 : 12)}px;
  font-weight: ${p => (p.$level === 1 ? 600 : 500)};
  color: ${p => (p.$level === 1 ? '#334155' : '#64748B')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { background: #E2E8F0; color: #0F172A; }
`;
