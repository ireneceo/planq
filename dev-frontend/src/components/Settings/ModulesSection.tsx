// 워크스페이스 «기능 사용» — 기능을 켜고 끈다(2026-10-15, Irene «사용할지 말지 정해서 사용하게 할 수 있어?»).
//   저장 = PUT /api/businesses/:id/modules (owner 만 · 판정 서버 services/modules 한 곳). 끈 기능은 메뉴·화면·알림에서 사라지고 기록은 남는다.
//   ★ 끄기는 확인을 받는다(ConfirmDialog — 무엇이 숨겨지는지 적는다). 켜기는 바로(자동저장 ✓).
//   ★ 저장 뒤 /api/auth/me 를 다시 읽어 사이드바가 따라온다(다른 창은 workspace:modules 신호 → MainLayout 이 다시 읽는다).
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import ConfirmDialog from '../Common/ConfirmDialog';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { payrollApi, PayrollError } from '../../pages/Payroll/payrollApi';

export default function ModulesSection({ businessId }: { businessId: number }) {
  const { t } = useTranslation('payroll');
  const { user, refreshUser } = useAuth();
  const isOwner = user?.business_role === 'owner';
  const serverOn = !!user?.modules?.payroll;
  const [on, setOn] = useState(serverOn);
  const wantRef = useRef(serverOn);
  const serverRef = useRef(serverOn);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setOn(serverOn); wantRef.current = serverOn; serverRef.current = serverOn; }, [serverOn]);

  const persist = async (next: boolean) => {
    try {
      await payrollApi.setModules(businessId, { payroll: next });
      serverRef.current = next;
      setError(null);
      await refreshUser();
    } catch (e) {
      // 되돌린다 — 저장이 안 됐는데 화면만 바뀐 채 두지 않는다
      wantRef.current = serverRef.current; setOn(serverRef.current);
      setError(e instanceof PayrollError && e.code === 'plan_required' ? t('modules.planRequired') as string : t('error.generic') as string);
      throw e;
    }
  };

  return (
    <Card data-testid="modules-section">
      <Title>{t('modules.sectionTitle')}</Title>
      <Desc>{t('modules.sectionDesc')}</Desc>
      <Row>
        <RowText>
          <RowLabel id="modules-payroll-label">{t('modules.payroll')} <ProBadge>{t('modules.proBadge')}</ProBadge></RowLabel>
          <RowDesc>{t('modules.payrollDesc')}</RowDesc>
        </RowText>
        <AutoSaveField key={`modules-payroll-${businessId}`} type="toggle"
          onSave={async () => { if (wantRef.current !== serverRef.current) await persist(wantRef.current); }}>
          <Switch type="button" role="switch" aria-checked={on} aria-labelledby="modules-payroll-label"
            data-testid="modules-payroll-toggle" $on={on} disabled={!isOwner}
            title={!isOwner ? (t('modules.ownerOnly') as string) : undefined}
            onClick={() => {
              if (on) { setConfirmOff(true); return; }   // 끄기는 확인 뒤(아래 onConfirm 이 저장)
              wantRef.current = true; setOn(true);
            }}>
            <SwitchKnob $on={on} />
          </Switch>
        </AutoSaveField>
      </Row>
      {!isOwner && <Hint>{t('modules.ownerOnly')}</Hint>}
      {error && <Err role="alert">{error}</Err>}
      <ConfirmDialog isOpen={confirmOff} onClose={() => setConfirmOff(false)} variant="warning"
        title={t('modules.offConfirmTitle')} message={t('modules.offConfirmMsg')} confirmText={t('modules.offConfirm') as string}
        onConfirm={() => { setConfirmOff(false); wantRef.current = false; setOn(false); persist(false).catch(() => null); }} />
    </Card>
  );
}

const Card = styled.section`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;`;
const Title = styled.h3`margin: 0 0 4px; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0 0 14px; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Row = styled.div`display: flex; align-items: center; gap: 16px; justify-content: space-between;`;
const RowText = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowLabel = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; display: flex; align-items: center; gap: 6px;`;
const RowDesc = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const ProBadge = styled.span`padding: 1px 6px; border-radius: 4px; background: #F1F5F9; color: #475569; font-size: 0.6875rem; font-weight: 700;`;
const Hint = styled.div`margin-top: 8px; font-size: 0.75rem; color: #94A3B8;`;
const Err = styled.div`margin-top: 8px; font-size: 0.75rem; color: #BE123C;`;
