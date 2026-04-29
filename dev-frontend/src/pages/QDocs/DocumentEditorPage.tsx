// Q docs — 단일 문서 편집 페이지 (TipTap 기반)
// 라우트: /docs/d/:id
// 기능: 제목 인라인 편집 + 본문 TipTap 에디터 + 자동 저장 (debounce 1.5s)
//      메타 (kind/status/client/project) 우측 사이드 + 액션 (PDF·공개링크는 D-4)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PostEditor from '../../components/Docs/PostEditor';
import PageShell from '../../components/Layout/PageShell';
import RevisionPanel from '../../components/Docs/RevisionPanel';
import {
  getDocument, updateDocument,
  KIND_LABELS_KO, type DocDetail,
} from '../../services/docs';

const DocumentEditorPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const docId = id ? Number(id) : null;

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [revisionReloadKey, setRevisionReloadKey] = useState(0);
  const saveTimer = useRef<number | null>(null);

  // 로드
  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    getDocument(docId)
      .then(d => { setDoc(d); setErr(null); })
      .catch(e => setErr(e.message || 'Failed'))
      .finally(() => setLoading(false));
  }, [docId]);

  // 디바운스 저장
  const scheduleSave = useCallback((patch: Partial<DocDetail>) => {
    if (!docId) return;
    setSaveStatus('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await updateDocument(docId, patch as Parameters<typeof updateDocument>[1]);
        setSaveStatus('saved');
        // 사이클 I4 — 저장 성공 후 revision 패널 리로드 (새 revision 자동 생성됨)
        setRevisionReloadKey(k => k + 1);
        window.setTimeout(() => setSaveStatus('idle'), 1500);
      } catch {
        setSaveStatus('error');
      }
    }, 1500);
  }, [docId]);

  const onTitleChange = (newTitle: string) => {
    setDoc(prev => prev ? { ...prev, title: newTitle } : prev);
    scheduleSave({ title: newTitle });
  };

  const onBodyChange = (json: unknown) => {
    const v = (json && typeof json === 'object') ? (json as Record<string, unknown>) : null;
    setDoc(prev => prev ? { ...prev, body_json: v } : prev);
    scheduleSave({ body_json: v });
  };

  if (loading) {
    return <PageShell title={t('editor.loading', '문서 로드 중...') as string}><EmptyMsg>{t('editor.loading', '문서 로드 중...')}</EmptyMsg></PageShell>;
  }
  if (err || !doc) {
    return (
      <PageShell title={t('editor.notFound', '문서를 찾을 수 없습니다') as string}>
        <EmptyMsg>{err || t('editor.notFound', '문서를 찾을 수 없습니다')}</EmptyMsg>
        <BackBtn onClick={() => navigate('/docs')}>{t('editor.back', '문서 목록으로')}</BackBtn>
      </PageShell>
    );
  }

  const kindLabel = KIND_LABELS_KO[doc.kind] || doc.kind;
  const saveLabel = saveStatus === 'saving' ? t('editor.saving', '저장 중...')
    : saveStatus === 'saved' ? t('editor.saved', '저장됨')
    : saveStatus === 'error' ? t('editor.saveError', '저장 실패')
    : '';

  return (
    <PageShell
      title={t('editor.title', { kind: kindLabel, defaultValue: '{{kind}} 편집' }) as string}
      actions={<>
        {saveLabel && <SaveBadge $kind={saveStatus}>{saveLabel}</SaveBadge>}
        <BackBtn onClick={() => navigate('/docs')}>{t('editor.back', '목록')}</BackBtn>
      </>}
    >
      <Layout>
        <MainCol>
          <TitleInput
            value={doc.title}
            onChange={e => onTitleChange(e.target.value)}
            placeholder={t('editor.titlePlaceholder', '문서 제목') as string} />
          <EditorWrap>
            <PostEditor
              value={doc.body_json ?? (doc.body_html ?? null)}
              onChange={onBodyChange}
              placeholder={t('editor.bodyPlaceholder', '본문을 작성하세요…') as string} />
          </EditorWrap>
        </MainCol>
        <SideCol>
          <SideCard>
            <SideTitle>{t('editor.meta', '메타')}</SideTitle>
            <Row><Label>{t('editor.kind', '유형')}</Label><Value>{kindLabel}</Value></Row>
            <Row><Label>{t('editor.status', '상태')}</Label><Value>{doc.status}</Value></Row>
            {doc.client_id && <Row><Label>{t('editor.client', '고객')}</Label><Value>#{doc.client_id}</Value></Row>}
            {doc.project_id && <Row><Label>{t('editor.project', '프로젝트')}</Label><Value>#{doc.project_id}</Value></Row>}
          </SideCard>
          {/* 사이클 I4 — 변경 이력 (revision diff) */}
          {docId && (
            <RevisionPanel
              docId={docId}
              slotLabels={(doc as DocDetail & { template?: { schema_json?: { key: string; label?: string; label_en?: string }[] } }).template?.schema_json?.reduce((acc: Record<string, string>, slot) => {
                acc[slot.key] = slot.label || slot.label_en || slot.key;
                return acc;
              }, {})}
              reloadKey={revisionReloadKey}
            />
          )}
          <SideCard>
            <SideTitle>{t('editor.upcoming', '예정 (D-4)')}</SideTitle>
            <Hint>{t('editor.upcomingPdf', 'PDF 생성 · 공개 링크 · 서명 — 추후 활성화')}</Hint>
          </SideCard>
        </SideCol>
      </Layout>
    </PageShell>
  );
};

export default DocumentEditorPage;

const Layout = styled.div`
  display: grid; grid-template-columns: 1fr 280px; gap: 20px; align-items: start;
  @media (max-width: 1024px) { grid-template-columns: 1fr; }
`;
const MainCol = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SideCol = styled.div`display:flex;flex-direction:column;gap:12px;`;
const TitleInput = styled.input`
  width: 100%; padding: 12px 14px; font-size: 22px; font-weight: 700; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 10px; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const EditorWrap = styled.div`
  background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 8px 12px; min-height: 480px;
`;
const SideCard = styled.div`
  background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;
`;
const SideTitle = styled.h3`margin:0 0 10px 0;font-size:13px;font-weight:700;color:#0F172A;`;
const Row = styled.div`display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #F1F5F9;font-size:13px;&:last-child{border-bottom:none;}`;
const Label = styled.span`color:#64748B;`;
const Value = styled.span`color:#0F172A;font-weight:500;`;
const Hint = styled.p`margin:0;font-size:12px;color:#94A3B8;line-height:1.55;`;
const SaveBadge = styled.span<{ $kind: 'idle' | 'saving' | 'saved' | 'error' }>`
  font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
  ${p => p.$kind === 'saved' && 'background:#F0FDFA;color:#0F766E;'}
  ${p => p.$kind === 'saving' && 'background:#F1F5F9;color:#64748B;'}
  ${p => p.$kind === 'error' && 'background:#FEF2F2;color:#DC2626;'}
`;
const BackBtn = styled.button`
  padding: 7px 14px; font-size: 13px; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const EmptyMsg = styled.p`padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;`;
