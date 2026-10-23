// autosave-exempt: 자동저장이 아니다 — 동의 체크는 제출 버튼("동의하고 계속")을 여는 게이트이고,
//   저장은 그 버튼을 눌러야 나간다. 동의를 체크만 해도 저장되면 오히려 사고다.
// 약관 변경 시 재동의 모달 — current_terms_version != user.terms_version 일 때 자동 노출
// 동의 시 PUT /api/users/:id 의 terms_accepted_at + terms_version 갱신
// 랜딩 페이지(/, /features, /pricing 등)에서는 표시 안 함 — 앱 영역에서만 노출
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useChromeLocation } from '../../hooks/useChromeNav';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { postWindowSync, onWindowSync } from '../../services/windowSync';

// 랜딩 페이지 경로 — 이 경로들에서는 약관 모달 표시 안 함
// '/dev-login' — 상황판 «시험 계정으로 열기» 착지(잠깐 거치는 화면). 앞 사람 세션이 재동의 대상이면 이 창이 lazy 로 뜨며
//   Suspense 가 화면을 갈아끼워 로그인 요청이 나가지 못했다(2026-10-12 실측). 시험 계정에 착지한 뒤의 화면에서는 그대로 뜬다.
const LANDING_PATHS = ['/', '/features', '/pricing', '/about', '/contact', '/insights', '/blog', '/legal', '/dev-login'];

const TermsReacceptModal: React.FC = () => {
  const { t } = useTranslation('auth');
  const { user, refreshUser } = useAuth();
  const location = useChromeLocation();
  const [termsAgree, setTermsAgree] = useState(false);
  const [privacyAgree, setPrivacyAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 랜딩 페이지에서는 표시 안 함
  const isLandingPage = LANDING_PATHS.some(p => location.pathname === p || location.pathname.startsWith('/legal'));

  const termsChanged = !!(user?.platform?.current_terms_version && user.platform.current_terms_version !== user.terms_version);
  const privacyChanged = !!(user?.platform?.current_privacy_version && user.platform.current_privacy_version !== user.privacy_version);
  const open = !isLandingPage && !!user?.platform && (termsChanged || privacyChanged);
  const userId = user?.id ?? null;
  // refreshUser 는 렌더마다 새 함수다 — 구독을 렌더마다 다시 걸지 않게 ref 로 읽는다.
  const refreshRef = useRef(refreshUser);
  refreshRef.current = refreshUser;

  // ★ 2026-10-22 — 다른 창(메인·팝아웃)에서 동의하면 이 창도 닫힌다. 창마다 부팅 때 받은 사용자 사본을 들고 있어
  //   여태는 동의한 창만 닫히고 나머지는 각각 눌러야 했다. 같은 브라우저 = 채널, 다른 기기에서 동의 = 창 복귀 때 다시 읽기.
  //   훅은 early return 위에 둔다(닫힐 때 훅 수가 달라지면 React 가 깨진다) — open 으로 켜고 끈다.
  useEffect(() => {
    if (!open || userId == null) return;
    const off = onWindowSync((m) => {
      if (m.type === 'terms:accepted' && Number(m.user_id) === Number(userId)) void refreshRef.current();
    });
    const onFocus = () => { void refreshRef.current(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshRef.current(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, userId]);

  if (!open || !user || !user.platform) return null;

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
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save');
      }
      // 서버에서 최신 유저 정보 다시 가져오기 — 그리고 같은 사람의 다른 창(팝아웃)도 닫히게 알린다
      await refreshUser();
      postWindowSync({ type: 'terms:accepted', user_id: Number(user.id) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Backdrop>
      {/* ★ data-testid 는 §17 요구사항이자 **하니스 생존 조건**이다 (2026-09-14).
          약관을 개정해 버전을 올리는 순간 이 모달이 전면에 떠 모든 카나리의 클릭을 가로챈다.
          손잡이가 없으면 하니스가 넘길 수 없어 개정마다 검사 전체가 죽는다
          (memory feedback_consent_modal_fakes_modal_open · feedback_overlay_eats_click_false_reason). */}
      <Dialog data-testid="terms-reaccept" role="dialog" aria-modal="true" aria-label={t('terms.reacceptTitle', '약관 재동의') as string}>
        <Header>{t('terms.reacceptTitle', '약관이 업데이트됐습니다')}</Header>
        <Body>
          <Hint>{t('terms.reacceptHint', '서비스를 계속 이용하려면 변경된 약관에 동의해주세요.')}</Hint>
          {termsChanged && (
            <ConsentItem>
              <input data-testid="terms-reaccept-terms" type="checkbox" id="re-terms" checked={termsAgree} onChange={e => setTermsAgree(e.target.checked)} />
              <label htmlFor="re-terms">
                <a href="/terms" target="_blank" rel="noopener">{t('terms.termsLink', '이용약관')}</a>
                {t('terms.versionLabel', ' (v{{v}})', { v: user.platform.current_terms_version }) as string}
                {t('terms.agreeRequired', ' 에 동의합니다 (필수)')}
              </label>
            </ConsentItem>
          )}
          {privacyChanged && (
            <ConsentItem>
              <input data-testid="terms-reaccept-privacy" type="checkbox" id="re-privacy" checked={privacyAgree} onChange={e => setPrivacyAgree(e.target.checked)} />
              <label htmlFor="re-privacy">
                <a href="/privacy" target="_blank" rel="noopener">{t('terms.privacyLink', '개인정보 처리방침')}</a>
                {t('terms.versionLabel', ' (v{{v}})', { v: user.platform.current_privacy_version }) as string}
                {t('terms.agreeRequired', ' 에 동의합니다 (필수)')}
              </label>
            </ConsentItem>
          )}
        </Body>
        <Footer>
          <Submit data-testid="terms-reaccept-submit" type="button" onClick={submit} disabled={submitting || (termsChanged && !termsAgree) || (privacyChanged && !privacyAgree)}>
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
const Header = styled.div`padding: 20px 24px; font-size: 1rem; font-weight: 700; color: #0F172A; border-bottom: 1px solid #E2E8F0;`;
const Body = styled.div`padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;`;
const Hint = styled.p`margin: 0; font-size: 0.8125rem; color: #475569; line-height: 1.6;`;
const ConsentItem = styled.div`display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: #334155; padding: 12px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; input { width: 16px; height: 16px; accent-color: #14B8A6; cursor: pointer; } label { cursor: pointer; } a { color: #0D9488; font-weight: 600; text-decoration: underline; }`;
const Footer = styled.div`padding: 14px 24px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end;`;
const Submit = styled.button`padding: 10px 20px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.8125rem; font-weight: 700; cursor: pointer; &:hover:not(:disabled) { background: #0D9488; } &:disabled { background: #CBD5E1; cursor: not-allowed; }`;
