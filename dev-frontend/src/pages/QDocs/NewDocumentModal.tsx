// 새 문서 모달 — 3 진입 (AI / 템플릿 / 빈 문서)
// D-3 에서 AI 진입 활성화. 지금은 disabled hint.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import {
  createDocument, KIND_LABELS_KO, KIND_ICON,
  type DocTemplate, type DocSummary, type DocKind,
} from '../../services/docs';

interface Props {
  open: boolean;
  onClose: () => void;
  templates: DocTemplate[];
  businessId: number;
  onCreated: (doc: DocSummary) => void;
}

const NewDocumentModal: React.FC<Props> = ({ open, onClose, templates, businessId, onCreated }) => {
  const { t } = useTranslation('qdocs');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'ai' | 'template' | 'blank'>('template');

  useEscapeStack(open, onClose);
  useBodyScrollLock(open);

  if (!open) return null;

  const start = async (tpl: DocTemplate | null, kind?: DocKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const k: DocKind = tpl?.kind || kind || 'custom';
      const doc = await createDocument({
        business_id: businessId,
        template_id: tpl?.id || null,
        kind: k,
        title: tpl ? tpl.name : `새 ${KIND_LABELS_KO[k]}`,
      });
      onCreated(doc as unknown as DocSummary);
    } catch (e) {
      console.error('createDocument failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('newModal.title', '새 문서')}>
        <Header>
          <Title>{t('newModal.title', '새 문서 만들기')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>
        <TabBar>
          <TabBtn $active={tab === 'ai'} onClick={() => setTab('ai')}>
            ✨ {t('newModal.ai', 'AI 로 시작')}
          </TabBtn>
          <TabBtn $active={tab === 'template'} onClick={() => setTab('template')}>
            📋 {t('newModal.template', '템플릿에서')}
          </TabBtn>
          <TabBtn $active={tab === 'blank'} onClick={() => setTab('blank')}>
            📄 {t('newModal.blank', '빈 문서')}
          </TabBtn>
        </TabBar>
        <Body>
          {tab === 'ai' && (
            <AIStub>
              <AIIcon>✨</AIIcon>
              <AITitle>{t('newModal.aiComing', 'AI 자동 작성 — 곧 제공됩니다')}</AITitle>
              <AIDesc>{t('newModal.aiDesc', 'Cue 가 고객·프로젝트·과거 데이터를 분석하여 한 번에 초안을 만들어 드립니다.')}</AIDesc>
              <AISmall>Phase D-3 (예정)</AISmall>
            </AIStub>
          )}
          {tab === 'template' && (
            <TemplateGrid>
              {templates.map(tpl => (
                <TplCard key={tpl.id} onClick={() => start(tpl)} disabled={busy}>
                  <TplIcon>{KIND_ICON[tpl.kind]}</TplIcon>
                  <TplBody>
                    <TplName>{tpl.name}</TplName>
                    <TplDesc>{tpl.description}</TplDesc>
                  </TplBody>
                  {tpl.is_system && <TplBadge>{t('badge.system', '기본')}</TplBadge>}
                </TplCard>
              ))}
              {templates.length === 0 && (
                <NoTpls>{t('newModal.noTemplates', '템플릿이 없습니다')}</NoTpls>
              )}
            </TemplateGrid>
          )}
          {tab === 'blank' && (
            <BlankGrid>
              {(['quote', 'invoice', 'contract', 'nda', 'proposal', 'meeting_note', 'sop', 'custom'] as DocKind[]).map(k => (
                <BlankCard key={k} onClick={() => start(null, k)} disabled={busy}>
                  <BlankIcon>{KIND_ICON[k]}</BlankIcon>
                  <BlankName>{KIND_LABELS_KO[k]}</BlankName>
                </BlankCard>
              ))}
            </BlankGrid>
          )}
        </Body>
      </Dialog>
    </Backdrop>
  );
};

export default NewDocumentModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 720px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(15,23,42,0.2);
  @media (max-width: 640px) { max-height: 100vh; height: 100vh; border-radius: 0; }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #F1F5F9;
`;
const Title = styled.h2`
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px;
  background: transparent; border: none;
  display: flex; align-items: center; justify-content: center;
  color: #64748B; cursor: pointer; border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const TabBar = styled.div`
  display: flex; padding: 0 20px;
  border-bottom: 1px solid #F1F5F9;
`;
const TabBtn = styled.button<{ $active: boolean }>`
  padding: 12px 16px;
  background: transparent; border: none;
  border-bottom: 2px solid ${p => p.$active ? '#0D9488' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  font-size: 13px; font-weight: ${p => p.$active ? 700 : 500};
  cursor: pointer;
  &:hover { color: #0F172A; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 20px;
`;
const AIStub = styled.div`
  display: flex; flex-direction: column; align-items: center;
  text-align: center; padding: 40px 20px;
`;
const AIIcon = styled.div`
  font-size: 48px; margin-bottom: 16px;
`;
const AITitle = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A;
  margin-bottom: 8px;
`;
const AIDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.5;
  max-width: 360px; margin-bottom: 12px;
`;
const AISmall = styled.div`
  font-size: 10px; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.5px;
`;
const TemplateGrid = styled.div`
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
`;
const TplCard = styled.button`
  display: flex; gap: 12px; align-items: flex-start;
  padding: 14px; background: #fff;
  border: 1px solid #E2E8F0; border-radius: 10px;
  text-align: left; cursor: pointer; position: relative;
  font-family: inherit;
  &:hover:not(:disabled) { border-color: #0D9488; background: #F0FDFA; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const TplIcon = styled.div`
  font-size: 24px; flex-shrink: 0;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA; border-radius: 8px;
`;
const TplBody = styled.div`flex: 1; min-width: 0;`;
const TplName = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  margin-bottom: 4px;
`;
const TplDesc = styled.div`
  font-size: 11px; color: #64748B; line-height: 1.4;
`;
const TplBadge = styled.span`
  position: absolute; top: 10px; right: 10px;
  font-size: 9px; font-weight: 700;
  padding: 2px 6px; background: #CCFBF1; color: #0F766E;
  border-radius: 6px;
`;
const NoTpls = styled.div`
  grid-column: 1 / -1;
  text-align: center; padding: 40px 20px;
  color: #94A3B8; font-size: 13px;
`;
const BlankGrid = styled.div`
  display: grid; gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
`;
const BlankCard = styled.button`
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 12px; background: #fff;
  border: 1px solid #E2E8F0; border-radius: 10px;
  cursor: pointer; font-family: inherit;
  &:hover:not(:disabled) { border-color: #0D9488; background: #F0FDFA; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const BlankIcon = styled.div`font-size: 24px;`;
const BlankName = styled.div`
  font-size: 12px; font-weight: 600; color: #0F172A;
`;
