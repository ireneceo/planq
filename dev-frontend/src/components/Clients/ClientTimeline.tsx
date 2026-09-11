// components/Clients/ClientTimeline.tsx — 고객 통합 타임라인의 **행 렌더링 한 벌**
//
// 고객 타임라인 페이지(/business/clients/:id/timeline)와 Q sale 상세가 같은 것을 그린다.
// 베껴 두면 갈라진다 — 채널이 늘 때 한쪽에만 붙고, 늘어난 type 이 색 표에 없으면
// 그 행이 통째로 죽는다(memory feedback_copied_component_drifts_extract_shell).
//
// ★ 모르는 type 은 **보이게** 렌더한다. 기본값으로 조용히 떨어뜨리지 않는다
//   (memory feedback_unknown_state_silent_default).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import type { TimelineItem, TimelineType } from '../../services/sale';

type Props = {
  items: TimelineItem[];
  onOpen?: (item: TimelineItem) => void;
  /** 항목 우측에 붙는 버튼 등 (예: 자동 기록 "확인함", 상담 기록 삭제) */
  renderActions?: (item: TimelineItem) => React.ReactNode;
  emptyText?: string;
};

const TYPE_COLOR: Record<TimelineType, { bg: string; fg: string }> = {
  chat: { bg: '#F0FDFA', fg: '#0F766E' },
  email: { bg: '#EFF6FF', fg: '#1D4ED8' },
  task: { bg: '#FEF3C7', fg: '#92400E' },
  invoice: { bg: '#F0FDFA', fg: '#0F766E' },
  interaction: { bg: '#FDF4FF', fg: '#A21CAF' },
  stage: { bg: '#F1F5F9', fg: '#334155' },
  guest: { bg: '#FFF7ED', fg: '#C2410C' },
};
const FALLBACK_COLOR = { bg: '#F1F5F9', fg: '#475569' };

export default function ClientTimeline({ items, onOpen, renderActions, emptyText }: Props) {
  const { t } = useTranslation('qsale');
  const { formatTimeAgo, formatDateTime } = useTimeFormat();
  // i18n 호출을 좁은 모양으로 감싼다 — TFunction 타입을 그대로 넘기면 헬퍼 시그니처와 안 맞는다
  const label = (key: string, vars?: Record<string, string | number>): string =>
    t(key, { defaultValue: key, ...(vars || {}) }) as string;

  if (!items.length) {
    return <Empty>{emptyText || (t('timeline.empty', { defaultValue: '아직 기록이 없습니다' }) as string)}</Empty>;
  }

  return (
    <List>
      {items.map((it) => {
        const color = TYPE_COLOR[it.type] || FALLBACK_COLOR;
        const meta = (it.meta || {}) as Record<string, unknown>;
        const clickable = !!onOpen;
        return (
          <Row key={`${it.type}-${it.id}`} $clickable={clickable}
            data-timeline-type={it.type}
            onClick={clickable ? () => onOpen?.(it) : undefined}>
            <TypeBadge style={{ background: color.bg, color: color.fg }}>
              {t(`timeline.channel.${it.type}`, { defaultValue: it.type }) as string}
            </TypeBadge>
            <Body>
              <RowTitle>{titleOf(it, meta, label)}</RowTitle>
              {it.preview && <Preview>{it.preview}</Preview>}
              <Metas>
                {it.type === 'interaction' && typeof meta.kind === 'string' && (
                  <Meta>{t(`record.kind.${meta.kind}`, { defaultValue: String(meta.kind) }) as string}</Meta>
                )}
                {it.type === 'interaction' && typeof meta.direction === 'string' && (
                  <Meta>{t(`record.direction.${meta.direction}`, { defaultValue: String(meta.direction) }) as string}</Meta>
                )}
                {it.type === 'interaction' && typeof meta.duration_seconds === 'number' && meta.duration_seconds > 0 && (
                  <Meta>{Math.round((meta.duration_seconds as number) / 60)}분</Meta>
                )}
                {it.type === 'interaction' && meta.origin === 'auto' && (
                  <Meta>{t('record.auto', { defaultValue: '자동' }) as string}</Meta>
                )}
                {it.type === 'interaction' && meta.origin === 'auto' && meta.reviewed === false && (
                  <MetaWarn>{t('record.unreviewed', { defaultValue: '미확인' }) as string}</MetaWarn>
                )}
                {it.type === 'stage' && meta.origin === 'auto' && (
                  <Meta>{t('record.auto', { defaultValue: '자동' }) as string}</Meta>
                )}
                {it.type === 'invoice' && typeof meta.grand_total === 'number' && (
                  <Meta>{Number(meta.grand_total).toLocaleString()} {String(meta.currency || 'KRW')}</Meta>
                )}
                {it.type === 'email' && typeof meta.direction === 'string' && (
                  <Meta>{t(`record.direction.${meta.direction}`, { defaultValue: String(meta.direction) }) as string}</Meta>
                )}
              </Metas>
            </Body>
            <Right>
              <TimeCell title={formatDateTime(it.at)}>{formatTimeAgo(it.at)}</TimeCell>
              {renderActions?.(it)}
            </Right>
          </Row>
        );
      })}
    </List>
  );
}

function titleOf(
  it: TimelineItem,
  meta: Record<string, unknown>,
  label: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (it.type === 'stage') {
    const from = meta.from ? label(`stage.${meta.from}`) : '—';
    const to = label(`stage.${meta.to}`);
    const line = label('timeline.stageChanged', { from, to });
    return meta.reason ? `${line} · ${String(meta.reason)}` : line;
  }
  if (it.type === 'guest') {
    return meta.event === 'account_requested' ? label('timeline.guestAccountRequested') : label('timeline.guestIssued');
  }
  if (it.title) return it.title;
  return label(`timeline.channel.${it.type}`);
}

const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.div<{ $clickable: boolean }>`
  display: grid; grid-template-columns: 76px 1fr auto; gap: 12px; align-items: start;
  width: 100%; text-align: left;
  padding: 12px 14px; border-radius: 12px;
  background: #fff; border: 1px solid #E2E8F0;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: ${(p) => (p.$clickable ? '#CBD5E1' : '#E2E8F0')}; }
  @media (max-width: 640px) { grid-template-columns: 64px 1fr; }
`;
/* 장식 배지는 높이를 고정하지 않는다 — 글자 크기 배율을 따라가야 하고, 컨트롤 높이 토큰(36/40/44)과도 무관하다 */
const TypeBadge = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 4px 8px; border-radius: 999px; line-height: 1.2;
  font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
`;
const Body = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 3px;`;
const RowTitle = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Preview = styled.div`font-size: 0.8125rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Metas = styled.div`display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;`;
const Meta = styled.span`font-size: 0.6875rem; font-weight: 600; color: #475569; background: #F1F5F9; border-radius: 999px; padding: 1px 8px;`;
const MetaWarn = styled(Meta)`color: #9A3412; background: #FFEDD5;`;
const Right = styled.div`display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  @media (max-width: 640px) { grid-column: 2; justify-content: flex-start; }`;
const TimeCell = styled.div`font-size: 0.75rem; color: #94A3B8; white-space: nowrap;`;
const Empty = styled.div`
  display: flex; align-items: center; justify-content: center;
  padding: 48px 24px; font-size: 0.8125rem; color: #94A3B8;
  background: #fff; border: 1px dashed #E2E8F0; border-radius: 12px;
`;
