// 데스크탑 앱(윈도우·맥)의 «디바이스 알림» 칸 본문 — docs/DESKTOP_APP_DESIGN.md §3-4·§3-5.
//   데스크탑 앱에는 웹 푸시가 없다. 앱이 켜져 있는 동안(창을 닫아도 트레이에 남는다) 소켓으로 받은 알림을
//   OS 알림으로 띄운다. 그래서 «켜기» 버튼이 아니라 ①어떻게 오는지 한 줄 ②OS 알림 설정 열기 ③컴퓨터 켤 때 자동 실행.
//   감싸는 칸(Section·제목)은 NotificationSettings 의 PushSection 이 그린다 — 칸 모양을 베끼지 않는다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import { desktopBridge, openAppNotificationSettings } from '../../services/native';

const DesktopAppNotifyBody: React.FC = () => {
  const { t } = useTranslation('settings');
  const bridge = desktopBridge();
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  // 래퍼(AutoSaveField)가 300ms 뒤 persist 를 부른다 — 최신 값은 ref 로 읽는다(ui-forms 계약).
  const autoRef = useRef<boolean | null>(null);
  autoRef.current = autoLaunch;

  useEffect(() => {
    if (!bridge) return;
    bridge.getAutoLaunch().then((v) => setAutoLaunch(!!v)).catch(() => setAutoLaunch(false));
  }, [bridge]);

  if (!bridge) return null;

  const persistAutoLaunch = async () => {
    const want = !!autoRef.current;
    const ok = await bridge.setAutoLaunch(want);
    if (!ok) { setAutoLaunch(!want); throw new Error('auto_launch_failed'); }
  };

  return (
    <Body>
      <Line>{t('push.desktop.howItWorks', 'PlanQ 데스크탑 앱이 켜져 있는 동안 알림이 옵니다. 창을 닫아도 작업 표시줄(맥은 메뉴 막대)에 남아 알림을 받고, 앱을 완전히 끄면 오지 않습니다.')}</Line>
      <Row>
        <ActionButton
          tone="secondary"
          size="sm"
          data-testid="desktop-open-os-notify"
          onClick={async () => { setOpenFailed(!(await openAppNotificationSettings())); }}
        >
          {t('push.desktop.openOsSettings', '컴퓨터 알림 설정 열기')}
        </ActionButton>
        {openFailed && <Hint>{t('push.desktop.openOsFailed', '이 컴퓨터에서는 설정을 바로 열 수 없어요 — 시스템 설정의 «알림» 에서 PlanQ 를 찾아 주세요.')}</Hint>}
      </Row>
      {autoLaunch !== null && (
        <Row>
          <AutoSaveField type="toggle" onSave={persistAutoLaunch}>
            <Switch
              type="button"
              role="switch"
              data-testid="desktop-auto-launch"
              aria-checked={autoLaunch}
              aria-label={t('push.desktop.autoLaunch', '컴퓨터를 켤 때 PlanQ 자동 실행') as string}
              $on={autoLaunch}
              onClick={() => setAutoLaunch((v) => !v)}
            >
              <SwitchKnob $on={autoLaunch} />
            </Switch>
          </AutoSaveField>
          <Label>{t('push.desktop.autoLaunch', '컴퓨터를 켤 때 PlanQ 자동 실행')}</Label>
        </Row>
      )}
    </Body>
  );
};

export default DesktopAppNotifyBody;

const Body = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Line = styled.div`font-size: 0.8125rem; color: #334155; line-height: 1.55;`;
const Row = styled.div`display: flex; align-items: center; gap: 10px; flex-wrap: wrap;`;
const Label = styled.span`font-size: 0.8125rem; color: #0F172A;`;
const Hint = styled.span`font-size: 0.75rem; color: #64748B;`;
