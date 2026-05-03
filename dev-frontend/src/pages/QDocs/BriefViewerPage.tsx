// 자료정리(Brief) 결과 뷰어 — 시점 모드 / 자료별 모드 토글, 1개 vs 여러 자료 분기.
//
// 라우트: /docs/brief/:id
// post.category === 'brief' 인 Post 의 brief_meta JSON 을 시각적으로 렌더.
// 추천 후속 문서 (recommended_next_kind) 가 있으면 하단에 CTA 카드.

import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { fetchPost, fetchPostChildren, createFollowUp, type PostDetail, type FollowUpChild } from '../../services/posts';

interface BriefMeta {
  view_kind: 'time' | 'file';
  sources: Array<{ source: string; file_id: number | null }>;
  timeline_count: number;
  by_file_count: number;
  recommended_next_kind: string;
  recommended_next_reason: string;
  summary: string;
  timeline: Array<{ when: string; title: string; content: string; source: string }>;
  by_file: Array<{ source: string; summary: string; key_points: string[] }>;
  generated_at: string;
}

const KIND_LABEL_KO: Record<string, string> = {
  meeting_note: '회의록', proposal: '제안서', quote: '견적서',
  contract: '계약서', nda: 'NDA', sop: '운영 가이드(SOP)', custom: '기타 문서',
};

