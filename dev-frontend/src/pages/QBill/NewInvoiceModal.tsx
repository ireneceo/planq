// 새 청구서 발행 모달
// - 발신 자동 (Business)
// - 수신 선택 (Client) + 사업자정보 자동 채움 + 누락 시 인라인 보완
// - 출처 문서 선택 (계약/견적/SOW/제안) — 본문·분할 일정 자동 흡수
// - 항목 / 분할 / 세금계산서 / 입금 안내
// - 발송 옵션 통합: 채팅방 (자동 표시) · 이메일 · 공개 링크 — 어디로 가는지 명시
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useAuth } from '../../contexts/AuthContext';
import {
  formatMoney, missingClientBizFields,
  listClientsForBilling, listSourceCandidates, findConversationForClient,
  getBusinessInfo, createInvoice, sendInvoice,
  type Currency, type ApiClientLite, type ApiSourcePost, type ApiBusinessInfo, type ApiConvFound,
} from '../../services/invoices';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 후속 액션 카드에서 진입 시 — 분할/단일 자동 분기 */
  prefillSplit?: boolean;
  /** 후속 액션 카드에서 진입 시 — 출처 문서 자동 연결 (post id) */
  prefillPostId?: number | null;
}

const KIND_LABEL: Record<string, string> = {
  contract: '계약서', quote: '견적서', sow: 'SOW', proposal: '제안서',
};

interface Item { id: number; description: string; quantity: number; unit_price: number; }
interface Round { id: number; label: string; milestone: string; rate: number; due_date: string; }

const todayStr = '2026-04-27';
const addDays = (s: string, d: number) => {
  const dt = new Date(s); dt.setDate(dt.getDate() + d); return dt.toISOString().split('T')[0];
};

