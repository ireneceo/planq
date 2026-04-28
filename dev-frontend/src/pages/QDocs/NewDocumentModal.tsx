// 새 문서 모달 — 3 진입 (AI / 템플릿 / 빈 문서)
// AI 모드는 client + project 컨텍스트 필수 (사용자가 진짜 회사명·담당자·금액을 채우지 않으면 빈 placeholder 만 남기 때문).
// project 선택 시 그 프로젝트의 primary client 자동 매핑.
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import {
  createDocument, aiGenerateDoc, KIND_LABELS_KO, KIND_ICON,
  type DocTemplate, type DocSummary, type DocKind,
} from '../../services/docs';
import { listClientsForBilling, type ApiClientLite } from '../../services/invoices';
import { listProjects, type ApiProject } from '../../services/qtalk';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';

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
  const [tab, setTab] = useState<'ai' | 'template' | 'blank'>('ai');

  // AI 모드 입력
  const [aiKind, setAiKind] = useState<DocKind>('proposal');
  const [aiTitle, setAiTitle] = useState('');
  const [aiUserInput, setAiUserInput] = useState('');
  const [aiClientId, setAiClientId] = useState<number | null>(null);
  const [aiProjectId, setAiProjectId] = useState<number | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<{ remaining: number; limit: number } | null>(null);

  // 컨텍스트 후보 — modal open 시 한 번 fetch
  const [clients, setClients] = useState<ApiClientLite[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [cls, prjs] = await Promise.all([
          listClientsForBilling(businessId).catch(() => [] as ApiClientLite[]),
          listProjects(businessId).catch(() => [] as ApiProject[]),
        ]);
        if (cancelled) return;
        setClients(cls);
        setProjects(prjs);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [open, businessId]);

  // project 선택 시 그 프로젝트의 primary client 자동 매핑 (사용자가 client 미선택 상태에 한해)
  useEffect(() => {
    if (!aiProjectId) return;
    if (aiClientId) return; // 이미 client 선택된 상태는 건드리지 않음
    const proj = projects.find(p => p.id === aiProjectId);
    const pc = proj?.projectClients?.[0];
    if (pc?.client_id) setAiClientId(pc.client_id);
  }, [aiProjectId, projects, aiClientId]);

  // 고객·프로젝트 연결은 선택 — 있으면 회사명·담당자·금액·주소 자동 채움.
  // 비워두면 LLM 이 placeholder 그대로 두므로 사용자가 나중에 채울 수 있음.
  const clientOptions: PlanQSelectOption[] = useMemo(() => clients.map(c => ({
    value: c.id, label: c.display_name || c.company_name || `Client ${c.id}`,
  })), [clients]);
  const projectOptions: PlanQSelectOption[] = useMemo(() => projects.map(p => ({
    value: p.id, label: p.name,
  })), [projects]);

  useEscapeStack(open, onClose);
  useBodyScrollLock(open);

  if (!open) return null;

  const startAi = async () => {
    if (busy || !aiTitle.trim()) return;
    setBusy(true); setAiError(null);
    try {
      const tpl = templates.find(x => x.kind === aiKind && x.is_system) || null;
      const ai = await aiGenerateDoc({
        business_id: businessId, kind: aiKind, title: aiTitle.trim(),
        user_input: aiUserInput.trim(),
        client_id: aiClientId,
        project_id: aiProjectId,
        template_id: tpl?.id || null,
      });
      setAiUsage(ai.usage);
      // AI 결과를 body_json 으로 변환 — 단순화: HTML 만 doc 생성 시 body_html 로 우회
      const doc = await createDocument({
        business_id: businessId, template_id: tpl?.id || null, kind: aiKind, title: aiTitle.trim(),
        client_id: aiClientId,
        project_id: aiProjectId,
        body_json: { type: 'doc', content: [] },  // 빈 JSON, body_html 은 백엔드에서 별도 set
      });
      // body_html 별도 PUT (createDocument 가 body_html 을 클라이언트에서 받지 않으므로)
      const { updateDocument } = await import('../../services/docs');
      await updateDocument(doc.id, { body_html: ai.body_html, ai_generated: true } as Parameters<typeof updateDocument>[1]);
      onCreated({ ...doc, ai_generated: true } as DocSummary);
    } catch (e: unknown) {
      const err = e as Error & { usage?: { remaining: number; limit: number } };
      if (err.message === 'cue_limit_exceeded') {
        setAiUsage(err.usage || null);
        setAiError(t('newModal.aiLimitExceeded', '월 한도를 사용했습니다. 플랜 업그레이드 또는 다음달까지 대기.') as string);
      } else {
        setAiError(t('newModal.aiFailed', 'AI 생성 실패. 잠시 후 다시 시도하세요.') as string);
      }
    } finally {
      setBusy(false);
    }
  };

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
            <AIForm>
              <AIDesc>{t('newModal.aiDesc', 'Cue 가 고객·프로젝트 컨텍스트를 분석하여 초안을 만들어 드립니다.')}</AIDesc>
              <FieldRow>
                <FieldLabel>{t('newModal.aiKind', '문서 종류')}</FieldLabel>
                <KindGrid>
                  {(['proposal','quote','invoice','nda','contract','meeting_note','sop','custom'] as DocKind[]).map(k => (
                    <KindOpt key={k} type="button" $active={aiKind===k} onClick={() => setAiKind(k)}>
                      <span>{KIND_ICON[k]}</span> {KIND_LABELS_KO[k]}
                    </KindOpt>
                  ))}
                </KindGrid>
              </FieldRow>
              <FieldRow>
                <FieldLabel>{t('newModal.aiClient', '고객 연결 (선택)')}</FieldLabel>
                <PlanQSelect
                  size="sm"
                  options={clientOptions}
                  value={clientOptions.find(o => o.value === aiClientId) || null}
                  onChange={(opt) => setAiClientId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={
                    clientOptions.length === 0
                      ? (t('newModal.aiClientEmpty', '등록된 고객이 없습니다') as string)
                      : (t('newModal.aiClientPh', '고객 선택 — 회사명·담당자 자동 채움 (선택)') as string)
                  }
                  isClearable
                  isSearchable
                />
              </FieldRow>
              <FieldRow>
                <FieldLabel>{t('newModal.aiProject', '프로젝트 연결 (선택)')}</FieldLabel>
                <PlanQSelect
                  size="sm"
                  options={projectOptions}
                  value={projectOptions.find(o => o.value === aiProjectId) || null}
                  onChange={(opt) => setAiProjectId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={t('newModal.aiProjectPh', '프로젝트 선택 — 고객 자동 매핑 (선택)') as string}
                  isClearable
                  isSearchable
                />
              </FieldRow>
              <FieldRow>
                <FieldLabel>{t('newModal.aiTitle', '문서 제목')}</FieldLabel>
                <FieldInput type="text" value={aiTitle} onChange={e => setAiTitle(e.target.value)}
                  placeholder={t('newModal.aiTitlePh', '예: 워프로랩 브랜드 리뉴얼 제안서') as string} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>{t('newModal.aiInput', '추가 요구사항 (선택)')}</FieldLabel>
                <FieldTextarea value={aiUserInput} onChange={e => setAiUserInput(e.target.value)}
                  rows={4}
                  placeholder={t('newModal.aiInputPh', '핵심 요지·납기·예산·강조하고 싶은 점 등을 자유롭게 입력하면 반영됩니다.') as string} />
              </FieldRow>
              {aiError && <ErrorMsg>{aiError}</ErrorMsg>}
              {aiUsage && <UsageHint>{t('newModal.aiUsage', { remaining: aiUsage.remaining, limit: aiUsage.limit, defaultValue: '이번 달 남은 횟수: {{remaining}}/{{limit}}' })}</UsageHint>}
              <FormActions>
                <CancelBtn type="button" onClick={onClose}>{t('common.cancel', '취소')}</CancelBtn>
                <GenerateBtn type="button" onClick={startAi}
                  disabled={busy || !aiTitle.trim()}>
                  {busy ? t('newModal.aiGenerating', '생성 중...') : t('newModal.aiGenerate', 'AI 로 작성하기')}
                </GenerateBtn>
              </FormActions>
            </AIForm>
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
const AIForm = styled.div`display:flex;flex-direction:column;gap:14px;`;
const AIDesc = styled.div`font-size:12px;color:#64748B;line-height:1.5;`;
const FieldRow = styled.div`display:flex;flex-direction:column;gap:6px;`;
const FieldLabel = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const FieldInput = styled.input`
  width:100%;padding:8px 10px;font-size:13px;color:#0F172A;
  border:1px solid #E2E8F0;border-radius:8px;background:#FFF;
  &:focus{outline:none;border-color:#14B8A6;}
  &::placeholder{color:#CBD5E1;}
`;
const FieldTextarea = styled.textarea`
  width:100%;padding:8px 10px;font-size:13px;color:#0F172A;line-height:1.5;
  border:1px solid #E2E8F0;border-radius:8px;background:#FFF;font-family:inherit;resize:vertical;
  &:focus{outline:none;border-color:#14B8A6;}
  &::placeholder{color:#CBD5E1;}
`;
const KindGrid = styled.div`display:grid;grid-template-columns:repeat(4,1fr);gap:6px;@media(max-width:520px){grid-template-columns:repeat(2,1fr);}`;
const KindOpt = styled.button<{ $active: boolean }>`
  display:flex;align-items:center;gap:5px;padding:7px 10px;font-size:12px;font-weight:600;
  border:1px solid ${p=>p.$active ? '#14B8A6' : '#E2E8F0'};
  background:${p=>p.$active ? '#F0FDFA' : '#FFF'};
  color:${p=>p.$active ? '#0F766E' : '#334155'};
  border-radius:8px;cursor:pointer;
  &:hover{border-color:#14B8A6;}
`;
const ErrorMsg = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;`;
const UsageHint = styled.div`font-size:11px;color:#94A3B8;text-align:right;`;
const FormActions = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:4px;`;
const CancelBtn = styled.button`
  padding:8px 14px;font-size:13px;font-weight:600;color:#334155;
  background:#FFF;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;
  &:hover{border-color:#CBD5E1;}
`;
const GenerateBtn = styled.button`
  padding:8px 16px;font-size:13px;font-weight:700;color:#FFF;
  background:#14B8A6;border:none;border-radius:8px;cursor:pointer;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#CBD5E1;cursor:not-allowed;}
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
