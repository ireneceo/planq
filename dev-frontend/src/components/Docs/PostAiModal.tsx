// AI 로 문서 본문 자동 생성 모달
// 사용자 입력 (kind/title/요구사항/고객/프로젝트) → /api/docs/ai-generate → body_html 반환 → onGenerate 콜백
// 컨텍스트 우선순위:
//   1. props.projectId (page-level 컨텍스트, 예: ProjectPostsTab) → 모달에서 selector 숨김, 백엔드가 primary client 자동 매핑
//   2. workspace 스코프 (PostsPage) → 모달에서 client/project selector 표시 (필수 — KIND_NEEDS_CLIENT)
import React, { useState, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { aiGenerateDoc, KIND_LABELS_KO, type DocKind } from '../../services/docs';
import { listClientsForBilling, type ApiClientLite } from '../../services/invoices';
import { listProjects, type ApiProject } from '../../services/qtalk';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  // 페이지에서 이미 알고 있는 컨텍스트. 주어지면 모달의 selector 숨기고 그대로 전송.
  projectId?: number | null;
  clientId?: number | null;
  onGenerate: (result: { title: string; bodyHtml: string }) => void;
}

const KIND_OPTIONS: PlanQSelectOption[] = [
  { value: 'proposal', label: KIND_LABELS_KO.proposal },
  { value: 'quote', label: KIND_LABELS_KO.quote },
  { value: 'invoice', label: KIND_LABELS_KO.invoice },
  { value: 'contract', label: KIND_LABELS_KO.contract },
  { value: 'sow', label: KIND_LABELS_KO.sow },
  { value: 'nda', label: KIND_LABELS_KO.nda },
  { value: 'meeting_note', label: KIND_LABELS_KO.meeting_note },
  { value: 'custom', label: KIND_LABELS_KO.custom },
];

