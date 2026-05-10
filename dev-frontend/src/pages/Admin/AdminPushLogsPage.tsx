// 사이클 N+4 — platform_admin 의 Web Push 발송 모니터링
// 라우트: /admin/push-logs
// 기능: 7일 통계 카드 4개 + 상태별 필터 + 발송 목록 + endpoint host top
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { Tabs, Tab, Badge } from '../../components/Common/TabComponents';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';

type Status = 'sent' | 'expired' | 'failed' | 'skipped';
type StatusFilter = Status | 'all';

interface PushLogRow {
  id: number;
  user_id: number | null;
  subscription_id: number | null;
  endpoint_host: string | null;
  category: string | null;
  status: Status;
  status_code: number | null;
  error_message: string | null;
  payload_title: string | null;
  created_at: string;
  user?: { id: number; name: string; email: string } | null;
}

interface Stats {
  days: number;
  total: number;
  sent: number;
  failed: number;
  failure_rate: number;
  by_status: Array<{ status: Status; count: string | number }>;
  by_host: Array<{ endpoint_host: string; count: string | number }>;
  daily: Array<{ day: string; total: string | number; sent: string | number; failed: string | number }>;
}

const STATUS_FILTERS: StatusFilter[] = ['all', 'sent', 'failed', 'expired', 'skipped'];

const STATUS_TONE: Record<Status, { bg: string; fg: string }> = {
  sent:    { bg: '#DCFCE7', fg: '#166534' },
  failed:  { bg: '#FEE2E2', fg: '#B91C1C' },
  expired: { bg: '#FEF3C7', fg: '#92400E' },
  skipped: { bg: '#E2E8F0', fg: '#475569' },
};

const fmt = (iso: string) => iso?.slice(0, 16).replace('T', ' ') || '';
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const truncHost = (h: string | null) => {
  if (!h) return '—';
  return h.replace('googleapis.com', 'fcm').replace('updates.push.services.mozilla.com', 'mozilla');
};

