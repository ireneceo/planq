// 공유 KB(인포) 문서 미리보기 — /public/kb/:token
// 문서 공개 페이지(PublicPostPage)와 동일한 레이아웃 (Toolbar + PromoBar + DocFrame).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import PublicPageShell, { PublicCenter, PublicWorkspaceLabel, PublicTitle, PublicMeta, PublicBtn } from '../../components/Layout/PublicPageShell';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
import { sanitizeRichText } from '../../utils/sanitizeHtml';

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
  updated_at: string | null;
  custom_columns?: Array<{ id: string; name: string; type: string; show_in_list?: boolean }>;
  custom_values?: Record<string, string>;
}

// KB body 는 HTML 문자열. 옛 plain text 도 안 깨지게 <p> wrap.
// 공개 페이지 — 사용자 작성 HTML 은 반드시 정화 후 렌더 (여태 원문 그대로 넣어 script/onerror 가 실행 가능했다)
function toHtml(v: string): string {
  return sanitizeRichText(v);
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

  if (loading) return <PublicCenter>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</PublicCenter>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchDoc} busy={pwBusy} error={pwError} />;
  if (error || !doc) return (
    <PublicCenter>
      <div style={{ textAlign: 'center' }}>
        <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
        <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      </div>
    </PublicCenter>
  );

  const isAuthed = !!getAccessToken();
  // 공개 미리보기 메타 = 작성일 / 수정일 (개인 프로필명·source 타입은 외부 공개에 부적절 — 제거).
  const createdStr = doc.created_at ? new Date(doc.created_at).toLocaleDateString('ko-KR') : null;
  const updatedStr = doc.updated_at ? new Date(doc.updated_at).toLocaleDateString('ko-KR') : null;

  return (
    <PublicPageShell promo
      actions={(
        <>
          {/* 문서 공개 페이지와 동일한 2버튼: (로그인 시) PlanQ 앱에서 열기 + PDF 다운로드 */}
          {isAuthed && (
            <PublicBtn $primary type="button" onClick={() => navigate(`/info?doc=${doc.id}`)}>
              {t('public.openInApp', { defaultValue: 'PlanQ 앱에서 열기' }) as string}
            </PublicBtn>
          )}
          <PublicBtn type="button" onClick={() => window.open(`/api/kb-documents/public/by-token/${token}/pdf`, '_blank')}>
            {t('public.downloadPdf', { defaultValue: 'PDF 다운로드' }) as string}
          </PublicBtn>
        </>
      )}
    >
      <>
        {doc.workspace && <PublicWorkspaceLabel>{doc.workspace.name}</PublicWorkspaceLabel>}
        <PublicTitle>{doc.title}</PublicTitle>
        <PublicMeta>
          {createdStr && <span>{t('public.kb.created', { defaultValue: '작성' }) as string} {createdStr}</span>}
          {updatedStr && updatedStr !== createdStr && <span>· {t('public.kb.updated', { defaultValue: '수정' }) as string} {updatedStr}</span>}
          {doc.file_name && <span>· {doc.file_name}</span>}
        </PublicMeta>

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
      </>
    </PublicPageShell>
  );
};

export default PublicKbDocumentPage;

const Hint = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const CustomRow = styled.div`
  display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 8px 16px; align-items: baseline;
  @media (max-width: 560px) { grid-template-columns: 1fr; gap: 2px; }
`;
const CustomLabel = styled.div`font-size: 0.8125rem; font-weight: 700; color: #334155; word-break: keep-all;`;
const CustomValue = styled.div`font-size: 0.875rem; color: #334155; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word;`;
const CustomLink = styled.a`
  font-size: 0.875rem; color: #0D9488; line-height: 1.6; text-decoration: underline;
  overflow-wrap: anywhere; word-break: break-word;
  &:hover { color: #0F766E; }
`;
const Body = styled.div`
  font-size: 0.875rem; color: #334155; line-height: 1.7;
  overflow-wrap: anywhere; word-break: break-word;
  & p { margin: 0 0 10px; }
  & p:last-child { margin-bottom: 0; }
  & ul, & ol { padding-left: 22px; margin: 8px 0; }
  & h1 { font-size: 1.375rem; font-weight: 700; margin: 16px 0 6px; }
  & h2 { font-size: 1.125rem; font-weight: 700; margin: 14px 0 6px; }
  & h3 { font-size: 0.9375rem; font-weight: 700; margin: 12px 0 4px; }
  & img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
  & a { color: #0D9488; text-decoration: underline; overflow-wrap: anywhere; }
  & table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 0.8125rem; }
  & td, & th { border: 1px solid #E2E8F0; padding: 8px 10px; }
  & blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; border-radius: 0 6px 6px 0; color: #475569; }
`;
const CustomSection = styled.div`
  margin-top: 24px; padding-top: 20px; border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 12px;
`;
