import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import OverviewTab from './OverviewTab';
import QuotesTab from './QuotesTab';
import ComingSoonTab from './ComingSoonTab';

type Tab = 'overview' | 'quotes' | 'invoices' | 'payments' | 'tax-invoices' | 'settings';

const TABS: Tab[] = ['overview', 'quotes', 'invoices', 'payments', 'tax-invoices', 'settings'];

function readTab(search: string): Tab {
  const t = new URLSearchParams(search).get('tab') as Tab | null;
  return t && (TABS as string[]).includes(t) ? t : 'overview';
}

export default function QBillPage() {
  const { t } = useTranslation('qbill');
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(() => readTab(location.search));

  useEffect(() => { setTab(readTab(location.search)); }, [location.search]);

  const switchTab = (next: Tab) => {
    const sp = new URLSearchParams(location.search);
    if (next === 'overview') sp.delete('tab'); else sp.set('tab', next);
    sp.delete('quote');
    navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
  };

  return (
    <PageShell title={t('page.title', 'Q bill')} bodyPadding="0">
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
        {tab === 'quotes' && <QuotesTab />}
        {tab === 'invoices' && <ComingSoonTab descKey="tabsComing.invoices" />}
        {tab === 'payments' && <ComingSoonTab descKey="tabsComing.payments" />}
        {tab === 'tax-invoices' && <ComingSoonTab descKey="tabsComing.taxInvoices" />}
        {tab === 'settings' && <ComingSoonTab descKey="tabsComing.settings" />}
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