const PostAiModal: React.FC<Props> = ({ open, onClose, businessId, projectId: pageProjectId, clientId: pageClientId, onGenerate }) => {
  const { t } = useTranslation('qdocs');
  const [kind, setKind] = useState<DocKind>('proposal');
  const [title, setTitle] = useState('');
  const [userInput, setUserInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ total: number; limit: number } | null>(null);

  // 페이지에서 컨텍스트가 주어지지 않은 워크스페이스 스코프에서만 selector 표시.
  const showSelectors = !pageProjectId;
  const [pickedClientId, setPickedClientId] = useState<number | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<number | null>(null);
  const [clients, setClients] = useState<ApiClientLite[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);

  useEffect(() => {
    if (!open) return;
    if (!showSelectors) return;
    let cancelled = false;
    (async () => {
      const [cls, prjs] = await Promise.all([
        listClientsForBilling(businessId).catch(() => [] as ApiClientLite[]),
        listProjects(businessId).catch(() => [] as ApiProject[]),
      ]);
      if (cancelled) return;
      setClients(cls); setProjects(prjs);
    })();
    return () => { cancelled = true; };
  }, [open, businessId, showSelectors]);

  // project 선택 → 그 프로젝트의 primary client 자동 매핑 (사용자가 client 미선택 상태에 한해)
  useEffect(() => {
    if (!pickedProjectId || pickedClientId) return;
    const proj = projects.find(p => p.id === pickedProjectId);
    const pc = proj?.projectClients?.[0];
    if (pc?.client_id) setPickedClientId(pc.client_id);
  }, [pickedProjectId, projects, pickedClientId]);

  const clientOptions: PlanQSelectOption[] = useMemo(() => clients.map(c => ({
    value: c.id, label: c.display_name || c.company_name || `Client ${c.id}`,
  })), [clients]);
  const projectOptions: PlanQSelectOption[] = useMemo(() => projects.map(p => ({
    value: p.id, label: p.name,
  })), [projects]);

  useBodyScrollLock(open);
  useEscapeStack(open && !busy, onClose);

  if (!open) return null;

  // 백엔드로 보낼 client/project — 페이지 컨텍스트 우선, 없으면 사용자가 모달에서 고른 값.
  const sendClientId = pageClientId ?? pickedClientId;
  const sendProjectId = pageProjectId ?? pickedProjectId;

  const submit = async () => {
    setError(null);
    if (!title.trim()) { setError(t('ai.titleRequired', '제목을 입력하세요') as string); return; }
    setBusy(true);
    try {
      const r = await aiGenerateDoc({
        business_id: businessId, kind, title: title.trim(), user_input: userInput.trim(),
        client_id: sendClientId,
        project_id: sendProjectId,
      });
      if (r.usage) setUsage({ total: r.usage.total, limit: r.usage.limit });
      onGenerate({ title: title.trim(), bodyHtml: r.body_html });
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('cue_limit_exceeded') || msg.includes('limit_exceeded')) {
        setError(t('ai.limitExceeded', '이번 달 AI 사용량 한도를 모두 사용했습니다. 플랜을 업그레이드하거나 다음 달까지 기다려 주세요.') as string);
      } else if (msg.includes('llm_unavailable')) {
        setError(t('ai.unavailable', 'AI 서비스가 일시적으로 사용 불가합니다. 잠시 후 다시 시도해 주세요.') as string);
      } else {
        setError(msg || (t('ai.failed', 'AI 생성에 실패했습니다.') as string));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Backdrop onClick={() => !busy && onClose()}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('ai.title', 'AI 로 작성') as string}>
        <Header>
          <Title>
            <Sparkle>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            </Sparkle>
            {t('ai.title', 'AI 로 작성')}
          </Title>
          <CloseBtn type="button" onClick={onClose} disabled={busy} aria-label={t('common.close', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>

        <Body>
          <Field>
            <Label>{t('ai.kind', '문서 종류')}</Label>
            <PlanQSelect
              size="sm"
              options={KIND_OPTIONS}
              value={KIND_OPTIONS.find(o => o.value === kind) || null}
              onChange={(opt) => setKind(((opt as PlanQSelectOption)?.value as DocKind) || 'proposal')}
              isSearchable={false}
              isDisabled={busy}
            />
          </Field>
          <Field>
            <Label>{t('ai.docTitle', '제목')} *</Label>
            <Input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t('ai.titlePh', '예: 클라이언트 온보딩 자동화 제안서') as string}
              disabled={busy}
              autoFocus
            />
          </Field>
          {showSelectors && (
            <>
              <Field>
                <Label>{t('ai.client', '고객 연결 (선택)')}</Label>
                <PlanQSelect
                  size="sm"
                  options={clientOptions}
                  value={clientOptions.find(o => o.value === pickedClientId) || null}
                  onChange={(opt) => setPickedClientId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={
                    clientOptions.length === 0
                      ? (t('ai.clientEmpty', '등록된 고객 없음') as string)
                      : (t('ai.clientPh', '고객 선택 — 회사명·담당자 자동 채움 (선택)') as string)
                  }
                  isClearable
                  isSearchable
                  isDisabled={busy}
                />
              </Field>
              <Field>
                <Label>{t('ai.project', '프로젝트 연결 (선택)')}</Label>
                <PlanQSelect
                  size="sm"
                  options={projectOptions}
                  value={projectOptions.find(o => o.value === pickedProjectId) || null}
                  onChange={(opt) => setPickedProjectId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={t('ai.projectPh', '프로젝트 선택 — 고객 자동 매핑 (선택)') as string}
                  isClearable
                  isSearchable
                  isDisabled={busy}
                />
              </Field>
            </>
          )}
          {(pageProjectId || pageClientId) && (
            <ContextBadge>
              {t('ai.contextLinked', '현재 페이지 컨텍스트로 연결되어 회사명·담당자·금액이 자동 채워집니다.')}
            </ContextBadge>
          )}
          <Field>
            <Label>{t('ai.input', '요구사항 / 컨텍스트 (선택)')}</Label>
            <Textarea
              rows={5} value={userInput} onChange={e => setUserInput(e.target.value)}
              placeholder={t('ai.inputPh', '특별히 강조하고 싶은 점, 고객 상황, 포함해야 할 항목 등을 자유롭게 작성하세요. (비워도 표준 양식으로 작성됩니다)') as string}
              disabled={busy}
            />
          </Field>
          <Hint>{t('ai.hint', '생성된 본문은 자동 저장되지 않습니다. 검토·수정 후 저장 버튼을 눌러주세요.')}</Hint>
          {usage && (
            <UsageRow>
              {t('ai.usage', '이번 달 사용량')}: <strong>{usage.total} / {usage.limit}</strong>
            </UsageRow>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={busy}>{t('cancel', '취소')}</SecondaryBtn>
          <PrimaryBtn type="button" onClick={submit} disabled={busy || !title.trim()}>
            {busy ? (
              <><Spinner />{t('ai.generating', '생성 중…')}</>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
                {t('ai.generate', 'AI 로 작성')}
              </>
            )}
          </PrimaryBtn>
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default PostAiModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 520px; width: 100%;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
`;
const Title = styled.h2`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
`;
const Sparkle = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  color: #F43F5E;
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Body = styled.div`padding: 16px 22px 8px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
const Label = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const Input = styled.input`
  width: 100%; padding: 9px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; }
`;
const Textarea = styled.textarea`
  width: 100%; padding: 10px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  resize: vertical; font-family: inherit; line-height: 1.55;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; }
`;
const Hint = styled.p`font-size:11px;color:#94A3B8;margin:6px 0 0;line-height:1.5;`;
const ContextBadge = styled.div`
  font-size: 11px; color: #0F766E;
  background: #F0FDFA; border: 1px solid #CCFBF1;
  padding: 8px 10px; border-radius: 6px; margin: 8px 0;
`;
const UsageRow = styled.div`
  font-size: 12px; color: #64748B; margin-top: 8px;
  background: #F8FAFC; padding: 8px 10px; border-radius: 6px;
`;
const ErrorBox = styled.div`
  font-size: 12px; color: #DC2626; background: #FEF2F2;
  padding: 8px 10px; border-radius: 6px; margin-top: 8px;
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 12px 22px 18px;
`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center;
  padding: 9px 18px; font-size: 13px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  border: none; border-radius: 8px; cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  &:hover:not(:disabled) { transform: translateY(-1px); }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Spinner = styled.span`
  width: 12px; height: 12px; margin-right: 6px;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
