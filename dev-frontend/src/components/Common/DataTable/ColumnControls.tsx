// 표 머리줄 조각 — 폭 손잡이 · «열 설정» 팝오버(←/→ 이동 · 보이기 · 기본으로 되돌리기).
// 훅은 hooks/useTableColumns. 머리 칸 자체(라벨·정렬 클릭)는 각 표의 styled 를 그대로 쓴다 — 모양을 바꾸지 않는다.
// 팝오버 판은 ChipPopover 의 Panel · 자리는 usePopoverAnchor — 새로 그리지 않는다.
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { usePopoverAnchor } from '../popoverAnchor';
import { Panel } from '../ChipPopover';
import type { TableColumnsApi } from '../../../hooks/useTableColumns';

/** 고정 열 머리 칸 오른쪽 끝 손잡이. 머리 칸은 position:relative 여야 한다 */
export function ColumnResizeHandle<K extends string>({ api, colKey }: { api: TableColumnsApi<K>; colKey: K }) {
  const { t } = useTranslation('common');
  if (api.phone) return null;
  return <Handle {...api.resizeProps(colKey, t('tableColumns.resize', '열 폭 조절') as string)} />;
}

/** 머리줄 오른쪽 끝(겹침) «열 설정» 버튼 */
export function ColumnSettingsButton<K extends string>({ api, testId }: { api: TableColumnsApi<K>; testId?: string }) {
  const { t } = useTranslation('common');
  const { open, toggle, pos, style, wrapRef, panelRef } = usePopoverAnchor();
  if (api.phone) return null;
  const visible = api.columns.map(c => c.key);
  const list = api.prefs.order.map(k => api.defs.find(d => d.key === k)!).filter(d => d && api.isActive(d.key));
  const label = t('tableColumns.settings', '열 설정') as string;
  return (
    <Wrap ref={wrapRef}>
      <Trigger type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={label} title={label}
        aria-haspopup="dialog" aria-expanded={open} $on={api.isCustomized} data-testid={testId}>
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg></span>
      </Trigger>
      {open && pos && createPortal(
        <Panel ref={panelRef} role="dialog" aria-label={label} style={{ ...style, width: 260 }} onClick={e => e.stopPropagation()}>
          <Title>{label}</Title>
          <Hint>{t('tableColumns.hint', '머리 칸을 끌어 좌우로 옮기고, 칸 경계를 끌어 폭을 바꿔요')}</Hint>
          <Rows>
            {list.map((d) => {
              const auto = api.autoHidden.includes(d.key);
              const hidden = api.prefs.hidden.includes(d.key);
              const vi = visible.indexOf(d.key);
              const name = t(d.labelKey, d.defaultValue) as string;
              return (
                <Row key={d.key} data-testid={testId ? `${testId}-row-${d.key}` : undefined}>
                  <Check type="checkbox" checked={!hidden} disabled={!d.hideable}
                    aria-label={t('tableColumns.show', '{{name}} 보이기', { name }) as string}
                    onChange={() => api.toggleHidden(d.key)} />
                  <Name $muted={hidden || auto}>
                    {name}
                    {auto && !hidden && <Auto>{t('tableColumns.autoHidden', '좁아서 숨겨짐')}</Auto>}
                  </Name>
                  <Arrow type="button" disabled={vi <= 0} onClick={() => api.step(d.key, -1)}
                    aria-label={t('tableColumns.moveLeft', '왼쪽으로 이동') as string} title={t('tableColumns.moveLeft', '왼쪽으로 이동') as string}>‹</Arrow>
                  <Arrow type="button" disabled={vi < 0 || vi >= visible.length - 1} onClick={() => api.step(d.key, 1)}
                    aria-label={t('tableColumns.moveRight', '오른쪽으로 이동') as string} title={t('tableColumns.moveRight', '오른쪽으로 이동') as string}>›</Arrow>
                </Row>
              );
            })}
          </Rows>
          <Reset type="button" disabled={!api.isCustomized} onClick={api.reset}
            data-testid={testId ? `${testId}-reset` : undefined}>{t('tableColumns.reset', '기본으로 되돌리기')}</Reset>
        </Panel>,
        document.body,
      )}
    </Wrap>
  );
}

const Handle = styled.span`
  /* 머리 칸이 overflow:hidden(라벨 말줄임)이라 칸 안쪽 끝에 둔다 */
  position:absolute;top:0;bottom:0;right:0;width:8px;cursor:col-resize;z-index:2;touch-action:none;
  &::after{content:'';position:absolute;top:0;bottom:0;right:0;width:2px;border-radius:1px;background:transparent;transition:background 0.12s;}
  &:hover::after,&:focus-visible::after{background:#5EEAD4;}
  &:focus-visible{outline:none;}
`;
// 오른쪽 끝 24px 는 Q task 우측 패널 접기 손잡이(FloatingPanelToggle)의 누르는 자리다 — 겹치면 버튼이 안 눌린다(실측 1440: 손잡이 996~1020)
const Wrap = styled.div`position:absolute;right:24px;top:50%;transform:translateY(-50%);display:flex;z-index:3;`;
// 누르는 자리는 규격 32px, 보이는 칸은 아이콘 14 + 여백 4 = 22px(머리줄 높이 안) — 배경은 안쪽 TriggerFace 에만 칠한다
const Trigger = styled.button<{ $on: boolean }>`
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;padding:0;
  border:none;background:transparent;cursor:pointer;
  color:${p => (p.$on ? '#0F766E' : '#94A3B8')};
  & > span{padding:4px;border-radius:6px;display:inline-flex;
    background:${p => (p.$on ? '#F0FDFA' : 'transparent')};}
  &:hover > span{background:#F1F5F9;color:#475569;}
  &:focus-visible{outline:none;}
  &:focus-visible > span{outline:2px solid #5EEAD4;outline-offset:1px;}
`;
const Title = styled.div`font-size:0.8125rem;font-weight:700;color:#0F172A;`;
const Hint = styled.div`font-size:0.6875rem;color:#94A3B8;line-height:1.45;`;
const Rows = styled.div`display:flex;flex-direction:column;gap:2px;`;
const Row = styled.div`display:flex;align-items:center;gap:6px;padding:3px 2px;border-radius:6px;&:hover{background:#F8FAFC;}`;
const Check = styled.input`margin:0;accent-color:#14B8A6;cursor:pointer;&:disabled{cursor:not-allowed;}`;
const Name = styled.span<{ $muted: boolean }>`flex:1;min-width:0;font-size:0.8125rem;color:${p => (p.$muted ? '#94A3B8' : '#334155')};display:flex;align-items:center;gap:6px;`;
const Auto = styled.span`font-size:0.625rem;font-weight:600;color:#B45309;background:#FFFBEB;border-radius:4px;padding:1px 5px;white-space:nowrap;`;
const Arrow = styled.button`
  width:32px;height:32px;border:1px solid #E2E8F0;border-radius:6px;background:#fff;color:#475569;
  font-size:0.9375rem;line-height:1;cursor:pointer;padding:0;
  &:hover:not(:disabled){border-color:#5EEAD4;color:#0F766E;}
  &:disabled{opacity:0.35;cursor:not-allowed;}
`;
const Reset = styled.button`
  margin-top:2px;height:32px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;color:#334155;
  font-size:0.75rem;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){border-color:#CBD5E1;}
  &:disabled{opacity:0.45;cursor:not-allowed;}
`;