const CURRENCY_OPTIONS: PlanQSelectOption[] = [
  { value: 'KRW', label: 'KRW (₩)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'JPY', label: 'JPY (¥)' },
  { value: 'CNY', label: 'CNY (¥)' },
];
const VAT_OPTIONS: PlanQSelectOption[] = [
  { value: '0', label: '0%' },
  { value: '0.1', label: '10%' },
];

export default function NewInvoiceModal({ open, onClose, prefillSplit, prefillPostId }: Props) {
  const { t } = useTranslation('qbill');
  const { user } = useAuth();
  const navigate = useNavigate();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  // ─── 발신자 / 클라이언트 / 출처 — 백엔드 데이터 ───
  const [businessInfo, setBusinessInfo] = useState<ApiBusinessInfo | null>(null);
  const [clients, setClients] = useState<ApiClientLite[]>([]);
  const [sourceCandidates, setSourceCandidates] = useState<ApiSourcePost[]>([]);
  const [convFound, setConvFound] = useState<ApiConvFound | null>(null);

  // ─── 폼 state ───
  const [submitting, setSubmitting] = useState(false);

  // 발송 결과 (sendInvoice 응답 기반) — 채팅방 가기 / 닫기
  const [sentResult, setSentResult] = useState<{
    invoiceId: number;
    convId: number | null;
    convName: string | null;
    emailTo: string | null;
  } | null>(null);

  const [clientId, setClientId] = useState<number | null>(null);
  const [sourcePostId, setSourcePostId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [issuedAt, setIssuedAt] = useState(todayStr);
  const [dueDate, setDueDate] = useState(addDays(todayStr, 14));
  const [currency, setCurrency] = useState<Currency>('KRW');
  const [vatRate, setVatRate] = useState<number>(0.10);
  const [notes, setNotes] = useState('');

  const [items, setItems] = useState<Item[]>([
    { id: 1, description: '', quantity: 1, unit_price: 0 },
  ]);

  const [splitOn, setSplitOn] = useState(false);
  const [rounds, setRounds] = useState<Round[]>([
    { id: 1, label: '선금', milestone: '계약 체결', rate: 30, due_date: addDays(todayStr, 7) },
    { id: 2, label: '중도금', milestone: '중간 검수', rate: 40, due_date: addDays(todayStr, 21) },
    { id: 3, label: '잔금', milestone: '최종 검수', rate: 30, due_date: addDays(todayStr, 35) },
  ]);

  const [taxOn, setTaxOn] = useState(false);

  // 발송 옵션
  const [sendChat, setSendChat] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [includePdf, setIncludePdf] = useState(true);

  // 누락 인라인 보완
  const [overrideBiz, setOverrideBiz] = useState<{
    biz_name?: string; biz_tax_id?: string; biz_representative?: string; biz_address?: string;
  }>({});

  const [errors, setErrors] = useState<string[]>([]);

  // ─── 파생값 ───
  const client = useMemo(
    () => clientId ? clients.find(c => c.id === clientId) || null : null,
    [clientId, clients]
  );
  const missing = missingClientBizFields(client as any);
  const missingAfterOverride = missing.filter(k => !(overrideBiz as any)[k]);

  const sourcePost = useMemo(
    () => sourcePostId ? sourceCandidates.find(p => p.id === sourcePostId) || null : null,
    [sourcePostId, sourceCandidates]
  );
  const conversation = convFound?.conversation || null;

  const subtotal = items.reduce((s, it) => s + (it.quantity * it.unit_price), 0);
  const vat = Math.round(subtotal * vatRate);
  const total = subtotal + vat;

  const sumPercent = rounds.reduce((s, r) => s + r.rate, 0);
  const sumOk = sumPercent === 100;

  const canTax = (client?.is_business ?? false) && (
    !!client?.biz_tax_id || !!overrideBiz.biz_tax_id
  );

  // ─── 출처 선택 시 자동 흡수 (제목만) ───
  useEffect(() => {
    if (!sourcePost) return;
    if (sourcePost.title) setTitle(sourcePost.title);
  }, [sourcePost]);

  // ─── 모달 open 시 발신자/클라이언트 fetch + 워크스페이스 기본값 적용 ───
  useEffect(() => {
    if (!open || !businessId) return;
    Promise.all([
      getBusinessInfo(businessId).catch(() => null),
      listClientsForBilling(businessId).catch(() => []),
    ]).then(([info, list]) => {
      setBusinessInfo(info);
      setClients(list);
      if (info) {
        const days = info.default_due_days ?? 14;
        setDueDate(addDays(todayStr, days));
        setVatRate(Number(info.default_vat_rate ?? 0.1));
        if (info.default_currency) setCurrency(info.default_currency as Currency);
      }
    });
    // 후속 액션 카드에서 진입 시 분할 자동 활성
    if (prefillSplit) setSplitOn(true);
  }, [open, businessId, prefillSplit]);

  // ─── 출처 문서 자동 연결 — followup 카드에서 prefillPostId 전달 시 ───
  // 프로젝트 → client 자동 선택은 사용자가 직접 client 선택 후 sourceCandidates 가 로드되면
  // sourcePostId 가 자동 매칭되도록 한다 (chicken-egg 회피).
  useEffect(() => {
    if (!open || !prefillPostId || !businessId) return;
    let cancelled = false;
    (async () => {
      try {
        const { fetchPost } = await import('../../services/posts');
        const post = await fetchPost(prefillPostId);
        if (cancelled || !post) return;
        if (post.title) setTitle(post.title);
        // 클라이언트가 있는 프로젝트라면 projectMembers/projectClients 에서 첫 client 자동 선택
        if (post.project_id) {
          try {
            const { apiFetch } = await import('../../contexts/AuthContext');
            const r = await apiFetch(`/api/projects/${post.project_id}`);
            const j = await r.json();
            const projClients = j?.data?.projectClients || [];
            if (projClients.length > 0 && projClients[0].client_id) {
              setClientId(projClients[0].client_id);
            }
          } catch { /* noop */ }
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [open, prefillPostId, businessId]);

  // sourceCandidates 로드 후 prefillPostId 자동 매칭
  useEffect(() => {
    if (!prefillPostId || !sourceCandidates.length) return;
    if (sourceCandidates.find(p => p.id === prefillPostId)) {
      setSourcePostId(prefillPostId);
    }
  }, [prefillPostId, sourceCandidates]);

  // ─── client 변경 시 source candidates + 채팅방 검색 ───
  useEffect(() => {
    if (!businessId || !clientId) {
      setSourceCandidates([]); setConvFound(null); setSourcePostId(null);
      return;
    }
    listSourceCandidates(businessId, { client_id: clientId }).then(setSourceCandidates).catch(() => setSourceCandidates([]));
    findConversationForClient(businessId, clientId).then(setConvFound).catch(() => setConvFound(null));
  }, [businessId, clientId]);

  useEffect(() => {
    if (!open) {
      // 닫힐 때 폼 초기화 (워크스페이스 기본값은 모달 open 시 다시 prefill 됨)
      setClientId(null); setSourcePostId(null); setTitle(''); setNotes('');
      setIssuedAt(todayStr);
      setItems([{ id: 1, description: '', quantity: 1, unit_price: 0 }]);
      setSplitOn(false);
      setTaxOn(false);
      setOverrideBiz({});
      setErrors([]);
      setSendChat(true); setSendEmail(true); setIncludePdf(true);
      setSourceCandidates([]); setConvFound(null);
    }
  }, [open]);

  useEffect(() => {
    if (!canTax && taxOn) setTaxOn(false);
  }, [canTax, taxOn]);

  // 채팅방이 없으면 sendChat 자동 끔
  useEffect(() => {
    if (!conversation && sendChat) setSendChat(false);
  }, [conversation, sendChat]);

  const clientOptions: PlanQSelectOption[] = useMemo(() => clients.map(c => ({
    value: c.id,
    label: c.is_business
      ? `${c.display_name || c.company_name || ''}${c.biz_name ? ` (${c.biz_name})` : ''}`
      : `${c.display_name || c.company_name || '—'} (개인)`,
  })), [clients]);

  const sourceOptions: PlanQSelectOption[] = useMemo(() => sourceCandidates.map(p => ({
    value: p.id,
    label: `[${KIND_LABEL[p.category || ''] || p.category || '문서'}] ${p.title}`,
  })), [sourceCandidates]);

  // ─── 액션 ───
  const addItem = () => setItems(arr => [...arr, { id: Date.now(), description: '', quantity: 1, unit_price: 0 }]);
  const updateItem = (id: number, patch: Partial<Item>) =>
    setItems(arr => arr.map(it => it.id === id ? { ...it, ...patch } : it));
  const removeItem = (id: number) => setItems(arr => arr.length === 1 ? arr : arr.filter(it => it.id !== id));

  const addRound = () => {
    const last = rounds[rounds.length - 1];
    setRounds(arr => [...arr, {
      id: Date.now(), label: `${arr.length + 1}차`, milestone: '',
      rate: 0, due_date: last ? addDays(last.due_date, 14) : addDays(todayStr, 14),
    }]);
  };
  const updateRound = (id: number, patch: Partial<Round>) =>
    setRounds(arr => arr.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRound = (id: number) =>
    setRounds(arr => arr.length === 1 ? arr : arr.filter(r => r.id !== id));

  const applyPreset = (preset: number[]) => {
    setRounds(arr => {
      const base = arr.slice(0, preset.length);
      const padded = preset.length > base.length ? [
        ...base,
        ...Array(preset.length - base.length).fill(null).map((_, i) => ({
          id: Date.now() + i,
          label: `${base.length + i + 1}차`, milestone: '', rate: 0,
          due_date: addDays(todayStr, 14 * (base.length + i + 1)),
        })),
      ] : base;
      return padded.map((r, i) => ({ ...r, rate: preset[i] || 0 }));
    });
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!clientId) errs.push(t('newInvoice.validation.clientRequired') as string);
    if (!title.trim()) errs.push(t('newInvoice.validation.titleRequired') as string);
    if (items.length === 0 || items.every(it => !it.description.trim())) {
      errs.push(t('newInvoice.validation.itemsRequired') as string);
    }
    if (splitOn && !sumOk) errs.push(t('newInvoice.validation.splitSumWrong') as string);
    return errs;
  };

  const submit = async (asDraft: boolean) => {
    if (submitting) return;
    if (!businessId) { setErrors(['워크스페이스를 먼저 선택하세요']); return; }
    if (!asDraft) {
      const errs = validate();
      if (errs.length > 0) { setErrors(errs); return; }
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const created = await createInvoice(businessId, {
        title: title.trim() || '(제목 없음)',
        client_id: clientId,
        source_post_id: sourcePostId,
        currency,
        vat_rate: vatRate,
        due_date: dueDate || null,
        recipient_email: client?.tax_invoice_email || client?.billing_contact_email || client?.invite_email || null,
        recipient_business_name: overrideBiz.biz_name || client?.biz_name || null,
        recipient_business_number: overrideBiz.biz_tax_id || client?.biz_tax_id || null,
        notes: notes.trim() || null,
        installment_mode: splitOn ? 'split' : 'single',
        installments: splitOn ? rounds.map(r => ({
          label: r.label, percent: r.rate, due_date: r.due_date || null, milestone_ref: r.milestone || null,
        })) : undefined,
        items: items.filter(it => it.description.trim()).map(it => ({ description: it.description, quantity: it.quantity, unit_price: it.unit_price })),
      });
      if (!asDraft) {
        const sent = await sendInvoice(businessId, created.id, {
          send_chat: sendChat && !!conversation,
          send_email: sendEmail,
          message: notes.trim() || undefined,
        });
        // 발송 결과 — 채팅 conversation_id / email to 안전 추출
        const chatRes = sent?.deliver?.chat;
        const emailRes = sent?.deliver?.email;
        const convId = (chatRes && 'conversation_id' in chatRes) ? chatRes.conversation_id : null;
        const emailSent = (emailRes && 'sent' in emailRes) ? emailRes.sent : false;
        const emailToAddr = (emailRes && 'to' in emailRes) ? emailRes.to : null;
        if (convId || emailSent) {
          setSentResult({
            invoiceId: created.id,
            convId,
            convName: convId ? (conversation?.title || null) : null,
            emailTo: emailSent ? emailToAddr : null,
          });
          setSubmitting(false);
          return; // 결과 화면 유지
        }
      }
      onClose();
    } catch (err) {
      setErrors([(err as Error).message || '발행 실패']);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  // 발송 결과 화면 — 채팅방 가기 / 닫기
  if (sentResult) {
    return (
      <Backdrop onClick={onClose}>
        <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('newInvoice.sent.title', '발송 완료') as string} style={{ maxWidth: 460 }}>
          <Head>
            <Title>{t('newInvoice.sent.title', '발송 완료')}</Title>
            <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
          </Head>
          <SentBody>
            <SentIcon>✓</SentIcon>
            <SentTitle>{t('newInvoice.sent.title', '발송 완료')}</SentTitle>
            <SentList>
              {sentResult.convId && sentResult.convName && (
                <li>{t('newInvoice.sent.chat', '"{{name}}" 채팅방에 카드 메시지를 보냈습니다', { name: sentResult.convName })}</li>
              )}
              {sentResult.emailTo && (
                <li>{t('newInvoice.sent.email', '{{to}} 에게 이메일을 발송했습니다', { to: sentResult.emailTo })}</li>
              )}
            </SentList>
            <SentActions>
              {sentResult.convId && (
                <SentSecondaryBtn type="button" onClick={() => { onClose(); navigate(`/talk/${sentResult.convId}`); }}>
                  {t('newInvoice.sent.goChat', '채팅방 가서 보기')}
                </SentSecondaryBtn>
              )}
              <SentPrimaryBtn type="button" onClick={onClose}>{t('common.close', '닫기')}</SentPrimaryBtn>
            </SentActions>
          </SentBody>
        </Dialog>
      </Backdrop>
    );
  }

  // 발송 요약 텍스트
  const recipientEmail = client?.tax_invoice_email || client?.billing_contact_email || client?.invite_email;
  const deliverSummary: string[] = [];
  if (sendChat && conversation) deliverSummary.push(`💬 ${conversation.title || '채팅방'}`);
  if (sendEmail && recipientEmail) deliverSummary.push(`✉ ${recipientEmail}`);
  if (deliverSummary.length === 0 && client) deliverSummary.push('공개 링크만 생성 (수동 전달)');

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('newInvoice.title') as string}>
        <Head>
          <Title>{t('newInvoice.title')}</Title>
          <CloseBtn onClick={onClose} aria-label={t('common.close') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Head>

        <Body>
          {/* ─── 발신 / 수신 ─── */}
          <SectionGrid>
            <Section>
              <SectionLabel>{t('newInvoice.from.title')}</SectionLabel>
              <FromCard>
                <FromName>{businessInfo?.legal_name || businessInfo?.name || '—'}</FromName>
                <FromMeta>
                  <FromMetaRow><FromKey>사업자번호</FromKey><FromVal>{businessInfo?.tax_id || <FieldHole>없음</FieldHole>}</FromVal></FromMetaRow>
                  <FromMetaRow><FromKey>대표자</FromKey><FromVal>{businessInfo?.representative || <FieldHole>없음</FieldHole>}</FromVal></FromMetaRow>
                  <FromMetaRow><FromKey>주소</FromKey><FromVal>{businessInfo?.address || <FieldHole>없음</FieldHole>}</FromVal></FromMetaRow>
                </FromMeta>
                <FromHint>{t('newInvoice.from.auto')}</FromHint>
              </FromCard>
            </Section>

            <Section>
              <SectionLabel>{t('newInvoice.to.title')}</SectionLabel>
              <PlanQSelect
                options={clientOptions}
                value={clientOptions.find(o => o.value === clientId) || null}
                onChange={(opt) => { setClientId(opt ? Number((opt as PlanQSelectOption).value) : null); setSourcePostId(null); setOverrideBiz({}); }}
                placeholder={t('newInvoice.to.selectPh') as string}
                isClearable
                isSearchable
              />

              {client && (
                <ToCard>
                  {client.is_business ? (
                    <>
                      <ToName>{(overrideBiz.biz_name || client.biz_name) || '—'}</ToName>
                      <FromMeta>
                        <FromMetaRow>
                          <FromKey>사업자번호</FromKey>
                          <FromVal>{overrideBiz.biz_tax_id || client.biz_tax_id || <FieldHole>없음</FieldHole>}</FromVal>
                        </FromMetaRow>
                        <FromMetaRow>
                          <FromKey>대표자</FromKey>
                          <FromVal>{overrideBiz.biz_representative || client.biz_ceo || <FieldHole>없음</FieldHole>}</FromVal>
                        </FromMetaRow>
                        <FromMetaRow>
                          <FromKey>주소</FromKey>
                          <FromVal>{overrideBiz.biz_address || client.biz_address || client.biz_address_en || <FieldHole>없음</FieldHole>}</FromVal>
                        </FromMetaRow>
                      </FromMeta>

                      {missingAfterOverride.length > 0 && (
                        <MissingPanel>
                          <MissingHead>
                            <MissingIcon>!</MissingIcon>
                            <MissingTitle>{t('newInvoice.to.missingTitle')}</MissingTitle>
                          </MissingHead>
                          <MissingDesc>{t('newInvoice.to.missingDesc')}</MissingDesc>
                          <MissingFields>
                            {missingAfterOverride.includes('biz_name') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_name')}</MissingLabel>
                                <MissingInput value={overrideBiz.biz_name || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_name: e.target.value }))} />
                              </MissingField>
                            )}
                            {missingAfterOverride.includes('biz_tax_id') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_tax_id')}</MissingLabel>
                                <MissingInput placeholder="000-00-00000" value={overrideBiz.biz_tax_id || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_tax_id: e.target.value }))} />
                              </MissingField>
                            )}
                            {missingAfterOverride.includes('biz_representative') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_representative')}</MissingLabel>
                                <MissingInput value={overrideBiz.biz_representative || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_representative: e.target.value }))} />
                              </MissingField>
                            )}
                            {missingAfterOverride.includes('biz_address') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_address')}</MissingLabel>
                                <MissingInput value={overrideBiz.biz_address || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_address: e.target.value }))} />
                              </MissingField>
                            )}
                          </MissingFields>
                          <SaveOnClient>
                            <SaveOnClientCheck type="checkbox" defaultChecked /> {t('newInvoice.to.saveOnClient')}
                          </SaveOnClient>
                        </MissingPanel>
                      )}
                    </>
                  ) : (
                    <NoBizMsg>{t('newInvoice.to.noBusiness')}</NoBizMsg>
                  )}
                </ToCard>
              )}
            </Section>
          </SectionGrid>

          {/* ─── 출처 문서 ─── */}
          {client && (
            <Section>
              <SectionLabel>출처 문서 (선택)</SectionLabel>
              {sourceCandidates.length === 0 ? (
                <SourceEmpty>
                  이 고객의 체결된 계약/견적이 없습니다. 출처 없이 발행합니다.
                </SourceEmpty>
              ) : (
                <>
                  <SourceHint>출처 선택 시 본문 항목·금액·분할 일정이 자동으로 채워집니다.</SourceHint>
                  <PlanQSelect
                    options={sourceOptions}
                    value={sourceOptions.find(o => o.value === sourcePostId) || null}
                    onChange={(opt) => setSourcePostId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                    placeholder="— 선택 (없으면 비워둠) —"
                    isClearable
                    isSearchable
                  />
                  {sourcePost && (
                    <SourceBadge>
                      <SourceKindBadge $kind={sourcePost.category || ''}>
                        {KIND_LABEL[sourcePost.category || ''] || sourcePost.category || '문서'}
                      </SourceKindBadge>
                      <SourceTitle>{sourcePost.title}</SourceTitle>
                      <SourceMeta>
                        {sourcePost.shared_at && `공유 ${sourcePost.shared_at.split('T')[0]}`}
                      </SourceMeta>
                    </SourceBadge>
                  )}
                </>
              )}
            </Section>
          )}

          {/* ─── 청구 내용 ─── */}
          <Section>
            <SectionLabel>{t('newInvoice.compose.title')}</SectionLabel>
            <FieldGrid>
              <Field $span={2}>
                <FieldLabel>{t('newInvoice.compose.titleField')}</FieldLabel>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('newInvoice.compose.titlePh') as string} />
              </Field>
              <Field>
                <FieldLabel>{t('newInvoice.compose.issuedAt')}</FieldLabel>
                <Input type="date" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>{t('newInvoice.compose.dueDate')}</FieldLabel>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>{t('newInvoice.compose.currency')}</FieldLabel>
                <PlanQSelect
                  size="sm"
                  options={CURRENCY_OPTIONS}
                  value={CURRENCY_OPTIONS.find(o => o.value === currency) || null}
                  onChange={(opt) => opt && setCurrency((opt as PlanQSelectOption).value as Currency)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('newInvoice.compose.vatRate')}</FieldLabel>
                <PlanQSelect
                  size="sm"
                  options={VAT_OPTIONS}
                  value={VAT_OPTIONS.find(o => o.value === String(vatRate)) || null}
                  onChange={(opt) => opt && setVatRate(parseFloat((opt as PlanQSelectOption).value as string))}
                />
              </Field>
            </FieldGrid>
          </Section>

          {/* ─── 항목 ─── */}
          <Section>
            <SectionLabelRow>
              <SectionLabel>{t('newInvoice.items.title')}</SectionLabel>
              <AddRow onClick={addItem}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                {t('newInvoice.items.addRow')}
              </AddRow>
            </SectionLabelRow>
            <ItemTable>
              <ItemHead>
                <ItemHeadCell style={{ width: 28 }}>#</ItemHeadCell>
                <ItemHeadCell>{t('newInvoice.items.description')}</ItemHeadCell>
                <ItemHeadCell style={{ width: 70 }}>{t('newInvoice.items.qty')}</ItemHeadCell>
                <ItemHeadCell style={{ width: 110 }}>{t('newInvoice.items.unitPrice')}</ItemHeadCell>
                <ItemHeadCell style={{ width: 110, textAlign: 'right' }}>{t('newInvoice.items.subtotal')}</ItemHeadCell>
                <ItemHeadCell style={{ width: 28 }}></ItemHeadCell>
              </ItemHead>
              {items.map((it, idx) => (
                <ItemRow key={it.id}>
                  <ItemCell style={{ width: 28, color: '#94A3B8' }}>{idx + 1}</ItemCell>
                  <ItemCell>
                    <Input value={it.description} onChange={e => updateItem(it.id, { description: e.target.value })} placeholder={t('newInvoice.items.descriptionPh') as string} />
                  </ItemCell>
                  <ItemCell style={{ width: 70 }}>
                    <Input type="number" min={1} value={it.quantity} onChange={e => updateItem(it.id, { quantity: Number(e.target.value) || 0 })} />
                  </ItemCell>
                  <ItemCell style={{ width: 110 }}>
                    <Input type="number" min={0} value={it.unit_price} onChange={e => updateItem(it.id, { unit_price: Number(e.target.value) || 0 })} />
                  </ItemCell>
                  <ItemCell style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>
                    {formatMoney(it.quantity * it.unit_price, currency)}
                  </ItemCell>
                  <ItemCell style={{ width: 28 }}>
                    <RemoveBtn type="button" onClick={() => removeItem(it.id)} aria-label="remove" disabled={items.length === 1}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </RemoveBtn>
                  </ItemCell>
                </ItemRow>
              ))}
            </ItemTable>

            <Summary>
              <SumRow>
                <SumKey>{t('newInvoice.summary.subtotal')}</SumKey>
                <SumVal>{formatMoney(subtotal, currency)}</SumVal>
              </SumRow>
              {vatRate > 0 && (
                <SumRow>
                  <SumKey>{t('newInvoice.summary.vat')} ({Math.round(vatRate * 100)}%)</SumKey>
                  <SumVal>{formatMoney(vat, currency)}</SumVal>
                </SumRow>
              )}
              <SumDiv />
              <SumRow>
                <SumKey style={{ fontWeight: 700, color: '#0F172A' }}>{t('newInvoice.summary.total')}</SumKey>
                <SumVal style={{ fontSize: 16, fontWeight: 700 }}>{formatMoney(total, currency)}</SumVal>
              </SumRow>
            </Summary>
          </Section>

          {/* ─── 분할 ─── */}
          <Section>
            <ToggleRow>
              <ToggleLeft>
                <Switch
                  $on={splitOn}
                  onClick={() => setSplitOn(o => !o)}
                  role="switch"
                  aria-checked={splitOn}
                  type="button"
                >
                  <Knob $on={splitOn} />
                </Switch>
                <ToggleText>
                  <ToggleTitle>{t('newInvoice.split.toggle')}</ToggleTitle>
                  <ToggleDesc>{t('newInvoice.split.toggleDesc')}</ToggleDesc>
                </ToggleText>
              </ToggleLeft>
            </ToggleRow>

            {splitOn && (
              <SplitArea>
                <PresetRow>
                  <PresetLabel>{t('newInvoice.split.presets.title')}</PresetLabel>
                  <PresetBtn onClick={() => applyPreset([30, 40, 30])}>{t('newInvoice.split.presets.p3030')}</PresetBtn>
                  <PresetBtn onClick={() => applyPreset([50, 50])}>{t('newInvoice.split.presets.p5050')}</PresetBtn>
                  <PresetBtn onClick={() => applyPreset([30, 70])}>{t('newInvoice.split.presets.p3070')}</PresetBtn>
                </PresetRow>

                <RoundTable>
                  <RoundHead>
                    <RoundHeadCell style={{ width: 28 }}>#</RoundHeadCell>
                    <RoundHeadCell>{t('newInvoice.split.label')}</RoundHeadCell>
                    <RoundHeadCell>{t('newInvoice.split.milestone')}</RoundHeadCell>
                    <RoundHeadCell style={{ width: 80 }}>{t('newInvoice.split.rate')}</RoundHeadCell>
                    <RoundHeadCell style={{ width: 110, textAlign: 'right' }}>{t('newInvoice.split.amount')}</RoundHeadCell>
                    <RoundHeadCell style={{ width: 130 }}>{t('newInvoice.split.due')}</RoundHeadCell>
                    <RoundHeadCell style={{ width: 28 }}></RoundHeadCell>
                  </RoundHead>
                  {rounds.map((r, idx) => (
                    <RoundRow key={r.id}>
                      <RoundCell style={{ width: 28, color: '#94A3B8' }}>{idx + 1}</RoundCell>
                      <RoundCell>
                        <Input value={r.label} onChange={e => updateRound(r.id, { label: e.target.value })} placeholder={t('newInvoice.split.labelPh') as string} />
                      </RoundCell>
                      <RoundCell>
                        <Input value={r.milestone} onChange={e => updateRound(r.id, { milestone: e.target.value })} placeholder={t('newInvoice.split.milestonePh') as string} />
                      </RoundCell>
                      <RoundCell style={{ width: 80 }}>
                        <PercentInputWrap>
                          <Input type="number" min={0} max={100} value={r.rate} onChange={e => updateRound(r.id, { rate: Number(e.target.value) || 0 })} style={{ paddingRight: 22 }} />
                          <PercentSign>%</PercentSign>
                        </PercentInputWrap>
                      </RoundCell>
                      <RoundCell style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>
                        {formatMoney(Math.round(total * r.rate / 100), currency)}
                      </RoundCell>
                      <RoundCell style={{ width: 130 }}>
                        <Input type="date" value={r.due_date} onChange={e => updateRound(r.id, { due_date: e.target.value })} />
                      </RoundCell>
                      <RoundCell style={{ width: 28 }}>
                        <RemoveBtn type="button" onClick={() => removeRound(r.id)} aria-label="remove">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </RemoveBtn>
                      </RoundCell>
                    </RoundRow>
                  ))}
                </RoundTable>

                <SplitFooter>
                  <AddRow onClick={addRound}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {t('newInvoice.split.addRound')}
                  </AddRow>
                  <SumStatus $ok={sumOk}>
                    {sumOk ? t('newInvoice.split.sumOk') : t('newInvoice.split.sumWarn', { percent: sumPercent })}
                  </SumStatus>
                </SplitFooter>
              </SplitArea>
            )}
          </Section>

          {/* ─── 세금계산서 ─── */}
          <Section>
            <ToggleRow>
              <ToggleLeft>
                <Switch
                  $on={taxOn}
                  onClick={() => canTax && setTaxOn(o => !o)}
                  role="switch"
                  aria-checked={taxOn}
                  type="button"
                  disabled={!canTax}
                >
                  <Knob $on={taxOn} />
                </Switch>
                <ToggleText>
                  <ToggleTitle>{t('newInvoice.tax.toggle')}</ToggleTitle>
                  <ToggleDesc>
                    {!client?.is_business ? t('newInvoice.tax.individual') :
                     canTax ? (taxOn ? t('newInvoice.tax.toggleDescOn') : '') :
                     t('newInvoice.tax.toggleDescOff')}
                  </ToggleDesc>
                </ToggleText>
              </ToggleLeft>
            </ToggleRow>
          </Section>

          {/* ─── 입금 안내 ─── */}
          <Section>
            <SectionLabel>{t('newInvoice.bank.title')}</SectionLabel>
            <BankAuto>
              <BankAutoTitle>{businessInfo?.bank_name || '—'} {businessInfo?.bank_account_number || ''}</BankAutoTitle>
              <BankAutoSub>{businessInfo?.bank_account_name || businessInfo?.name || '—'} · {t('newInvoice.bank.auto')}</BankAutoSub>
            </BankAuto>
          </Section>

          {/* 메모 */}
          <Section>
            <SectionLabel>{t('newInvoice.compose.notes')}</SectionLabel>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('newInvoice.compose.notesPh') as string} />
          </Section>

          {/* ─── 발송 옵션 (어디로 가는지) ─── */}
          {client && (
            <Section>
              <SectionLabel>발송</SectionLabel>
              <DeliverList>
                {/* 채팅방 */}
                <DeliverRow $disabled={!conversation}>
                  <DeliverCheck
                    type="checkbox"
                    checked={sendChat && !!conversation}
                    disabled={!conversation}
                    onChange={e => setSendChat(e.target.checked)}
                  />
                  <DeliverIcon $color="#14B8A6">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </DeliverIcon>
                  <DeliverBody>
                    <DeliverTitle>채팅방으로 결제 요청 카드 보내기</DeliverTitle>
                    <DeliverTarget>
                      {conversation ? (
                        <>→ <strong>{conversation.title || '채팅방'}</strong></>
                      ) : (
                        <NoChannelHint>이 고객의 채팅방이 없습니다 · <NoChannelLink>채팅방 만들기 →</NoChannelLink></NoChannelHint>
                      )}
                    </DeliverTarget>
                  </DeliverBody>
                </DeliverRow>

                {/* 이메일 */}
                <DeliverRow>
                  <DeliverCheck type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} />
                  <DeliverIcon $color="#0EA5E9">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </DeliverIcon>
                  <DeliverBody>
                    <DeliverTitle>이메일 발송</DeliverTitle>
                    <DeliverTarget>→ <strong>{recipientEmail || '이메일 없음'}</strong></DeliverTarget>
                    {sendEmail && (
                      <PdfToggle>
                        <input type="checkbox" checked={includePdf} onChange={e => setIncludePdf(e.target.checked)} />
                        <span>PDF 첨부</span>
                      </PdfToggle>
                    )}
                  </DeliverBody>
                </DeliverRow>

                {/* 공개 링크 */}
                <DeliverRow>
                  <DeliverCheck type="checkbox" checked disabled />
                  <DeliverIcon $color="#A855F7">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                  </DeliverIcon>
                  <DeliverBody>
                    <DeliverTitle>공개 링크 자동 발급</DeliverTitle>
                    <DeliverTarget>→ /public/invoices/:token (발행 즉시 생성)</DeliverTarget>
                  </DeliverBody>
                </DeliverRow>
              </DeliverList>
            </Section>
          )}

          {/* 에러 */}
          {errors.length > 0 && (
            <ErrorPanel>
              {errors.map((err, i) => <ErrorRow key={i}>! {err}</ErrorRow>)}
            </ErrorPanel>
          )}
        </Body>

        {/* ─── 푸터 ─── */}
        <Footer>
          <FooterLeft>
            <SecondaryBtn type="button" onClick={onClose}>{t('newInvoice.actions.cancel')}</SecondaryBtn>
          </FooterLeft>
          <FooterRight>
            <FooterSummary>
              {client && (sendChat || sendEmail) ? (
                <FooterSumText>발행 후: {deliverSummary.join(' · ')}</FooterSumText>
              ) : null}
            </FooterSummary>
            <SecondaryBtn type="button" onClick={() => submit(true)} disabled={submitting}>
              {t('newInvoice.actions.saveDraft')}
            </SecondaryBtn>
            <PrimaryBtn type="button" onClick={() => submit(false)} disabled={submitting}>
              {submitting ? '...' : (sendChat || sendEmail ? t('newInvoice.actions.issueAndSend') : t('newInvoice.actions.issue'))}
            </PrimaryBtn>
          </FooterRight>
        </Footer>
      </Dialog>
    </Backdrop>
  );
}

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
  animation: fadeIn 0.15s ease-out;
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
const Dialog = styled.div`
  background: #fff; border-radius: 16px; max-width: 880px; width: 100%;
  max-height: 92vh; display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
  animation: slideUp 0.2s ease-out;
  @keyframes slideUp {
    from { transform: translateY(8px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`;
