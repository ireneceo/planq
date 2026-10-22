// 휴가 잔여 — 종류별로 보이게 (2026-10-22, Irene: «몇 개 쓴건지도 알아야 하는데 팀통계 표시에서만 보이네» ·
//   «부여한 것도 관리하고 수정 삭제 해야지»).
//   숫자는 전부 서버 getBalance 한 벌(by_type) — 화면이 따로 세지 않는다(승인 판정과 같은 공식).
//   · ByTypeList — 내 휴가 카드 안: 종류마다 «남음 / 부여 · 사용 · 신청 중»
//   · LeaveBalancesSection — 설정 › 근태 관리: 멤버 × 종류 표 + 줄을 누르면 그 사람의 부여 이력(고치기·지우기)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import AutoSaveField from '../../components/Common/AutoSaveField';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { labelOf, type LeaveTypeBrief } from './leaveTypes';
import { Section, SectionTitle, Empty, TableWrap, Table, Th, Td, Muted, Hint } from './shared';

export interface TypeBalance extends LeaveTypeBrief {
  is_active?: boolean; granted: number; used: number; pending: number; remaining: number;
}

/** 이 종류를 보여줄 만한가 — 부여·사용·신청 중 숫자가 하나라도 있을 때만(0 만 늘어선 줄은 읽을 거리가 없다) */
const worthShowing = (b: TypeBalance) => b.granted !== 0 || b.used !== 0 || b.pending !== 0;

// ─── 내 휴가 카드 안 ───────────────────────────────────────────
export const ByTypeList: React.FC<{ byType?: TypeBalance[] }> = ({ byType }) => {
  const { t } = useTranslation('attendance');
  const rows = (byType || []).filter(worthShowing);
  if (!rows.length) return null;
  return (
    <TypeList data-testid="leave-by-type">
      {rows.map((b) => (
        <TypeLine key={b.id}>
          <TypeName>{labelOf(b, t)}</TypeName>
          {b.pay === 'paid' ? (
            <TypeNums>
              <strong>{t('leave.byType.remaining', { n: b.remaining, defaultValue: '남음 {{n}}일' }) as string}</strong>
              <Muted>{t('leave.byType.detail', { g: b.granted, u: b.used, p: b.pending, defaultValue: '부여 {{g}} · 사용 {{u}} · 신청 중 {{p}}' }) as string}</Muted>
            </TypeNums>
          ) : (
            <TypeNums><Muted>{t('leave.byType.unpaidUsed', { u: b.used, p: b.pending, defaultValue: '무급 · 사용 {{u}}일 · 신청 중 {{p}}일' }) as string}</Muted></TypeNums>
          )}
        </TypeLine>
      ))}
    </TypeList>
  );
};

// ─── 설정 › 근태 관리: 팀 휴가 현황 ────────────────────────────
interface TeamRow { user_id: number; granted: number; used: number; remaining: number; by_type: TypeBalance[] }
interface GrantRow { id: number; year: number; days: number; note: string | null; leave_type_id: number; type: LeaveTypeBrief | null; created_at: string }

