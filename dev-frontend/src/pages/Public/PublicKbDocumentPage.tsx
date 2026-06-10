// 공유 KB(인포) 문서 미리보기 — /public/kb/:token
// 문서 공개 페이지(PublicPostPage)와 동일한 레이아웃 (Toolbar + PromoBar + DocFrame).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';

interface KbPreview {
  id: number;
  title: string;
  body: string | null;
  source_type: string | null;
  file_name: string | null;
  mime_type: string | null;
  uploader?: { id: number; name: string } | null;
  workspace?: { id: number; name: string } | null;
  shared_at: string | null;
  created_at: string | null;
  custom_columns?: Array<{ id: string; name: string; type: string; show_in_list?: boolean }>;
  custom_values?: Record<string, string>;
}

const SOURCE_LABEL_DEFAULTS: Record<string, string> = {
  manual: '직접 입력',
  faq: 'FAQ',
  policy: '정책',
  pricing: '가격',
  other: '기타',
  file: '파일',
  post: '문서',
};

// KB body 는 HTML 문자열. 옛 plain text 도 안 깨지게 <p> wrap.
function toHtml(v: string): string {
  const isHtml = /<[a-z][\s\S]*>/i.test(v);
  return isHtml ? v : `<p>${v.replace(/\n/g, '<br/>')}</p>`;
}

const PublicKbDocumentPage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<KbPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  const fetchDoc = useCallback(async (pw?: string) => {
    if (!token) return;
    if (pw) setPwBusy(true); else setLoading(true);
    setPwError(null);
    try {
      const r = await fetch(`/api/kb-documents/public/by-token/${token}`,
        pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) { setDoc(j.data); setNeedPw(false); }
      else if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (r.status === 401 && j.requires_password) {
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else { setError(j.message || 'not_found'); }
    } catch { setError('network'); }
    finally { setLoading(false); setPwBusy(false); }
  }, [token]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // N+95 — 자동 redirect 없음 (PublicPostPage 와 동일). 로그인 사용자는 Toolbar 의 'PlanQ 에서 보기' 명시 클릭.

  if (loading) return <Center>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Center>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchDoc} busy={pwBusy} error={pwError} />;
  if (error || !doc) return (
    <Center>
      <div style={{ textAlign: 'center' }}>
        <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
        <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      </div>
    </Center>
  );

  const isAuthed = !!getAccessToken();
  const sourceLabel = doc.source_type
    ? t(`public.kb.source.${doc.source_type}`, { defaultValue: SOURCE_LABEL_DEFAULTS[doc.source_type] || doc.source_type }) as string
    : null;
  const dateStr = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ko-KR') : null;

  return (
    <Page>
      <Toolbar className="no-print">
        <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ToolbarSpacer />
        {/* 문서 공개 페이지와 동일한 2버튼: (로그인 시) PlanQ 앱에서 열기 + PDF 다운로드 */}
        {isAuthed && (
          <PrimaryBtn type="button" onClick={() => navigate(`/info?doc=${doc.id}`)}>
            {t('public.openInApp', { defaultValue: 'PlanQ 앱에서 열기' }) as string}
          </PrimaryBtn>
        )}
        <PlainBtn type="button" onClick={() => window.open(`/api/kb-documents/public/by-token/${token}/pdf`, '_blank')}>
          {t('public.downloadPdf', { defaultValue: 'PDF 다운로드' }) as string}
        </PlainBtn>
      </Toolbar>

      <PromoBar className="no-print">
        <PromoText>{t('public.promoCopy', { defaultValue: '업무, 프로젝트, 사람, 시간, 고객, 청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진' }) as string}</PromoText>
        <PromoLink href="https://planq.kr" target="_blank" rel="noreferrer">
          {t('public.promoCta', { defaultValue: '플랜큐 바로가기' }) as string} <span aria-hidden="true">→</span>
        </PromoLink>
      </PromoBar>

      <DocFrame>
        {doc.workspace && <WorkspaceLabel>{doc.workspace.name}</WorkspaceLabel>}
        <DocTitle>{doc.title}</DocTitle>
        <DocMeta>
          {sourceLabel && <SourcePill>{sourceLabel}</SourcePill>}
          {doc.uploader && <span>{doc.uploader.name}</span>}
          {dateStr && <span>· {dateStr}</span>}
          {doc.file_name && <span>· {doc.file_name}</span>}
        </DocMeta>

        {doc.body && (
          <Body dangerouslySetInnerHTML={{ __html: toHtml(doc.body) }} />
        )}

        {(() => {
          const cols = (doc.custom_columns || []).filter(c => {
            const val = (doc.custom_values || {})[c.id];
            return val != null && String(val).trim() !== '';
          });
          if (cols.length === 0) return null;
          return (
            <CustomSection>
              {cols.map(col => {
                const val = String((doc.custom_values || {})[col.id]);
                const isUrl = col.type === 'url' || /^https?:\/\//i.test(val);
                return (
                  <CustomRow key={col.id}>
                    <CustomLabel>{col.name}</CustomLabel>
                    {isUrl ? (
                      <CustomLink href={val} target="_blank" rel="noreferrer">{val}</CustomLink>
                    ) : (
                      <CustomValue>{val}</CustomValue>
                    )}
                  </CustomRow>
                );
              })}
            </CustomSection>
          );
        })()}

        {!doc.body && (doc.custom_columns || []).length === 0 && (
          <Hint>{t('public.kb.noBody', { defaultValue: '본문이 비어 있습니다.' }) as string}</Hint>
        )}
      </DocFrame>
    </Page>
  );
};