const Head = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px; border-bottom: 1px solid #F1F5F9; flex-shrink: 0;
`;
const Title = styled.h2`
  font-size: 17px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px; margin: 0;
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  font-size: 22px; line-height: 1;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
// 발송 결과 화면
const SentBody = styled.div`
  padding: 28px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px;
`;
const SentIcon = styled.div`
  width: 56px; height: 56px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: #F0FDF4; color: #15803D; font-size: 28px; font-weight: 700;
`;
const SentTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const SentList = styled.ul`
  margin: 4px 0; padding: 0 0 0 0;
  list-style: none; display: flex; flex-direction: column; gap: 6px;
  font-size: 13px; color: #475569; text-align: center;
  & li { padding: 6px 12px; background: #F8FAFC; border-radius: 8px; }
`;
const SentActions = styled.div`
  display: flex; gap: 8px; justify-content: center; margin-top: 8px;
`;
const SentSecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #0F766E;
  background: #fff; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  &:hover { background: #F0FDFA; }
`;
const SentPrimaryBtn = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #fff;
  background: #0D9488; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: #0F766E; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 20px 24px 24px; background: #FAFBFC;
  display: flex; flex-direction: column; gap: 14px;
`;
const Footer = styled.div`
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 14px 24px; border-top: 1px solid #F1F5F9; flex-shrink: 0; background: #fff;
`;
const FooterLeft = styled.div``;
const FooterRight = styled.div`
  display: flex; gap: 8px; align-items: center;
`;
const FooterSummary = styled.div`
  margin-right: 10px; max-width: 320px; min-width: 0; text-align: right;
  @media (max-width: 720px) { display: none; }
`;
const FooterSumText = styled.div`
  font-size: 11px; color: #64748B; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SectionGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;
const Section = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
`;
const SectionLabel = styled.div`
  font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;
`;
const SectionLabelRow = styled.div`
  display: flex; justify-content: space-between; align-items: center;
`;
const FromCard = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FromName = styled.div`font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 4px;`;
const FromMeta = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FromMetaRow = styled.div`display: flex; gap: 6px; font-size: 12px;`;
const FromKey = styled.span`color: #94A3B8; min-width: 60px; flex-shrink: 0;`;
const FromVal = styled.span`color: #334155; flex: 1; min-width: 0;`;
const FromHint = styled.div`font-size: 11px; color: #94A3B8; margin-top: 4px;`;
const ToCard = styled.div`display: flex; flex-direction: column; gap: 6px; margin-top: 4px;`;
const ToName = styled.div`font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 4px;`;
const FieldHole = styled.span`color: #DC2626; font-size: 11px; font-weight: 500;`;
const NoBizMsg = styled.div`
  font-size: 12px; color: #64748B;
  background: #F8FAFC; padding: 8px 10px; border-radius: 6px;
`;
const MissingPanel = styled.div`
  margin-top: 8px; padding: 10px 12px;
  background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px;
`;
const MissingHead = styled.div`display: flex; align-items: center; gap: 6px; margin-bottom: 4px;`;
const MissingIcon = styled.span`
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F59E0B; color: #fff; font-size: 11px; font-weight: 700;
`;
const MissingTitle = styled.div`font-size: 12px; font-weight: 700; color: #92400E;`;
const MissingDesc = styled.div`font-size: 11px; color: #92400E; line-height: 1.5; margin-bottom: 8px;`;
const MissingFields = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const MissingField = styled.div`display: flex; flex-direction: column; gap: 3px;`;
const MissingLabel = styled.label`font-size: 11px; font-weight: 600; color: #92400E;`;
const MissingInput = styled.input`
  width: 100%; padding: 6px 8px; font-size: 12px; color: #0F172A;
  background: #fff; border: 1px solid #FDE68A; border-radius: 6px;
  &:focus { outline: none; border-color: #F59E0B; }
`;
const SaveOnClient = styled.label`
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #92400E; margin-top: 8px; cursor: pointer;
`;
const SaveOnClientCheck = styled.input`accent-color: #F59E0B; cursor: pointer;`;
const FieldGrid = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  @media (max-width: 720px) { grid-template-columns: repeat(2, 1fr); }
`;
const Field = styled.div<{ $span?: number }>`
  grid-column: span ${p => p.$span || 1};
  display: flex; flex-direction: column; gap: 4px;
  @media (max-width: 720px) { grid-column: span 2; }
