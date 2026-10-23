// 급여·계약 (docs/PAYROLL_DESIGN.md §9) — 메뉴 하나(2026-10-20 Irene «합쳐야 할 것 같은데 왜 나눠?»).
//   급여 관리자(owner + 지정 담당자): 탭 넷 — 급여(월별 회차) · 대상자 · 항목 · 내 명세서.
//   그 밖의 직원: 탭 없이 «내 명세서»(자기 명세서·계약)만. 관리 데이터는 서버가 403 으로 다시 거른다.
//   모듈이 꺼져 있으면 ModuleGate 가 없는 화면으로 그린다. 켜고 끄기·담당자 지정은 설정 › 급여 설정(대표).
//   탭은 주소(?tab=)에 싣는다 — 새로고침·공유해도 같은 탭. 대상자 상세(?person=)도 그대로.
//   책임선 문구(법정 공제는 세무사 대장 값이 기준)는 모든 탭 위에 고정한다(설계 §1).
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import { AddActionButton, CtaPlus } from '../../components/Common/headerCta';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import PeopleTab from './PeopleTab';
import RunsTab from './RunsTab';
import ItemsTab from './ItemsTab';
import { MyPayslipsView } from './MyPayslipsPage';

type Tab = 'runs' | 'people' | 'items' | 'mine';
const TABS: Tab[] = ['runs', 'people', 'items', 'mine'];

export default function PayrollPage() {
  const { t } = useTranslation('payroll');
  const { user } = useAuth();
  const isManager = !!user?.can_manage_payroll;
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  // 대상자 상세 주소(?person=)로 들어오면 대상자 탭이 열린다(멤버 상세의 «계약 이력» 링크)
  // 관리자가 아니면 언제나 «내 명세서» — 관리 탭 주소로 들어와도 그 화면을 그리지 않는다
  const tab: Tab = !isManager ? 'mine'
    : TABS.includes(raw as Tab) ? (raw as Tab) : (params.get('person') || params.get('user') ? 'people' : params.get('entry') ? 'mine' : 'runs');
  const [personCreate, setPersonCreate] = useState(false);
  const [runCreate, setRunCreate] = useState(false);
  const [itemCreate, setItemCreate] = useState(false);

  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(params);
    sp.set('tab', next);
    if (next !== 'people') sp.delete('person');
    if (next !== 'items') sp.delete('item');
    if (next !== 'mine') sp.delete('entry');
    setParams(sp, { replace: true });
  };

  const action = tab === 'mine' ? null : tab === 'runs'
    ? <AddActionButton data-testid="payroll-run-new" aria-label={t('runs.add') as string} title={t('runs.add') as string} onClick={() => setRunCreate(true)}><CtaPlus /><span data-cta-label>{t('runs.add')}</span></AddActionButton>
    : tab === 'people'
      ? <AddActionButton data-testid="payroll-person-new" aria-label={t('people.add') as string} title={t('people.add') as string} onClick={() => setPersonCreate(true)}><CtaPlus /><span data-cta-label>{t('people.add')}</span></AddActionButton>
      : <AddActionButton data-testid="payroll-item-new" aria-label={t('items.add') as string} title={t('items.add') as string} onClick={() => setItemCreate(true)}><CtaPlus /><span data-cta-label>{t('items.add')}</span></AddActionButton>;

  return (
    <PageShell
      title={t('title')}
      actions={!isManager ? undefined : (
        <>
          <SegmentedToggle role="tablist" aria-label={t('title') as string}>
            {TABS.map((k) => (
              <SegmentedBtn key={k} type="button" role="tab" aria-selected={tab === k} $active={tab === k}
                data-testid={`payroll-tab-${k}`} onClick={() => setTab(k)}>
                {t(`tabs.${k}`)}
              </SegmentedBtn>
            ))}
          </SegmentedToggle>
          {action}
        </>
      )}
    >
      <Notice data-testid="payroll-responsibility">{t('responsibility')}</Notice>
      {tab === 'runs' && <RunsTab createOpen={runCreate} setCreateOpen={setRunCreate} />}
      {tab === 'people' && <PeopleTab createOpen={personCreate} setCreateOpen={setPersonCreate} />}
      {tab === 'items' && <ItemsTab createOpen={itemCreate} setCreateOpen={setItemCreate} />}
      {tab === 'mine' && <MyPayslipsView />}
    </PageShell>
  );
}

const Notice = styled.div`
  margin-bottom: 12px; padding: 10px 14px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0; color: #475569; font-size: 0.8125rem; line-height: 1.5;
`;
