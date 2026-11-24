// 설정 › 근태 관리 — «확인할 정정» + 설정 «본인 수정은 승인 후 반영» (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §6)
//
// 끔(기본 · #392 그대로): 본인이 고치면 바로 반영 → 관리자는 [확인함] 체크만(여러 건 «모두 확인함»).
//   동의하지 않으면 반려가 아니라 팀 표의 [정정](관리자 정정)으로 고친다.
// 켬: 본인 수정은 승인 대기 → [승인](그때 반영) / [반려](사유 필수). 승인 전까지는 원래 찍힌 값으로 계산한다.
// 켬→끔이어도 이미 대기 중인 건은 남는다 — 여기서 계속 처리한다.
// 실시간: 요청이 생기거나 처리되면 서버가 대표·관리자 개인 방에 `attendance:fix_updated` 신호를 보낸다(동료는 모른다).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import ActionButton from '../../components/Common/ActionButton';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { fixChanges } from '../Attendance/SelfFixBadge';
import { punctText } from '../Attendance/PunctBadge';   // 고정 근무 — 이 정정으로 판정이 어떻게 바뀌나
import type { Punct, SelfFix } from '../../hooks/useAttendance';

interface FixRow extends Omit<SelfFix, 'request_id'> {
  id: number;
  user_id: number;
  user_name: string | null;
  work_date: string;
  created_at: string | null;
  /** 고정 근무일 때만 — 정정 전 스냅숏 판정 / 지금 판정 (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §5.4) */
  punct_before?: Punct | null;
  punct_after?: Punct | null;
}

