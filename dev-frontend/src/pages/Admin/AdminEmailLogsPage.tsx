// 사이클 Q-C — platform_admin 의 메일 발송 모니터링
// 라우트: /admin/email-logs
// 기능: 상태별 탭 (sent / failed / skipped / all), 템플릿 필터, 재발송
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { Tabs, Tab, Badge } from '../../components/Common/TabComponents';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';

type Status = 'sent' | 'failed' | 'skipped';
type StatusFilter = Status | 'all';

interface EmailLogRow {
  id: number;
  to_email: string;
  subject: string;
  status: Status;
  error_message: string | null;
  template: string | null;
  related_entity_type: string | null;
  related_entity_id: number | null;
  business_id: number | null;
  initiated_by: number | null;
  retry_count: number;
  created_at: string;
  initiator?: { id: number; name: string } | null;
}

const STATUS_FILTERS: StatusFilter[] = ['all', 'sent', 'failed', 'skipped'];

const STATUS_TONE: Record<Status, { bg: string; fg: string }> = {
  sent: { bg: '#DCFCE7', fg: '#166534' },
  failed: { bg: '#FEE2E2', fg: '#B91C1C' },
  skipped: { bg: '#FEF3C7', fg: '#92400E' },
};

const AdminEmailLogsPage = () => {
  const { t } = useTranslation('admin');
  const [items, setItems] = useState<EmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, sent: 0, failed: 0, skipped: 0 });
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (activeStatus !== 'all') sp.set('status', activeStatus);
      sp.set('limit', '100');
      const r = await apiFetch(`/api/admin/email-logs?${sp.toString()}`);
      const j = await r.json();
      if (j.success) {
        setItems(j.data || []);
        // 별도 카운트 호출 — 간소화: 현재 페이지 응답에서 status 별 집계 (정확도는 limit 안 일부 한정)
        const list: EmailLogRow[] = j.data || [];
        const next: Record<string, number> = { all: list.length, sent: 0, failed: 0, skipped: 0 };
        for (const x of list) next[x.status] = (next[x.status] || 0) + 1;
        setCounts(next);
      }
    } finally {
      setLoading(false);
    }
  }, [activeStatus]);

  useEffect(() => { load(); }, [load]);

  const retry = async (id: number) => {
    setRetrying(id);
    try {
      const r = await apiFetch(`/api/admin/email-logs/${id}/retry`, { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        // 카운트 증가만 — 즉시 새로고침
        load();
      }
    } finally {
      setRetrying(null);
    }
  };

  const fmt = (iso: string) => iso?.slice(0, 16).replace('T', ' ') || '';

  return (
    <PageShell title={t('emailLogs.title', '메일 발송 모니터링') as string}>
      <Tabs>
        {STATUS_FILTERS.map((s) => (
          <Tab key={s} active={activeStatus === s} onClick={() => setActiveStatus(s)}>
            {t(`emailLogs.tab.${s}`, s)}
            {counts[s] > 0 && <Badge count={counts[s]} />}
          </Tab>
        ))}
      </Tabs>

      {loading ? (
        <Hint>{t('emailLogs.loading', '로드 중...')}</Hint>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
          title={t('emailLogs.empty.title', '발송 기록이 없습니다') as string}
          description={t('emailLogs.empty.message', '시스템이 보낸 모든 이메일이 여기에 기록됩니다.') as string}
        />
      ) : (
        <Table role="table">
          <Thead>
            <Tr>
              <Th>{t('emailLogs.col.time', '시각')}</Th>
              <Th>{t('emailLogs.col.to', '수신')}</Th>
              <Th>{t('emailLogs.col.subject', '제목')}</Th>
              <Th>{t('emailLogs.col.template', '템플릿')}</Th>
              <Th>{t('emailLogs.col.status', '상태')}</Th>
              <Th>{t('emailLogs.col.retry', '재발송')}</Th>
              <Th>{t('emailLogs.col.action', '액션')}</Th>
            </Tr>
          </Thead>
          <tbody>
            {items.map((it) => {
              const tone = STATUS_TONE[it.status];
              const canRetry = it.status !== 'sent' && !!it.template;
              return (
                <Tr key={it.id}>
                  <Td $mono>{fmt(it.created_at)}</Td>
                  <Td>{it.to_email}</Td>
                  <Td title={it.subject}>{it.subject}</Td>
                  <Td>{it.template || '—'}</Td>
                  <Td>
                    <Pill style={{ background: tone.bg, color: tone.fg }}>
                      {t(`emailLogs.status.${it.status}`, it.status)}
                    </Pill>
                    {it.error_message && <ErrLine title={it.error_message}>{it.error_message}</ErrLine>}
                  </Td>
                  <Td $mono>{it.retry_count}</Td>
                  <Td>
                    {canRetry && (
                      <RetryBtn type="button" onClick={() => retry(it.id)} disabled={retrying === it.id}>
                        {retrying === it.id ? t('emailLogs.action.retrying', '...') : t('emailLogs.action.retry', '재발송')}
                      </RetryBtn>
                    )}
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

export default AdminEmailLogsPage;

const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 16px 0;`;
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
const RetryBtn = styled.button`
  padding: 4px 10px; font-size: 11px; font-weight: 600; color: #0F766E;
  background: #FFF; border: 1px solid #CBD5E1; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { border-color: #0F766E; background: #F0FDFA; }
  &:disabled { color: #94A3B8; cursor: not-allowed; }
`;
