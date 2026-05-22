import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  cityFromTz,
  formatTimeInTz,
  abbrFromTz,
  offsetFromTz,
} from '../../utils/timezones';

type Props = {
  workspaceTz: string;
  workspaceLabel?: string;
  userTz: string;
  referenceTzs: string[];
  locale?: 'ko' | 'en';
  isWorkspaceAdmin?: boolean;
};

// 좌우 패딩 일관 — 헤더와 rows 모두 같은 X 정렬
const ROW_PAD_X = '4px';

// margin-top: -12px → SidebarFooter 의 padding-top(12px) 상쇄
// 상/하 padding 10px 로 동일 → 위·아래 구분선 사이에 시계가 정중앙 정렬
const Wrap = styled.div`
  margin: -12px -16px 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.button<{ $interactive?: boolean }>`
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 3px ${ROW_PAD_X};
  min-height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: ${(p) => (p.$interactive ? 'pointer' : 'default')};
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;

  ${(p) => p.$interactive && `
    &:hover { background: rgba(255, 255, 255, 0.05); }
  `}
`;

const City = styled.span<{ $variant: 'workspace' | 'you' | 'reference' }>`
  color: ${(p) =>
    p.$variant === 'you'
      ? '#FFFFFF'
      : p.$variant === 'workspace'
      ? 'rgba(204, 251, 241, 0.75)'
      : 'rgba(204, 251, 241, 0.5)'};
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1 1 auto;
`;

const Time = styled.span<{ $variant: 'workspace' | 'you' | 'reference' }>`
  color: ${(p) =>
    p.$variant === 'you'
      ? '#FFFFFF'
      : p.$variant === 'workspace'
      ? 'rgba(240, 253, 250, 0.85)'
      : 'rgba(240, 253, 250, 0.55)'};
  font-weight: 600;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  letter-spacing: -0.2px;
  flex-shrink: 0;
`;

const ExpandButton = styled.button<{ $open?: boolean }>`
  width: 100%;
  margin-top: 4px;
  padding: 3px ${ROW_PAD_X};
  background: none;
  border: none;
  color: rgba(204, 251, 241, 0.4);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  border-radius: 5px;
  transition: all 0.15s;
  text-align: left;
  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.05);
  }
  svg {
    transform: rotate(${(p) => (p.$open ? 180 : 0)}deg);
    transition: transform 0.2s;
  }
`;

const ReferenceList = styled.div<{ $open?: boolean }>`
  max-height: ${(p) => (p.$open ? '240px' : '0')};
  overflow: hidden;
  transition: max-height 0.25s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: ${(p) => (p.$open ? '2px' : '0')};
`;

export default function SidebarClock({
  workspaceTz,
  workspaceLabel,
  userTz,
  referenceTzs,
  locale = 'en',
  isWorkspaceAdmin = false,
}: Props) {
  const { t } = useTranslation('layout');
  const navigate = useNavigate();
  const [now, setNow] = useState<Date>(new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 20000);
    return () => window.clearInterval(id);
  }, []);

  const sameTz = workspaceTz === userTz;

  const uniqueRefs = useMemo(() => {
    const seen = new Set<string>([workspaceTz, userTz]);
    return referenceTzs.filter((r) => {
      if (seen.has(r)) return false;
      seen.add(r);
      return true;
    });
  }, [referenceTzs, workspaceTz, userTz]);

  const localeTag = locale === 'ko' ? 'ko-KR' : 'en-US';

  const tooltipFor = (tz: string, extra?: string) => {
    const abbr = abbrFromTz(now, tz);
    const off = offsetFromTz(now, tz);
    const tail = abbr && off ? `${abbr} (UTC${off})` : abbr || (off ? `UTC${off}` : '');
    return [extra, tz, tail].filter(Boolean).join(' · ');
  };

  const workspaceInteractive = isWorkspaceAdmin;

  return (
    <Wrap>
      <List>
        <Row
          $interactive={workspaceInteractive}
          title={tooltipFor(workspaceTz, workspaceLabel || t('clock.workspace'))}
          onClick={workspaceInteractive ? () => navigate('/business/settings') : undefined}
          type="button"
          disabled={!workspaceInteractive}
        >
          <City $variant="workspace">{cityFromTz(workspaceTz)}</City>
          <Time $variant="workspace">{formatTimeInTz(now, workspaceTz, localeTag)}</Time>
        </Row>

        {!sameTz && (
          <Row
            $interactive
            title={tooltipFor(userTz, t('clock.you'))}
            onClick={() => navigate('/profile')}
            type="button"
          >
            <City $variant="you">{cityFromTz(userTz)}</City>
            <Time $variant="you">{formatTimeInTz(now, userTz, localeTag)}</Time>
          </Row>
        )}
      </List>

      {uniqueRefs.length > 0 && (
        <>
          <ReferenceList $open={open}>
            {uniqueRefs.map((tz) => (
              <Row
                key={tz}
                $interactive
                title={tooltipFor(tz, t('clock.reference'))}
                onClick={() => navigate('/profile')}
                type="button"
              >
                <City $variant="reference">{cityFromTz(tz)}</City>
                <Time $variant="reference">{formatTimeInTz(now, tz, localeTag)}</Time>
              </Row>
            ))}
          </ReferenceList>
          <ExpandButton
            $open={open}
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {open
              ? t('clock.collapse')
              : t('clock.expand', { count: uniqueRefs.length })}
          </ExpandButton>
        </>
      )}
    </Wrap>
  );
}