const AdminPushLogsPage = () => {
  const { t } = useTranslation('admin');
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<PushLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        apiFetch('/api/admin/push-logs/stats?days=7').then(r => r.json()).catch(() => null),
        (() => {
          const sp = new URLSearchParams();
          if (activeStatus !== 'all') sp.set('status', activeStatus);
          sp.set('limit', '100');
          return apiFetch(`/api/admin/push-logs?${sp.toString()}`).then(r => r.json()).catch(() => null);
        })(),
      ]);
      if (statsRes?.success) setStats(statsRes.data);
      if (listRes?.success) setItems(listRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [activeStatus]);

  useEffect(() => { load(); }, [load]);

  const counts: Record<string, number> = { all: stats?.total || 0 };
  (stats?.by_status || []).forEach(r => { counts[r.status] = Number(r.count); });

  return (
    <PageShell title={t('pushLogs.title', { defaultValue: 'Push 발송 모니터링' }) as string}>
      {/* 통계 카드 4 */}
      {stats && (
        <StatGrid>
          <StatCard>
            <StatLabel>{t('pushLogs.stat.total', { defaultValue: '7일 발송' }) as string}</StatLabel>
            <StatValue>{stats.total.toLocaleString()}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>{t('pushLogs.stat.sent', { defaultValue: '성공' }) as string}</StatLabel>
            <StatValue $tone="ok">{stats.sent.toLocaleString()}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>{t('pushLogs.stat.failed', { defaultValue: '실패·만료' }) as string}</StatLabel>
            <StatValue $tone="bad">{stats.failed.toLocaleString()}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>{t('pushLogs.stat.rate', { defaultValue: '실패율' }) as string}</StatLabel>
            <StatValue $tone={stats.failure_rate > 0.1 ? 'bad' : 'ok'}>{pct(stats.failure_rate)}</StatValue>
          </StatCard>
        </StatGrid>
      )}

      {/* endpoint host top */}
      {stats && stats.by_host.length > 0 && (
        <HostBox>
          <HostTitle>{t('pushLogs.hostTop', { defaultValue: 'Endpoint host top' }) as string}</HostTitle>
          <HostList>
            {stats.by_host.map(h => (
              <HostRow key={h.endpoint_host}>
                <HostName>{truncHost(h.endpoint_host)}</HostName>
                <HostCount>{Number(h.count).toLocaleString()}</HostCount>
              </HostRow>
            ))}
          </HostList>
        </HostBox>
      )}

      <Tabs>
        {STATUS_FILTERS.map((s) => (
          <Tab key={s} active={activeStatus === s} onClick={() => setActiveStatus(s)}>
            {t(`pushLogs.tab.${s}`, { defaultValue: s }) as string}
            {counts[s] > 0 && <Badge count={counts[s]} />}
          </Tab>
        ))}
      </Tabs>

      {loading ? (
        <Hint>{t('pushLogs.loading', { defaultValue: '로드 중...' }) as string}</Hint>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
          title={t('pushLogs.empty.title', { defaultValue: '발송 기록이 없습니다' }) as string}
          description={t('pushLogs.empty.message', { defaultValue: 'Web Push 발송 시도가 모두 여기에 기록됩니다.' }) as string}
        />
      ) : (
        <Table role="table">
          <Thead>
            <Tr>
              <Th>{t('pushLogs.col.time', { defaultValue: '시각' }) as string}</Th>
              <Th>{t('pushLogs.col.user', { defaultValue: '사용자' }) as string}</Th>
              <Th>{t('pushLogs.col.title', { defaultValue: '제목' }) as string}</Th>
              <Th>{t('pushLogs.col.host', { defaultValue: 'Host' }) as string}</Th>
              <Th>{t('pushLogs.col.category', { defaultValue: '카테고리' }) as string}</Th>
              <Th>{t('pushLogs.col.status', { defaultValue: '상태' }) as string}</Th>
            </Tr>
          </Thead>
          <tbody>
            {items.map((it) => {
              const tone = STATUS_TONE[it.status];
              return (
                <Tr key={it.id}>
                  <Td $mono>{fmt(it.created_at)}</Td>
                  <Td>{it.user?.name || (it.user_id ? `#${it.user_id}` : '—')}</Td>
                  <Td title={it.payload_title || ''}>{it.payload_title || '—'}</Td>
                  <Td>{truncHost(it.endpoint_host)}</Td>
                  <Td>{it.category || '—'}</Td>
                  <Td>
                    <Pill style={{ background: tone.bg, color: tone.fg }}>
                      {t(`pushLogs.status.${it.status}`, { defaultValue: it.status }) as string}
                      {it.status_code ? ` ${it.status_code}` : ''}
                    </Pill>
                    {it.error_message && <ErrLine title={it.error_message}>{it.error_message}</ErrLine>}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </PageShell>
  );
};

export default AdminPushLogsPage;

// styled
const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 16px 0;`;
const StatGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px; margin: 16px 0 20px;
`;
const StatCard = styled.div`
  padding: 14px 16px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const StatLabel = styled.div`font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px;`;
const StatValue = styled.div<{ $tone?: 'ok' | 'bad' }>`
  font-size: 22px; font-weight: 700; color: ${p => p.$tone === 'ok' ? '#0F766E' : p.$tone === 'bad' ? '#B91C1C' : '#0F172A'};
  margin-top: 4px;
`;
const HostBox = styled.div`
  padding: 14px 16px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  margin-bottom: 20px;
`;
const HostTitle = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px;`;
const HostList = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const HostRow = styled.div`display: flex; justify-content: space-between; font-size: 12px;`;
const HostName = styled.span`color: #334155; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const HostCount = styled.span`color: #0F172A; font-weight: 700;`;
const Table = styled.table`width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px;`;
const Thead = styled.thead`background: #F8FAFC;`;
const Tr = styled.tr`border-bottom: 1px solid #F1F5F9;`;
const Th = styled.th`text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px;`;
const Td = styled.td<{ $mono?: boolean }>`
  padding: 10px 12px; vertical-align: top; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;
  ${p => p.$mono && 'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #334155;'}
`;
const Pill = styled.span`
  display: inline-flex; align-items: center; padding: 2px 10px; font-size: 11px; font-weight: 700;
  border-radius: 999px;
`;
const ErrLine = styled.div`
  margin-top: 4px; font-size: 11px; color: #B91C1C; max-width: 240px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