const BriefViewerPage = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('qdocs');
  const navigate = useNavigate();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'time' | 'file'>('time');
  const [children, setChildren] = useState<FollowUpChild[]>([]);
  const [followUpBusy, setFollowUpBusy] = useState<'manual' | 'ai' | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchPost(Number(id))
      .then((p) => {
        setPost(p);
        const meta = (p as PostDetail & { brief_meta?: BriefMeta }).brief_meta;
        if (meta?.view_kind) setView(meta.view_kind);
      })
      .finally(() => setLoading(false));
    fetchPostChildren(Number(id)).then(setChildren).catch(() => null);
  }, [id]);

  const handleFollowUp = async (mode: 'manual' | 'ai') => {
    if (!post || !meta || followUpBusy) return;
    setFollowUpBusy(mode); setFollowUpError(null);
    try {
      const child = await createFollowUp(post.id, { mode, kind: meta.recommended_next_kind });
      // 후속 문서 → DocumentEditor 또는 PostsPage. 신규 post 는 PostsPage 의 detail (현재 별도 페이지 없음 — /docs?post=:id 로 진입)
      navigate(`/docs?post=${child.id}`);
    } catch (e: unknown) {
      const err = e as Error & { usage?: { remaining: number; limit: number } };
      if (err.message === 'cue_limit_exceeded') {
        setFollowUpError(t('brief.followUpLimit', '월 한도를 사용했습니다. 직접 작성을 사용하거나 다음달 시도하세요.') as string);
      } else {
        setFollowUpError(t('brief.followUpFailed', '후속 문서 생성 실패. 잠시 후 다시 시도하세요.') as string);
      }
    } finally {
      setFollowUpBusy(null);
    }
  };

  const meta: BriefMeta | null = useMemo(() => {
    if (!post) return null;
    const raw = (post as PostDetail & { brief_meta?: BriefMeta | string }).brief_meta;
    if (!raw) return null;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw as BriefMeta;
  }, [post]);

  if (loading) {
    return <PageShell title={t('brief.loading', '불러오는 중...')}><Skeleton /></PageShell>;
  }
  if (!post || !meta) {
    return (
      <PageShell title={t('brief.notFound', '자료정리를 찾을 수 없습니다')}>
        <Center>
          <BackBtn onClick={() => navigate('/docs')}>{t('brief.backToDocs', '문서 목록으로')}</BackBtn>
        </Center>
      </PageShell>
    );
  }

  const isSingleFile = meta.by_file.length <= 1;
  const hasTimeline = meta.timeline.length > 0;
  const hasFileView = meta.by_file.length > 0;

  return (
    <PageShell
      title={post.title}
      actions={
        <BackLink to="/docs">← {t('brief.backToDocs', '문서 목록')}</BackLink>
      }
    >
      <Wrap>
        {/* 요약 카드 */}
        <SummaryCard>
          <SummaryLabel>{t('brief.summary', '요약')}</SummaryLabel>
          <SummaryText>{meta.summary}</SummaryText>
          <SummaryMeta>
            {hasTimeline && <Chip>{t('brief.timelineCount', { count: meta.timeline.length, defaultValue: '시점 {{count}}건' })}</Chip>}
            {hasFileView && <Chip>{t('brief.sourceCount', { count: meta.by_file.length, defaultValue: '자료 {{count}}건' })}</Chip>}
            <ChipGray>{new Date(meta.generated_at).toLocaleString('ko-KR')}</ChipGray>
          </SummaryMeta>
        </SummaryCard>

        {/* View 토글 — 둘 다 가능할 때만 노출 */}
        {hasTimeline && hasFileView && (
          <ViewToggle role="tablist">
            <ToggleBtn role="tab" aria-selected={view === 'time'} $active={view === 'time'} onClick={() => setView('time')}>
              {t('brief.viewTime', '시점 보기')}
            </ToggleBtn>
            <ToggleBtn role="tab" aria-selected={view === 'file'} $active={view === 'file'} onClick={() => setView('file')}>
              {isSingleFile ? t('brief.viewFileSingle', '자료 보기') : t('brief.viewFileMulti', '자료별 보기')}
            </ToggleBtn>
          </ViewToggle>
        )}

        {/* 시점 모드 */}
        {((hasTimeline && (view === 'time' || !hasFileView))) && (
          <TimelineSection>
            {!hasFileView && <SectionTitle>{t('brief.timelineTitle', '시점별 정리')}</SectionTitle>}
            <Timeline>
              {meta.timeline.map((item, idx) => (
                <TimelineItem key={idx}>
                  <Dot />
                  <ItemBody>
                    <ItemHeader>
                      <When>{item.when || '—'}</When>
                      {item.source && <SourceTag>{item.source}</SourceTag>}
                    </ItemHeader>
                    <ItemTitle>{item.title}</ItemTitle>
                    <ItemContent>{item.content}</ItemContent>
                  </ItemBody>
                </TimelineItem>
              ))}
            </Timeline>
          </TimelineSection>
        )}

        {/* 자료별 모드 */}
        {((hasFileView && (view === 'file' || !hasTimeline))) && (
          <FilesSection $single={isSingleFile}>
            {!hasTimeline && (
              <SectionTitle>
                {isSingleFile ? t('brief.fileTitleSingle', '자료 정리') : t('brief.fileTitleMulti', '자료별 정리')}
              </SectionTitle>
            )}
            <FileGrid $single={isSingleFile}>
              {meta.by_file.map((item, idx) => (
                <FileCard key={idx} $single={isSingleFile}>
                  <FileHeader>
                    <FileSource>{item.source}</FileSource>
                  </FileHeader>
                  {item.summary && <FileSummary>{item.summary}</FileSummary>}
                  {item.key_points.length > 0 && (
                    <KeyList>
                      {item.key_points.map((kp, i) => <KeyItem key={i}>{kp}</KeyItem>)}
                    </KeyList>
                  )}
                </FileCard>
              ))}
            </FileGrid>
          </FilesSection>
        )}

        {/* 추천 후속 문서 CTA */}
        {meta.recommended_next_kind && (
          <NextCta>
            <NextLabel>{t('brief.nextLabel', '추천 후속 문서')}</NextLabel>
            <NextBody>
              <NextKindBadge>{KIND_LABEL_KO[meta.recommended_next_kind] || meta.recommended_next_kind}</NextKindBadge>
              <NextReason>{meta.recommended_next_reason || t('brief.nextDefaultReason', '이 자료를 바탕으로 후속 문서를 작성할 수 있어요.')}</NextReason>
            </NextBody>
            <NextActions>
              <NextSecondary type="button" onClick={() => handleFollowUp('manual')}
                disabled={!!followUpBusy}>
                {followUpBusy === 'manual'
                  ? t('brief.creatingManual', '생성 중...')
                  : t('brief.nextDirect', '직접 작성')}
              </NextSecondary>
              <NextPrimary type="button" onClick={() => handleFollowUp('ai')}
                disabled={!!followUpBusy}>
                {followUpBusy === 'ai'
                  ? t('brief.creatingAi', 'AI 작성 중...')
                  : t('brief.nextAi', 'AI 로 작성')}
              </NextPrimary>
            </NextActions>
            {followUpError && <FollowUpError>{followUpError}</FollowUpError>}
          </NextCta>
        )}

        {/* 이 자료정리에서 파생된 후속 문서들 (양방향 링크) */}
        {children.length > 0 && (
          <ChildrenSection>
            <SectionTitle>{t('brief.childrenTitle', { count: children.length, defaultValue: '이 자료정리에서 파생된 문서 ({{count}}건)' })}</SectionTitle>
            <ChildrenList>
              {children.map((c) => (
                <ChildCard key={c.id} to={`/docs?post=${c.id}`}>
                  <ChildKind>{KIND_LABEL_KO[c.category || 'custom'] || c.category}</ChildKind>
                  <ChildTitle>{c.title}</ChildTitle>
                  <ChildMeta>
                    {c.author?.name || ''} · {new Date(c.created_at).toLocaleDateString('ko-KR')}
                  </ChildMeta>
                </ChildCard>
              ))}
            </ChildrenList>
          </ChildrenSection>
        )}

        {/* 출처 (sources) — 작은 영역 */}
        {meta.sources.length > 0 && (
          <SourcesFoot>
            <SourcesLabel>{t('brief.sourcesLabel', '입력 자료')}</SourcesLabel>
            <SourcesList>
              {meta.sources.map((s, i) => <SourceFootItem key={i}>{s.source}</SourceFootItem>)}
            </SourcesList>
          </SourcesFoot>
        )}
      </Wrap>
    </PageShell>
  );
};

