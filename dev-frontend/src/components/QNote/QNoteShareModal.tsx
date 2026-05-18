// QNoteShareModal — Q Note 세션 공유 (사이클 N+25)
//
// 통합 컴포넌트: visibility 4단계 (L1 본인 / L2 프로젝트 / L3 워크스페이스 / L4 외부 공유 링크) 한 곳에서.
// L4 선택 시 share_token 자동 발급 + 링크 복사 + 만료/해제 옵션.
//
// 다른 자산의 ShareModal 패턴 동일 UX (탭 / 링크 / 만료) 이지만 q-note 자체 API 사용.

import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { VLevel } from '../Common/VisibilityBadge';
import { createSessionShareToken, revokeSessionShareToken, changeSessionVisibility } from '../../services/qnote';

interface Props {
  open: boolean;
  sessionId: number;
  currentVisibility: VLevel;
  hasProject: boolean;
  shareToken: string | null;
  sessionTitle?: string;
  onClose: () => void;
  onChanged: (next: { visibility: VLevel; share_token?: string | null }) => void;
}

const QNoteShareModal: React.FC<Props> = ({ open, sessionId, currentVisibility, hasProject, shareToken, sessionTitle, onClose, onChanged }) => {
  const { t } = useTranslation('qnote');
  const [picked, setPicked] = useState<VLevel>(currentVisibility);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(shareToken);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(currentVisibility);
      setToken(shareToken);
      setError(null);
      setConfirmRevoke(false);
    }
  }, [open, currentVisibility, shareToken]);

  if (!open) return null;

  const shareUrl = token ? `${window.location.origin}/public/qnote-sessions/${token}` : '';

  const applyVisibility = async (level: 'L1' | 'L2' | 'L3') => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await changeSessionVisibility(sessionId, { visibility: level });
      setPicked(level);
      onChanged({ visibility: level, share_token: null });
    } catch (e) {
      setError((e as Error).message || 'visibility_change_failed');
    } finally {
      setBusy(false);
    }
  };

  const issueToken = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await createSessionShareToken(sessionId);
      setToken(r.share_token);
      setPicked('L4');
      onChanged({ visibility: 'L4', share_token: r.share_token });
    } catch (e) {
      setError((e as Error).message || 'share_failed');
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await revokeSessionShareToken(sessionId);
      setToken(null);
      setConfirmRevoke(false);
      // 토큰만 해제 — visibility 는 그대로 (L1/L2/L3 중 마지막 값으로 자동 복원되도록 backend 가 처리)
      onChanged({ visibility: currentVisibility === 'L4' ? 'L1' : currentVisibility, share_token: null });
    } catch (e) {
      setError((e as Error).message || 'revoke_failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 불가 */ }
  };

  const levels: Array<{ key: 'L1' | 'L2' | 'L3'; title: string; desc: string; disabled?: boolean }> = [
    { key: 'L1', title: t('share.L1.title', '본인만'), desc: t('share.L1.desc', '나만 이 회의록을 볼 수 있습니다.') },
    { key: 'L2', title: t('share.L2.title', '프로젝트 멤버'), desc: t('share.L2.desc', '연결된 프로젝트의 멤버만 볼 수 있습니다.'), disabled: !hasProject },
    { key: 'L3', title: t('share.L3.title', '워크스페이스'), desc: t('share.L3.desc', '워크스페이스의 모든 멤버가 볼 수 있습니다.') },
  ];

  return (
    <Backdrop role="dialog" aria-modal="true" onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>{t('share.title', '회의록 공유')}{sessionTitle && <SubTitle> · {sessionTitle}</SubTitle>}</Title>
          <CloseBtn type="button" onClick={onClose}>×</CloseBtn>
        </Header>

        <Body>
          <Hint>{t('share.hint', '누가 이 회의록을 볼 수 있는지 선택하세요.')}</Hint>

          <Options role="radiogroup">
            {levels.map((lv) => (
              <Opt key={lv.key} type="button" role="radio" aria-checked={picked === lv.key}
                $active={picked === lv.key} $disabled={lv.disabled}
                disabled={busy || lv.disabled}
                onClick={() => !lv.disabled && applyVisibility(lv.key)}>
                <OptTitle>{lv.title}</OptTitle>
                <OptDesc>{lv.disabled ? t('share.needProject', '(이 회의록에 연결된 프로젝트가 없습니다)') : lv.desc}</OptDesc>
              </Opt>
            ))}
          </Options>

          <Divider />

          <SectionTitle>{t('share.external.title', '외부에 링크로 공유')}</SectionTitle>
          <SectionHint>{t('share.external.hint', '링크를 받은 누구나 회의 내용을 볼 수 있습니다. 발급 후 언제든 해제 가능.')}</SectionHint>

          {!token ? (
            <PrimaryBtn type="button" disabled={busy} onClick={issueToken}>
              {busy ? t('share.external.creating', '링크 생성 중...') : t('share.external.create', '공유 링크 만들기')}
            </PrimaryBtn>
          ) : (
            <>
              <LinkRow>
                <LinkInput value={shareUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                <CopyBtn type="button" onClick={copy} $copied={copied}>
                  {copied ? t('share.external.copied', '복사됨!') : t('share.external.copy', '복사')}
                </CopyBtn>
              </LinkRow>
              {!confirmRevoke ? (
                <DangerBtn type="button" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                  {t('share.external.revoke', '공유 링크 해제')}
                </DangerBtn>
              ) : (
                <ConfirmRow>
                  <ConfirmText>{t('share.external.revokeConfirm', '정말 해제할까요? 기존 링크는 즉시 만료됩니다.')}</ConfirmText>
                  <ConfirmActions>
                    <SecondaryBtn type="button" onClick={() => setConfirmRevoke(false)} disabled={busy}>{t('share.external.cancel', '취소')}</SecondaryBtn>
                    <DangerBtn type="button" onClick={revokeToken} disabled={busy}>{t('share.external.confirmRevoke', '해제')}</DangerBtn>
                  </ConfirmActions>
                </ConfirmRow>
              )}
            </>
          )}

          {error && <ErrorBox>{error}</ErrorBox>}
        </Body>
      </Card>
    </Backdrop>
  );
};

export default QNoteShareModal;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px;
`;
const Card = styled.div`
  width: 100%; max-width: 520px; max-height: 85vh;
  background: #FFFFFF; border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.18);
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
`;
const Title = styled.h3`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const SubTitle = styled.span`font-size: 13px; font-weight: 500; color: #64748B; margin-left: 4px;`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; font-size: 20px; color: #64748B;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;`;
const Hint = styled.div`font-size: 13px; color: #64748B; line-height: 1.6;`;
const Options = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Opt = styled.button<{ $active: boolean; $disabled?: boolean }>`
  width: 100%; padding: 12px 14px; text-align: left;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border: 1.5px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 10px; cursor: ${p => p.$disabled ? 'not-allowed' : 'pointer'};
  opacity: ${p => p.$disabled ? 0.5 : 1};
  transition: border-color 0.15s, background 0.15s;
  &:hover:not(:disabled) { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; }
`;
const OptTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; margin-bottom: 4px;`;
const OptDesc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;
const Divider = styled.div`height: 1px; background: #E2E8F0; margin: 8px 0;`;
const SectionTitle = styled.h4`margin: 0; font-size: 13px; font-weight: 700; color: #0F172A;`;
const SectionHint = styled.div`font-size: 12px; color: #64748B; line-height: 1.6; margin-top: -4px;`;
const PrimaryBtn = styled.button`
  padding: 10px 16px; background: #0F766E; color: #FFFFFF;
  border: none; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-weight: 600;
  &:hover:not(:disabled) { background: #115E59; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const LinkRow = styled.div`display: flex; gap: 8px;`;
const LinkInput = styled.input`
  flex: 1; padding: 8px 12px; font-size: 12px; color: #0F172A;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const CopyBtn = styled.button<{ $copied?: boolean }>`
  padding: 8px 14px; font-size: 12px; font-weight: 600;
  background: ${p => p.$copied ? '#22C55E' : '#0F766E'};
  color: #FFFFFF; border: none; border-radius: 8px; cursor: pointer;
  white-space: nowrap;
  &:hover { background: ${p => p.$copied ? '#16A34A' : '#115E59'}; }
`;
const DangerBtn = styled.button`
  padding: 8px 14px; font-size: 12px; font-weight: 600;
  background: #FFFFFF; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; font-size: 12px; font-weight: 600;
  background: #FFFFFF; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
`;
const ConfirmRow = styled.div`display: flex; flex-direction: column; gap: 8px; padding: 10px; background: #FEF2F2; border-radius: 8px; border: 1px solid #FECACA;`;
const ConfirmText = styled.div`font-size: 12px; color: #B91C1C;`;
const ConfirmActions = styled.div`display: flex; gap: 6px; justify-content: flex-end;`;
const ErrorBox = styled.div`padding: 10px 12px; font-size: 12px; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;`;
