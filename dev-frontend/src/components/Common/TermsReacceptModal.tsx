// 약관 변경 시 재동의 모달 — current_terms_version != user.terms_version 일 때 자동 노출
// 동의 시 PUT /api/users/:id 의 terms_accepted_at + terms_version 갱신
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';

const TermsReacceptModal: React.FC = () => {
  const { t } = useTranslation('auth');
  const { user, refreshUser } = useAuth() as ReturnType<typeof useAuth> & { refreshUser?: () => Promise<void> };
  const [termsAgree, setTermsAgree] = useState(false);
  const [privacyAgree, setPrivacyAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!user || !user.platform) return null;

  const termsChanged = !!(user.platform.current_terms_version && user.platform.current_terms_version !== user.terms_version);
  const privacyChanged = !!(user.platform.current_privacy_version && user.platform.current_privacy_version !== user.privacy_version);
  if (!termsChanged && !privacyChanged) return null;

  const submit = async () => {
    if (submitting) return;
    if (termsChanged && !termsAgree) return;
    if (privacyChanged && !privacyAgree) return;
    setSubmitting(true);
    try {
      const patch: Record<string, string> = {};
      if (termsChanged) {
        patch.terms_accepted_at = new Date().toISOString();
        patch.terms_version = user.platform!.current_terms_version;
      }
      if (privacyChanged) {
        patch.privacy_accepted_at = new Date().toISOString();
        patch.privacy_version = user.platform!.current_privacy_version;
      }
      await apiFetch(`/api/users/${user.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // user 재로드 — refreshUser 가 없으면 페이지 리로드
      if (typeof refreshUser === 'function') {
        await refreshUser();
      } else {
        window.location.reload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Backdrop>
      <Dialog role="dialog" aria-modal="true" aria-label={t('terms.reacceptTitle', '약관 재동의') as string}>
        <Header>{t('terms.reacceptTitle', '약관이 업데이트됐습니다')}</Header>
        <Body>
          <Hint>{t('terms.reacceptHint', '서비스를 계속 이용하려면 변경된 약관에 동의해주세요.')}</Hint>
          {termsChanged && (
            <ConsentItem>
              <input type="checkbox" id="re-terms" checked={termsAgree} onChange={e => setTermsAgree(e.target.checked)} />
              <label htmlFor="re-terms">
                <Link to="/legal/terms" target="_blank" rel="noopener">{t('terms.termsLink', '이용약관')}</Link>
                {t('terms.versionLabel', ' (v{{v}})', { v: user.platform.current_terms_version }) as string}
                {t('terms.agreeRequired', ' 에 동의합니다 (필수)')}
              </label>
            </ConsentItem>
          )}
          {privacyChanged && (
            <ConsentItem>
              <input type="checkbox" id="re-privacy" checked={privacyAgree} onChange={e => setPrivacyAgree(e.target.checked)} />
              <label htmlFor="re-privacy">
                <Link to="/legal/privacy" target="_blank" rel="noopener">{t('terms.privacyLink', '개인정보 처리방침')}</Link>
                {t('terms.versionLabel', ' (v{{v}})', { v: user.platform.current_privacy_version }) as string}
                {t('terms.agreeRequired', ' 에 동의합니다 (필수)')}
              </label>
            </ConsentItem>
          )}
        </Body>
        <Footer>
          <Submit type="button" onClick={submit} disabled={submitting || (termsChanged && !termsAgree) || (privacyChanged && !privacyAgree)}>
            {submitting ? t('terms.saving', '저장 중...') : t('terms.agree', '동의하고 계속')}
          </Submit>
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default TermsReacceptModal;

const Backdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.6); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 24px;`;
const Dialog = styled.div`width: 100%; max-width: 480px; background: #FFFFFF; border-radius: 14px; box-shadow: 0 24px 48px rgba(15,23,42,0.18); overflow: hidden;`;
const Header = styled.div`padding: 20px 24px; font-size: 16px; font-weight: 700; color: #0F172A; border-bottom: 1px solid #E2E8F0;`;
const Body = styled.div`padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;`;
const Hint = styled.p`margin: 0; font-size: 13px; color: #475569; line-height: 1.6;`;
const ConsentItem = styled.div`display: flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; padding: 12px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; input { width: 16px; height: 16px; accent-color: #14B8A6; cursor: pointer; } label { cursor: pointer; } a { color: #0D9488; font-weight: 600; text-decoration: underline; }`;
const Footer = styled.div`padding: 14px 24px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end;`;
const Submit = styled.button`padding: 10px 20px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; &:hover:not(:disabled) { background: #0D9488; } &:disabled { background: #CBD5E1; cursor: not-allowed; }`;