export default BriefViewerPage;

// ─── styled ───
const Wrap = styled.div`
  max-width: 880px;
  margin: 0 auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  @media (max-width: 768px) { padding: 16px 12px; gap: 16px; }
`;
const SummaryCard = styled.section`
  background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 100%);
  border: 1px solid #CCFBF1;
  border-radius: 14px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;
const SummaryLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #0F766E;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;
const SummaryText = styled.p`
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: #0F172A;
`;
const SummaryMeta = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;
`;
const Chip = styled.span`
  display: inline-flex; align-items: center;
  padding: 3px 10px;
  font-size: 11px; font-weight: 600;
  background: #CCFBF1; color: #0F766E;
  border-radius: 999px;
`;
const ChipGray = styled.span`
  display: inline-flex; align-items: center;
  padding: 3px 10px;
  font-size: 11px; font-weight: 500;
  background: #F1F5F9; color: #64748B;
  border-radius: 999px;
`;
const ViewToggle = styled.div`
  display: inline-flex; gap: 0;
  background: #F1F5F9;
  border-radius: 10px;
  padding: 4px;
  align-self: flex-start;
`;
const ToggleBtn = styled.button<{ $active: boolean }>`
  padding: 8px 16px;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: ${p => p.$active ? 700 : 500};
  cursor: pointer;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  transition: background 0.15s, color 0.15s;
  &:hover { color: #0F766E; }
`;
const SectionTitle = styled.h3`
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: #0F172A;
`;
const TimelineSection = styled.section``;
const Timeline = styled.div`
  position: relative;
  padding-left: 24px;
  &::before {
    content: '';
    position: absolute;
    left: 7px; top: 6px; bottom: 6px;
    width: 2px;
    background: linear-gradient(to bottom, #14B8A6 0%, #14B8A6 50%, #E2E8F0 100%);
  }
`;
const TimelineItem = styled.article`
  position: relative;
  padding-bottom: 18px;
  &:last-child { padding-bottom: 0; }
`;
const Dot = styled.span`
  position: absolute;
  left: -22px; top: 6px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #14B8A6;
  border: 2px solid #FFFFFF;
  box-shadow: 0 0 0 1px #14B8A6;
`;
const ItemBody = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 12px 16px;
`;
const ItemHeader = styled.header`
  display: flex; gap: 8px; align-items: center;
  margin-bottom: 4px;
