// SlotFormModal — Phase F 슬롯 시스템 (사이클 I2).
// DocumentTemplate.schema_json 의 슬롯 정의 기반 동적 폼.
// 백엔드의 /api/docs/templates/:id/context 가 default_values 자동 채움 → 사용자가 수정/추가만.
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import i18n from '../../i18n';

export type SlotType = 'text' | 'textarea' | 'number' | 'date' | 'email';

export interface SlotDef {
  key: string;
  label?: string;
  /** 사이클 I3 — 영문 라벨. viewer language 'en' 시 label 대신 사용 */
  label_en?: string;
  type?: SlotType;
  required?: boolean;
  default_from?: string;
  placeholder?: string;
  placeholder_en?: string;
}

// 사이클 I3 — viewer 언어에 따라 슬롯 라벨/플레이스홀더 결정
function pickSlotLabel(slot: SlotDef): string {
  const lang = i18n.language || 'ko';
  if (lang.startsWith('en') && slot.label_en) return slot.label_en;
  return slot.label || slot.key;
}
function pickSlotPlaceholder(slot: SlotDef): string {
  const lang = i18n.language || 'ko';
  if (lang.startsWith('en') && slot.placeholder_en) return slot.placeholder_en;
  return slot.placeholder || '';
}

export interface TemplateContext {
  template_id: number;
  kind: string;
  name: string;
  schema: SlotDef[];
  body_template: string | null;
  default_values: Record<string, string | number>;
  preview: string;
}

interface Props {
  templateId: number;
  businessId: number;
  projectId?: number | null;
  clientId?: number | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (rendered: { html: string; title: string; values: Record<string, string | number> }) => void;
}

