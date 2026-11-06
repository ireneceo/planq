// 설정 › 멤버·고객 › «참여 신청» — 대표·관리자 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §5-5)
//   줄: 이름·이메일·어떻게 찾았나·한마디·신청일 · [승인(권한 멤버/관리자)] [거절].
//   승인은 확인창(«누구를 무슨 권한으로 · 남은 자리 n → n-1»). 자리가 0 이면 [승인] 비활성 + 이유.
//   실시간: 소켓 join_request:updated(신호만) → 다시 읽기 · 탭 복귀 때도.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import LetterAvatar from '../Common/LetterAvatar';
import PlanQSelect from '../Common/PlanQSelect';
import { formatDay } from '../../utils/dateFormat';
import { onSocket } from '../../services/socket';
import { getJoinRequests, approveJoinRequest, rejectJoinRequest, JoinApiError, type PendingJoinRequest } from '../../services/join';

/** 탭 이름 옆 대기 수 — 같은 목록 API 를 읽는다(숫자가 목록과 갈라지지 않게). */
export function useJoinPendingCount(businessId: number | null, enabled: boolean): number {
  const [n, setN] = useState(0);
  const load = useCallback(async () => {
    if (!businessId || !enabled) return;
    try { const d = await getJoinRequests(businessId); setN(d.requests.filter((r) => !r.expired).length); } catch { setN(0); }
  }, [businessId, enabled]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!enabled) return undefined;
    const off = onSocket<{ business_id?: number }>('join_request:updated', (p) => { if (!p || p.business_id === businessId) void load(); });
    return off;
  }, [enabled, businessId, load]);
  return n;
}

