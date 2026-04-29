import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { useAuth } from '../../contexts/AuthContext';
import OverviewTab from './OverviewTab';
import InvoicesTab from './InvoicesTab';
import PaymentsTab from './PaymentsTab';
import TaxInvoicesTab from './TaxInvoicesTab';

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