const SlotFormModal: React.FC<Props> = ({ templateId, businessId, projectId, clientId, open, onClose, onConfirm }) => {
  const { t } = useTranslation('qdocs');
  const [ctx, setCtx] = useState<TemplateContext | null>(null);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !templateId || !businessId) return;
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ business_id: String(businessId) });
    if (projectId) sp.set('project_id', String(projectId));
    if (clientId) sp.set('client_id', String(clientId));
    apiFetch(`/api/docs/templates/${templateId}/context?${sp.toString()}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) throw new Error(j.message || 'load_failed');
        setCtx(j.data);
        setValues(j.data.default_values || {});
      })
      .catch(e => setError(e instanceof Error ? e.message : 'error'))
      .finally(() => setLoading(false));
  }, [open, templateId, businessId, projectId, clientId]);

  // 클라이언트 사이드 치환 — 사용자 입력값으로 body_template 미리보기 갱신
  const preview = useMemo(() => {
    if (!ctx?.body_template) return '';
    return ctx.body_template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const v = values[key];
      if (v != null && v !== '') return String(v);
      return `[{{${key}}}]`;
    });
  }, [ctx, values]);

  // 필수 슬롯 누락 검사
  const missing = useMemo(() => {
    if (!ctx) return [];
    return ctx.schema.filter(s => s.required && (values[s.key] == null || values[s.key] === ''));
  }, [ctx, values]);

  const handleConfirm = () => {
    if (!ctx) return;
    if (missing.length > 0) {
      setError(t('slot.errMissing', '필수 슬롯을 채워주세요: {{keys}}', { keys: missing.map(m => pickSlotLabel(m)).join(', ') }) as string);
      return;
    }
    onConfirm({ html: preview, title: ctx.name, values });
  };

  if (!open) return null;
  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <Header>
          <Title>{ctx?.name || t('slot.loading', '로드 중…')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label={t('slot.close', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>
        <Body>
          {loading && <Loading>{t('slot.loading', '로드 중…')}</Loading>}
          {error && <ErrorBox>{error}</ErrorBox>}
          {ctx && !loading && (
            <Layout>
              <FormCol>
                <SectionTitle>{t('slot.fillTitle', '슬롯 채우기')}</SectionTitle>
                <Hint>{t('slot.fillHint', '회사·프로젝트·고객 정보는 자동 채워졌습니다. 필요한 것만 수정하세요.')}</Hint>
                {ctx.schema.map(slot => {
                  const lbl = pickSlotLabel(slot);
                  const ph = pickSlotPlaceholder(slot);
                  return (
                    <Field key={slot.key}>
                      <Label>
                        {lbl}
                        {slot.required && <Req>*</Req>}
                      </Label>
                      {slot.type === 'textarea' ? (
                        <TextArea
                          value={String(values[slot.key] ?? '')}
                          onChange={e => setValues(v => ({ ...v, [slot.key]: e.target.value }))}
                          placeholder={ph}
                          rows={3}
                        />
                      ) : slot.type === 'date' ? (
                        <Input type="date"
                          value={String(values[slot.key] ?? '').slice(0, 10)}
                          onChange={e => setValues(v => ({ ...v, [slot.key]: e.target.value }))}
                        />
                      ) : slot.type === 'number' ? (
                        <Input type="number"
                          value={String(values[slot.key] ?? '')}
                          onChange={e => setValues(v => ({ ...v, [slot.key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                          placeholder={ph}
                        />
                      ) : (
                        <Input type={slot.type === 'email' ? 'email' : 'text'}
                          value={String(values[slot.key] ?? '')}
                          onChange={e => setValues(v => ({ ...v, [slot.key]: e.target.value }))}
                          placeholder={ph}
                        />
                      )}
                    </Field>
                  );
                })}
              </FormCol>
              <PreviewCol>
                <SectionTitle>{t('slot.preview', '미리보기')}</SectionTitle>
                <Preview>{preview}</Preview>
              </PreviewCol>
            </Layout>
          )}
        </Body>
        <Footer>
          <SecondaryBtn type="button" onClick={onClose}>{t('slot.cancel', '취소')}</SecondaryBtn>
          <PrimaryBtn type="button" onClick={handleConfirm} disabled={!ctx || loading}>
            {t('slot.confirm', '문서로 시작')}
          </PrimaryBtn>
        </Footer>
      </Modal>
    </Backdrop>
  );
};

export default SlotFormModal;

// ─── styled ───
const Backdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.40); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px;`;
const Modal = styled.div`width: 100%; max-width: 880px; background: #FFFFFF; border-radius: 14px; box-shadow: 0 24px 48px rgba(15,23,42,0.18); display: flex; flex-direction: column; max-height: 90vh; overflow: hidden;`;
const Header = styled.div`padding: 18px 22px; border-bottom: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;`;
const Title = styled.h2`font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;`;
const CloseBtn = styled.button`width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 8px; color: #64748B; cursor: pointer; &:hover { background: #F1F5F9; color: #0F172A; }`;
const Body = styled.div`padding: 20px 22px; overflow-y: auto; flex: 1;`;
const Layout = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 24px; @media (max-width: 768px) { grid-template-columns: 1fr; }`;
const FormCol = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const PreviewCol = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const SectionTitle = styled.h3`font-size: 13px; font-weight: 700; color: #0F172A; margin: 0;`;
const Hint = styled.p`font-size: 12px; color: #94A3B8; margin: 0 0 8px; line-height: 1.5;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Label = styled.label`font-size: 12px; font-weight: 600; color: #475569;`;
const Req = styled.span`color: #F43F5E; margin-left: 2px;`;
const Input = styled.input`height: 34px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; color: #0F172A; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const TextArea = styled.textarea`padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const Preview = styled.pre`padding: 14px 16px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 12px; line-height: 1.6; color: #334155; white-space: pre-wrap; word-break: break-word; font-family: inherit; max-height: 400px; overflow-y: auto;`;
const Footer = styled.div`padding: 14px 22px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;`;
const PrimaryBtn = styled.button`height: 36px; padding: 0 18px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:disabled { background: #CBD5E1; cursor: not-allowed; } &:hover:not(:disabled) { background: #0D9488; }`;
const SecondaryBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; border-color: #CBD5E1; }`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const ErrorBox = styled.div`padding: 8px 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; font-size: 12px; color: #B91C1C; margin-bottom: 12px;`;
