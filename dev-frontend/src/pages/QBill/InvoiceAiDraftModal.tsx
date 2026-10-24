// 청구서 발행 창 [AI 작성] — 재료(고객 단서·고객·문서·파일·붙여넣은 글)를 받아 서버가 뽑은 값을 보여 주고,
//   [발행 창에 채우기] 를 누르면 부모(NewInvoiceModal)가 폼에 넣는다. 여기서는 저장·발행하지 않는다.
// 설계 docs/INVOICE_AI_DRAFT_DESIGN.md §7 (Fable 2026-10-24). 껍데기는 StandardModal · 첨부는 AttachmentField(새로 그리지 않는다).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import ModalActionButton from '../../components/Common/ModalActionButton';
import AttachmentField from '../../components/Common/AttachmentField';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { uploadMyFile } from '../../services/files';
import { aiDraftInvoice, type InvoiceAiDraft, type Currency } from '../../services/invoices';

const MAX_IDS = 3;

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  clientOptions: PlanQSelectOption[];
  /** 발행 창에서 이미 고른 고객 — AI 가 바꾸지 않는다(§7-8 ②) */
  fixedClientId: number | null;
  currency: Currency;
  /** 발행 창 지금 세율 — 서버가 «품목 합 + 세금 = 합계» 모양을 가릴 때 쓴다 */
  vatRate: number;
  /** 고른 후보 고객 id(후보에서 사람이 고른 것) 와 함께 넘긴다 */
  onApply: (draft: InvoiceAiDraft, pickedClientId: number | null) => void;
}

