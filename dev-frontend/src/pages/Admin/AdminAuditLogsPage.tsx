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

// 사이클 N+62 — 카테고리 그룹화. N+51/54/59 추가 action 반영 + target_type filter.
// 운영자가 보안 사고 분석 시 빠르게 필터링 가능하도록 그룹별 정리.
const ACTION_GROUPS: { labelKey: string; actions: string[] }[] = [
  {
    labelKey: 'adminAudit.group.security',  // 보안·권한
    actions: [
      'user.impersonate', 'user.data_export', 'user.status_change',
      'user.secondary_email_change', 'user.secondary_email_remove',
      'platform_settings.update', 'member_permission.update',
      'task.reviewer_add', 'task.reviewer_remove', 'task.policy_change',
    ],
  },
  {
    labelKey: 'adminAudit.group.finance',   // 재무
    actions: [
      'invoice.create', 'invoice.send', 'invoice.delete',
      'invoice.installment.mark_paid', 'invoice.installment.unmark_paid',
      'invoice.installment.mark_tax_invoice', 'invoice.installment.cancel',
      'invoice.status.change',
      'payment.mark_paid', 'subscription.checkout',
      'addon.mark_paid', 'addon.cancel',
      'plan.trial_start', 'plan.upgrade', 'plan.downgrade_schedule', 'plan.cancel_schedule',
      'business.default_billing_owner.update',
    ],
  },
  {
    labelKey: 'adminAudit.group.content',   // 콘텐츠
    actions: [
      'post.create', 'post.update', 'post.delete', 'post.brief.create',
      'kb.document_create', 'kb.document_update', 'kb.document_delete', 'kb.document_upload',
      'document.public_sign', 'document.archive',
      'document.share', 'document.share_revoke', 'document_template.archive',
      'record.delete', 'task_template.delete',
    ],
  },
  {
    labelKey: 'adminAudit.group.files',     // 파일
    actions: [
      'file.upload', 'file.delete', 'file.visibility_change',
      'file.share_link_create', 'file.share_link_revoke', 'file.bulk_delete',
    ],
  },
  {
    labelKey: 'adminAudit.group.signature', // 서명
    actions: ['signature.request', 'signature.sign'],
  },
  {
    labelKey: 'adminAudit.group.workspace', // 워크스페이스
    actions: [
      'business.create', 'business.weekly_finalize_update',
      'workspace_weekly_report.create', 'workspace_weekly_report.update',
      'workspace_weekly_report.overwrite', 'workspace_weekly_report.delete',
      'project.client_added', 'conversation.archive', 'conversation.unlink_project',
    ],
  },
];

// 자주 쓰는 target_type — DB 통계 기준 (사이클 N+62)
const COMMON_TARGET_TYPES = [
  'Post', 'KbDocument', 'file', 'calendar_event', 'conversation', 'Message',
  'business', 'Task', 'client', 'document', 'SignatureRequest', 'payment',
  'invoice', 'q_record', 'User', 'business_member_permission', 'project_client',
];

const AdminAuditLogsPage = () => {
  const { t } = useTranslation('common');
  const tf = useTimeFormat();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterTargetType, setFilterTargetType] = useState<string>('all'); // N+62
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [detailId, setDetailId] = useState<number | null>(null);

  // 사이클 N+59 — auto-paginate (N+55 패턴). 5 페이지 × 500 = 2500 audit row 까지 누적.
  // 사이클 N+62 — target_type filter 추가
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const baseParams = new URLSearchParams();
      if (filterAction !== 'all') baseParams.set('action', filterAction);
      if (filterTargetType !== 'all') baseParams.set('target_type', filterTargetType);
      if (filterUserId.trim()) baseParams.set('user_id', filterUserId.trim());
      if (filterFrom) baseParams.set('from', filterFrom);
      if (filterTo) baseParams.set('to', filterTo);
      const collected: AuditRow[] = [];
      const MAX_PAGES = 5;
      const LIMIT = 500;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const p = new URLSearchParams(baseParams);
        p.set('page', String(page));
        p.set('limit', String(LIMIT));
        const r = await apiFetch(`/api/admin/audit-logs?${p.toString()}`);
        const j = await r.json();
        if (!j.success) break;
        collected.push(...((j.data || []) as AuditRow[]));
        if (!j.pagination || !j.pagination.has_more) break;
      }
      setRows(collected);
    } finally { setLoading(false); }
  }, [filterAction, filterTargetType, filterUserId, filterFrom, filterTo]);

  useEffect(() => { void load(); }, [load]);

  const detail = useMemo(() => rows.find(r => r.id === detailId) || null, [rows, detailId]);

  // 사이클 N+62 — 그룹별 action options (재무/콘텐츠/보안 등)
  const actionOptions: PlanQSelectOption[] = useMemo(() => {
    const opts: PlanQSelectOption[] = [
      { value: 'all', label: t('adminAudit.actionAll', '전체 액션') as string },
    ];
    for (const group of ACTION_GROUPS) {
      const groupLabel = t(group.labelKey, group.labelKey) as string;
      for (const a of group.actions) {
        opts.push({ value: a, label: `[${groupLabel}] ${a}` });
      }
    }
    return opts;
  }, [t]);

  const targetTypeOptions: PlanQSelectOption[] = useMemo(() => [
    { value: 'all', label: t('adminAudit.targetTypeAll', '전체 대상') as string },
    ...COMMON_TARGET_TYPES.map(tt => ({ value: tt, label: tt })),
  ], [t]);

  return (
    <PageShell
      title={t('adminAudit.title', '감사 로그') as string}
      count={rows.length}
      actions={
        <FilterRow>
          <PlanQSelect size="sm" isSearchable={true}
            value={actionOptions.find(o => o.value === filterAction)}
            options={actionOptions}
            onChange={(opt) => setFilterAction((opt as PlanQSelectOption | null)?.value as string || 'all')}
          />
          <PlanQSelect size="sm" isSearchable={false}
            value={targetTypeOptions.find(o => o.value === filterTargetType)}
            options={targetTypeOptions}
            onChange={(opt) => setFilterTargetType((opt as PlanQSelectOption | null)?.value as string || 'all')}
          />
          <SmallInput type="number" placeholder={t('adminAudit.userIdPh', 'user ID') as string}
            value={filterUserId} onChange={e => setFilterUserId(e.target.value)} />
          <SingleDateField value={filterFrom} onChange={setFilterFrom} placeholder={t('adminAudit.fromPh', '시작') as string} size="sm" width={130} />
          <SingleDateField value={filterTo} onChange={setFilterTo} placeholder={t('adminAudit.toPh', '끝') as string} size="sm" width={130} minDate={filterFrom || undefined} />
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
              <DValue>{detail.User ? `${detail.User.name} (${detail.User.email})` : (detail.user_id ? `#${detail.user_id}` : t('adminAudit.system', '시스템'))}</DValue>
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