export const LeaveBalancesSection: React.FC<{
  bizId: number; year: number; nameOf: (id: number) => string; refreshKey?: number;
}> = ({ bizId, year, nameOf, refreshKey }) => {
  const { t } = useTranslation('attendance');
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/leave/team-balances?business_id=${bizId}&year=${year}`);
    const j = await r.json().catch(() => null);
    if (r.ok && j?.success) setRows(j.data.members || []);
  }, [bizId, year]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useVisibilityRefresh(load);
  useEffect(() => {
    const room = `business:${bizId}`;
    joinRoom(room);
    let timer: number | null = null;
    const debounced = () => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => { void load(); }, 250); };
    const offL = onSocket('leave:updated', debounced);
    const offT = onSocket('leave_type:updated', debounced);
    return () => { if (timer) window.clearTimeout(timer); offL(); offT(); leaveRoom(room); };
  }, [bizId, load]);

  // 열: 한 명이라도 보여줄 만한 종류(순서는 서버가 준 종류 순서)
  const cols: TypeBalance[] = [];
  for (const m of rows || []) for (const b of m.by_type) if (worthShowing(b) && !cols.some((c) => c.id === b.id)) cols.push(b);

  return (
    <Section data-testid="leave-balances-section">
      <SectionTitle>{t('leave.team.title', { year, defaultValue: '{{year}}년 휴가 현황' }) as string}</SectionTitle>
      {!rows ? null : rows.length === 0 ? <Empty>{t('leave.team.empty', '멤버가 없습니다') as string}</Empty> : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{t('team.member')}</Th>
                {cols.map((c) => <Th key={c.id}>{labelOf(c, t)}</Th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <React.Fragment key={m.user_id}>
                  <ClickRow data-testid={`leave-balance-row-${m.user_id}`} $open={open === m.user_id}
                    onClick={() => setOpen((o) => (o === m.user_id ? null : m.user_id))}>
                    <Td><strong>{nameOf(m.user_id)}</strong></Td>
                    {cols.map((c) => {
                      const b = m.by_type.find((x) => x.id === c.id);
                      if (!b) return <Td key={c.id}><Muted>—</Muted></Td>;
                      return (
                        <Td key={c.id}>
                          {b.pay === 'paid'
                            ? <><strong>{b.remaining}</strong><Muted>{` / ${b.granted}`}</Muted>{b.used ? <Muted>{` · ${t('leave.team.used', { n: b.used, defaultValue: '사용 {{n}}' })}`}</Muted> : null}</>
                            : <Muted>{t('leave.team.used', { n: b.used, defaultValue: '사용 {{n}}' }) as string}</Muted>}
                        </Td>
                      );
                    })}
                  </ClickRow>
                  {open === m.user_id && (
                    <tr><Td colSpan={cols.length + 1} style={{ background: '#F8FAFC', whiteSpace: 'normal' }}>
                      <GrantHistory bizId={bizId} year={year} userId={m.user_id} onChanged={load} />
                    </Td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Hint>{t('leave.team.hint', '숫자는 «남음 / 부여». 줄을 누르면 그 멤버의 부여 이력을 고치거나 지울 수 있어요.') as string}</Hint>
    </Section>
  );
};

const GrantHistory: React.FC<{ bizId: number; year: number; userId: number; onChanged: () => Promise<void> | void }> =
({ bizId, year, userId, onChanged }) => {
  const { t } = useTranslation('attendance');
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<GrantRow | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/leave/grants?business_id=${bizId}&user_id=${userId}&year=${year}`);
    const j = await r.json().catch(() => null);
    if (r.ok && j?.success) {
      setGrants(j.data);
      setDrafts(Object.fromEntries((j.data as GrantRow[]).map((g) => [g.id, String(g.days)])));
    }
  }, [bizId, userId, year]);
  useEffect(() => { void load(); }, [load]);

  const errText = (code: string) => t(`leave.team.err.${code}`, { defaultValue: t('error.generic') as string }) as string;
  const persistDays = async (id: number) => {
    const v = draftsRef.current[id];
    const r = await apiFetch(`/api/leave/grants/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: Number(v) }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setErr(errText(j?.message || 'generic')); await load(); throw new Error(j?.message || 'save_failed'); }
    setErr(null);
    await onChanged();
  };
  const remove = async (g: GrantRow) => {
    setConfirmDel(null);
    const r = await apiFetch(`/api/leave/grants/${g.id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setErr(errText(j?.message || 'generic')); return; }
    setErr(null);
    await load();
    await onChanged();
  };

  if (!grants) return null;
  return (
    <div data-testid={`leave-grant-history-${userId}`}>
      {grants.length === 0 ? <Muted>{t('leave.team.noGrants', '올해 부여한 휴가가 없습니다') as string}</Muted> : (
        <GrantList>
          {grants.map((g) => (
            <GrantLine key={g.id} data-testid={`leave-grant-${g.id}`}>
              <GrantType>{g.type ? labelOf(g.type, t) : '—'}</GrantType>
              <AutoSaveField key={`grant-days-${g.id}`} type="input" onSave={() => persistDays(g.id)}>
                <DaysInput type="number" step="0.5" inputMode="decimal" value={drafts[g.id] ?? ''}
                  aria-label={t('leave.grantDays') as string} data-testid={`leave-grant-days-${g.id}`}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.id]: e.target.value }))} />
              </AutoSaveField>
              <Muted>{t('leave.team.days', '일') as string}</Muted>
              <GrantNote>{g.note || ''}</GrantNote>
              <Muted>{(g.created_at || '').slice(0, 10)}</Muted>
              {/* autosave-exempt: 삭제는 액션이다(확인창을 거친다) */}
              <DelBtn type="button" data-testid={`leave-grant-delete-${g.id}`}
                aria-label={t('leave.team.delete', '삭제') as string} title={t('leave.team.delete', '삭제') as string}
                onClick={() => setConfirmDel(g)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </DelBtn>
            </GrantLine>
          ))}
        </GrantList>
      )}
      {err && <ErrLine role="alert">{err}</ErrLine>}
      <ConfirmDialog
        isOpen={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => { if (confirmDel) void remove(confirmDel); }}
        title={t('leave.team.deleteTitle', '부여 지우기') as string}
        message={confirmDel ? t('leave.team.deleteMsg', {
          type: confirmDel.type ? labelOf(confirmDel.type, t) : '', days: confirmDel.days,
          defaultValue: '{{type}} {{days}}일 부여를 지웁니다. 남은 휴가에서 그만큼 빠집니다.',
        }) as string : ''}
        confirmText={t('leave.team.delete', '삭제') as string}
        variant="danger"
      />
    </div>
  );
};

const TypeList = styled.div` display: flex; flex-direction: column; gap: 6px; padding-top: 4px; border-top: 1px solid #F1F5F9; `;
const TypeLine = styled.div` display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 0.8125rem; `;
const TypeName = styled.span` min-width: 72px; font-weight: 600; color: #334155; `;
const TypeNums = styled.span` display: inline-flex; gap: 8px; flex-wrap: wrap; strong { color: #0F172A; } `;
const ClickRow = styled.tr<{ $open: boolean }>`
  cursor: pointer;
  background: ${(p) => (p.$open ? '#F0FDFA' : 'transparent')};
  &:hover { background: ${(p) => (p.$open ? '#F0FDFA' : '#F8FAFC')}; }
`;
const GrantList = styled.div` display: flex; flex-direction: column; gap: 6px; `;
const GrantLine = styled.div` display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.8125rem; `;
const GrantType = styled.span` min-width: 72px; font-weight: 600; color: #334155; `;
const GrantNote = styled.span` flex: 1 1 120px; min-width: 0; color: #475569; overflow: hidden; text-overflow: ellipsis; `;
const DaysInput = styled.input`
  width: 80px; height: 32px; padding: 0 8px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.8125rem; font-variant-numeric: tabular-nums;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const DelBtn = styled.button`
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 8px; color: #94A3B8; cursor: pointer;
  &:hover { background: #FEF2F2; color: #DC2626; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const ErrLine = styled.div` margin-top: 6px; font-size: 0.75rem; color: #DC2626; `;