`;
const FieldLabel = styled.label`font-size: 11px; font-weight: 600; color: #475569;`;
const Input = styled.input`
  width: 100%; padding: 7px 10px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px;
  font-variant-numeric: tabular-nums;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const Textarea = styled.textarea`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ItemTable = styled.div`
  display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; overflow: hidden;
`;
const ItemHead = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; background: #F8FAFC;
  border-bottom: 1px solid #F1F5F9;
  font-size: 11px; font-weight: 600; color: #64748B;
`;
const ItemHeadCell = styled.div`flex: 1; min-width: 0;`;
const ItemRow = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; align-items: center;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
`;
const ItemCell = styled.div`flex: 1; min-width: 0; display: flex; align-items: center;`;
const RemoveBtn = styled.button`
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 4px; cursor: pointer; color: #94A3B8;
  &:hover:not(:disabled) { background: #FEF2F2; color: #DC2626; }
  &:disabled { opacity: 0.3; cursor: not-allowed; }
`;
const Summary = styled.div`
  display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; background: #F8FAFC; border-radius: 8px;
`;
const SumRow = styled.div`display: flex; justify-content: space-between; font-size: 13px;`;
const SumKey = styled.span`color: #64748B;`;
const SumVal = styled.span`color: #0F172A; font-variant-numeric: tabular-nums;`;
const SumDiv = styled.div`height: 1px; background: #E2E8F0; margin: 4px 0;`;
const AddRow = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; font-size: 11px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 6px; cursor: pointer;
  line-height: 1;
  & > svg { display: block; flex-shrink: 0; }
  &:hover { background: #14B8A6; color: #fff; }
`;
const ToggleRow = styled.div`display: flex; justify-content: space-between; align-items: flex-start;`;
const ToggleLeft = styled.div`display: flex; gap: 12px; align-items: flex-start;`;
const Switch = styled.button<{ $on: boolean }>`
  width: 36px; height: 20px; border-radius: 999px;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border: none; cursor: pointer; padding: 0; flex-shrink: 0;
  position: relative; transition: background 0.2s; margin-top: 2px;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Knob = styled.span<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '18px' : '2px'};
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transition: left 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
`;
const ToggleText = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const ToggleTitle = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const ToggleDesc = styled.div`font-size: 11px; color: #64748B; line-height: 1.5;`;
const SplitArea = styled.div`display: flex; flex-direction: column; gap: 10px; margin-top: 8px;`;
const PresetRow = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const PresetLabel = styled.span`font-size: 11px; font-weight: 600; color: #64748B;`;
const PresetBtn = styled.button`
  padding: 4px 10px; font-size: 11px; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 999px; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; background: #F0FDFA; }
`;
const RoundTable = styled.div`
  display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; overflow: hidden;
`;
const RoundHead = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; background: #F8FAFC;
  border-bottom: 1px solid #F1F5F9;
  font-size: 11px; font-weight: 600; color: #64748B;