const JoinRequestsPanel: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<PendingJoinRequest[] | null>(null);
  const [seats, setSeats] = useState<number | null>(null);
  const [roles, setRoles] = useState<Record<number, 'member' | 'admin'>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'approve' | 'reject'; row: PendingJoinRequest } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await getJoinRequests(businessId);
      setRows(d.requests); setSeats(d.seats_remaining);
    } catch { setErr(t('joinRequests.loadFailed', '참여 신청을 불러오지 못했어요.') as string); }
  }, [businessId, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const off = onSocket<{ business_id?: number }>('join_request:updated', (p) => { if (!p || p.business_id === businessId) void load(); });
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { off(); document.removeEventListener('visibilitychange', onVis); };
  }, [businessId, load]);

  const run = async () => {
    if (!confirm) return;
    const { kind, row } = confirm;
    setConfirm(null); setBusy(row.id); setErr('');
    try {
      if (kind === 'approve') await approveJoinRequest(businessId, row.id, roles[row.id] || 'member');
      else await rejectJoinRequest(businessId, row.id, note.trim() || undefined);
      setNote('');
      await load();
    } catch (e) {
      const code = e instanceof JoinApiError ? String(e.body?.code || e.message) : '';
      setErr(code.includes('quota') ? t('joinRequests.quota', '자리가 없습니다 · 요금제에서 멤버 자리를 늘려 주세요.') as string
        : t('joinRequests.failed', '처리하지 못했어요. 잠시 뒤 다시 해 주세요.') as string);
      await load();
    } finally { setBusy(null); }
  };

  const roleLabel = (r: 'member' | 'admin') => (r === 'admin' ? t('joinRequests.roleAdmin', '관리자') : t('joinRequests.roleMember', '멤버'));
  const noSeat = seats !== null && seats <= 0;

  return (
    <Card data-testid="join-requests-panel">
      <Title>{t('joinRequests.title', '참여 신청')}</Title>
      <Desc>
        {t('joinRequests.desc', '회사 메일이나 참여 코드로 이 워크스페이스를 찾아 신청한 사람입니다. 14일 안에 승인하지 않으면 사라집니다.')}
        {seats !== null && <> {t('joinRequests.seats', { n: seats, defaultValue: '· 남은 자리 {{n}}명' })}</>}
      </Desc>
      {noSeat && <Warn>{t('joinRequests.noSeat', '자리가 없어 지금은 승인할 수 없습니다 · 설정 › 요금제에서 늘릴 수 있어요.')}</Warn>}
      {err && <Warn role="alert">{err}</Warn>}
      {rows && rows.length === 0 && <Empty>{t('joinRequests.empty', '들어온 참여 신청이 없습니다.')}</Empty>}
      {(rows || []).map((r) => (
        <Item key={r.id} $expired={r.expired} data-testid="join-request-row">
          <LetterAvatar name={r.user?.name || '?'} size={36} />
          <Main>
            <Name>{r.user?.name}</Name>
            <Meta>
              <span>{r.user?.email}</span>
              <span>{r.source === 'domain' ? t('joinRequests.viaDomain', '회사 메일') : t('joinRequests.viaCode', '참여 코드')}</span>
              <span>{formatDay(r.requested_at)}</span>
              {r.expired && <span>{t('joinRequests.expired', '기한 지남')}</span>}
            </Meta>
            {r.message && <Msg>{r.message}</Msg>}
          </Main>
          {!r.expired && (
            <Actions>
              <RoleSlot data-testid="join-request-role">
                <PlanQSelect
                  size="sm"
                  aria-label={t('joinRequests.roleLabel', '권한') as string}
                  options={[{ value: 'member', label: roleLabel('member') as string }, { value: 'admin', label: roleLabel('admin') as string }]}
                  value={{ value: roles[r.id] || 'member', label: roleLabel(roles[r.id] || 'member') as string }}
                  onChange={(opt) => setRoles((m) => ({ ...m, [r.id]: (opt as { value: string } | null)?.value === 'admin' ? 'admin' : 'member' }))}
                />
              </RoleSlot>
              <ActionButton tone="primary" size="sm" disabled={noSeat || busy === r.id} onClick={() => setConfirm({ kind: 'approve', row: r })} data-testid="join-request-approve">
                {t('joinRequests.approve', '승인')}
              </ActionButton>
              <ActionButton tone="secondary" size="sm" disabled={busy === r.id} onClick={() => { setNote(''); setConfirm({ kind: 'reject', row: r }); }} data-testid="join-request-reject">
                {t('joinRequests.reject', '거절')}
              </ActionButton>
            </Actions>
          )}
        </Item>
      ))}

      <ConfirmDialog
        isOpen={confirm?.kind === 'approve'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { void run(); }}
        title={t('joinRequests.approveTitle', '참여를 승인할까요?') as string}
        message={confirm?.kind === 'approve' ? [
          t('joinRequests.approveBody', { name: confirm.row.user?.name || '', role: roleLabel(roles[confirm.row.id] || 'member'), defaultValue: '{{name}} 님을 {{role}} 권한으로 들입니다.' }) as string,
          seats !== null ? t('joinRequests.approveSeats', { from: seats, to: Math.max(0, seats - 1), defaultValue: '남은 자리 {{from}} → {{to}}' }) as string : '',
        ].filter(Boolean).join('\n') : ''}
        confirmText={t('joinRequests.approve', '승인') as string}
        cancelText={t('joinRequests.cancel', '취소') as string}
        variant="info"
      />
      <ConfirmDialog
        isOpen={confirm?.kind === 'reject'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { void run(); }}
        title={t('joinRequests.rejectTitle', '참여 신청을 거절할까요?') as string}
        message={t('joinRequests.rejectBody', { name: confirm?.row.user?.name || '', defaultValue: '{{name}} 님에게 «승인되지 않았어요» 알림이 가고, 7일 뒤 다시 신청할 수 있습니다.' }) as string}
        confirmText={t('joinRequests.reject', '거절') as string}
        cancelText={t('joinRequests.cancel', '취소') as string}
        variant="warning"
      />
    </Card>
  );
};

export default JoinRequestsPanel;

const Card = styled.section`
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 16px;
`;
const Title = styled.h2`font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0 0 4px;`;
const Desc = styled.p`font-size: 0.8125rem; color: #64748b; margin: 0 0 12px;`;
const Warn = styled.div`font-size: 0.75rem; color: #b45309; margin-bottom: 8px;`;
const Empty = styled.div`font-size: 0.8125rem; color: #94a3b8; padding: 8px 0;`;
const Item = styled.div<{ $expired: boolean }>`
  display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid #f1f5f9;
  opacity: ${(p) => (p.$expired ? 0.55 : 1)};
  @media (max-width: 640px) { flex-wrap: wrap; }
`;
const Main = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;`;
const Name = styled.div`font-size: 0.875rem; font-weight: 700; color: #0f172a;`;
const Meta = styled.div`display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.75rem; color: #64748b; span { overflow-wrap: anywhere; }`;
const Msg = styled.div`font-size: 0.8125rem; color: #334155; background: #f8fafc; border-radius: 8px; padding: 6px 10px;`;
const Actions = styled.div`
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  @media (max-width: 640px) { width: 100%; justify-content: flex-end; }
`;
const RoleSlot = styled.div`width: 110px;`;
