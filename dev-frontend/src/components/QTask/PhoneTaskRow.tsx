// 폰(≤640) Q task 목록 행 — 「오늘 내 업무」 팝아웃 행을 그대로 가져다 쓴다(2026-11-06 Irene
//   «Q task 메뉴만 모바일에서 보는데 체크박스 작거나 해서 불편해. 팝아웃 오늘의 업무처럼 두가지 보기 버전 두고»).
//
// 왜 새 파일인가 — 옛 폰 목록은 데스크탑 표 행(TRow+TCell)을 접어 썼다. 체크가 15px 네이티브 상자라 손가락으로
//   못 눌렀고, 표 칸을 숨기는 규칙으로 두 줄을 흉내 내서 카드/한 줄 보기를 넣을 자리가 없었다.
//   모양은 새로 그리지 않는다 — 팝아웃 styled(Row·RowMain·Badge·StatusDot·MetaDue…)와 퀵액션(PopoutQuickAction,
//   판정 quickActionFor)을 그대로 쓰고, 폰 터치 규격(40px)·한 줄 보기만 여기서 덮는다.
//   QTaskPage 가 이미 god-file 이라 행 모양은 여기, 판정·동작(완료·상세 열기)은 QTaskPage 의 기존 함수를 받는다.
import React from 'react';
import styled, { css } from 'styled-components';
import PopoutQuickAction from './PopoutQuickAction';
import type { QuickAction } from './popoutQuickAction';
import { COMPACT_TEXT_CODES } from './usePopoutDensity';
import {
  Row, RowInner, RowLead, RowMain, RowTop, RowTitle, RowMeta, MetaChip, MetaDue,
  Badge, StatusDot, Slot, CheckBtn, SubmitBtn, PrioChip,
} from './TaskPopoutView.styles';
import TagChips, { type TaskTagLite } from './TagChips';
import ImportanceChip, { type PriorityLevel } from './ImportanceChip';

export interface PhoneTaskRowProps {
  taskId: number;
  title: string;
  /** 표시 상태 코드(displayStatus) — 한 줄 보기에서 글자를 남길지 가른다 */
  statusCode: string;
  statusLabel: React.ReactNode;
  statusPlain: string;
  color: { bg: string; fg: string };
  compact: boolean;
  qa: QuickAction;
  /** 보류·외부컨펌 — 완료로 못 간다(QTaskPage completeBlocked). 체크는 보이되 누를 수 없다 */
  completeBlocked: boolean;
  completeBlockedHint: string;
  done: boolean;
  selected: boolean;
  delayed: boolean;
  unread: boolean;
  unreadHint: string;
  prioNum?: number | null;
  priorityLevel?: PriorityLevel;
  projectName?: string | null;
  dueText?: string | null;
  overdueText?: string | null;
  tags?: TaskTagLite[] | null;
  /** 요청자/담당자·이월·반복·담당자 이름(전체 업무) 같은 작은 칩 — QTaskPage 가 기존 칩을 그대로 넘긴다 */
  extra?: React.ReactNode;
  /** 시간 측정 버튼(보일 때만) */
  trailing?: React.ReactNode;
  onAction: (action: 'complete' | 'revert-status') => void;
  onOpen: () => void;
}