`;
const RoundHeadCell = styled.div`flex: 1; min-width: 0;`;
const RoundRow = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; align-items: center;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
`;
const RoundCell = styled.div`flex: 1; min-width: 0; display: flex; align-items: center;`;
const PercentInputWrap = styled.div`position: relative; width: 100%;`;
const PercentSign = styled.span`
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 12px; color: #94A3B8;
`;
const SplitFooter = styled.div`
  display: flex; justify-content: space-between; align-items: center;
`;
const SumStatus = styled.span<{ $ok: boolean }>`
  font-size: 12px; font-weight: 700;
  color: ${p => p.$ok ? '#166534' : '#92400E'};
  background: ${p => p.$ok ? '#DCFCE7' : '#FEF3C7'};
  padding: 4px 10px; border-radius: 999px;
`;
const BankAuto = styled.div`
  display: flex; flex-direction: column; gap: 3px; padding: 12px 14px;
  background: #F8FAFC; border-radius: 8px;
`;
const BankAutoTitle = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const BankAutoSub = styled.div`font-size: 11px; color: #64748B;`;
const ErrorPanel = styled.div`
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px;
`;
const ErrorRow = styled.div`font-size: 12px; color: #991B1B; font-weight: 600;`;
const PrimaryBtn = styled.button`
  padding: 9px 18px; font-size: 13px; font-weight: 700;
  background: #14B8A6; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600;
  background: #fff; color: #334155; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// 출처 문서
const SourceEmpty = styled.div`
  font-size: 12px; color: #64748B; padding: 8px 10px; background: #F8FAFC; border-radius: 6px;