export default PublicKbDocumentPage;

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
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #FFFFFF;
  border: none; border-radius: 8px; background: #14B8A6; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const PlainBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 16px; font-size: 13px; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const PromoBar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 9px 24px; background: #F0FDFA; border-bottom: 1px solid #99F6E4;
  font-size: 12px; color: #475569; line-height: 1.5;
  @media (max-width: 640px) { padding: 9px 16px; gap: 10px; flex-wrap: wrap; }
  @media print { display: none !important; }
`;
const PromoText = styled.span`
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  @media (max-width: 640px) { white-space: normal; }
`;
const PromoLink = styled.a`
  flex-shrink: 0; color: #0F766E; font-weight: 700; text-decoration: none; white-space: nowrap;
  &:hover { color: #115E59; text-decoration: underline; }
  span { margin-left: 4px; }
`;
const DocFrame = styled.article`
  max-width: 820px; margin: 32px auto; background: #FFF; border: 1px solid #E2E8F0;
  border-radius: 12px; padding: 48px 56px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  font-size: 14px; line-height: 1.7; color: #0F172A;
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
const WorkspaceLabel = styled.div`font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`;
const DocTitle = styled.h1`font-size: 24px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0; line-height: 1.3;`;
const DocMeta = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  font-size: 12px; color: #64748B; margin: 0 0 24px 0;
`;
const SourcePill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
const Body = styled.div`
  font-size: 14px; color: #334155; line-height: 1.7;
  overflow-wrap: anywhere; word-break: break-word;
  & p { margin: 0 0 10px; }
  & p:last-child { margin-bottom: 0; }
  & ul, & ol { padding-left: 22px; margin: 8px 0; }
  & h1 { font-size: 22px; font-weight: 700; margin: 16px 0 6px; }
  & h2 { font-size: 18px; font-weight: 700; margin: 14px 0 6px; }
  & h3 { font-size: 15px; font-weight: 700; margin: 12px 0 4px; }
  & img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
  & a { color: #0D9488; text-decoration: underline; overflow-wrap: anywhere; }
  & table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  & td, & th { border: 1px solid #E2E8F0; padding: 8px 10px; }
  & blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; border-radius: 0 6px 6px 0; color: #475569; }
`;
const Hint = styled.div`font-size: 13px; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Center = styled.div`min-height:60vh;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px;`;
// 사용자 정의 항목 (label + value/link) — 반응형: 넓으면 label|value 2열, 좁으면 세로 스택
const CustomSection = styled.div`
  margin-top: 24px; padding-top: 20px; border-top: 1px solid #EEF2F6;
  display: flex; flex-direction: column; gap: 12px;
`;
const CustomRow = styled.div`
  display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 8px 16px; align-items: baseline;
  @media (max-width: 560px) { grid-template-columns: 1fr; gap: 2px; }
`;
const CustomLabel = styled.div`font-size: 13px; font-weight: 700; color: #334155; word-break: keep-all;`;
const CustomValue = styled.div`font-size: 14px; color: #334155; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word;`;
const CustomLink = styled.a`
  font-size: 14px; color: #0D9488; line-height: 1.6; text-decoration: underline;
  overflow-wrap: anywhere; word-break: break-word;
  &:hover { color: #0F766E; }
`;
