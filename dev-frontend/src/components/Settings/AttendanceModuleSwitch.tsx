// 근태·휴가 기능 켜기/끄기 — 설정 › 근태 관리 맨 위(2026-11-17 Irene «사용 안하는 경우 어디서 비활성화 해? … 설정에 메뉴는 두고 최상단에 활성/비활성»).
//   급여(설정 › 급여 맨 위 ModulesSection)와 같은 모양·같은 저장 길: PUT /api/businesses/:id/modules (owner 만 · 판정 서버 services/modules 한 곳).
//   끄면 근태·휴가 메뉴·사이드바 출퇴근 위젯·동료 근무 점·휴가 승인 할 일·휴가 알림이 사라지고 API 는 404. 기록은 지우지 않는다.
//   ★ 끄기는 확인을 받는다(ConfirmDialog — 무엇이 숨는지 적는다). 켜기는 바로(자동저장 ✓). 저장 뒤 /api/auth/me 를 다시 읽어 메뉴가 따라온다.
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import ConfirmDialog from '../Common/ConfirmDialog';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { payrollApi } from '../../pages/Payroll/payrollApi';
import { attendanceOn } from '../../utils/workspaceModules';

export default function AttendanceModuleSwitch({ businessId }: { businessId: number }) {
  const { t } = useTranslation('attendance');
  const { user, refreshUser } = useAuth();
  const isOwner = user?.business_role === 'owner';
  const serverOn = attendanceOn(user?.modules);
  const [on, setOn] = useState(serverOn);
  const wantRef = useRef(serverOn);
  const serverRef = useRef(serverOn);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setOn(serverOn); wantRef.current = serverOn; serverRef.current = serverOn; }, [serverOn]);

  const persist = async (next: boolean) => {
    try {
      await payrollApi.setModules(businessId, { attendance: next });
      serverRef.current = next;
      setError(null);
      await refreshUser();
    } catch (e) {
      wantRef.current = serverRef.current; setOn(serverRef.current);   // 저장이 안 됐는데 화면만 바뀐 채 두지 않는다
      setError(t('module.saveError') as string);
      throw e;
    }
  };

  return (
    <Card data-testid="attendance-module-section">
      <Row>
        <RowText>
          <RowLabel id="attendance-module-label">
            {t('module.title')}
            <StateChip $on={on}>{on ? t('module.stateOn') : t('module.stateOff')}</StateChip>
          </RowLabel>
          <RowDesc>{on ? t('module.descOn') : t('module.descOff')}</RowDesc>
        </RowText>
        <AutoSaveField key={`attendance-module-${businessId}`} type="toggle"
          onSave={async () => { if (wantRef.current !== serverRef.current) await persist(wantRef.current); }}>
          <Switch type="button" role="switch" aria-checked={on} aria-labelledby="attendance-module-label"
            data-testid="attendance-module-toggle" $on={on} disabled={!isOwner}
            title={!isOwner ? (t('module.ownerOnly') as string) : undefined}
            onClick={() => {
              if (on) { setConfirmOff(true); return; }   // 끄기는 확인 뒤(아래 onConfirm 이 저장)
              wantRef.current = true; setOn(true);
            }}>
            <SwitchKnob $on={on} />
          </Switch>
        </AutoSaveField>
      </Row>
      {!isOwner && <Hint>{t('module.ownerOnly')}</Hint>}
      {error && <Err role="alert">{error}</Err>}
      <ConfirmDialog isOpen={confirmOff} onClose={() => setConfirmOff(false)} variant="warning"
        title={t('module.offConfirmTitle')} message={t('module.offConfirmMsg')} confirmText={t('module.offConfirm') as string}
        onConfirm={() => { setConfirmOff(false); wantRef.current = false; setOn(false); persist(false).catch(() => null); }} />
    </Card>
  );
}

const Card = styled.section`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;`;
const Row = styled.div`display: flex; align-items: center; gap: 16px; justify-content: space-between;`;
const RowText = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const RowLabel = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const StateChip = styled.span<{ $on: boolean }>`padding: 1px 8px; border-radius: 999px; font-size: 0.6875rem; font-weight: 700;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#F1F5F9')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};`;
const RowDesc = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Hint = styled.div`margin-top: 8px; font-size: 0.75rem; color: #94A3B8;`;
const Err = styled.div`margin-top: 8px; font-size: 0.75rem; color: #BE123C;`;
