// 보내는 쪽 서명 — 멤버가 **앱 안에서** 서명한다 (2026-09-22, 설계 docs/SIGNATURE_FIELD_DESIGN.md §3).
//
// 받는 쪽과 다른 것은 **본인 확인 방법 하나**다: 이메일 인증번호 대신 **로그인**이 본인을 증명한다.
// 나머지(동의 체크·그리기·기록)는 같다 — 증거의 수준이 갈리면 우리 서명이 약한 고리가 된다.
//
// 그리기 칸은 공개 서명 페이지와 **같은 컴포넌트**(components/Common/SignaturePad).
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import SignaturePad, { type SignaturePadHandle } from '../Common/SignaturePad';
import { signInternal, type SignatureRequest } from '../../services/posts';

interface Props {
  open: boolean;
  onClose: () => void;
  request: SignatureRequest | null;
  docTitle?: string;
  onSigned: () => void;
}

const InternalSignModal: React.FC<Props> = ({ open, onClose, request, docTitle, onSigned }) => {
  const { t } = useTranslation('qdocs');
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [empty, setEmpty] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { if (busy) return; setConsent(false); setError(null); onClose(); };

  const submit = async () => {
    if (busy || !request) return;
    const img = padRef.current?.toDataURL() || null;
    if (!img) { setError(t('internalSign.drawRequired', { defaultValue: '서명을 그려주세요.' }) as string); return; }
    if (!consent) { setError(t('internalSign.consentRequired', { defaultValue: '동의에 체크해야 서명할 수 있습니다.' }) as string); return; }
    setBusy(true); setError(null);
    try {
      await signInternal(request.id, img);
      onSigned();
      setConsent(false);
      onClose();
    } catch (e) {
      setError((e as Error).message || (t('internalSign.failed', { defaultValue: '서명하지 못했습니다.' }) as string));
    } finally { setBusy(false); }
  };

  return (
    <StandardModal
      open={open}
      onClose={close}
      title={t('internalSign.title', { defaultValue: '서명하기' }) as string}
      size="md"
      footer={(
        <>
          <ActionButton tone="secondary" type="button" onClick={close} disabled={busy}>
            {t('common.cancel', '취소') as string}
          </ActionButton>
          <ActionButton
            tone="primary" type="button" data-testid="internal-sign-submit"
            onClick={() => void submit()} loading={busy} disabled={busy || empty || !consent}
          >
            {t('internalSign.submit', { defaultValue: '서명 완료' }) as string}
          </ActionButton>
        </>
      )}
    >
      {docTitle && <DocLine>{docTitle}</DocLine>}
      <Hint>{t('internalSign.hint', { defaultValue: '아래 칸에 서명을 그려주세요. 마우스·손가락 모두 됩니다.' }) as string}</Hint>
      <PadWrap>
        <SignaturePad
          ref={padRef}
          onEmptyChange={setEmpty}
          ariaLabel={t('internalSign.padLabel', { defaultValue: '서명 그리기' }) as string}
        />
        <PadTools>
          <ClearBtn type="button" onClick={() => padRef.current?.clear()} disabled={busy || empty}>
            {t('internalSign.clear', { defaultValue: '지우기' }) as string}
          </ClearBtn>
        </PadTools>
      </PadWrap>
      <ConsentRow>
        <input
          id="internal-sign-consent" type="checkbox" checked={consent}
          onChange={(e) => setConsent(e.target.checked)} disabled={busy}
        />
        <label htmlFor="internal-sign-consent">
          {t('internalSign.consent', { defaultValue: '문서 내용을 확인했고, 이 서명이 전자서명으로서 법적 효력을 갖는 데 동의합니다.' }) as string}
        </label>
      </ConsentRow>
      <IdNote>{t('internalSign.idNote', { defaultValue: '본인 확인은 로그인으로 대신합니다. 서명 시각과 접속 정보가 함께 기록됩니다.' }) as string}</IdNote>
      {error && <ErrorBar role="alert">{error}</ErrorBar>}
    </StandardModal>
  );
};

export default InternalSignModal;

const DocLine = styled.div`font-size:0.875rem;font-weight:700;color:#0F172A;margin-bottom:6px;`;
const Hint = styled.div`font-size:0.75rem;color:#64748B;margin-bottom:10px;`;
const PadWrap = styled.div`position:relative;`;
const PadTools = styled.div`display:flex;justify-content:flex-end;margin-top:6px;`;
const ClearBtn = styled.button`
  border:none;background:none;color:#64748B;font-size:0.75rem;cursor:pointer;padding:4px 6px;
  &:disabled { color:#CBD5E1;cursor:default; }
`;
const ConsentRow = styled.div`
  display:flex;align-items:flex-start;gap:8px;margin-top:12px;
  label { font-size:0.8125rem;color:#334155;line-height:1.5; }
  input { margin-top:3px;flex-shrink:0; }
`;
const IdNote = styled.div`margin-top:8px;font-size:0.6875rem;color:#94A3B8;`;
const ErrorBar = styled.div`
  margin-top:10px;padding:8px 10px;border-radius:8px;
  background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;font-size:0.75rem;
`;
