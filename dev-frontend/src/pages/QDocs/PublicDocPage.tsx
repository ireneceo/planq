// 공개 문서 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/docs/:token
// 기능: 본문 표시 + 인쇄(PDF) + 이미 받은 서명 표시(읽기)
// ★ 2026-10-08 (0-C C-6) — 이 화면의 공개 서명(이름만 넣으면 서명되던 문)은 없앴다. OTP·이메일 검증이 없는
//   무인증 쓰기 표면이었다. 서명이 필요하면 Q docs 서명 요청(/sign/:token)으로 받는다.
import React, { useEffect, useState, useCallback } from 'react';
import { sanitizeRichText } from '../../utils/sanitizeHtml';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
// 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀐다(공개 페이지 공통 계약)
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';

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
  // N+44 — 410 share_expired 분기
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  // silent = **다시 읽기**. 보고 있는 문서를 스피너·에러 화면으로 되돌리지 않는다.
  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/docs/public/${token}`);
      const j = await r.json().catch(() => ({}));
      if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (!j.success) {
        throw new Error(j.message || 'load_failed');
      } else {
        setDoc(j.data); setErr(null);
      }
    } catch (e) {
      if (!silent) setErr((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  // 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀐다(공개 페이지 공통 계약).
  usePublicRevalidate(() => load(true), { enabled: !!doc });

  if (loading) return <Center>{t('public.loading', '문서 로드 중...')}</Center>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  // 서버 코드(`not_found_or_expired` 같은)를 고객 화면에 그대로 걸지 않는다 — 2026-09-14
  if (err || !doc) return <Center>{(err && !/^[a-z0-9_]+$/.test(err)) ? err : t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</Center>;

  const alreadySigned = !!doc.signed_at;
  const signerLabel = doc.signature_data?.signer_name || '';
  const accepted = doc.signature_data?.accept;

  return (
    <Page>
      <Toolbar className="no-print">
        <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ToolbarSpacer />
        <PrintBtn type="button" onClick={() => window.print()}>{t('public.print', '인쇄 / PDF 저장')}</PrintBtn>
      </Toolbar>

      <DocFrame>
        <DocTitle>{doc.title}</DocTitle>
        {/* ★ 무인증 공개 페이지다 — 원문을 그대로 넣으면 저장형 XSS 가 로그인 없는 방문자에게 실행된다.
            (2026-09-02 보안감사 실측: 주입한 onerror 가 verbatim 으로 응답에 실렸다.)
            같은 계열 공개 페이지(PublicKbDocumentPage·PublicTaskPage)는 이미 이 함수를 태운다. */}
        <DocBody dangerouslySetInnerHTML={{ __html: sanitizeRichText(doc.body_html) }} />

        {alreadySigned && (
          <SignBlock $accept={accepted}>
            <SignTitle>
              {accepted ? t('public.signedAccept', '동의 완료') : t('public.signedReject', '거절됨')}
            </SignTitle>
            <SignMeta>
              {t('public.signer', '서명자')}: <strong>{signerLabel}</strong> · {t('public.signedAt', '서명 시각')}: {new Date(doc.signed_at!).toLocaleString('ko-KR')}
            </SignMeta>
          </SignBlock>
        )}

        {!alreadySigned && (
          <ViewOnlyNote className="no-print" data-testid="public-doc-view-only">{t('public.signMoved', '이 문서는 보기 전용입니다. 서명이 필요하면 보낸 분께 서명 요청 링크를 요청해 주세요.')}</ViewOnlyNote>
        )}
      </DocFrame>

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
const Brand = styled.img`display:block;width:120px;height:auto;user-select:none;`;
const ToolbarSpacer = styled.div`flex:1;`;
const PrintBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 16px; font-size: 0.8125rem; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const DocFrame = styled.article`
  max-width: 820px; margin: 32px auto; background: #FFF; border: 1px solid #E2E8F0;
  border-radius: 12px; padding: 48px 56px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  font-size: 0.875rem; line-height: 1.7; color: #0F172A;
  h1 { font-size: 1.5rem; margin: 0 0 16px 0; }
  h2 { font-size: 1.0625rem; margin: 28px 0 10px 0; color: #0F172A; }
  p { margin: 0 0 12px 0; }
  ul, ol { padding-left: 24px; margin: 0 0 12px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #E2E8F0; padding: 8px 10px; }
  @media print {
    border: none; box-shadow: none; padding: 0; margin: 0; max-width: 100%;
  }
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
const DocTitle = styled.h1`font-size:1.5rem;font-weight:700;color:#0F172A;margin:0 0 20px 0;`;
const DocBody = styled.div``;
const SignBlock = styled.div<{ $accept?: boolean }>`
  margin-top: 32px; padding: 16px 20px; border-radius: 12px;
  background: ${p => p.$accept ? '#F0FDFA' : '#FEF2F2'};
  border: 1px solid ${p => p.$accept ? '#14B8A6' : '#EF4444'};
`;
const SignTitle = styled.div`font-size:0.9375rem;font-weight:700;color:#0F172A;margin-bottom:6px;`;
const SignMeta = styled.div`font-size:0.75rem;color:#64748B;`;
const ViewOnlyNote = styled.p`margin:32px 0 0 0;padding:12px 16px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:0.75rem;color:#64748B;line-height:1.5;@media print{display:none;}`;
const Center = styled.div`min-height:60vh;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:0.875rem;`;

