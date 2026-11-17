// MailStandalonePage — Q mail 분리 창 (2026-11-17 Irene · Fable 설계 1단계)
//   Irene: "Q mail 만도 팝아웃 있어야 할 것 같아 … 다른 창이랑 옆에 두고 봐야 하는 일이 자꾸 생기는데."
//   MailPage 를 **그대로** MainLayout 없이 얹는다(베끼지 않는다 — 3천 줄 화면이 두 벌로 갈라진다).
//   창 폭이 좁으면 MailPage 의 기존 폰/태블릿 분기(목록↔본문 드릴다운)를 그대로 쓴다.
//   설정·고객 상세 같은 «다른 화면으로 가기» 는 메인 창에 부탁한다(PopoutBridge.goMainOr).
//
//   워크스페이스 — 이 창은 **연 워크스페이스에 고정**된다(2단계, Irene «권고대로» 2026-11-17 · Fable 설계).
//   메인 창에서 바꿔도 이 창은 그대로이고, 맨 위 띠의 워크스페이스 칩에서만 **이 창만** 바꾼다.
//   고르는 목록은 직원으로 속한 곳(대표·관리자·멤버)만 — 고객으로 속한 곳은 메일이 없다(서버 /me?view_ws 가 같은 판정).
//   고정 판정·저장은 utils/popout 한 곳(getPinnedWorkspace) · 다른 창 전환 무시는 WorkspaceSyncGuard.
import React, { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import MailPage from './MailPage';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost } from '../../utils/pinHost';
import { markPopoutWindow, getPinnedWorkspace, switchPinnedWorkspace } from '../../utils/popout';
import ChipPopover from '../../components/Common/ChipPopover';
import { PickerList, PickerItem } from '../../components/Common/pickerList';
import { useAppShellLock } from '../../hooks/useAppShellLock';
import { useAuth } from '../../contexts/AuthContext';

const MailStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const pin = usePinHost({ tool: 'qmail', title: 'Q mail' });

  const bid = user?.business_id != null ? Number(user.business_id) : null;
  const wsName = useMemo(() => {
    const m = (user?.workspaces || []).find((w) => Number(w.business_id) === bid);
    return m?.brand_name || user?.business_name || '';
  }, [user, bid]);
  // 바꿀 수 있는 곳 = 직원으로 속한 워크스페이스(서버 VIEW_ROLES 와 같은 집합)
  const choices = useMemo(() => (user?.workspaces || [])
    .filter((w) => ['owner', 'admin', 'member'].includes(String(w.role))), [user]);
  const pinned = getPinnedWorkspace();

  useEffect(() => {
    document.title = wsName
      ? `${t('popout.windowTitle', { defaultValue: 'PlanQ 메일' })} · ${wsName}`
      : t('popout.windowTitle', { defaultValue: 'PlanQ 메일' }) as string;
  }, [t, wsName]);

  // 주소에도 «이 창의 워크스페이스» 를 남긴다 — MailPage 가 ?thread= 등을 쓰며 주소를 새로 쓰면 ?ws= 가 빠진다.
  //   고정 판정은 창 저장값으로도 되지만, 핀(고정창)·새로고침·주소 복사는 주소를 쓴다. 없을 때만 덧붙인다(반복 없음).
  const location = useLocation();
  useEffect(() => {
    if (!pinned) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('ws') === String(pinned)) return;
    sp.set('ws', String(pinned));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${sp.toString()}${window.location.hash}`);
  }, [pinned, location.search]);

  useEffect(() => {
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84 — 팝아웃 창 내부 이동에도 FAB/토스터 재노출 차단
    return () => { delete document.body.dataset.popout; };
  }, []);

  if (pin.mode === 'holder') return <Shell><PinHolderView host={pin} label="Q mail" /></Shell>;

  return (
    <Shell>
      <WsStrip data-testid="mail-popout-bar">
        <ChipPopover
          data-testid="mail-popout-workspace"
          prefix={t('popout.workspace', { defaultValue: '워크스페이스' }) as string}
          label={wsName || '—'}
          active
          width={260}
          ariaLabel={t('popout.workspacePick', { defaultValue: '이 창의 워크스페이스 바꾸기' }) as string}>
          {(close) => (
            <>
              <PickNote data-testid="mail-popout-workspace-hint">
                {pinned
                  ? t('popout.pinnedHint', { defaultValue: '이 창만 바뀝니다. 메인 창에서 워크스페이스를 바꿔도 이 창은 그대로예요.' })
                  : t('popout.workspaceHint', { defaultValue: '이 창에 보이는 메일의 워크스페이스입니다. 워크스페이스를 바꾸면 이 창도 같이 바뀝니다.' })}
              </PickNote>
              <PickerList>
                {choices.map((w) => (
                  <PickerItem key={w.business_id} type="button" $on={Number(w.business_id) === bid}
                    data-testid="mail-popout-workspace-item"
                    onClick={() => { close(); if (Number(w.business_id) !== bid) switchPinnedWorkspace(Number(w.business_id)); }}>
                    {w.brand_name}
                  </PickerItem>
                ))}
              </PickerList>
            </>
          )}
        </ChipPopover>
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
const Spacer = styled.div`flex: 1;`;
const PickNote = styled.div`
  padding: 4px 8px 8px;
  font-size: 0.6875rem;
  line-height: 1.45;
  color: #64748B;
`;
const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
`;
