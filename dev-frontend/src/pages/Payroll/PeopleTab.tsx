// 급여 › 대상자 탭 (docs/PAYROLL_DESIGN.md §9) — 대상자 목록(멤버 + 계정 없는 프리랜서) → 상세 드로어(기본 정보·지급 계좌·계약 이력).
//   실시간: payroll:updated(개인 방 신호) → 250ms 뒤 다시 읽기 + 탭 복귀 재조회.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PlanQSelect from '../../components/Common/PlanQSelect';
import LetterAvatar from '../../components/Common/LetterAvatar';
import ActionButton from '../../components/Common/ActionButton';
import { FilterBar, FilterSearchSlot, FilterSlot, FilterRight, axisOption } from '../../components/Common/filterBar';
import { useAuth } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { listRowTitleCss } from '../../theme/tokens';
import { payrollApi, formatMoney, type PersonSummary } from './payrollApi';
import PersonDrawer from './PersonDrawer';
import PersonCreateDrawer from './PersonCreateDrawer';

export default function PeopleTab({ createOpen, setCreateOpen }: { createOpen: boolean; setCreateOpen: (v: boolean) => void }) {
  const { t, i18n } = useTranslation('payroll');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'left'>('');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('person') ? Number(params.get('person')) : null;
  const seqRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!bizId) return;
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    try {
      const rows = await payrollApi.people(bizId);
      if (seq !== seqRef.current) return;
      setPeople(rows);   // 서버 응답으로 통째 교체(실시간·복귀 재조회 계약)
      setError(false);
    } catch {
      if (seq === seqRef.current && !silent) setError(true);
    } finally {
      if (seq === seqRef.current && !silent) setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { load(); }, [load]);
  const silentLoad = useCallback(() => load(true), [load]);
  useVisibilityRefresh(silentLoad);
  useEffect(() => {
    let pending: number | null = null;
    const off = onSocket<{ business_id?: number }>('payroll:updated', (d) => {
      if (d?.business_id && Number(d.business_id) !== bizId) return;
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    });
    return () => { off(); if (pending) window.clearTimeout(pending); };
  }, [bizId, silentLoad]);

  // 멤버 상세의 «계약 이력 보기»(?user=<user_id>) — 그 멤버의 대상자를 연다. 없으면 목록만(대상자로 넣지 않은 멤버).
  const userParam = params.get('user');
  useEffect(() => {
    if (!userParam || loading) return;
    const p = people.find((x) => String(x.user_id) === userParam);
    const next = new URLSearchParams(params);
    next.delete('user');
    if (p) next.set('person', String(p.id));
    setParams(next, { replace: true });
  }, [userParam, loading, people]);   // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => (!status || p.status === status)
      && (!needle || p.display_name.toLowerCase().includes(needle) || (p.employee_no || '').toLowerCase().includes(needle)));
  }, [people, q, status]);

  const openPerson = (id: number) => {
    const next = new URLSearchParams(params);
    if (selectedId === id) next.delete('person'); else next.set('person', String(id));   // 재클릭 토글
    setParams(next, { replace: true });
  };
  const closePerson = () => { const next = new URLSearchParams(params); next.delete('person'); setParams(next, { replace: true }); };

  const statusOptions = [axisOption(t('people.statusAxis')), { value: 'active', label: t('people.statusActive') }, { value: 'left', label: t('people.statusLeft') }];

  return (
    <>
      <FilterBar>
        <FilterSearchSlot>
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('people.searchPlaceholder') as string}
            aria-label={t('people.searchPlaceholder') as string} />
        </FilterSearchSlot>
        <FilterRight>
          <FilterSlot width={130} testId="payroll-status-filter">
            <PlanQSelect size="sm"
              value={statusOptions.find((o) => o.value === status) || statusOptions[0]}
              onChange={(v) => setStatus(((v as { value?: string })?.value || '') as '' | 'active' | 'left')}
              options={statusOptions} />
          </FilterSlot>
        </FilterRight>
      </FilterBar>

      {loading ? null : error ? (
        <Empty>
          <span>{t('people.loadFailed')}</span>
          <ActionButton tone="secondary" onClick={() => load()}>{t('people.retry')}</ActionButton>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>{people.length === 0 ? t('people.empty') : t('people.emptyFiltered')}</Empty>
      ) : (
        <List data-testid="payroll-people">
          {filtered.map((p) => (
            <Row key={p.id} type="button" $active={selectedId === p.id} $dim={p.status === 'left'}
              data-testid="payroll-person-row" onClick={() => openPerson(p.id)}>
              <LetterAvatar name={p.display_name} size={32} />
              <RowMain>
                <RowTitle>{p.display_name}{p.employee_no ? <EmpNo>{p.employee_no}</EmpNo> : null}</RowTitle>
                <RowMeta>
                  {[p.job_title, t(`incomeKind.${p.income_kind}`), p.status === 'left' ? t('people.statusLeft') : null].filter(Boolean).join(' · ')}
                </RowMeta>
              </RowMain>
              <RowRight>
                {p.current_contract ? (
                  <>
                    <Chip>{t(`kind.${p.current_contract.kind}`)}</Chip>
                    <Amount>{formatMoney(p.current_contract.monthly_total, p.current_contract.currency, i18n.language)}</Amount>
                  </>
                ) : <Muted>{t('people.noContract')}</Muted>}
              </RowRight>
            </Row>
          ))}
        </List>
      )}

      {bizId && (
        <PersonCreateDrawer open={createOpen} businessId={bizId} onClose={() => setCreateOpen(false)}
          onCreated={(p) => { setCreateOpen(false); silentLoad(); openPerson(p.id); }} />
      )}
      {bizId && selectedId !== null && (
        <PersonDrawer key={selectedId} businessId={bizId} personId={selectedId} onClose={closePerson}
          onChanged={silentLoad} onDeleted={() => { closePerson(); silentLoad(); }} />
      )}
    </>
  );
}

const SearchInput = styled.input`
  width: 100%; height: 36px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.875rem; font-family: inherit; background: #FFF; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const List = styled.div`
  margin-top: 12px; background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
`;
const Row = styled.button<{ $active: boolean; $dim: boolean }>`
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 60px;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFF')}; border: none; border-bottom: 1px solid #F1F5F9;
  text-align: left; cursor: pointer; font-family: inherit; opacity: ${(p) => (p.$dim ? 0.6 : 1)};
  &:last-child { border-bottom: none; }
  &:hover { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const RowMain = styled.div`flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowTitle = styled.span`
  ${listRowTitleCss} color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const EmpNo = styled.span`margin-left: 8px; font-size: 0.75rem; font-weight: 500; color: #94A3B8;`;
const RowMeta = styled.span`font-size: 0.75rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const RowRight = styled.div`flex: 0 0 auto; display: flex; align-items: center; gap: 8px;`;
const Chip = styled.span`
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
  background: #F1F5F9; color: #475569; font-size: 0.75rem; font-weight: 600;
`;
const Amount = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A; font-variant-numeric: tabular-nums;`;
const Muted = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const Empty = styled.div`
  margin-top: 12px; padding: 40px 16px; text-align: center; color: #64748B; font-size: 0.875rem;
  background: #FFF; border: 1px dashed #E2E8F0; border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
`;
