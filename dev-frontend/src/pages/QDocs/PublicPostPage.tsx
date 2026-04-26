// 공개 포스트 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/posts/:token
// 기능: 본문 표시 + 인쇄(PDF)
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import PostEditor from '../../components/Docs/PostEditor';

interface PublicPost {
  id: number;
  title: string;
  content_json: { type: 'doc'; content: unknown[] } | null;
  author: { id: number; name: string } | null;
  created_at: string;
  attachments: Array<{
    id: number;
    file: { id: number; file_name: string; download_url: string } | null;
  }>;
}

const PublicPostPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { token } = useParams<{ token: string }>();
  const [post, setPost] = useState<PublicPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/posts/public/${token}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) throw new Error(j.message || 'load_failed');
        setPost(j.data);
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Center>{t('public.loading', '문서 로드 중...')}</Center>;
  if (err || !post) return <Center>{err || t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</Center>;

  return (
    <Page>
      <Toolbar className="no-print">
        <Brand>PlanQ</Brand>
        <ToolbarSpacer />
        <PrintBtn type="button" onClick={() => window.print()}>{t('public.print', '인쇄 / PDF 저장')}</PrintBtn>
      </Toolbar>

      <DocFrame data-print-area>
        <DocTitle>{post.title}</DocTitle>
        <DocMeta>
          {post.author?.name || '—'} · {new Date(post.created_at).toLocaleDateString('ko-KR')}
        </DocMeta>
        <PostEditor value={post.content_json} onChange={() => {}} editable={false} />

        {post.attachments && post.attachments.length > 0 && (
          <AttachSection>
            <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
            {post.attachments.map(a => (
              a.file ? (
                <AttachRow key={a.id}>
                  <AttachLink href={a.file.download_url} target="_blank" rel="noreferrer">
                    {a.file.file_name}
                  </AttachLink>
                </AttachRow>
              ) : null
            ))}
          </AttachSection>
        )}
      </DocFrame>
    </Page>
  );
};

export default PublicPostPage;

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
const DocFrame = styled.article`
  max-width: 820px; margin: 32px auto; background: #FFF; border: 1px solid #E2E8F0;
  border-radius: 12px; padding: 48px 56px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  font-size: 14px; line-height: 1.7; color: #0F172A;
  @media print {
    border: none; box-shadow: none; padding: 0; margin: 0; max-width: 100%;
  }
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
const DocTitle = styled.h1`font-size:24px;font-weight:700;color:#0F172A;margin:0 0 6px 0;`;
const DocMeta = styled.div`font-size:12px;color:#64748B;margin:0 0 24px 0;`;
const AttachSection = styled.section`
  margin-top: 24px; padding-top: 16px; border-top: 1px solid #EEF2F6;
  display: flex; flex-direction: column; gap: 8px;
`;
const AttachTitle = styled.h3`font-size:13px;font-weight:700;color:#334155;margin:0;`;
const AttachRow = styled.div`font-size:13px;`;
const AttachLink = styled.a`
  color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const Center = styled.div`min-height:60vh;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px;`;
