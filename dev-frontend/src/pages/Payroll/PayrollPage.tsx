// 급여·계약 (docs/PAYROLL_DESIGN.md §9) — 탭 세 개: 급여(월별 회차) · 대상자 · 항목.
//   ★ 이 화면은 급여 관리자(owner + 지정 담당자)만 — 서버가 403/404 로 다시 거른다. 모듈이 꺼져 있으면 ModuleGate 가 없는 화면으로 그린다.
//   탭은 주소(?tab=)에 싣는다 — 새로고침·공유해도 같은 탭. 대상자 상세(?person=)도 그대로.
//   책임선 문구(법정 공제는 세무사 대장 값이 기준)는 모든 탭 위에 고정한다(설계 §1).
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import ActionButton from '../../components/Common/ActionButton';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import PeopleTab from './PeopleTab';
import RunsTab from './RunsTab';
import ItemsTab from './ItemsTab';

type Tab = 'runs' | 'people' | 'items';
const TABS: Tab[] = ['runs', 'people', 'items'];

export default function PayrollPage() {
  const { t } = useTranslation('payroll');
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  // 대상자 상세 주소(?person=)로 들어오면 대상자 탭이 열린다(멤버 상세의 «계약 이력» 링크)
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : (params.get('person') ? 'people' : 'runs');
  const [personCreate, setPersonCreate] = useState(false);
  const [runCreate, setRunCreate] = useState(false);
  const [itemCreate, setItemCreate] = useState(false);

  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(params);
    sp.set('tab', next);
    if (next !== 'people') sp.delete('person');
    if (next !== 'items') sp.delete('item');
    setParams(sp, { replace: true });
  };

  const action = tab === 'runs'
    ? <ActionButton data-testid="payroll-run-new" onClick={() => setRunCreate(true)}>+ {t('runs.add')}</ActionButton>
    : tab === 'people'
      ? <ActionButton data-testid="payroll-person-new" onClick={() => setPersonCreate(true)}>+ {t('people.add')}</ActionButton>
      : <ActionButton data-testid="payroll-item-new" onClick={() => setItemCreate(true)}>+ {t('items.add')}</ActionButton>;

  return (
    <PageShell
      title={t('title')}
      actions={(
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
    </PageShell>
  );
}

const Notice = styled.div`
  margin-bottom: 12px; padding: 10px 14px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0; color: #475569; font-size: 0.8125rem; line-height: 1.5;
`;
