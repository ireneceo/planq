// 팝아웃 «직접 추가 · 보기 설정» 접기 — 퀵애드와 보기 기준·정렬·완료 가리기 줄을 한 번에 접는다.
//
//   Irene 2026-10-12: *"Cue에게 말하기가 있으니까 그 아래 업무추가 영역이랑 필터영역은 접어두면 어때?
//   항상 설정한대로 쓸 확률이 높으니까 접었다 열었다 하면 될 것 같아."*
//   ★ 기본은 접힘. 접혀 있어도 **지금 설정이 무엇인지는 줄에 적는다**(태그별 · 직접 정렬 · 완료 가림) —
//     안 보이는 필터가 목록을 거르고 있으면 «업무가 없어졌다» 로 읽힌다.
//   열림 여부는 창마다가 아니라 사람마다(이 브라우저) 기억한다.
import React, { useEffect, useId, useState } from 'react';
import styled from 'styled-components';

const KEY = 'planq:taskPopout:toolsOpen';

interface Props {
  label: string;
  /** 접혀 있을 때 오른쪽에 보일 지금 설정 요약 */
  summary: string;
  children: React.ReactNode;
}

const PopoutToolsFold: React.FC<Props> = ({ label, summary, children }) => {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0'); } catch { /* ignore */ } }, [open]);
  const bodyId = useId();
  return (
    <>
      <Bar>
        <Toggle type="button" data-testid="task-popout-tools-toggle" aria-expanded={open} aria-controls={bodyId}
          $open={open} onClick={() => setOpen((v) => !v)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
          <Label>{label}</Label>
          {!open && summary && <Summary data-testid="task-popout-tools-summary">{summary}</Summary>}
        </Toggle>
      </Bar>
      {open && <div id={bodyId} data-testid="task-popout-tools">{children}</div>}
    </>
  );
};

// 좌우 12px — Cue 칸·보기 칩·목록과 같은 축.
const Bar = styled.div`padding:6px 12px 0;flex-shrink:0;`;
const Toggle = styled.button<{ $open: boolean }>`
  width:100%;height:32px;padding:0 6px;
  display:flex;align-items:center;gap:6px;min-width:0;
  border:none;border-radius:8px;background:transparent;cursor:pointer;font-family:inherit;
  color:#64748B;font-size:0.75rem;font-weight:600;text-align:left;
  svg{flex-shrink:0;transition:transform 0.15s;transform:rotate(${p => (p.$open ? 90 : 0)}deg);}
  &:hover{background:#F1F5F9;color:#0F172A;}
  &:focus-visible{outline:2px solid rgba(15,118,110,0.5);outline-offset:2px;}
`;
const Label = styled.span`flex-shrink:0;white-space:nowrap;`;
const Summary = styled.span`
  margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-weight:500;color:#94A3B8;
`;

export default PopoutToolsFold;