const PhoneTaskRow: React.FC<PhoneTaskRowProps> = (p) => {
  const dot = p.compact && !COMPACT_TEXT_CODES.has(p.statusCode);
  // 보류·외부컨펌 중 완료 체크 — 팝아웃 퀵액션은 이 막기를 모른다(팝아웃엔 그 상태가 거의 안 온다).
  //   목록의 종전 동작(체크 비활성 + 이유)을 지킨다.
  const lead = p.qa === 'complete' && p.completeBlocked
    ? <CheckBtn type="button" role="checkbox" aria-checked={false} disabled data-testid="task-row-check"
        aria-label={p.completeBlockedHint} title={p.completeBlockedHint} />
    : <PopoutQuickAction taskId={p.taskId} qa={p.qa} busy={false}
        onAction={(_id, action) => p.onAction(action)} onOpenDetail={() => p.onOpen()} />;
  return (
    <PRow role="listitem" data-task-row data-qtask-row={p.taskId} data-row-id={p.taskId}
      data-testid="qtask-phone-row" data-density={p.compact ? 'compact' : 'card'}
      $active={p.selected} $dim={p.done} $compact={p.compact} $delayed={p.delayed && !p.done}>
      <RowInner>
        <RowLead data-testid="qtask-phone-lead">{lead}</RowLead>
        <RowMain type="button" data-testid="task-row-title" title={p.title} onClick={p.onOpen}>
          <RowTop>
            {p.unread && <Unread role="img" aria-label={p.unreadHint} title={p.unreadHint} />}
            {!!p.prioNum && <PrioChip $dim={p.done}>{p.prioNum}</PrioChip>}
            {dot
              ? <StatusDot $bg={p.color.bg} $fg={p.color.fg} role="img" aria-label={p.statusPlain} title={p.statusPlain} />
              : <Badge $bg={p.color.bg} $fg={p.color.fg} data-testid="qtask-phone-status">{p.statusLabel}</Badge>}
            <RowTitle data-row-title="">{p.title}</RowTitle>
            <ImportanceChip level={p.priorityLevel} />
          </RowTop>
          <RowMeta>
            {p.overdueText
              ? <MetaDue $overdue data-testid="qtask-phone-due">{p.overdueText}</MetaDue>
              : (p.dueText && <MetaDue $overdue={false} data-testid="qtask-phone-due">{p.dueText}</MetaDue>)}
            {!p.compact && <TagChips tags={p.tags || []} max={1} />}
            {p.projectName && <ProjChip $compact={p.compact} data-testid="qtask-phone-project">{p.projectName}</ProjChip>}
            {!p.compact && p.extra}
          </RowMeta>
        </RowMain>
        {p.trailing && <Trail>{p.trailing}</Trail>}
      </RowInner>
    </PRow>
  );
};

export default PhoneTaskRow;

/* 카드 = 팝아웃 카드 행 + 폰 터치 40px / 한 줄 = 팝아웃 «촘촘히» 와 같은 축(CompactList 의 덮기 값)을 행 하나에 건다.
   목록 상자(CompactList)로 감쌀 수 없는 까닭: Q task 목록은 행 사이에 «아래에 추가»·안내 줄이 끼는 한 흐름이라 행마다 건다. */
const PRow = styled(Row)<{ $compact: boolean; $delayed: boolean }>`
  margin: 8px 10px 0;
  ${({ $delayed }) => ($delayed ? 'box-shadow: inset 3px 0 0 #DC2626;' : '')}
  ${Slot}, ${CheckBtn}, ${SubmitBtn} { width: 40px; height: 40px; }
  ${CheckBtn}::before { width: 22px; height: 22px; }
  ${RowLead} { display: flex; align-items: center; margin-left: -6px; }
  ${({ $compact, $delayed }) => $compact && css`
    margin: 0; gap: 0; padding: 0 10px 0 6px;
    border: 0; border-radius: 0; border-bottom: 1px solid #F1F5F9;
    ${$delayed ? 'box-shadow: inset 3px 0 0 #DC2626;' : ''}
    &:hover { box-shadow: none; background: #F8FAFC; }
    ${RowInner} { gap: 4px; min-height: 44px; }
    ${RowMain} { flex-direction: row; align-items: center; gap: 8px; min-height: 44px; }
    ${RowTop} { flex: 1; min-width: 0; align-items: center; gap: 6px; }
    ${RowTitle} { line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: normal; min-width: 0; }
    ${RowMeta} { flex-wrap: nowrap; flex-shrink: 0; gap: 6px; white-space: nowrap; }
  `}
  ${({ $active, $compact }) => ($active && $compact ? 'background: #F0FDFA; box-shadow: inset 3px 0 0 #14B8A6;' : '')}
`;
const ProjChip = styled(MetaChip)<{ $compact: boolean }>`
  max-width: ${({ $compact }) => ($compact ? '84px' : '160px')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Unread = styled.span`
  flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; background: #F43F5E; align-self: center;
`;
const Trail = styled.span`
  flex-shrink: 0; display: inline-flex; align-items: center;
`;
