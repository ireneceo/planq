// 공개 포스트 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/posts/:token
// 기능: 본문 표시 + 인쇄(PDF)
import React, { useEffect, useCallback, useState } from 'react';
import styled from 'styled-components';
import PublicPageShell, { PublicCenter, PublicTitle, PublicMeta, PublicBtn } from '../../components/Layout/PublicPageShell';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import PostEditor from '../../components/Docs/PostEditor';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
import { apiFetch, getAccessToken } from '../../contexts/AuthContext';
// 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀌어야 한다(공개 페이지 공통 계약)
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';

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
  const navigate = useNavigate();
  const [post, setPost] = useState<PublicPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // N+44 — 410 share_expired 분기 (N+43 백엔드 응답)
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  // ★ silent=true 는 **다시 읽기**다 — 로딩 화면으로 되돌리지 않는다.
  //   읽던 문서가 스피너로 바뀌면 갱신이 아니라 고장으로 읽힌다.
  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/posts/public/${token}`);
      const j = await r.json().catch(() => ({}));
      if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (!j.success) {
        throw new Error(j.message || 'load_failed');
      } else {
        setPost(j.data);
        setExpired(null);
        setErr(null);
      }
    } catch (e) {
      // 조용한 재조회가 실패했다고 보고 있던 문서를 에러 화면으로 덮지 않는다
      if (!silent) setErr((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  usePublicRevalidate(() => load(true));

  // N+72-3 fix — 옛 자동 redirect 제거 (사용자 호소 "로그인했어도 따로 보이는게 맞다").
  // share link 의 의도는 외부 뷰. in-app 으로 가고 싶으면 별도 버튼 (아래 InAppOpenLink) 명시 클릭.
  const [appUrl, setAppUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!token || !post) return;
    if (!getAccessToken()) return;
    apiFetch(`/api/posts/public/${token}/auth-check`)
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.canAccess && j.data?.appUrl) setAppUrl(j.data.appUrl);
      })
      .catch(() => { /* silent */ });
  }, [token, post]);

  if (loading) return <PublicCenter>{t('public.loading', '문서 로드 중...')}</PublicCenter>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  //   ★ 서버 코드(not_found 등)를 그대로 뿌리지 않는다 — 사용자에게는 뜻 없는 영어 한 단어로 보인다
  //     (Irene 2026-08-31: 죽은 공유 링크를 열었더니 무엇이 잘못됐는지 알 수 없었다).
  //     원인은 셋 다 같은 결과다: 문서가 지워졌거나 · 공유를 중지했거나 · 링크가 만료됐다.
  if (err || !post) return (
    <PublicCenter>
      <div>{t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</div>
      <SubHint>{t('public.notFoundHint', '문서가 삭제됐거나 공유가 중지된 링크입니다. 보낸 분께 새 링크를 요청해 주세요.')}</SubHint>
    </PublicCenter>
  );

  return (
    <PublicPageShell promo
      actions={(
        <>
          {appUrl && (
            <PublicBtn type="button" onClick={() => navigate(appUrl)} style={{ background: '#14B8A6', color: '#FFFFFF', border: 'none' }}>
              {t('public.openInApp', { defaultValue: 'PlanQ 앱에서 열기' }) as string}
            </PublicBtn>
          )}
          <PublicBtn type="button" onClick={() => window.open(`/api/posts/public/${token}/pdf`, '_blank')}>{t('public.downloadPdf', 'PDF 다운로드')}</PublicBtn>
        </>
      )}
    >
      <>
        <PublicTitle>{post.title}</PublicTitle>
        <PublicMeta>
          {post.author?.name || '—'} · {new Date(post.created_at).toLocaleDateString('ko-KR')}
        </PublicMeta>
        <PostEditor value={post.content_json} onChange={() => {}} editable={false} borderless />

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
      </>
    </PublicPageShell>
  );
};

export default PublicPostPage;

const AttachTitle = styled.h3`font-size:0.8125rem;font-weight:700;color:#334155;margin:0;`;
const AttachRow = styled.div`font-size:0.8125rem;`;
const AttachLink = styled.a`
  color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const SubHint = styled.div`
  margin-top: 8px; font-size: 0.8125rem; color: #94A3B8; line-height: 1.5;
`;

const AttachSection = styled.section`
  margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 8px;
`;
