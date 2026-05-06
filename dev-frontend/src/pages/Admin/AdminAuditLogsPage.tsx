// platform_admin 감사 로그 조회 — 누가 언제 뭘 바꿨나 추적
// 라우트: /admin/audit-logs
// 백엔드: GET /api/admin/audit-logs?user_id=&action=&target_type=&from=&to=&limit=
import { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface AuditRow {
  id: number;
  user_id: number | null;
  business_id: number | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  old_value: unknown;
  new_value: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  User?: { id: number; name: string; email: string } | null;
}

const COMMON_ACTIONS = [
  'user.impersonate',
  'user.data_export',
  'platform_settings.update',
  'plan.change',
  'payment.mark_paid',
  'business.create',
  'kb.document_create',
  'kb.document_update',
  'kb.document_delete',
];

const AdminAuditLogsPage = () => {
  const { t } = useTranslation('common');
  const tf = useTimeFormat();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filterAction !== 'all') sp.set('action', filterAction);
      if (filterUserId.trim()) sp.set('user_id', filterUserId.trim());
      if (filterFrom) sp.set('from', filterFrom);
      if (filterTo) sp.set('to', filterTo);
      sp.set('limit', '200');
      const r = await apiFetch(`/api/admin/audit-logs?${sp.toString()}`);
      const j = await r.json();
      if (j.success) setRows(j.data || []);
    } finally { setLoading(false); }
  }, [filterAction, filterUserId, filterFrom, filterTo]);

  useEffect(() => { void load(); }, [load]);

  const detail = useMemo(() => rows.find(r => r.id === detailId) || null, [rows, detailId]);

  const actionOptions: PlanQSelectOption[] = useMemo(() => [
    { value: 'all', label: t('adminAudit.actionAll', '전체 액션') as string },
    ...COMMON_ACTIONS.map(a => ({ value: a, label: a })),
  ], [t]);

  return (
    <PageShell
      title={t('adminAudit.title', '감사 로그') as string}
      count={rows.length}
      actions={
        <FilterRow>
          <PlanQSelect size="sm" isSearchable={false}
            value={actionOptions.find(o => o.value === filterAction)}
            options={actionOptions}
            onChange={(opt) => setFilterAction((opt as PlanQSelectOption | null)?.value as string || 'all')}
          />
          <SmallInput type="number" placeholder={t('adminAudit.userIdPh', 'user ID') as string}
            value={filterUserId} onChange={e => setFilterUserId(e.target.value)} />
          <SingleDateField value={filterFrom} onChange={setFilterFrom} placeholder="시작" size="sm" width={130} />
          <SingleDateField value={filterTo} onChange={setFilterTo} placeholder="끝" size="sm" width={130} minDate={filterFrom || undefined} />
        </FilterRow>
      }
    >
      {loading ? (
        <Loading>{t('common.loading', '불러오는 중...')}</Loading>
      ) : rows.length === 0 ? (
        <EmptyState icon="inbox" title={t('adminAudit.empty', '조건에 맞는 로그가 없습니다') as string} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('adminAudit.col.when', '시각')}</Th>
              <Th>{t('adminAudit.col.user', '사용자')}</Th>
              <Th>{t('adminAudit.col.action', '액션')}</Th>
              <Th>{t('adminAudit.col.target', '대상')}</Th>
              <Th>{t('adminAudit.col.ip', 'IP')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <Row key={r.id} onClick={() => setDetailId(r.id)} $selected={r.id === detailId}>
                <Td>{tf.formatDateTime(r.created_at)}</Td>
                <Td>{r.User ? `${r.User.name} (${r.User.email})` : (r.user_id ? `#${r.user_id}` : '—')}</Td>
                <Td><ActionTag>{r.action}</ActionTag></Td>
                <Td>{r.target_type ? `${r.target_type} #${r.target_id}` : '—'}</Td>
                <Td><IpText>{r.ip_address || '—'}</IpText></Td>
              </Row>
            ))}
          </tbody>
        </Table>
      )}

      {detail && (
        <DetailDrawer open={!!detail} onClose={() => setDetailId(null)} width={560} ariaLabel={t('adminAudit.detail', '로그 상세') as string}>
          <DetailDrawer.Header onClose={() => setDetailId(null)}>
            <DTitle>#{detail.id} — {detail.action}</DTitle>
          </DetailDrawer.Header>
          <DetailDrawer.Body>
            <DSection>
              <DLabel>{t('adminAudit.col.when', '시각')}</DLabel>
              <DValue>{tf.formatDateTime(detail.created_at)}</DValue>
            </DSection>
            <DSection>
              <DLabel>{t('adminAudit.col.user', '사용자')}</DLabel>
              <DValue>{detail.User ? `${detail.User.name} (${detail.User.email})` : (detail.user_id ? `#${detail.user_id}` : '시스템')}</DValue>
            </DSection>
            <DSection>
              <DLabel>{t('adminAudit.col.target', '대상')}</DLabel>
              <DValue>{detail.target_type ? `${detail.target_type} #${detail.target_id}` : '—'}</DValue>
            </DSection>
            <DSection>
              <DLabel>{t('adminAudit.col.ip', 'IP')}</DLabel>
              <DValue>{detail.ip_address || '—'}</DValue>
            </DSection>
            {detail.user_agent && (
              <DSection>
                <DLabel>{t('adminAudit.col.ua', 'User Agent')}</DLabel>
                <DValueSmall>{detail.user_agent}</DValueSmall>
              </DSection>
            )}
            {detail.old_value !== null && detail.old_value !== undefined && (
              <DSection>
                <DLabel>{t('adminAudit.oldValue', 'Before')}</DLabel>
                <DJson>{JSON.stringify(detail.old_value, null, 2)}</DJson>
              </DSection>
            )}
            {detail.new_value !== null && detail.new_value !== undefined && (
              <DSection>
                <DLabel>{t('adminAudit.newValue', 'After')}</DLabel>
                <DJson>{JSON.stringify(detail.new_value, null, 2)}</DJson>
              </DSection>
            )}
          </DetailDrawer.Body>
        </DetailDrawer>
      )}
    </PageShell>
  );
};

