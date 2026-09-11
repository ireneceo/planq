// OtherWorkspaceNotice — 다른 워크스페이스 항목을 id 로 열었을 때 **내용 대신** 그리는 안내 (전 상세 화면 공통)
//   docs/WORKSPACE_SCOPE_DESIGN.md Q6 · utils/workspaceMatch.isOtherWorkspace
//
// 내용을 먼저 그리고 배너를 얹지 않는다 — 한 화면에는 한 워크스페이스의 내용만 보인다(Irene: "모든 페이지가
// 하나의 워크스페이스로만 연결되어야지"). 내가 소속된 워크스페이스면 "전환해서 열기", 아니면 열 수 없다고만 말한다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  businessId: number | null | undefined;
}

const OtherWorkspaceNotice: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('common');
  const { user, switchWorkspace } = useAuth();
  const [busy, setBusy] = useState(false);
  const ws = (user?.workspaces || []).find((w) => Number(w.business_id) === Number(businessId)) || null;

  const onSwitch = async () => {
    if (!ws || busy) return;
    setBusy(true);
    const ok = await switchWorkspace(ws.business_id);
    // 같은 주소로 다시 부팅 — 이번에는 그 워크스페이스 안에서 열린다(다른 창은 WorkspaceSyncGuard 가 따라온다).
    if (ok) { window.location.reload(); return; }
    setBusy(false);
  };

  return (
    <Wrap role="status" data-testid="other-workspace-notice">
      <Title>
        {ws
          ? t('otherWorkspace.title', { name: ws.brand_name, defaultValue: '{{name}} 워크스페이스의 항목이에요' }) as string
          : t('otherWorkspace.noAccessTitle', '지금 워크스페이스에서 열 수 없는 항목이에요') as string}
      </Title>
      <Desc>{t('otherWorkspace.desc', '한 화면에는 한 워크스페이스의 내용만 보여요. 그 워크스페이스로 전환하면 열 수 있어요.') as string}</Desc>
      {ws && (
        <SwitchBtn type="button" onClick={onSwitch} disabled={busy} data-testid="other-workspace-switch">
          {t('otherWorkspace.switch', { name: ws.brand_name, defaultValue: '{{name}}(으)로 전환해서 열기' }) as string}
        </SwitchBtn>
      )}
    </Wrap>
  );
};

export default OtherWorkspaceNotice;

const Wrap = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; text-align: center;
  padding: 48px 20px; min-height: 240px;
`;
const Title = styled.div`
  font-size: 0.9375rem; font-weight: 700; color: #0F172A;
`;
const Desc = styled.div`
  font-size: 0.8125rem; color: #64748B; line-height: 1.6; max-width: 360px;
`;
const SwitchBtn = styled.button`
  margin-top: 8px; min-height: 40px; padding: 0 16px; border-radius: 8px;
  border: none; background: #0D9488; color: #FFFFFF;
  font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: wait; }
  &:focus-visible { outline: 2px solid #99F6E4; outline-offset: 2px; }
`;