`;
const SourceHint = styled.div`font-size: 11px; color: #94A3B8;`;
const SourceBadge = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
`;
const SourceKindBadge = styled.span<{ $kind: string }>`
  font-size: 10px; font-weight: 700;
  padding: 3px 8px; border-radius: 4px;
  background: ${p =>
    p.$kind === 'contract' ? '#FEF3C7' :
    p.$kind === 'quote' ? '#E0F2FE' :
    p.$kind === 'sow' ? '#F3E8FF' :
    '#FEE2E2'};
  color: ${p =>
    p.$kind === 'contract' ? '#92400E' :
    p.$kind === 'quote' ? '#0369A1' :
    p.$kind === 'sow' ? '#6B21A8' :
    '#991B1B'};
`;
const SourceTitle = styled.div`flex: 1; font-size: 13px; font-weight: 600; color: #0F172A; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const SourceMeta = styled.div`font-size: 11px; color: #64748B; flex-shrink: 0;`;

// 발송 옵션
const DeliverList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const DeliverRow = styled.label<{ $disabled?: boolean }>`
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  background: #fff; transition: all 0.15s;
  ${p => p.$disabled && `opacity: 0.6; cursor: not-allowed;`}
  &:hover { border-color: ${p => p.$disabled ? '#E2E8F0' : '#14B8A6'}; background: ${p => p.$disabled ? '#fff' : '#F0FDFA'}; }
`;
const DeliverCheck = styled.input`
  margin-top: 3px; accent-color: #14B8A6; flex-shrink: 0;
`;
const DeliverIcon = styled.div<{ $color: string }>`
  width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => p.$color}1a; color: ${p => p.$color};
`;
const DeliverBody = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;`;
const DeliverTitle = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const DeliverTarget = styled.div`font-size: 12px; color: #64748B;`;
const NoChannelHint = styled.span`color: #92400E;`;
const NoChannelLink = styled.span`color: #0F766E; font-weight: 600; cursor: pointer; &:hover { text-decoration: underline; }`;
const PdfToggle = styled.label`
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: #475569; margin-top: 4px;
  input { accent-color: #14B8A6; }
`;
