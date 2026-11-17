// MailStandalonePage — Q mail 분리 창 (2026-11-17 Irene · Fable 설계 1단계)
//   Irene: "Q mail 만도 팝아웃 있어야 할 것 같아 … 다른 창이랑 옆에 두고 봐야 하는 일이 자꾸 생기는데."
//   MailPage 를 **그대로** MainLayout 없이 얹는다(베끼지 않는다 — 3천 줄 화면이 두 벌로 갈라진다).
//   창 폭이 좁으면 MailPage 의 기존 폰/태블릿 분기(목록↔본문 드릴다운)를 그대로 쓴다.
//   설정·고객 상세 같은 «다른 화면으로 가기» 는 메인 창에 부탁한다(PopoutBridge.goMainOr).
//
//   워크스페이스 — 머리줄에 **이 창이 보여 주는 워크스페이스 이름**을 늘 보인다(여러 워크스페이스 사용자가
//   «지금 어느 메일인가» 를 헷갈리지 않게). 전환은 지금 계약(.claude/rules/workspace.md 3항) 그대로
//   모든 창이 같이 따라간다. «이 창만 고정» 은 계약 예외라 Irene 결정 뒤 2단계로(Fable 판정 2026-11-17).
import React, { useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import MailPage from './MailPage';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';
import { useAuth } from '../../contexts/AuthContext';

const MailStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const pin = usePinHost({ tool: 'qmail', title: 'Q mail' });

  const wsName = useMemo(() => {
    const bid = user?.business_id != null ? Number(user.business_id) : null;
    const m = (user?.workspaces || []).find((w) => Number(w.business_id) === bid);
    return m?.brand_name || user?.business_name || '';
  }, [user]);

  useEffect(() => {
    document.title = wsName
      ? `${t('popout.windowTitle', { defaultValue: 'PlanQ 메일' })} · ${wsName}`
      : t('popout.windowTitle', { defaultValue: 'PlanQ 메일' }) as string;
  }, [t, wsName]);

  useEffect(() => {
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84 — 팝아웃 창 내부 이동에도 FAB/토스터 재노출 차단
    return () => { delete document.body.dataset.popout; };
  }, []);

  if (pin.mode === 'holder') return <Shell><PinHolderView host={pin} label="Q mail" /></Shell>;

  return (
    <Shell>
      <WsStrip data-testid="mail-popout-bar">
        <WsChip data-testid="mail-popout-workspace"
          title={t('popout.workspaceHint', { defaultValue: '이 창에 보이는 메일의 워크스페이스입니다. 워크스페이스를 바꾸면 이 창도 같이 바뀝니다.' }) as string}>
          <WsDot aria-hidden="true" />
          <WsLabel>{t('popout.workspace', { defaultValue: '워크스페이스' })}</WsLabel>
          <WsName>{wsName || '—'}</WsName>
        </WsChip>
        <Spacer />
        <PopoutPinButton host={pin} />
      </WsStrip>
      <Body>
        <MailPage />
      </Body>
    </Shell>
  );
};

export default MailStandalonePage;

const Shell = styled.div`
  /* 높이는 --vvh 하나로 — 다른 팝아웃(QTaskStandalonePage)과 같은 이유 */
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: var(--pq-safe-top, 0px);
`;
// 머리줄이 아니라 «이 창의 워크스페이스» 띠 — MailPage 의 PanelHeader(60px)가 이 아래에 그대로 선다.
const WsStrip = styled.div`
  flex-shrink: 0;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid #E2E8F0;
  background: #F8FAFC;
`;
const WsChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid #CCFBF1;
  border-radius: 999px;
  background: #F0FDFA;
  font-size: 0.75rem;
  color: #0F172A;
`;
const WsDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #14B8A6;
  flex-shrink: 0;
`;
const WsLabel = styled.span`
  color: #64748B;
  flex-shrink: 0;
`;
const WsName = styled.span`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const Spacer = styled.div`flex: 1;`;
const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
`;
