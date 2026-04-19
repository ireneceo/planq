// SlashCommand 팝업 리스트 — 화살표/엔터로 선택
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import styled from 'styled-components';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { SlashItem } from './SlashCommand';

const SlashCommandList = forwardRef<unknown, SuggestionProps<SlashItem>>((props, ref) => {
  const { items, command } = props;
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [items]);

  const selectItem = (i: number) => {
    const it = items[i];
    if (it) command(it);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setIndex((prev) => (prev + items.length - 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === 'ArrowDown') {
        setIndex((prev) => (prev + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(index);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return <Panel><Empty>명령 없음</Empty></Panel>;

  return (
    <Panel>
      {items.map((it, i) => (
        <Item key={it.title} $active={i === index}
          onMouseEnter={() => setIndex(i)}
          onClick={() => selectItem(i)}>
          <Icon>{it.icon || '·'}</Icon>
          <Meta>
            <Title>{it.title}</Title>
            {it.description && <Desc>{it.description}</Desc>}
          </Meta>
        </Item>
      ))}
    </Panel>
  );
});
SlashCommandList.displayName = 'SlashCommandList';
export default SlashCommandList;

const Panel = styled.div`
  background:#FFF;border:1px solid #E2E8F0;border-radius:10px;
  box-shadow:0 8px 24px rgba(15,23,42,0.12);
  padding:4px;min-width:240px;max-height:300px;overflow-y:auto;
`;
const Item = styled.div<{$active?:boolean}>`
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?'#F0FDFA':'transparent'};
  &:hover{background:#F0FDFA;}
`;
const Icon = styled.div`
  width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;border-radius:6px;flex-shrink:0;
`;
const Meta = styled.div`display:flex;flex-direction:column;gap:1px;min-width:0;`;
const Title = styled.span`font-size:13px;font-weight:600;color:#0F172A;`;
const Desc = styled.span`font-size:11px;color:#94A3B8;`;
const Empty = styled.div`padding:10px;font-size:12px;color:#94A3B8;`;
