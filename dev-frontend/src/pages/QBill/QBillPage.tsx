import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { useAuth } from '../../contexts/AuthContext';
import OverviewTab from './OverviewTab';
import InvoicesTab from './InvoicesTab';
import PaymentsTab from './PaymentsTab';
import TaxInvoicesTab from './TaxInvoicesTab';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

type Tab = 'overview' | 'invoices' | 'payments' | 'tax-invoices';

const ALL_TABS: Tab[] = ['overview', 'invoices', 'payments', 'tax-invoices'];
// client 시점에는 owner 의 운영 메트릭 탭(overview)을 숨기고 받은 청구서 위주.
const CLIENT_TABS: Tab[] = ['invoices', 'payments', 'tax-invoices'];

function readTab(search: string, allowed: Tab[]): Tab {
  const t = new URLSearchParams(search).get('tab') as Tab | null;
  return t && allowed.includes(t) ? t : allowed[0];
}

export default function QBillPage() {
  const { t } = useTranslation('qbill');
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const TABS = useMemo<Tab[]>(() => (isClient ? CLIENT_TABS : ALL_TABS), [isClient]);

  // 레거시 ?tab=settings 진입 → 통합 설정으로 자동 redirect
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get('tab') === 'settings') {
      navigate('/business/settings/billing', { replace: true });
    }
  }, [location.search, navigate]);

  const [tab, setTab] = useState<Tab>(() => readTab(location.search, TABS));
  // 탭별 할 일 수 (청구서 확인·발행 대기 / 입금 알림 / 증빙 발행)
  const [todoCounts, setTodoCounts] = useState<Record<string, number>>({});
  const aliveRef = useRef(true);
  // #217 — 증빙 발행 마킹을 해도 이 뱃지 숫자가 안 바뀌던 결함.
  //   백엔드(routes/invoices.js)는 마킹 4경로 전부 socket 으로 inbox:refresh 를 쏘고 있었는데,
  //   여기서는 **window CustomEvent 만** 듣고 있었다. 같은 페이지의 TaxInvoicesTab 은 socket 을 들어
  //   리스트는 갱신되는데 그 위 탭 뱃지만 멈춰 있었다 (CLAUDE.md §16 채널 불일치).
  const loadCounts = useCallback(async () => {
    try {
      const r = await apiFetch('/api/dashboard/todo');
      const j = await r.json();
      if (aliveRef.current && j.success) setTodoCounts(j.data?.billTabCounts || {});
    } catch { /* 뱃지는 부가 — 실패해도 화면은 동작 */ }
  }, []);
  useEffect(() => {
    aliveRef.current = true;
    loadCounts();
    // socket 과 window 를 **같은 debounce** 로 묶는다 — 둘 다 와도 한 번만 부른다 (§16 (c)(e)).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(loadCounts, 250);
    };
    // business room join 은 필요 없다 — server.js 의 autoJoinUserBusinesses 가 연결 시 이미 넣는다.
    const offUpdated = onSocket('invoice:updated', debounced);
    const offInbox = onSocket('inbox:refresh', debounced);
    const offDeleted = onSocket('invoice:deleted', debounced);   // draft 삭제도 뱃지를 바꾼다
    window.addEventListener('inbox:refresh', debounced);
    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
      offUpdated(); offInbox(); offDeleted();
      window.removeEventListener('inbox:refresh', debounced);
    };
  }, [loadCounts]);
  // PWA background → foreground 복귀 시 놓친 이벤트 회복 (§16 (d))
  useVisibilityRefresh(loadCounts);

  useEffect(() => { setTab(readTab(location.search, TABS)); }, [location.search, TABS]);

  const switchTab = (next: Tab) => {
    const sp = new URLSearchParams(location.search);
    if (next === TABS[0]) sp.delete('tab'); else sp.set('tab', next);
    sp.delete('invoice');
    navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
  };

  return (
    <PageShell title={isClient ? t('page.titleClient', '받은 청구서') : t('page.title', 'Q bill')} bodyPadding="0">
      <TabBar role="tablist">
        {TABS.map((k) => (
          <TabBtn
            key={k}
            role="tab"
            aria-selected={tab === k}
            $active={tab === k}
            onClick={() => switchTab(k)}
          >
            {t(`page.tabs.${k === 'tax-invoices' ? 'taxInvoices' : k}`)}
            {/* 할 일 숫자 — 좌측 메뉴에만 뜨고 어느 탭에 할 일이 있는지는 알 수 없었다 (#140) */}
            {(todoCounts[k] || 0) > 0 && <TabCount $active={tab === k}>{todoCounts[k]}</TabCount>}
          </TabBtn>
        ))}
      </TabBar>
      <Body>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'invoices' && <InvoicesTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'tax-invoices' && <TaxInvoicesTab />}
      </Body>
    </PageShell>
  );
}

const TabBar = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 20px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  overflow-x: auto;
  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const TabBtn = styled.button<{ $active: boolean }>`
  padding: 12px 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? '#0D9488' : 'transparent')};
  color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.1s, border-color 0.1s;
  &:hover { color: #0F172A; }
`;

const Body = styled.div`
  padding: 20px;
`;

// 탭 옆 할 일 숫자
const TabCount = styled.span<{ $active: boolean }>`
  margin-left: 6px; padding: 0 6px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; font-size: 10px; font-weight: 700;
  color: ${(p) => (p.$active ? '#0F766E' : '#B45309')};
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FEF3C7')};
`;