`;
const When = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #0F766E;
`;
const SourceTag = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: #64748B;
  background: #F1F5F9;
  padding: 2px 6px;
  border-radius: 4px;
`;
const ItemTitle = styled.h4`
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: #0F172A;
`;
const ItemContent = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #334155;
`;
const FilesSection = styled.section<{ $single: boolean }>``;
const FileGrid = styled.div<{ $single: boolean }>`
  display: grid;
  gap: 12px;
  grid-template-columns: ${p => p.$single ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))'};
`;
const FileCard = styled.article<{ $single: boolean }>`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: ${p => p.$single ? '20px 24px' : '14px 16px'};
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const FileHeader = styled.header``;
const FileSource = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #0F766E;
  word-break: break-all;
`;
const FileSummary = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #334155;
`;
const KeyList = styled.ul`
  margin: 4px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
const KeyItem = styled.li`
  font-size: 13px;
  line-height: 1.5;
  color: #334155;
`;
const NextCta = styled.section`
  background: #F0FDFA;
  border: 1px solid #CCFBF1;
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;
const NextLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #0F766E;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;
const NextBody = styled.div`
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
`;
const NextKindBadge = styled.span`
  display: inline-flex;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 700;
  background: #14B8A6;
  color: #FFFFFF;
  border-radius: 999px;
`;
const NextReason = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #334155;
  flex: 1;
  min-width: 200px;
`;
const NextActions = styled.div`
  display: flex; gap: 8px; justify-content: flex-end;
  @media (max-width: 640px) { flex-direction: column; }
`;
const NextSecondary = styled.button`
  padding: 8px 14px;
  font-size: 13px; font-weight: 600;
  color: #334155;
  background: #FFFFFF;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const NextPrimary = styled.button`
  padding: 8px 16px;
  font-size: 13px; font-weight: 700;
  color: #FFFFFF;
  background: #14B8A6;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const FollowUpError = styled.div`
  font-size: 12px;
  color: #DC2626;
  background: #FEF2F2;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #FECACA;
`;
const ChildrenSection = styled.section``;
const ChildrenList = styled.div`
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
`;
const ChildCard = styled(Link)`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  text-decoration: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: #14B8A6; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
`;
const ChildKind = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #0F766E;
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;
const ChildTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  line-height: 1.4;
`;
const ChildMeta = styled.div`
  font-size: 11px;
  color: #94A3B8;
`;
const SourcesFoot = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid #E2E8F0;
`;
const SourcesLabel = styled.div`
  font-size: 11px;
  color: #94A3B8;
  font-weight: 600;
`;
const SourcesList = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
`;
const SourceFootItem = styled.span`
  font-size: 11px;
  color: #64748B;
  background: #F1F5F9;
  padding: 2px 8px;
  border-radius: 4px;
`;
const Center = styled.div`
  display: flex; justify-content: center; padding: 40px;
`;
const BackBtn = styled.button`
  padding: 10px 18px;
  font-size: 13px; font-weight: 600;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const BackLink = styled(Link)`
  font-size: 13px;
  color: #64748B;
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 6px;
  &:hover { color: #0F766E; background: #F0FDFA; }
`;
const Skeleton = styled.div`
  height: 400px;
  margin: 20px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 10px;
  animation: shimmer 1.5s infinite;
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
