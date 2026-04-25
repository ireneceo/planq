// 공개 문서 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/docs/:token
// 기능: 본문 표시 + 인쇄(PDF) + 동의/서명/거절
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface PublicDoc {
  id: number; title: string; status: string; kind: string;
  body_html: string | null;
  body_json: Record<string, unknown> | null;
  signed_at: string | null;
  signature_data: { signer_name?: string; accept?: boolean } | null;
  share_token: string;
}

const PublicDocPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<PublicDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signNote, setSignNote] = useState('');
  const [signing, setSigning] = useState(false);
  const [signedDone, setSignedDone] = useState<{ status: string; at: string } | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/docs/public/${token}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) throw new Error(j.message || 'load_failed');
        setDoc(j.data);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const submitSign = async (accept: boolean) => {
    if (!token || !signerName.trim()) return;
    setSigning(true);
    try {
      const r = await fetch(`/api/docs/public/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim() || null,
          accept,
          note: signNote.trim() || null,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'sign_failed');
      setSignedDone({ status: j.data.status, at: j.data.signed_at });
      setSignOpen(false);
      // 새로 로드
      const fresh = await (await fetch(`/api/docs/public/${token}`)).json();
      if (fresh.success) setDoc(fresh.data);
    } catch (e) {
      const err = e as Error;
      setSignError(t('public.signError', { message: err.message, defaultValue: '서명 실패: {{message}}' }) as string);
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <Center>{t('public.loading', '문서 로드 중...')}</Center>;
  if (err || !doc) return <Center>{err || t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</Center>;

  const alreadySigned = !!doc.signed_at;
  const signerLabel = doc.signature_data?.signer_name || '';
  const accepted = doc.signature_data?.accept;

  return (
    <Page>
      <Toolbar className="no-print">
        <Brand>PlanQ</Brand>
        <ToolbarSpacer />
        <PrintBtn type="button" onClick={() => window.print()}>{t('public.print', '인쇄 / PDF 저장')}</PrintBtn>
        {!alreadySigned && (
          <SignBtn type="button" onClick={() => setSignOpen(true)}>{t('public.signOpen', '동의 / 서명')}</SignBtn>
        )}
      </Toolbar>

      <DocFrame>
        <DocTitle>{doc.title}</DocTitle>
        <DocBody dangerouslySetInnerHTML={{ __html: doc.body_html || '' }} />

        {alreadySigned && (
          <SignBlock $accept={accepted}>
            <SignTitle>
              {accepted ? t('public.signedAccept', '✓ 동의 완료') : t('public.signedReject', '✗ 거절됨')}
            </SignTitle>
            <SignMeta>
              {t('public.signer', '서명자')}: <strong>{signerLabel}</strong> · {t('public.signedAt', '서명 시각')}: {new Date(doc.signed_at!).toLocaleString('ko-KR')}
            </SignMeta>
          </SignBlock>
        )}

        {signedDone && !alreadySigned && (
          <SignBlock $accept={signedDone.status === 'signed'}>
            <SignTitle>
              {signedDone.status === 'signed' ? t('public.signedAccept', '✓ 동의 완료') : t('public.signedReject', '✗ 거절됨')}
            </SignTitle>
          </SignBlock>
        )}
      </DocFrame>

      {signOpen && (
        <ModalBackdrop onClick={() => setSignOpen(false)}>
          <ModalDialog onClick={e => e.stopPropagation()}>
            <ModalTitle>{t('public.signTitle', '동의 또는 거절')}</ModalTitle>
            <ModalSub>{t('public.signSub', '서명 후에는 변경할 수 없습니다. 신중히 검토해 주세요.')}</ModalSub>
            <ModalField>
              <FieldLabel>{t('public.signerName', '이름')} *</FieldLabel>
              <FieldInput type="text" value={signerName} onChange={e => setSignerName(e.target.value)} placeholder={t('public.signerNamePh', '예: 홍길동') as string} autoFocus />
            </ModalField>
            <ModalField>
              <FieldLabel>{t('public.signerEmail', '이메일 (선택)')}</FieldLabel>
              <FieldInput type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} placeholder="name@example.com" />
            </ModalField>
            <ModalField>
              <FieldLabel>{t('public.signNote', '메모 (선택)')}</FieldLabel>
              <FieldTextarea rows={2} value={signNote} onChange={e => setSignNote(e.target.value)} placeholder={t('public.signNotePh', '의견·조건·요청 사항') as string} />
            </ModalField>
            {signError && <ErrorBox>{signError}</ErrorBox>}
            <ModalActions>
              <BtnGhost type="button" onClick={() => setSignOpen(false)} disabled={signing}>{t('common.cancel', '취소')}</BtnGhost>
              <BtnDanger type="button" onClick={() => submitSign(false)} disabled={signing || !signerName.trim()}>{t('public.reject', '거절')}</BtnDanger>
              <BtnPrimary type="button" onClick={() => submitSign(true)} disabled={signing || !signerName.trim()}>{signing ? '...' : t('public.accept', '동의 · 서명')}</BtnPrimary>
            </ModalActions>
          </ModalDialog>
        </ModalBackdrop>
      )}
    </Page>
  );
};

export default PublicDocPage;

const Page = styled.div`
  min-height: 100vh; background: #F8FAFC; padding: 0 0 40px 0;
  @media print { background: #FFF; padding: 0; }
`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 12px 24px;
  background: #FFF; border-bottom: 1px solid #E2E8F0;
  position: sticky; top: 0; z-index: 10;
  @media print { display: none !important; }
`;
const Brand = styled.span`font-size:14px;font-weight:700;color:#0F766E;`;
const ToolbarSpacer = styled.div`flex:1;`;
const PrintBtn = styled.button`
  padding: 7px 14px; font-size: 13px; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const SignBtn = styled.button`
  padding: 7px 14px; font-size: 13px; font-weight: 700; color: #FFF;
  background: #14B8A6; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const DocFrame = styled.article`
  max-width: 820px; margin: 32px auto; background: #FFF; border: 1px solid #E2E8F0;
  border-radius: 12px; padding: 48px 56px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  font-size: 14px; line-height: 1.7; color: #0F172A;
  h1 { font-size: 24px; margin: 0 0 16px 0; }
  h2 { font-size: 17px; margin: 28px 0 10px 0; color: #0F172A; }
  p { margin: 0 0 12px 0; }
  ul, ol { padding-left: 24px; margin: 0 0 12px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #E2E8F0; padding: 8px 10px; }
  @media print {
    border: none; box-shadow: none; padding: 0; margin: 0; max-width: 100%;
  }
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
const DocTitle = styled.h1`font-size:24px;font-weight:700;color:#0F172A;margin:0 0 20px 0;`;
const DocBody = styled.div``;
const SignBlock = styled.div<{ $accept?: boolean }>`
  margin-top: 32px; padding: 16px 20px; border-radius: 12px;
  background: ${p => p.$accept ? '#F0FDFA' : '#FEF2F2'};
  border: 1px solid ${p => p.$accept ? '#14B8A6' : '#EF4444'};
`;
const SignTitle = styled.div`font-size:15px;font-weight:700;color:#0F172A;margin-bottom:6px;`;
const SignMeta = styled.div`font-size:12px;color:#64748B;`;
const Center = styled.div`min-height:60vh;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px;`;

const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
  @media print { display: none; }
`;
const ModalDialog = styled.div`
  background: #FFF; border-radius: 14px; max-width: 460px; width: 100%; padding: 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
`;
const ModalTitle = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0 0 6px 0;`;
const ModalSub = styled.p`font-size:12px;color:#64748B;margin:0 0 16px 0;line-height:1.5;`;
const ModalField = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
const FieldLabel = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const FieldInput = styled.input`width:100%;padding:8px 10px;font-size:13px;color:#0F172A;border:1px solid #E2E8F0;border-radius:8px;&:focus{outline:none;border-color:#14B8A6;}`;
const FieldTextarea = styled.textarea`width:100%;padding:8px 10px;font-size:13px;color:#0F172A;border:1px solid #E2E8F0;border-radius:8px;resize:vertical;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const ModalActions = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:8px;`;
const BtnGhost = styled.button`padding:8px 14px;font-size:13px;font-weight:600;color:#334155;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;&:hover:not(:disabled){border-color:#CBD5E1;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const BtnDanger = styled.button`padding:8px 14px;font-size:13px;font-weight:700;color:#DC2626;background:#FFF;border:1px solid #EF4444;border-radius:8px;cursor:pointer;&:hover:not(:disabled){background:#FEF2F2;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const BtnPrimary = styled.button`padding:8px 16px;font-size:13px;font-weight:700;color:#FFF;background:#14B8A6;border:none;border-radius:8px;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;
const ErrorBox = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;margin-bottom:8px;`;