export default function InvoiceAiDraftModal({ open, onClose, businessId, clientOptions, fixedClientId, currency, vatRate, onApply }: Props) {
  const { t } = useTranslation('qbill');
  const [hint, setHint] = useState('');
  const [clientId, setClientId] = useState<number | null>(fixedClientId);
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<number[]>([]);
  const [postIds, setPostIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvoiceAiDraft | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  // 열 때마다 발행 창의 지금 고객으로 맞춘다(재료는 남겨 둔다 — 다시 열어 고쳐 쓰게)
  useEffect(() => { if (open) { setClientId(fixedClientId); setError(null); } }, [open, fixedClientId]);

  const hasMaterial = !!(text.trim() || hint.trim() || clientId || uploads.length || fileIds.length || postIds.length);

  const run = async () => {
    setError(null);
    if (uploads.length + fileIds.length > MAX_IDS || postIds.length > MAX_IDS) {
      setError(t('newInvoice.ai.err.tooMany', { max: MAX_IDS }) as string);
      return;
    }
    setBusy(true);
    try {
      const uploaded: number[] = [];
      for (const f of uploads) {
        const r = await uploadMyFile(businessId, f);
        const n = r.success && r.file ? Number(String(r.file.id).replace('direct-', '')) : NaN;
        if (Number.isFinite(n)) uploaded.push(n);
      }
      if (uploaded.length) { setUploads([]); setFileIds((cur) => [...cur, ...uploaded]); }
      const r = await aiDraftInvoice(businessId, {
        text: text.trim() || undefined, client_hint: hint.trim() || undefined, client_id: clientId,
        post_ids: postIds, file_ids: [...fileIds, ...uploaded], currency, vat_rate: vatRate,
      });
      if (r.data) { setResult(r.data); setPicked(null); }
      // 429 = 사용자당 분·일 한도(costGuard) — 몸통 문구는 서버 한국어라 키로 쓰지 않는다
      if (!r.ok) setError(r.status === 429 ? t('newInvoice.ai.err.rate') as string
        : t(`newInvoice.ai.err.${r.message || 'generic'}`, { defaultValue: t('newInvoice.ai.err.generic') as string }) as string);
    } catch {
      setError(t('newInvoice.ai.err.generic') as string);
    } finally { setBusy(false); }
  };

  const d = result;
  const canApply = !!d && (d.items.length > 0 || !!d.title || !!d.client.match_id || !!picked || !!d.client.guess);
  const warnText = (w: InvoiceAiDraft['warnings'][number]) =>
    t(`newInvoice.ai.warn.${w.code}`, { count: w.count, title: w.title, name: w.name, defaultValue: w.code }) as string;
  const skipText = (s: InvoiceAiDraft['skipped'][number]) =>
    t(`newInvoice.ai.skip.${s.reason}`, { kind: t(`newInvoice.ai.kind.${s.kind}`), name: s.name || '', defaultValue: s.reason }) as string;

  return (
    <StandardModal open={open} onClose={onClose} title={t('newInvoice.ai.title') as string} size="lg"
      footer={<>
        <ModalActionButton variant="secondary" onClick={onClose}>{t('newInvoice.actions.cancel')}</ModalActionButton>
        <ModalActionButton variant="ai" onClick={run} disabled={busy || !hasMaterial} data-testid="invoice-ai-run">
          {busy ? t('newInvoice.ai.running') : (d ? t('newInvoice.ai.rerun') : t('newInvoice.ai.run'))}
        </ModalActionButton>
        {d && (
          <ModalActionButton variant="primary" onClick={() => onApply(d, picked)} disabled={busy || !canApply} data-testid="invoice-ai-apply">
            {t('newInvoice.ai.apply')}
          </ModalActionButton>
        )}
      </>}>
      <Intro>{t('newInvoice.ai.intro')}</Intro>
      <Grid>
        <Field>
          <Label htmlFor="invoice-ai-hint">{t('newInvoice.ai.hint')}</Label>
          {/* draft-exempt: AI 재료 한 줄(고객 이름 단서) — 발행 창이 열린 동안 남고, 결과는 발행 창 폼으로 옮겨진다 */}
          <Input id="invoice-ai-hint" data-testid="invoice-ai-hint" value={hint} maxLength={200} disabled={busy || !!clientId}
            onChange={(e) => setHint(e.target.value)} placeholder={t('newInvoice.ai.hintPh') as string} />
        </Field>
        <Field>
          <Label>{t('newInvoice.ai.client')}</Label>
          <PlanQSelect options={clientOptions} value={clientOptions.find((o) => o.value === clientId) || null}
            onChange={(opt) => setClientId(opt ? Number((opt as PlanQSelectOption).value) : null)}
            placeholder={t('newInvoice.ai.clientPh') as string} isClearable isSearchable />
        </Field>
      </Grid>
      <Hint>{t('newInvoice.ai.clientHelp')}</Hint>
      <Field>
        <Label htmlFor="invoice-ai-text">{t('newInvoice.ai.text')}</Label>
        {/* draft-exempt: AI 재료로 붙여넣은 사본(원문은 메일·문서에 있다) — 발행 창이 열린 동안 남고, 결과는 발행 창 폼으로 옮겨진다 */}
        <Textarea id="invoice-ai-text" data-testid="invoice-ai-text" rows={4} value={text} maxLength={8000} disabled={busy}
          onChange={(e) => setText(e.target.value)} placeholder={t('newInvoice.ai.textPh') as string} />
      </Field>
      <Field>
        <Label>{t('newInvoice.ai.attach', { max: MAX_IDS })}</Label>
        <AttachmentField businessId={businessId} uploads={uploads} onUploadsChange={setUploads}
          existingFileIds={fileIds} onExistingFileIdsChange={setFileIds}
          includePosts existingPostIds={postIds} onExistingPostIdsChange={setPostIds} disabled={busy} />
        <Hint>{t('newInvoice.ai.attachHelp')}</Hint>
      </Field>

      {error && <ErrorLine role="alert">{error}</ErrorLine>}

      {d && (
        <Result data-testid="invoice-ai-result">
          <ResultTitle>{t('newInvoice.ai.resultTitle')}</ResultTitle>
          <Row>
            <Key>{t('newInvoice.ai.client')}</Key>
            <Val>
              {d.client.match_id ? `${d.client.match_name} · ${t(`newInvoice.ai.by.${d.client.by}`)}`
                : d.client.candidates.length ? (
                  <Candidates>
                    <span>{t('newInvoice.ai.pickCandidate')}</span>
                    {d.client.candidates.map((c) => (
                      <Cand key={c.id} type="button" $on={picked === c.id} onClick={() => setPicked(picked === c.id ? null : c.id)}
                        data-testid="invoice-ai-candidate">{c.name}</Cand>
                    ))}
                  </Candidates>
                ) : d.client.guess ? t('newInvoice.ai.external', { name: d.client.guess.company || d.client.guess.name || d.client.guess.email || '' })
                  : <Muted>{t('newInvoice.ai.noClient')}</Muted>}
            </Val>
          </Row>
          {d.title && <Row><Key>{t('newInvoice.compose.titleField')}</Key><Val>{d.title}</Val></Row>}
          {d.items.length > 0 && (
            <Row>
              <Key>{t('newInvoice.items.title')}</Key>
              <Val>
                <ItemList>
                  {d.items.map((it, i) => (
                    <li key={i}>
                      {it.description} · {it.quantity} × {it.unit_price === null ? <Warn>{t('newInvoice.ai.noPrice')}</Warn> : it.unit_price.toLocaleString()}
                      {it.vat_basis && <Muted> · {t(`newInvoice.ai.basis.${it.vat_basis}`)}</Muted>}
                    </li>
                  ))}
                </ItemList>
              </Val>
            </Row>
          )}
          {d.tax_mode && <Row><Key>{t('tax.mode')}</Key><Val>{t(`newInvoice.ai.taxMode.${d.tax_mode}`)}</Val></Row>}
          {d.terms.map((tm) => (
            <Notice key={tm.post_id} $tone="warn">
              {t(`newInvoice.ai.terms.${tm.state === 'invoiced' || tm.state === 'removed' ? tm.state : 'pending'}`, { title: tm.title, number: tm.invoice_number || '' })}
            </Notice>
          ))}
          {d.warnings.map((w, i) => <Notice key={`w${i}`} $tone="warn">{warnText(w)}</Notice>)}
          {d.tax_inclusive_hint && <Notice $tone="warn">{t('newInvoice.ai.warn.tax_inclusive')}</Notice>}
          {d.tax_exempt_hint && <Notice $tone="warn">{t('newInvoice.ai.warn.tax_exempt')}</Notice>}
          {d.skipped.map((s, i) => <Notice key={`s${i}`} $tone="muted">{skipText(s)}</Notice>)}
          <Hint>{t('newInvoice.ai.applyHelp')}</Hint>
        </Result>
      )}
    </StandardModal>
  );
}

const Intro = styled.p`margin: 0; font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const Grid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #334155;`;
const Input = styled.input`
  height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; color: #94A3B8; }
`;
const Textarea = styled.textarea`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; color: #0F172A; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const ErrorLine = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 8px 10px;`;
const Result = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
  border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC;
`;
const ResultTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Row = styled.div`
  display: grid; grid-template-columns: 90px 1fr; gap: 8px; font-size: 0.8125rem;
  @media (max-width: 640px) { grid-template-columns: 1fr; gap: 2px; }
`;
const Key = styled.div`color: #64748B;`;
const Val = styled.div`color: #0F172A; min-width: 0; word-break: break-word;`;
const ItemList = styled.ul`margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 2px;`;
const Muted = styled.span`color: #94A3B8;`;
const Warn = styled.span`color: #B45309; font-weight: 600;`;
const Candidates = styled.div`display: flex; flex-wrap: wrap; gap: 6px; align-items: center;`;
const Cand = styled.button<{ $on: boolean }>`
  min-height: 32px; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')}; background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')}; color: #0F172A;
`;
const Notice = styled.div<{ $tone: 'warn' | 'muted' }>`
  font-size: 0.75rem; line-height: 1.5; border-radius: 8px; padding: 6px 10px;
  background: ${(p) => (p.$tone === 'warn' ? '#FFFBEB' : '#F1F5F9')}; color: ${(p) => (p.$tone === 'warn' ? '#92400E' : '#475569')};
`;