export default function AttendanceFixSection({ businessId }: { businessId: number }) {
  const { t } = useTranslation('attendance');
  const [approval, setApproval] = useState<boolean | null>(null);
  const wantRef = useRef<boolean | null>(null);
  const [rows, setRows] = useState<FixRow[]>([]);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      apiFetch(`/api/attendance/fix-settings?business_id=${businessId}`),
      apiFetch(`/api/attendance/fix-requests?business_id=${businessId}&scope=all&status=pending,applied&limit=200`),
    ]);
    if (s.ok) {
      const j = await s.json().catch(() => null);
      if (j?.success) { setApproval(!!j.data.attendance_fix_approval); wantRef.current = !!j.data.attendance_fix_approval; }
    }
    if (l.ok) {
      const j = await l.json().catch(() => null);
      if (j?.success && Array.isArray(j.data)) setRows(j.data);
    }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    let timer: number | null = null;
    const debounced = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, 250);
    };
    const off = onSocket('attendance:fix_updated', debounced);
    window.addEventListener('socket:reconnected', debounced);
    return () => { if (timer) window.clearTimeout(timer); off(); window.removeEventListener('socket:reconnected', debounced); };
  }, [load]);

  const persistApproval = async () => {
    const next = wantRef.current;
    if (next === null) return;
    const r = await apiFetch('/api/attendance/fix-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId, attendance_fix_approval: next }),
    });
    if (!r.ok) { setApproval(!next); wantRef.current = !next; throw new Error('save_failed'); }
  };

  const post = async (key: number | 'all', path: string, body: Record<string, unknown>) => {
    if (busy !== null) return false;
    setBusy(key); setError(null);
    try {
      const r = await apiFetch(`/api/attendance/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, ...body }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setError(t(`fixAdmin.err.${j?.message}`, { defaultValue: t('fixAdmin.err.generic') as string }) as string);
        return false;
      }
      await load();
      return true;
    } finally { setBusy(null); }
  };

  // 판정이 바뀌는 정정(«지각 25분 → 정상»)은 그 묶음 맨 위로 — 조용히 넘어가지 않게(§5.4)
  const punctChange = (r: FixRow) => {
    if (!r.punct_before || !r.punct_after?.applicable) return null;
    const a = punctText(r.punct_before, t); const b = punctText(r.punct_after, t);
    return a !== b ? { a, b } : null;
  };
  const changedFirst = (list: FixRow[]) => [...list].sort((x, y) => Number(!!punctChange(y)) - Number(!!punctChange(x)));
  const pending = changedFirst(rows.filter((r) => r.status === 'pending'));
  const unconfirmed = changedFirst(rows.filter((r) => r.status === 'applied'));

  const renderRow = (r: FixRow) => {
    const changes = fixChanges({ ...r, request_id: r.id } as SelfFix);
    return (
      <Item key={r.id} data-testid="attn-fixreq-row">
        <ItemMain>
          <ItemHead><b>{r.user_name || `#${r.user_id}`}</b><span>{r.work_date}</span></ItemHead>
          {changes.map((c) => (
            <div key={c.kind}>{t(c.kind === 'in' ? 'fix.changeIn' : 'fix.changeOut', { from: c.from, to: c.to })}</div>
          ))}
          {(() => { const pc = punctChange(r); return pc ? <PunctChange data-testid="attn-fixreq-punct">{t('punct.fixChanges', { before: pc.a, after: pc.b })}</PunctChange> : null; })()}
          {r.reason && <Muted>{t('fix.reasonLine', { reason: r.reason })}</Muted>}
          {rejecting === r.id && (
            <RejectBox>
              {/* draft-exempt: 관리자 반려 사유 한두 줄 — 그 줄에서 쓰고 바로 보낸다(접으면 반려도 없다) */}
              <textarea rows={2} maxLength={300} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t('fixAdmin.rejectPh') as string} aria-label={t('fixAdmin.rejectPh') as string} data-testid="attn-fixreq-reject-note" />
              <Btns>
                <ActionButton tone="secondary" size="sm" onClick={() => { setRejecting(null); setRejectNote(''); }}>{t('correct.cancel')}</ActionButton>
                <ActionButton tone="danger" size="sm" disabled={!rejectNote.trim()} loading={busy === r.id}
                  data-testid="attn-fixreq-reject-send"
                  onClick={async () => {
                    if (await post(r.id, `fix-requests/${r.id}/reject`, { decide_note: rejectNote.trim() })) { setRejecting(null); setRejectNote(''); }
                  }}>{t('fixAdmin.reject')}</ActionButton>
              </Btns>
            </RejectBox>
          )}
        </ItemMain>
        <Btns>
          {r.status === 'pending' && rejecting !== r.id && (
            <>
              <ActionButton tone="secondary" size="sm" disabled={busy !== null} onClick={() => { setRejecting(r.id); setRejectNote(''); }} data-testid="attn-fixreq-reject">
                {t('fixAdmin.reject')}
              </ActionButton>
              <ActionButton tone="primary" size="sm" loading={busy === r.id} disabled={busy !== null && busy !== r.id}
                onClick={() => post(r.id, `fix-requests/${r.id}/approve`, {})} data-testid="attn-fixreq-approve">
                {t('fixAdmin.approve')}
              </ActionButton>
            </>
          )}
          {r.status === 'applied' && (
            <ActionButton tone="secondary" size="sm" loading={busy === r.id} disabled={busy !== null && busy !== r.id}
              onClick={() => post(r.id, 'fix-requests/confirm', { ids: [r.id] })} data-testid="attn-fixreq-confirm">
              {t('fixAdmin.confirm')}
            </ActionButton>
          )}
          {r.status !== 'pending' && r.status !== 'applied' && <Muted>{t(`fix.status.${r.status}`, { defaultValue: r.status })}</Muted>}
        </Btns>
      </Item>
    );
  };

  return (
    <Card data-testid="attn-fix-section">
      <Row>
        <RowText>
          <RowLabel id="attn-fix-approval-label">{t('fixAdmin.approvalTitle')}</RowLabel>
          <RowDesc>{approval ? t('fixAdmin.approvalOnDesc') : t('fixAdmin.approvalOffDesc')}</RowDesc>
        </RowText>
        {approval !== null && (
          <AutoSaveField key={`attn-fix-approval-${businessId}`} type="toggle" onSave={persistApproval}>
            <Switch type="button" role="switch" aria-checked={approval} aria-labelledby="attn-fix-approval-label"
              data-testid="attn-fix-approval-toggle" $on={approval}
              onClick={() => { const n = !approval; wantRef.current = n; setApproval(n); }}>
              <SwitchKnob $on={approval} />
            </Switch>
          </AutoSaveField>
        )}
      </Row>

      <ListHead>
        <span>{t('fixAdmin.listTitle')}</span>
        {unconfirmed.length > 1 && (
          <ActionButton tone="secondary" size="sm" loading={busy === 'all'} disabled={busy !== null && busy !== 'all'}
            onClick={() => post('all', 'fix-requests/confirm', { ids: unconfirmed.map((r) => r.id) })} data-testid="attn-fixreq-confirm-all">
            {t('fixAdmin.confirmAll', { count: unconfirmed.length })}
          </ActionButton>
        )}
      </ListHead>
      {error && <Err role="alert">{error}</Err>}
      {rows.length === 0 ? (
        <Empty>{t('fixAdmin.empty')}</Empty>
      ) : (
        <>
          {pending.length > 0 && <Group>{t('fixAdmin.pendingGroup', { count: pending.length })}</Group>}
          {pending.map(renderRow)}
          {unconfirmed.length > 0 && <Group>{t('fixAdmin.unconfirmedGroup', { count: unconfirmed.length })}</Group>}
          {unconfirmed.map(renderRow)}
        </>
      )}
    </Card>
  );
}

const Card = styled.section`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;`;
const Row = styled.div`display: flex; align-items: center; gap: 16px; justify-content: space-between;`;
const RowText = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const RowLabel = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const RowDesc = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const ListHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin: 16px 0 8px; padding-top: 14px; border-top: 1px solid #F1F5F9;
  font-size: 0.8125rem; font-weight: 700; color: #334155;
`;
const Group = styled.div`margin: 10px 0 6px; font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Item = styled.div`
  display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid #F1F5F9; font-size: 0.8125rem; color: #0F172A; line-height: 1.5;
  @media (max-width: 640px) { flex-direction: column; }
`;
const ItemMain = styled.div`min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px;`;
const ItemHead = styled.div`display: flex; gap: 8px; align-items: baseline; span { color: #64748B; font-size: 0.75rem; }`;
const Btns = styled.div`display: flex; gap: 6px; flex-shrink: 0; align-items: center;`;
const Muted = styled.div`color: #64748B; font-size: 0.75rem;`;
const PunctChange = styled.div`font-size: 0.75rem; font-weight: 600; color: #9F1239;`;
const Empty = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 8px 0;`;
const Err = styled.div`font-size: 0.75rem; color: #BE123C; margin-bottom: 8px;`;
const RejectBox = styled.div`
  margin-top: 6px; display: flex; flex-direction: column; gap: 6px;
  textarea {
    width: 100%; box-sizing: border-box; border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px;
    font-size: 0.8125rem; font-family: inherit; resize: vertical;
    &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
  }
`;
