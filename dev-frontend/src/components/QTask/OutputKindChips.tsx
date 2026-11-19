// 업무 «산출물» 읽기 전용 칩 줄 (docs/TASK_DELIVERABLES_DESIGN.md §6.1). 빈 배열이면 아무것도 그리지 않는다.
//   무채색 — 태그(색 있음)와 섞여 보이지 않게.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { labelOf, type OutputKindLite } from './outputKindLabel';

interface Props { items?: OutputKindLite[] | null; testId?: string }

const OutputKindChips: React.FC<Props> = ({ items, testId }) => {
  const { i18n } = useTranslation();
  if (!items || items.length === 0) return null;
  return (
    <Wrap data-testid={testId}>
      {items.map((k) => { const l = labelOf(k, i18n.language); return <Chip key={k.id} title={l}>{l}</Chip>; })}
    </Wrap>
  );
};

export default OutputKindChips;

/** 결과물 칸 머리의 «만들 산출물» 읽기 줄 — 담당자가 결과물을 쓰는 자리에서 무엇을 내야 하는지 본다. 비면 그리지 않는다. */
export const ToProduceLine: React.FC<{ items?: OutputKindLite[] | null }> = ({ items }) => {
  const { t } = useTranslation('qtask');
  if (!items || items.length === 0) return null;
  return (
    <Line data-testid="task-output-kinds-to-produce">
      <LineLabel>{t('outputs.toProduce', '만들 산출물')}</LineLabel>
      <OutputKindChips items={items} />
    </Line>
  );
};

const Wrap = styled.div`display:flex;flex-wrap:wrap;gap:4px;min-width:0;`;
const Chip = styled.span`
  display:inline-flex;align-items:center;max-width:100%;padding:2px 8px;line-height:1.4;border-radius:11px;
  background:#F1F5F9;border:1px solid #E2E8F0;color:#334155;font-size:0.75rem;font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
`;
const Line = styled.div`display:flex;align-items:center;gap:8px;margin:0 0 8px;min-width:0;flex-wrap:wrap;`;
const LineLabel = styled.span`font-size:0.6875rem;font-weight:600;color:#64748B;flex-shrink:0;`;