export default AdminAuditLogsPage;

const FilterRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const SmallInput = styled.input`
  height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A; max-width: 130px;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Loading = styled.div`padding: 40px; text-align: center; color: #64748B;`;
const Table = styled.table`
  width: 100%; border-collapse: collapse; margin-top: 12px;
  font-size: 13px;
`;
const Th = styled.th`
  padding: 10px 12px; text-align: left; background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0; font-weight: 700; font-size: 11px; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Row = styled.tr<{ $selected: boolean }>`
  cursor: pointer;
  background: ${p => p.$selected ? '#F0FDFA' : 'transparent'};
  &:hover { background: ${p => p.$selected ? '#F0FDFA' : '#F8FAFC'}; }
`;
const Td = styled.td`
  padding: 10px 12px; border-bottom: 1px solid #F1F5F9;
  color: #334155; vertical-align: middle;
`;
const ActionTag = styled.span`
  display: inline-block; padding: 2px 8px;
  background: #F0FDFA; color: #0F766E;
  border: 1px solid #99F6E4; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const IpText = styled.span`font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #64748B;`;

const DTitle = styled.h3`margin: 0; font-size: 14px; font-weight: 700; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const DSection = styled.section`margin-bottom: 16px;`;
const DLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px;`;
const DValue = styled.div`font-size: 13px; color: #0F172A;`;
const DValueSmall = styled.div`font-size: 11px; color: #64748B; word-break: break-all;`;
const DJson = styled.pre`
  margin: 0; padding: 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 11px; color: #0F172A;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-x: auto;
  max-height: 320px; overflow-y: auto;
`;
