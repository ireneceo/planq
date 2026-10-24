// 새 청구서 발행 모달
// - 발신 자동 (Business)
// - 수신 선택 (Client) + 사업자정보 자동 채움 + 누락 시 인라인 보완
// - 출처 문서 선택 (계약/견적/SOW/제안) — 본문·분할 일정 자동 흡수
// - 항목 / 분할 / 세금계산서 / 입금 안내
// - 발송 옵션 통합: 채팅방 (자동 표시) · 이메일 · 공개 링크 — 어디로 가는지 명시
import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { accessLabel } from '../../utils/clientLabel';
import { useNavigate } from 'react-router-dom';
import SingleDateField from '../../components/Common/SingleDateField';
import { todayInTz } from '../../utils/timezones';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useAuth } from '../../contexts/AuthContext';
import {
  missingClientBizFields,
  listClientOptionsForInvoice, listSourceCandidates, findConversationForClient,
  getBusinessInfo, createInvoice, updateInvoice, getInvoice, sendInvoice,
  type Currency, type ApiClientLite, type ApiSourcePost, type ApiBusinessInfo, type ApiConvFound,
} from '../../services/invoices';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { invoiceCapsOf, invoiceViewerOf } from './invoiceCaps';
import { invoiceErrorText } from './invoiceErrors';
import { putClientFields, type BizRegRead } from '../../services/sale';
import BizRegReadButton from '../../components/Clients/BizRegReadButton';
import { onSocket } from '../../services/socket';
import {
  InvoiceItemsTable, InvoiceTotals, InvoiceSplitArea, invoiceTotalsOf, Input, AddRow, type InvoiceLineItem, type InvoiceRound,
  Section, SectionLabel, SectionLabelRow, FieldGrid, Field, FieldLabel, Textarea,
  ToggleRow, ToggleLeft, Switch, Knob, ToggleText, ToggleTitle, ToggleDesc,
} from './InvoiceLinesEditor';
import { TaxRateInput, TaxModeSelect, useTaxLabel } from './TaxFields';
import AiActionButton from '../../components/Common/AiActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import InvoiceAiDraftModal from './InvoiceAiDraftModal';
import type { InvoiceAiDraft } from '../../services/invoices';
import { isTaxEnabled, type TaxMode } from '../../utils/taxCalc';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 후속 액션 카드에서 진입 시 — 분할/단일 자동 분기 */
  prefillSplit?: boolean;
  /** 후속 액션 카드에서 진입 시 — 출처 문서 자동 연결 (post id) */
  prefillPostId?: number | null;
  /** 프로젝트에서 발행 진입 시 — invoice.project_id 자동 연결 (post 없이) */
  prefillProjectId?: number | null;
  /** 임시저장(draft) 재편집 진입 시 — 해당 invoice id 를 로드해 폼 채움 (PUT 저장) */
  editInvoiceId?: number | null;
  /** Q sale 상담에서 "청구서 발행" 으로 진입 — 받는 고객을 미리 고른다(죽은 링크를 만들지 않는다) */
  prefillClientId?: number | null;
}

type Item = InvoiceLineItem;
type Round = InvoiceRound;

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

export default function NewInvoiceModal({ open, onClose, prefillSplit, prefillPostId, prefillProjectId, editInvoiceId, prefillClientId }: Props) {
  const isEdit = !!editInvoiceId;
  const { t } = useTranslation('qbill');
  const { t: tSale } = useTranslation('qsale');   // 고객 관계 글자(utils/clientLabel)
  const { user } = useAuth();
  const navigate = useNavigate();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  // 발행(send)은 대표만(서버 assertInvoiceMutationOwner) — 판정은 invoiceCaps 한 곳. 멤버는 임시 저장까지.
  //   옛: 멤버도 [발행] 이 눌려 초안을 만든 뒤 서버 403 영어 문장이 그대로 떴다(2026-10-16 신고).
  const canIssue = invoiceCapsOf(invoiceViewerOf(user)).canSend;
  // 발행일 기본값 = 워크스페이스 타임존 기준 실제 오늘 (옛 하드코딩 '2026-04-27' 버그 fix).
  const todayStr = useMemo(() => todayInTz(user?.workspace_timezone || 'Asia/Seoul'), [user?.workspace_timezone]);
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  // ─── 발신자 / 클라이언트 / 출처 — 백엔드 데이터 ───
  const [businessInfo, setBusinessInfo] = useState<ApiBusinessInfo | null>(null);
  const [clients, setClients] = useState<ApiClientLite[]>([]);
  const [sourceCandidates, setSourceCandidates] = useState<ApiSourcePost[]>([]);
  const [convFound, setConvFound] = useState<ApiConvFound | null>(null);

  // ─── 폼 state ───
  const [submitting, setSubmitting] = useState(false);

  // 발송 접수 결과 — ★ 발송은 응답 뒤 백그라운드로 돈다(services/invoiceDelivery.js).
  //   여기서 "발송 완료" 라고 쓰면 거짓말이다. 무엇을 어디로 **보내기 시작했는지**만 말하고,
  //   결과는 청구서 상세의 발송 상태가 말한다(socket 으로 갱신된다).
  const [sentResult, setSentResult] = useState<{
    invoiceId: number;
    convId: number | null;
    convName: string | null;
    emailQueued: boolean;
    emailTo: string | null;
  } | null>(null);

  const [clientId, setClientId] = useState<number | null>(prefillClientId ?? null);
  // 상담에서 넘어온 고객 — 열릴 때마다 적용한다(모달이 살아 있는 채로 다른 고객으로 다시 열 수 있다)
  useEffect(() => { if (open && prefillClientId) setClientId(prefillClientId); }, [open, prefillClientId]);
  // 프로젝트 자동선택 보완 — ProjectClient.client_id 가 비어있는 초대중 고객을 clients 로드 후 매칭
  const [pendingContactUserId, setPendingContactUserId] = useState<number | null>(null);
  // 프로젝트 연결 — 프로젝트에서 발행 시 invoice.project_id 로 저장 + 그 프로젝트 채팅방 탐색
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  // #211 ② — 이 프로젝트의 직전 청구 항목 · 기록된 시간. 청구서를 **처음부터 타이핑하지 않게** 한다.
  //   ★ 직전 단가를 시간당 단가로 쓰지 않는다 — 이 팀의 청구는 월정액이라 그 값은 '월 사용료'다
  //     (운영 실측: 모든 항목이 수량 1 × 단가). 시간은 별도 항목으로 **덧붙이고 단가는 사람이 친다.**
  const [draft, setDraft] = useState<{
    last_invoice: { id: number; title: string | null } | null;
    last_items: { description: string; detail: string; quantity: number; unit_price: number }[];
    time: { hours: number; tasks_total: number; tasks_with_time: number };
  } | null>(null);
  // 외부 고객 직접 입력 (초대 없이 청구) — 운영 #1. 'client'=기존 고객 선택, 'external'=이름+이메일 직접
  const [recipientMode, setRecipientMode] = useState<'client' | 'external'>('client');
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [extBizNumber, setExtBizNumber] = useState('');
  const [sourcePostId, setSourcePostId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [issuedAt, setIssuedAt] = useState(todayStr);
  const [dueDate, setDueDate] = useState(addDays(todayStr, 14));
  const [currency, setCurrency] = useState<Currency>('KRW');
  const [vatRate, setVatRate] = useState<number>(0.10);
  // 금액 기준 — 항목 단가를 세금 포함가로 적는지(2026-10-24, docs/TAX_SETTINGS_DESIGN.md). 기본은 워크스페이스 설정
  const [taxMode, setTaxMode] = useState<TaxMode>('exclusive');
  const [notes, setNotes] = useState('');

  const [items, setItems] = useState<Item[]>([
    { id: 1, description: '', detail: '', quantity: 1, unit_price: 0 },
  ]);

  const [splitOn, setSplitOn] = useState(false);
  const [rounds, setRounds] = useState<Round[]>([
    { id: 1, label: t('newInvoice.preset.deposit', { defaultValue: '선금' }) as string, milestone: t('newInvoice.preset.depositMs', { defaultValue: '계약 체결' }) as string, rate: 30, due_date: addDays(todayStr, 7) },
    { id: 2, label: t('newInvoice.preset.interim', { defaultValue: '중도금' }) as string, milestone: t('newInvoice.preset.interimMs', { defaultValue: '중간 검수' }) as string, rate: 40, due_date: addDays(todayStr, 21) },
    { id: 3, label: t('newInvoice.preset.balance', { defaultValue: '잔금' }) as string, milestone: t('newInvoice.preset.balanceMs', { defaultValue: '최종 검수' }) as string, rate: 30, due_date: addDays(todayStr, 35) },
  ]);

  const [taxOn, setTaxOn] = useState(false);

  // 발송 옵션 — 채팅은 기본 꺼짐(2026-10-23 Irene: 채팅방이 있는 고객은 «확인 필요» 로 청구서가 온 걸 안다)
  const [sendChat, setSendChat] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [includePdf, setIncludePdf] = useState(true);

  // 누락 인라인 보완
  //   ★ 키는 고객 칸 이름 그대로(biz_ceo) — missingClientBizFields 가 'biz_ceo' 를 내는데 화면이 'biz_representative' 를 찾아
  //     대표자 칸이 한 번도 안 떴다(2026-10-23 «아무리 저장해도 저장 안 돼»).
  const [overrideBiz, setOverrideBiz] = useState<{
    biz_name?: string; biz_tax_id?: string; biz_ceo?: string; biz_address?: string;
  }>({});
  // «고객 정보에 저장» — 체크돼 있으면 발행·임시저장 뒤 고객에 **비어 있던 칸만** 채운다(PUT /api/clients/:biz/:id, 감사 포함)
  const [saveOnClient, setSaveOnClient] = useState(true);
  // 사업자등록증 읽기(Fable 2026-10-23 판정 5) — 비어 있는 칸만 채운다(사람이 쓴 값은 덮지 않는다).
  //   등록 고객이면 위 «고객 정보에 저장»(기본 켬)이 발행 때 고객의 빈 칸에도 넣는다. 외부 수신은 이름·번호 두 칸.
  const [bizRegMsg, setBizRegMsg] = useState<string | null>(null);
  const applyBizReg = (r: BizRegRead | null, _file: File, error: string | null) => {
    const warn = r && r.warnings.includes('tax_id_checksum') ? t('bizReg.taxIdUnreadable', { ns: 'clients' }) as string : null;
    setBizRegMsg(error || warn);
    if (!r || !r.found) return;
    const v = r.values;
    if (recipientMode === 'external') {
      if (v.biz_name) setExtName(cur => cur.trim() ? cur : v.biz_name!);
      if (v.biz_tax_id) setExtBizNumber(cur => cur.trim() ? cur : v.biz_tax_id!);
      return;
    }
    setOverrideBiz(o => {
      const next = { ...o };
      for (const k of ['biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address'] as const) {
        if (v[k] && missing.includes(k) && !(o[k] || '').trim()) next[k] = v[k]!;
      }
      return next;
    });
  };

  const [errors, setErrors] = useState<string[]>([]);

  // [AI 작성] (docs/INVOICE_AI_DRAFT_DESIGN.md §7) — 채운 칸은 «AI 가 채움» 으로 말하고 사람이 고치면 표시를 뗀다
  const [aiOpen, setAiOpen] = useState(false);
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [aiNotice, setAiNotice] = useState<{ noPrice: string[]; exempt: boolean; mixed: string[] } | null>(null);
  const [aiConfirm, setAiConfirm] = useState<{ fields: string; run: () => void } | null>(null);
  // AI 가 출처 문서를 붙일 때 «문서 제목을 청구서 제목으로» 효과가 AI 제목을 덮지 않게(그 문서 한 번만)
  const aiSourceTitleSkip = useRef<number | null>(null);
  const unmarkAi = (key: string) => setAiFilled(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });

  // ─── 파생값 ───
  const client = useMemo(
    () => clientId ? clients.find(c => c.id === clientId) || null : null,
    [clientId, clients]
  );
  // 고객에 비어 있는 칸 — 입력 칸은 이 목록으로 그린다(입력한 값으로 거르면 한 글자 치는 순간 칸이 사라진다)
  const missing = missingClientBizFields(client as any);

  const sourcePost = useMemo(
    () => sourcePostId ? sourceCandidates.find(p => p.id === sourcePostId) || null : null,
    [sourcePostId, sourceCandidates]
  );
  const conversation = convFound?.conversation || null;

  // 서버와 같은 통화별 반올림(services/invoices.roundMoney ↔ dev-backend/services/money.js) — 문서 «청구 조건» 창과 같은 함수
  const { subtotal, vat, total } = invoiceTotalsOf(items, vatRate, currency, taxMode);
  const taxLabel = useTaxLabel(businessInfo?.tax_label);

  const sumPercent = rounds.reduce((s, r) => s + r.rate, 0);
  const sumOk = sumPercent === 100;

  // 세금계산서: 통화 KRW 면 항상 발행 가능. 외화(USD/EUR/JPY/CNY)는 한국 세금계산서 발행 불가.
  //  - 사업자정보(상호·사업자번호)가 지금 없어도 OK → 결제 완료 후 고객이 공개 결제페이지에서 직접 제출.
  //    (receiptsDue 큐 + 공개 페이지가 고객 입력 흐름을 이미 지원 — 운영 피드백 2026-06-15)
  const canTax = currency === 'KRW';
  // 발행 시점에 사업자정보가 이미 채워져 있는지 — 설명 문구 분기용 (없으면 "고객이 입력" 안내).
  const taxHasBizInfo = recipientMode === 'external'
    ? !!extBizNumber.trim()
    : ((client?.is_business ?? false) && (!!client?.biz_tax_id || !!overrideBiz.biz_tax_id));

  // ─── 출처 선택 시 자동 흡수 (제목만) ───
  useEffect(() => {
    if (!sourcePost) return;
    if (aiSourceTitleSkip.current === sourcePost.id) { aiSourceTitleSkip.current = null; return; }
    if (sourcePost.title) setTitle(sourcePost.title);
  }, [sourcePost]);

  // 창이 열린 동안 Q sale·고객 상세에서 고객을 고치면 고객 목록(받는 쪽 카드·누락 칸)을 다시 읽는다 — 신호만 오므로 다시 받는다
  useEffect(() => {
    if (!open || !businessId) return;
    let pending: number | null = null;
    const off = onSocket('client:updated', () => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = null;
        listClientOptionsForInvoice(businessId).then(setClients).catch(() => { /* 보던 목록 유지 */ });
      }, 250);
    });
    return () => { if (pending) window.clearTimeout(pending); off(); };
  }, [open, businessId]);

  // ─── 모달 open 시 발신자/클라이언트 fetch + 워크스페이스 기본값 적용 ───
  useEffect(() => {
    if (!open || !businessId) return;
    Promise.all([
      getBusinessInfo(businessId).catch(() => null),
      listClientOptionsForInvoice(businessId).catch(() => []),
    ]).then(([info, list]) => {
      setBusinessInfo(info);
      setClients(list);
      // 편집 모드에서는 워크스페이스 기본값으로 덮어쓰지 않음 (invoice 값이 진실 원천)
      if (info && !editInvoiceId) {
        const days = info.default_due_days ?? 14;
        setDueDate(addDays(todayStr, days));
        // 세금을 끈 워크스페이스는 0% — 서버 workspaceTaxDefaults 와 같은 규칙
        setVatRate(!isTaxEnabled(info.tax_enabled) ? 0 : Number(info.default_vat_rate ?? 0.1));
        setTaxMode(info.default_tax_mode === 'inclusive' ? 'inclusive' : 'exclusive');
        if (info.default_currency) setCurrency(info.default_currency as Currency);
      }
    });
    // 후속 액션 카드에서 진입 시 분할 자동 활성
    if (prefillSplit) setSplitOn(true);
  }, [open, businessId, prefillSplit, editInvoiceId]);

  // ─── 임시저장(draft) 재편집 — invoice 로드해 폼 전체 채움 ───
  useEffect(() => {
    if (!open || !editInvoiceId || !businessId) return;
    let cancelled = false;
    (async () => {
      try {
        const inv = await getInvoice(businessId, editInvoiceId);
        if (cancelled || !inv) return;
        setTitle(inv.title || '');
        setNotes(inv.notes || '');
        setCurrency((inv.currency || 'KRW') as Currency);
        setVatRate(Number(inv.vat_rate ?? 0.1));
        setTaxMode(inv.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive');
        if (inv.issued_at) setIssuedAt(inv.issued_at.split('T')[0]);
        if (inv.due_date) setDueDate(inv.due_date.split('T')[0]);
        setSourcePostId(inv.source_post_id ?? null);
        setProjectId(inv.project_id ?? null);
        // 수신: client_id 있으면 기존 고객, 없으면 외부 직접 입력
        if (inv.client_id) {
          setRecipientMode('client');
          setClientId(inv.client_id);
          // 청구서에 박아 둔 상호·사업자번호를 다시 보인다(안 채우면 다시 열 때 칸이 비어 «저장 안 됨» 으로 보인다)
          setOverrideBiz({
            ...(inv.recipient_business_name ? { biz_name: inv.recipient_business_name } : {}),
            ...(inv.recipient_business_number ? { biz_tax_id: inv.recipient_business_number } : {}),
          });
        } else {
          setRecipientMode('external');
          setExtName(inv.recipient_business_name || '');
          setExtEmail(inv.recipient_email || '');
          setExtBizNumber(inv.recipient_business_number || '');
        }
        // 항목
        if (inv.items && inv.items.length > 0) {
          setItems(inv.items
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((it, i) => ({
              id: it.id || i + 1,
              description: it.description || '',
              detail: it.detail || '',
              quantity: Number(it.quantity) || 1,
              unit_price: Number(it.unit_price) || 0,
            })));
        }
        // 분할
        if (inv.installment_mode === 'split' && inv.installments && inv.installments.length > 0) {
          setSplitOn(true);
          setRounds(inv.installments
            .slice()
            .sort((a, b) => a.installment_no - b.installment_no)
            .map((ins) => ({
              id: ins.id,
              label: ins.label || '',
              milestone: ins.milestone_ref || '',
              rate: Number(ins.percent) || 0,
              due_date: ins.due_date ? ins.due_date.split('T')[0] : '',
            })));
        }
        // 세금계산서 의향
        if (inv.receipt_type === 'tax_invoice') setTaxOn(true);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [open, editInvoiceId, businessId]);

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
          setProjectId(post.project_id);
          try {
            const { apiFetch } = await import('../../contexts/AuthContext');
            const r = await apiFetch(`/api/projects/${post.project_id}`);
            const j = await r.json();
            if (j?.data?.name) setProjectName(j.data.name);
            const projClients = j?.data?.projectClients || [];
            const first = projClients[0];
            if (first) {
              // client_id 우선. 초대중(invited) 고객은 ProjectClient.client_id 가 비어있고
              // contact_user_id 만 있는 경우가 있어 → clients 로드 후 user_id 매칭으로 보완.
              if (first.client_id) setClientId(first.client_id);
              else if (first.contact_user_id) setPendingContactUserId(first.contact_user_id);
            }
          } catch { /* noop */ }
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [open, prefillPostId, businessId]);

  // ─── 프로젝트에서 발행 진입 (post 없이 ?project=:id) — project_id 자동 연결 + 첫 고객 선택 ───
  useEffect(() => {
    if (!open || isEdit || !prefillProjectId || !businessId) return;
    if (prefillPostId) return;  // post 경유는 위 effect 가 처리
    let cancelled = false;
    setProjectId(prefillProjectId);
    (async () => {
      try {
        const { apiFetch } = await import('../../contexts/AuthContext');
        const r = await apiFetch(`/api/projects/${prefillProjectId}`);
        const j = await r.json();
        if (cancelled) return;
        if (j?.data?.name) setProjectName(j.data.name);
        const projClients = j?.data?.projectClients || [];
        const first = projClients[0];
        if (first) {
          if (first.client_id) setClientId(first.client_id);
          else if (first.contact_user_id) setPendingContactUserId(first.contact_user_id);
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [open, isEdit, prefillProjectId, prefillPostId, businessId]);

  // 초대중 고객(client_id 없음) — clients 로드되면 contact_user_id 로 매칭해 선택 보완
  useEffect(() => {
    if (!pendingContactUserId || clients.length === 0) return;
    const match = clients.find(c => c.user_id === pendingContactUserId);
    if (match) { setClientId(match.id); setPendingContactUserId(null); }
  }, [pendingContactUserId, clients]);

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
    // 프로젝트 컨텍스트가 있으면 그 프로젝트의 고객 채팅방을 우선 탐색 (프로젝트 발행 시 "채팅방 없음" 오표시 fix)
    findConversationForClient(businessId, clientId, projectId).then(setConvFound).catch(() => setConvFound(null));
  }, [businessId, clientId, projectId]);

  useEffect(() => {
    if (!open) {
      // 닫힐 때 폼 초기화 (워크스페이스 기본값은 모달 open 시 다시 prefill 됨)
      setClientId(null); setPendingContactUserId(null); setProjectId(null); setProjectName(''); setSourcePostId(null); setTitle(''); setNotes('');
      setRecipientMode('client'); setExtName(''); setExtEmail(''); setExtBizNumber('');
      setIssuedAt(todayStr);
      setItems([{ id: 1, description: '', detail: '', quantity: 1, unit_price: 0 }]);
      setSplitOn(false);
      setTaxOn(false);
      setOverrideBiz({}); setSaveOnClient(true);
      setErrors([]);
      setSendChat(false); setSendEmail(true); setIncludePdf(true);
      setSourceCandidates([]); setConvFound(null);
      setAiFilled(new Set()); setAiNotice(null); setAiConfirm(null); setAiOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!canTax && taxOn) setTaxOn(false);
  }, [canTax, taxOn]);

  // 채팅방이 없으면 sendChat 자동 끔
  useEffect(() => {
    if (!conversation && sendChat) setSendChat(false);
  }, [conversation, sendChat]);

  const clientOptions: PlanQSelectOption[] = useMemo(() => clients.map(c => {
    const base = c.is_business
      ? `${c.display_name || c.company_name || ''}${c.biz_name ? ` (${c.biz_name})` : ''}`
      : `${c.display_name || c.company_name || '—'} (${t('newInvoice.to.individual', { defaultValue: '개인' }) as string})`;
    // 초대 수락 전 고객도 청구 가능 — 식별되도록 "초대중" 표시
    //   Q sale 문의 고객(prospect)도 공개 결제 링크로 청구할 수 있다. 정식 고객과 구별되게 따로 표시한다
    //   (라벨이 없으면 "초대중" 도 아니고 아무 표시도 없어 정식 고객처럼 보인다 — 상태값 규약).
    //   2026-10-23 — 관계 글자는 한 벌(utils/clientLabel · 서버 access_kind). 응답에 없을 때만 옛 태그.
    const rel = accessLabel(c.access_kind, tSale);
    const tag = rel ? ` · ${rel}` : c.status === 'invited' ? ` · ${t('newInvoice.to.invitedTag', { defaultValue: '초대중' }) as string}`
      : c.status === 'prospect' ? ` · ${t('newInvoice.to.prospectTag', { defaultValue: '문의 고객' }) as string}` : '';
    return { value: c.id, label: `${base}${tag}` };
  }), [clients, t, tSale]);

  // 프로젝트 고르기 — 고른 고객이 연결된 프로젝트만(서버 client-options 가 Q sale 과 같은 술어로 싣는다).
  //   지금 값이 목록에 없으면(프로젝트에서 열었는데 아직 목록이 안 왔다 등) 그 값을 지우지 않고 보여 준다.
  const projectOptions: PlanQSelectOption[] = useMemo(() => {
    const list = (client?.projects || []).map(p => ({ value: p.id, label: p.name }));
    if (projectId && !list.some(o => o.value === projectId)) list.unshift({ value: projectId, label: projectName || `#${projectId}` });
    return list;
  }, [client, projectId, projectName]);
  /** 사람이 고객을 바꾸면 — 새 고객이 연결 안 된 프로젝트는 비운다(서버가 client_not_in_project 로 거절한다) */
  const pickClient = (nextId: number | null) => {
    unmarkAi('client');
    setClientId(nextId);
    setSourcePostId(null);
    setOverrideBiz({});
    const next = nextId ? clients.find(c => c.id === nextId) : null;
    if (projectId && next && !(next.projects || []).some(p => p.id === projectId)) { setProjectId(null); setProjectName(''); }
  };

  // 서명 상태를 라벨에 붙인다 — 없으면 서명한 계약서가 복사본·초안과 구별되지 않아 «서명한 것이 없다» 로 보였다(2026-10-23)
  const sourceOptions: PlanQSelectOption[] = useMemo(() => sourceCandidates.map(p => {
    const signTag = !p.sign ? ''
      : p.sign.state === 'completed' ? ` · ${t('newInvoice.source.signedTag', { defaultValue: '서명 완료' }) as string}`
        : ` · ${t('newInvoice.source.signingTag', { defaultValue: '서명 {{signed}}/{{total}}', signed: p.sign.signed, total: p.sign.total }) as string}`;
    return {
      value: p.id,
      label: `[${p.category ? t(`kind.${p.category}`, { defaultValue: p.category }) : t('kind.document', { defaultValue: '문서' })}] ${p.title}${signTag}`,
    };
  }), [sourceCandidates, t]);

  // ─── 액션 ───
  // 프로젝트가 정해지면 초안 재료를 가져온다. 실패는 조용히 무시 — 없으면 안 보여주면 그만이다.
  useEffect(() => {
    let alive = true;
    if (!projectId) { setDraft(null); return; }
    (async () => {
      try {
        // 이 파일은 apiFetch 를 동적 import 로 쓴다(위 effect 들과 같은 방식).
        const { apiFetch } = await import('../../contexts/AuthContext');
        const r = await apiFetch(`/api/projects/${projectId}/billing-draft`);
        if (!r.ok) { if (alive) setDraft(null); return; }
        const j = await r.json();
        if (alive) setDraft(j?.success ? j.data : null);
      } catch { if (alive) setDraft(null); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  /** 직전 청구 항목을 그대로 채운다(월정액 반복 청구). 비어 있던 첫 행은 버린다. */
  const applyLastItems = () => {
    if (!draft?.last_items?.length) return;
    const rows = draft.last_items.map((it, i) => ({
      id: Date.now() + i, description: it.description, detail: it.detail,
      quantity: it.quantity, unit_price: it.unit_price,
    }));
    setItems(prev => {
      const kept = prev.filter(x => x.description.trim() || x.unit_price > 0);
      return [...kept, ...rows];
    });
  };

  /** 기록된 시간을 항목 한 줄로 덧붙인다. **단가는 비워 둔다** — 사람이 정한다. */
  const applyTimeItem = () => {
    const h = draft?.time?.hours || 0;
    if (h <= 0) return;
    setItems(prev => {
      const kept = prev.filter(x => x.description.trim() || x.unit_price > 0);
      return [...kept, {
        id: Date.now(),
        description: t('newInvoice.draft.timeItemDesc', { defaultValue: '작업 시간' }) as string,
        detail: '', quantity: h, unit_price: 0,
      }];
    });
  };

  const addItem = () => setItems(arr => [...arr, { id: Date.now(), description: '', detail: '', quantity: 1, unit_price: 0 }]);
  const updateItem = (id: number, patch: Partial<Item>) => {
    unmarkAi('items');
    setItems(arr => arr.map(it => it.id === id ? { ...it, ...patch } : it));
  };

  /** [AI 작성] 결과를 폼에 넣는다 — 빈 칸은 그냥, 값이 있는 칸이 바뀌면 한 번 묻는다(§7-9).
   *  순서: 고객 → 출처 문서 → 나머지(pickClient 가 출처·프로젝트를 비운다). 프로젝트는 AI 가 정하지 않는다. */
  const applyAiDraft = (d: InvoiceAiDraft, pickedClientId: number | null) => {
    const nextClientId = pickedClientId ?? d.client.match_id;
    const guess = !nextClientId ? d.client.guess : null;
    const guessName = guess ? (guess.company || guess.name || '') : '';
    const hasItems = items.some(x => x.description.trim() || x.unit_price > 0);
    const changed: string[] = [];
    if (nextClientId && clientId && nextClientId !== clientId && recipientMode === 'client') changed.push(t('newInvoice.ai.field.client') as string);
    if (guess && recipientMode === 'external' && extName.trim() && guessName && extName.trim() !== guessName) changed.push(t('newInvoice.ai.field.client') as string);
    if (d.title && title.trim() && title.trim() !== d.title) changed.push(t('newInvoice.ai.field.title') as string);
    if (d.items.length && hasItems) changed.push(t('newInvoice.ai.field.items', { count: d.items.length }) as string);
    if (d.notes && notes.trim() && notes.trim() !== d.notes) changed.push(t('newInvoice.ai.field.notes') as string);
    const run = () => {
      const filled = new Set<string>();
      if (nextClientId) {
        setRecipientMode('client');
        if (nextClientId !== clientId) pickClient(nextClientId);
        filled.add('client');
      } else if (guess) {
        setRecipientMode('external');
        if (guessName) setExtName(guessName);
        if (guess.email) setExtEmail(guess.email);
        if (guess.biz_tax_id) setExtBizNumber(guess.biz_tax_id);
        filled.add('client');
      }
      if (d.source_post_id && (nextClientId || recipientMode === 'client') && !guess) {
        aiSourceTitleSkip.current = d.title ? d.source_post_id : null;
        setSourcePostId(d.source_post_id);
      }
      if (d.title) { setTitle(d.title); filled.add('title'); }
      if (d.currency) setCurrency(d.currency);
      if (d.tax_mode) { setTaxMode(d.tax_mode); filled.add('tax'); }
      if (d.notes) { setNotes(d.notes); filled.add('notes'); }
      if (d.due_days !== null) setDueDate(addDays(issuedAt, d.due_days));
      if (d.items.length) {
        const base = Date.now();
        setItems(d.items.map((it, i) => ({ id: base + i, description: it.description, detail: it.detail || '', quantity: it.quantity, unit_price: it.unit_price ?? 0 })));
        filled.add('items');
      }
      setAiFilled(filled);
      const noPrice = d.items.filter(it => it.unit_price === null).map(it => it.description);
      const mixed = d.items.filter(it => it.vat_basis).map(it => `${it.description} (${t(`newInvoice.ai.basis.${it.vat_basis}`)})`);
      setAiNotice(noPrice.length || mixed.length || d.tax_exempt_hint ? { noPrice, exempt: d.tax_exempt_hint, mixed } : null);
      setAiConfirm(null);
      setAiOpen(false);
    };
    if (changed.length) setAiConfirm({ fields: changed.join(', '), run });
    else run();
  };
  const removeItem = (id: number) => setItems(arr => arr.length === 1 ? arr : arr.filter(it => it.id !== id));

  const addRound = () => {
    const last = rounds[rounds.length - 1];
    setRounds(arr => [...arr, {
      id: Date.now(), label: t('newInvoice.misc.roundSuffix', { n: arr.length + 1, defaultValue: '{{n}}차' }) as string, milestone: '',
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
          label: t('newInvoice.misc.roundSuffix', { n: base.length + i + 1, defaultValue: '{{n}}차' }) as string, milestone: '', rate: 0,
          due_date: addDays(todayStr, 14 * (base.length + i + 1)),
        })),
      ] : base;
      return padded.map((r, i) => ({ ...r, rate: preset[i] || 0 }));
    });
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (recipientMode === 'external') {
      if (!extName.trim()) errs.push(t('newInvoice.validation.extNameRequired', { defaultValue: '받는 분/회사명을 입력하세요' }) as string);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(extEmail.trim())) errs.push(t('newInvoice.validation.extEmailRequired', { defaultValue: '받는 분 이메일을 정확히 입력하세요' }) as string);
    } else if (!clientId) {
      errs.push(t('newInvoice.validation.clientRequired') as string);
    }
    if (!title.trim()) errs.push(t('newInvoice.validation.titleRequired') as string);
    if (items.length === 0 || items.every(it => !it.description.trim())) {
      errs.push(t('newInvoice.validation.itemsRequired') as string);
    }
    if (splitOn && !sumOk) errs.push(t('newInvoice.validation.splitSumWrong') as string);
    return errs;
  };

  const submit = async (asDraft: boolean) => {
    if (!asDraft && !canIssue) return;  // 버튼도 꺼져 있다 — Enter 등 다른 길로 들어와도 서버 403 까지 가지 않게
    if (submitting) return;
    if (!businessId) { setErrors([t('newInvoice.misc.selectWorkspaceFirst', { defaultValue: '워크스페이스를 먼저 선택하세요' }) as string]); return; }
    if (!asDraft) {
      const errs = validate();
      if (errs.length > 0) { setErrors(errs); return; }
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim() || (t('newInvoice.misc.noTitle', { defaultValue: '(제목 없음)' }) as string),
        client_id: recipientMode === 'external' ? null : clientId,
        project_id: projectId,   // 프로젝트에서 발행 시 연결 (거래 단계·프로젝트 청구 집계)
        source_post_id: recipientMode === 'external' ? null : sourcePostId,
        currency,
        vat_rate: vatRate,
        tax_mode: taxMode,
        due_date: dueDate || null,
        // ★ 등록 고객이면 고객 값을 청구서에 **복사하지 않는다** — 받는 쪽은 서버(services/invoiceRecipient)가 지금 고객 값으로 그린다.
        //   복사해 두면 Q sale 에서 상호·메일을 고쳐도 청구서 상세·발송이 옛 값을 썼다(2026-10-23 신고).
        //   남기는 것은 고객에게 **없는 칸**에 넣은 보완 값뿐(고객에 저장을 끈 경우의 이 청구서 몫).
        recipient_email: recipientMode === 'external'
          ? (extEmail.trim() || null)
          : null,
        recipient_business_name: recipientMode === 'external'
          ? (extName.trim() || null)
          : (client?.biz_name ? null : (overrideBiz.biz_name?.trim() || null)),
        recipient_business_number: recipientMode === 'external'
          ? (extBizNumber.trim() || null)
          : (client?.biz_tax_id ? null : (overrideBiz.biz_tax_id?.trim() || null)),
        // 세금계산서 발행 의향 — 토글 ON + 발행 가능(canTax) 일 때만 'tax_invoice'.
        // 결제 완료 후 증빙 발행 큐(receiptsDue)에 자동 편입. 고객이 공개 페이지에서 증빙정보 제출/변경 가능.
        receipt_type: ((taxOn && canTax) ? 'tax_invoice' : 'none') as 'tax_invoice' | 'none',
        notes: notes.trim() || null,
        installment_mode: (splitOn ? 'split' : 'single') as 'split' | 'single',
        installments: splitOn ? rounds.map(r => ({
          label: r.label, percent: r.rate, due_date: r.due_date || null, milestone_ref: r.milestone || null,
        })) : undefined,
        items: items.filter(it => it.description.trim()).map(it => ({ description: it.description, detail: it.detail.trim() || null, quantity: it.quantity, unit_price: it.unit_price })),
      };
      // 누락 보완 값 → 고객 정보(비어 있던 칸만) — 청구서보다 **먼저** 저장한다.
      //   실패하면 여기서 멈추고 알린다(뒤에 하면 청구서는 이미 생겨 다시 누르면 두 장이 된다). 체크를 끄면 청구서에만 남는다.
      if (recipientMode === 'client' && clientId && client && saveOnClient) {
        const patch: Record<string, string> = {};
        for (const k of ['biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address'] as const) {
          const v = (overrideBiz[k] || '').trim();
          if (v && missing.includes(k)) patch[k] = v;
        }
        if (Object.keys(patch).length) {
          try {
            await putClientFields(businessId, clientId, patch);
          } catch {
            setErrors([t('newInvoice.to.saveOnClientFailed', { defaultValue: '고객 정보에 저장하지 못했습니다(고객 수정 권한 필요). «고객 정보에 저장» 을 끄면 이 청구서에만 남깁니다.' }) as string]);
            return;
          }
          setClients(prev => prev.map(c => c.id === clientId ? { ...c, ...patch } : c));
          setOverrideBiz(o => ({ ...o, ...patch }));
        }
      }
      // 편집 모드 = draft 재저장(PUT), 신규 = 생성(POST)
      const created = isEdit
        ? await updateInvoice(businessId, editInvoiceId!, payload)
        : await createInvoice(businessId, payload);
      if (!asDraft) {
        const sent = await sendInvoice(businessId, created.id, {
          send_chat: sendChat && !!conversation,
          send_email: sendEmail,
          message: notes.trim() || undefined,
        });
        // ★ 응답은 "보내기를 걸었다" 는 뜻이다 — 도달 여부가 아니다.
        //   어디로 걸었는지는 우리가 요청한 값으로 안다(서버가 그대로 받는다).
        if (sent?.deliver?.queued) {
          const convId = (sendChat && conversation) ? conversation.id : null;
          setSentResult({
            invoiceId: created.id,
            convId,
            convName: convId ? (conversation?.title || null) : null,
            emailQueued: !!sent.deliver.email,
            emailTo: recipientEmail || null,
          });
          setSubmitting(false);
          return; // 결과 화면 유지
        }
      }
      onClose();
    } catch (err) {
      setErrors([invoiceErrorText(err, t) || (err as Error).message || (t('newInvoice.misc.issueFailed', { defaultValue: '발행 실패' }) as string)]);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  // 발송 결과 화면 — 채팅방 가기 / 닫기
  if (sentResult) {
    return (
      <>
        <Backdrop onClick={onClose} />
        <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('newInvoice.sent.title', '청구서를 발행했습니다') as string} style={{ width: 460 }}>
          <Head>
            <Title>{t('newInvoice.sent.title', '청구서를 발행했습니다')}</Title>
            <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', '닫기') as string}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
            </CloseBtn>
          </Head>
          <SentBody>
            <SentIcon>✓</SentIcon>
            <SentTitle>{t('newInvoice.sent.title', '청구서를 발행했습니다')}</SentTitle>
            <SentList>
              {sentResult.convId && sentResult.convName && (
                <li>{t('newInvoice.sent.chat', '"{{name}}" 채팅방으로 보내는 중입니다', { name: sentResult.convName })}</li>
              )}
              {sentResult.emailQueued && (
                sentResult.emailTo
                  ? <li>{t('newInvoice.sent.email', '{{to}} 로 메일을 보내는 중입니다', { to: sentResult.emailTo })}</li>
                  : <li>{t('newInvoice.sent.emailNoAddr', '고객 이메일로 보내는 중입니다')}</li>
              )}
              <li>{t('newInvoice.sent.note', '발송 결과는 청구서 상세에서 확인할 수 있습니다. 창을 닫아도 계속 진행됩니다.')}</li>
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
      </>
    );
  }

  // 발송 요약 텍스트
  const recipientEmail = recipientMode === 'external'
    ? extEmail.trim()
    : (client?.tax_invoice_email || client?.billing_contact_email || client?.invite_email);
  const deliverSummary: string[] = [];
  if (sendChat && conversation) deliverSummary.push(t('newInvoice.misc.deliverChat', { name: conversation.title || (t('newInvoice.misc.chatRoom', { defaultValue: '채팅방' }) as string), defaultValue: '채팅: {{name}}' }) as string);
  if (sendEmail && recipientEmail) deliverSummary.push(t('newInvoice.misc.deliverEmail', { email: recipientEmail, defaultValue: '이메일: {{email}}' }) as string);
  if (deliverSummary.length === 0 && client) deliverSummary.push(t('newInvoice.misc.deliverPublicOnly', { defaultValue: '공개 링크만 생성 (수동 전달)' }) as string);

  return (
    <>
      <Backdrop onClick={onClose} />
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('newInvoice.title') as string}>
        <Head>
          <Title>{isEdit ? t('newInvoice.editTitle', { defaultValue: '청구서 편집' }) as string : t('newInvoice.title')}</Title>
          {!isEdit && businessId && (
            <HeadAi><AiActionButton onClick={() => setAiOpen(true)} label={t('newInvoice.ai.open') as string} testId="invoice-ai-draft" /></HeadAi>
          )}
          <CloseBtn onClick={onClose} aria-label={t('common.close') as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
          </CloseBtn>
        </Head>

        <Body>
          {aiFilled.size > 0 && (
            <AiBanner data-testid="invoice-ai-banner">
              <div>{t('newInvoice.ai.banner', { fields: [...aiFilled].map(k => t(`newInvoice.ai.field.${k}`, { count: items.length })).join(', ') })}</div>
              {aiNotice?.noPrice.length ? <div>{t('newInvoice.ai.bannerNoPrice', { items: aiNotice.noPrice.join(', ') })}</div> : null}
              {aiNotice?.mixed.length ? <div>{t('newInvoice.ai.bannerMixed', { items: aiNotice.mixed.join(', ') })}</div> : null}
              {aiNotice?.exempt && vatRate > 0 && (
                <div>{t('newInvoice.ai.warn.tax_exempt')}{' '}
                  <AiBannerBtn type="button" data-testid="invoice-ai-zero-tax" onClick={() => setVatRate(0)}>{t('newInvoice.ai.zeroTax')}</AiBannerBtn>
                </div>
              )}
            </AiBanner>
          )}
          {/* ─── 발신 / 수신 ─── */}
          <SectionGrid>
            <Section>
              <SectionLabel>{t('newInvoice.from.title')}</SectionLabel>
              <FromCard>
                <FromName>{businessInfo?.legal_name || businessInfo?.name || '—'}</FromName>
                <FromMeta>
                  <FromMetaRow><FromKey>{t('newInvoice.to.fields.biz_tax_id')}</FromKey><FromVal>{businessInfo?.tax_id || <FieldHole>{t('newInvoice.misc.none')}</FieldHole>}</FromVal></FromMetaRow>
                  <FromMetaRow><FromKey>{t('newInvoice.to.fields.biz_representative')}</FromKey><FromVal>{businessInfo?.representative || <FieldHole>{t('newInvoice.misc.none')}</FieldHole>}</FromVal></FromMetaRow>
                  <FromMetaRow><FromKey>{t('newInvoice.to.fields.biz_address')}</FromKey><FromVal>{businessInfo?.address || <FieldHole>{t('newInvoice.misc.none')}</FieldHole>}</FromVal></FromMetaRow>
                </FromMeta>
                <FromHint>{t('newInvoice.from.auto')}</FromHint>
              </FromCard>
            </Section>

            <Section>
              <SectionLabel>{t('newInvoice.to.title')}</SectionLabel>
              <RecipientModeRow role="tablist">
                <RecipientModeBtn type="button" $active={recipientMode === 'client'}
                  onClick={() => setRecipientMode('client')} role="tab" aria-selected={recipientMode === 'client'}>
                  {t('newInvoice.to.modeClient', { defaultValue: '기존 고객' }) as string}
                </RecipientModeBtn>
                <RecipientModeBtn type="button" $active={recipientMode === 'external'}
                  onClick={() => setRecipientMode('external')} role="tab" aria-selected={recipientMode === 'external'}>
                  {t('newInvoice.to.modeExternal', { defaultValue: '외부 직접 입력' }) as string}
                </RecipientModeBtn>
              </RecipientModeRow>

              {recipientMode === 'client' && (
                <PlanQSelect
                  options={clientOptions}
                  value={clientOptions.find(o => o.value === clientId) || null}
                  onChange={(opt) => pickClient(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={t('newInvoice.to.selectPh') as string}
                  isClearable
                  isSearchable
                />
              )}

              {recipientMode === 'external' && (
                <ExtRecipientCard>
                  <ExtField>
                    <ExtLabel>{t('newInvoice.to.extName', { defaultValue: '받는 분 · 회사명' }) as string}</ExtLabel>
                    <MissingInput value={extName} onChange={e => setExtName(e.target.value)}
                      placeholder={t('newInvoice.to.extNamePh', { defaultValue: '예: 홍길동 / (주)예시' }) as string} />
                  </ExtField>
                  <ExtField>
                    <ExtLabel>{t('newInvoice.to.extEmail', { defaultValue: '이메일' }) as string}</ExtLabel>
                    <MissingInput type="email" value={extEmail} onChange={e => setExtEmail(e.target.value)}
                      placeholder="name@company.com" />
                  </ExtField>
                  <ExtField>
                    <ExtLabel>{t('newInvoice.to.extBizNumber', { defaultValue: '사업자번호 (선택)' }) as string}</ExtLabel>
                    <MissingInput value={extBizNumber} onChange={e => setExtBizNumber(e.target.value)}
                      placeholder="000-00-00000" />
                  </ExtField>
                  <BizRegRow>
                    {businessId && <BizRegReadButton businessId={businessId} door="invoice" testId="invoice-ext-bizreg-read" onRead={applyBizReg} />}
                    {bizRegMsg && <BizRegMsg role="status">{bizRegMsg}</BizRegMsg>}
                  </BizRegRow>
                  <ExtHint>{t('newInvoice.to.extHint', { defaultValue: '초대 없이 입력한 이메일로 청구서를 발송합니다. 공개 결제 링크로 결제·확인이 가능합니다.' }) as string}</ExtHint>
                </ExtRecipientCard>
              )}

              {recipientMode === 'client' && client && (
                <ToCard>
                  {client.is_business ? (
                    <>
                      <ToName>{(client.biz_name || overrideBiz.biz_name) || '—'}</ToName>
                      <FromMeta>
                        <FromMetaRow>
                          <FromKey>{t('newInvoice.to.fields.biz_tax_id')}</FromKey>
                          <FromVal>{overrideBiz.biz_tax_id || client.biz_tax_id || <FieldHole>{t('newInvoice.misc.none')}</FieldHole>}</FromVal>
                        </FromMetaRow>
                        <FromMetaRow>
                          <FromKey>{t('newInvoice.to.fields.biz_representative')}</FromKey>
                          <FromVal>{overrideBiz.biz_ceo || client.biz_ceo || <FieldHole>{t('newInvoice.misc.none')}</FieldHole>}</FromVal>
                        </FromMetaRow>
                        <FromMetaRow>
                          <FromKey>{t('newInvoice.to.fields.biz_address')}</FromKey>
                          <FromVal>{overrideBiz.biz_address || client.biz_address || client.biz_address_en || <FieldHole>{t('newInvoice.misc.none')}</FieldHole>}</FromVal>
                        </FromMetaRow>
                      </FromMeta>

                      {missing.length > 0 && (
                        <MissingPanel>
                          <MissingHead>
                            <MissingIcon>!</MissingIcon>
                            <MissingTitle>{t('newInvoice.to.missingTitle')}</MissingTitle>
                          </MissingHead>
                          <MissingDesc>{t('newInvoice.to.missingDesc')}</MissingDesc>
                          <BizRegRow>
                            {businessId && <BizRegReadButton businessId={businessId} door="invoice" testId="invoice-bizreg-read" onRead={applyBizReg} />}
                            {bizRegMsg && <BizRegMsg role="status">{bizRegMsg}</BizRegMsg>}
                          </BizRegRow>
                          <MissingFields>
                            {missing.includes('biz_name') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_name')}</MissingLabel>
                                <MissingInput value={overrideBiz.biz_name || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_name: e.target.value }))} />
                              </MissingField>
                            )}
                            {missing.includes('biz_tax_id') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_tax_id')}</MissingLabel>
                                <MissingInput placeholder="000-00-00000" value={overrideBiz.biz_tax_id || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_tax_id: e.target.value }))} />
                              </MissingField>
                            )}
                            {missing.includes('biz_ceo') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_representative')}</MissingLabel>
                                <MissingInput value={overrideBiz.biz_ceo || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_ceo: e.target.value }))} />
                              </MissingField>
                            )}
                            {missing.includes('biz_address') && (
                              <MissingField>
                                <MissingLabel>{t('newInvoice.to.fields.biz_address')}</MissingLabel>
                                <MissingInput value={overrideBiz.biz_address || ''} onChange={e => setOverrideBiz(o => ({ ...o, biz_address: e.target.value }))} />
                              </MissingField>
                            )}
                          </MissingFields>
                          <SaveOnClient>
                            <SaveOnClientCheck type="checkbox" checked={saveOnClient} onChange={e => setSaveOnClient(e.target.checked)} /> {t('newInvoice.to.saveOnClient')}
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

          {/* 프로젝트 — 기존 고객이면 그 고객의 프로젝트 중에서 고른다(2026-10-16: 옛엔 프로젝트에서 열 때만 붙어
               Q Bill 에서 바로 만든 청구서는 프로젝트 «거래» 탭에 안 보였다) */}
          {recipientMode === 'client' && client && (
            <Section data-testid="invoice-project-section">
              <SectionLabel>{t('newInvoice.project.label') as string}</SectionLabel>
              {projectOptions.length === 0 ? (
                <SourceEmpty>{t('newInvoice.project.noProjects') as string}</SourceEmpty>
              ) : (
                <>
                  <SourceHint>{t('newInvoice.project.hint') as string}</SourceHint>
                  <PlanQSelect
                    options={projectOptions}
                    value={projectOptions.find(o => o.value === projectId) || null}
                    onChange={(opt) => {
                      const o = opt as PlanQSelectOption | null;
                      setProjectId(o ? Number(o.value) : null);
                      setProjectName(o ? String(o.label) : '');
                    }}
                    placeholder={t('newInvoice.project.none') as string}
                    isClearable
                    isSearchable
                  />
                </>
              )}
            </Section>
          )}

          {/* 프로젝트 연결 표시 — 외부 수신자인데 프로젝트에서 발행했을 때 */}
          {recipientMode === 'external' && projectId && (
            <ProjectLink>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              {t('newInvoice.projectLinked', { defaultValue: '이 청구서는 프로젝트에 연결됩니다' }) as string}
              {projectName && <ProjectName>{projectName}</ProjectName>}
            </ProjectLink>
          )}

          {/* ─── 출처 문서 ─── */}
          {client && (
            <Section>
              <SectionLabel>{t('newInvoice.source.title')}</SectionLabel>
              {sourceCandidates.length === 0 ? (
                <SourceEmpty>
                  {t('newInvoice.source.empty')}
                </SourceEmpty>
              ) : (
                <>
                  <SourceHint>{t('newInvoice.source.hint')}</SourceHint>
                  <PlanQSelect
                    options={sourceOptions}
                    value={sourceOptions.find(o => o.value === sourcePostId) || null}
                    onChange={(opt) => setSourcePostId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                    placeholder={t('newInvoice.misc.sourceNone', { defaultValue: '— 선택 (없으면 비워둠) —' }) as string}
                    isClearable
                    isSearchable
                  />
                  {sourcePost && (
                    <SourceBadge>
                      <SourceKindBadge $kind={sourcePost.category || ''}>
                        {sourcePost.category ? t(`kind.${sourcePost.category}`, { defaultValue: sourcePost.category }) : t('kind.document', { defaultValue: '문서' })}
                      </SourceKindBadge>
                      <SourceTitle>{sourcePost.title}</SourceTitle>
                      <SourceMeta>
                        {sourcePost.shared_at && t('newInvoice.source.sharedOn', { date: sourcePost.shared_at.split('T')[0] })}
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
                <Input value={title} onChange={e => { unmarkAi('title'); setTitle(e.target.value); }} placeholder={t('newInvoice.compose.titlePh') as string} />
              </Field>
              <Field>
                <FieldLabel>{t('newInvoice.compose.issuedAt')}</FieldLabel>
                <SingleDateField value={issuedAt} onChange={setIssuedAt} size="md" />
              </Field>
              <Field>
                <FieldLabel>{t('newInvoice.compose.dueDate')}</FieldLabel>
                <SingleDateField value={dueDate} onChange={setDueDate} size="md" />
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
                <FieldLabel htmlFor="new-invoice-tax-rate">{t('newInvoice.compose.vatRate')}</FieldLabel>
                <TaxRateInput id="new-invoice-tax-rate" testId="new-invoice-tax-rate" value={vatRate} onChange={setVatRate} />
              </Field>
              <Field>
                <FieldLabel>{t('tax.mode')}</FieldLabel>
                <TaxModeSelect testId="new-invoice-tax-mode" value={taxMode} onChange={setTaxMode} />
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
            {/* #211 ② — 시간과 직전 청구가 여기까지 오지 못하고 있었다(운영: invoices 에 시간 참조 0건).
                기록률을 같이 보여주는 이유: 실제시간이 든 업무가 26% 뿐이라 숫자만 주면
                **실제보다 적게 청구**하게 된다(memory feedback_actual_hours_focus_only). */}
            {draft && (draft.last_items.length > 0 || draft.time.hours > 0) && (
              <DraftBar>
                {draft.last_items.length > 0 && (
                  <DraftBtn type="button" onClick={applyLastItems}>
                    {t('newInvoice.draft.useLast', { defaultValue: '직전 청구 항목 불러오기' })}
                    <DraftMeta>{t('newInvoice.draft.itemCount', { count: draft.last_items.length })}</DraftMeta>
                  </DraftBtn>
                )}
                {draft.time.hours > 0 && (
                  <DraftBtn type="button" onClick={applyTimeItem}>
                    {t('newInvoice.draft.useTime', { defaultValue: '기록된 시간 추가' })}
                    <DraftMeta>{draft.time.hours}h</DraftMeta>
                  </DraftBtn>
                )}
                {draft.time.hours > 0 && (
                  <DraftNote>
                    {t('newInvoice.draft.coverage', {
                      defaultValue: '업무 {{total}}건 중 {{with}}건에만 시간이 기록돼 있습니다 — 실제보다 적을 수 있습니다',
                      total: draft.time.tasks_total, with: draft.time.tasks_with_time,
                    })}
                  </DraftNote>
                )}
              </DraftBar>
            )}
            <InvoiceItemsTable items={items} currency={currency} onUpdate={updateItem} onRemove={removeItem}
              basis={vatRate > 0 ? (taxMode === 'inclusive' ? t('tax.tag.included', { label: taxLabel }) : t('tax.tag.excluded', { label: taxLabel })) as string : null} />
            <InvoiceTotals subtotal={subtotal} vat={vat} total={total} vatRate={vatRate} currency={currency} taxLabel={taxLabel} />
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
              <InvoiceSplitArea
                rounds={rounds} total={total} currency={currency} sumOk={sumOk} sumPercent={sumPercent}
                onPreset={applyPreset} onUpdate={updateRound} onRemove={removeRound} onAdd={addRound}
              />
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
                    {currency !== 'KRW'
                      ? t('newInvoice.tax.foreignBlocked', { defaultValue: '외화 청구서는 세금계산서 발행 대상이 아닙니다' }) as string
                      : taxOn
                        ? (taxHasBizInfo
                            ? t('newInvoice.tax.toggleDescOn') as string
                            : t('newInvoice.tax.toggleDescNeedClient', { defaultValue: '사업자정보(상호·사업자번호)는 결제 후 고객이 공개 결제페이지에서 입력합니다' }) as string)
                        : t('newInvoice.tax.toggleDescHint', { defaultValue: '켜면 결제 완료 후 세금계산서 발행 대기 큐에 자동 추가됩니다' }) as string}
                  </ToggleDesc>
                  {/* 세금을 끈 워크스페이스에서 세금계산서 — 판정은 그대로, 경고 한 줄(Fable 고칠 점 10) */}
                  {taxOn && canTax && !!businessInfo && !isTaxEnabled(businessInfo.tax_enabled) && (
                    <ToggleDesc data-testid="new-invoice-tax-off-warn" style={{ color: '#B45309' }}>{t('tax.receiptWarn')}</ToggleDesc>
                  )}
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
              <SectionLabel>{t('newInvoice.deliverOpts.title')}</SectionLabel>
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
                    <DeliverTitle>{t('newInvoice.deliverOpts.chat')}</DeliverTitle>
                    <DeliverTarget>
                      {conversation ? (
                        <>→ <strong>{conversation.title || (t('newInvoice.misc.chatRoom', { defaultValue: '채팅방' }) as string)}</strong></>
                      ) : (
                        <NoChannelHint>{t('newInvoice.deliverOpts.noChat')} · <NoChannelLink>{t('newInvoice.deliverOpts.createChat')}</NoChannelLink></NoChannelHint>
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
                    <DeliverTitle>{t('newInvoice.deliverOpts.email')}</DeliverTitle>
                    <DeliverTarget>→ <strong>{recipientEmail || (t('newInvoice.misc.noEmail', { defaultValue: '이메일 없음' }) as string)}</strong></DeliverTarget>
                    {sendEmail && (
                      <PdfToggle>
                        <input type="checkbox" checked={includePdf} onChange={e => setIncludePdf(e.target.checked)} />
                        <span>{t('newInvoice.deliverOpts.attachPdf')}</span>
                      </PdfToggle>
                    )}
                  </DeliverBody>
                </DeliverRow>

                {/* 공개 링크 */}
                <DeliverRow>
                  <DeliverCheck type="checkbox" checked disabled />
                  <DeliverIcon $color="#14B8A6">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                  </DeliverIcon>
                  <DeliverBody>
                    <DeliverTitle>{t('newInvoice.deliverOpts.publicLink')}</DeliverTitle>
                    <DeliverTarget>→ {t('newInvoice.deliverOpts.publicLinkTarget')}</DeliverTarget>
                  </DeliverBody>
                </DeliverRow>
              </DeliverList>
            </Section>
          )}

          {/* 발행 권한 안내 — 버튼만 꺼 두면 폰에서는 이유가 안 보인다(title 은 터치에서 안 뜨고 바닥줄 요약은 폰에서 숨는다) */}
          {!canIssue && (
            <OwnerOnlyNote data-testid="invoice-owner-only-hint">{t('newInvoice.ownerOnlyIssue') as string}</OwnerOnlyNote>
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
              {canIssue && client && (sendChat || sendEmail) ? (
                <FooterSumText>{t('newInvoice.deliverOpts.after', { list: deliverSummary.join(' · ') })}</FooterSumText>
              ) : null}
            </FooterSummary>
            <SecondaryBtn type="button" onClick={() => submit(true)} disabled={submitting}>
              {isEdit ? t('newInvoice.actions.saveChanges', { defaultValue: '변경 저장' }) as string : t('newInvoice.actions.saveDraft')}
            </SecondaryBtn>
            <PrimaryBtn type="button" onClick={() => submit(false)} disabled={submitting || !canIssue}
              title={!canIssue ? (t('newInvoice.ownerOnlyIssue') as string) : undefined} data-testid="invoice-issue">
              {submitting ? '...' : (sendChat || sendEmail ? t('newInvoice.actions.issueAndSend') : t('newInvoice.actions.issue'))}
            </PrimaryBtn>
          </FooterRight>
        </Footer>
      </Dialog>
      {businessId && (
        <InvoiceAiDraftModal open={aiOpen} onClose={() => setAiOpen(false)} businessId={businessId} clientOptions={clientOptions}
          fixedClientId={recipientMode === 'client' ? clientId : null} currency={currency} onApply={applyAiDraft} />
      )}
      <ConfirmDialog isOpen={!!aiConfirm} onClose={() => setAiConfirm(null)} onConfirm={() => aiConfirm?.run()}
        title={t('newInvoice.ai.confirmTitle') as string} message={t('newInvoice.ai.confirmMsg', { fields: aiConfirm?.fields || '' }) as string}
        confirmText={t('newInvoice.ai.confirmOk') as string} cancelText={t('newInvoice.actions.cancel') as string} variant="warning" />
    </>
  );
}

// ─── styled ───
const HeadAi = styled.div`margin-right: 8px; display: flex; align-items: center;`;
const AiBanner = styled.div`
  display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; margin-bottom: 4px;
  border-radius: 8px; background: #FFF7ED; border: 1px solid #FED7AA; font-size: 0.75rem; color: #9A3412; line-height: 1.5;
`;
const AiBannerBtn = styled.button`
  border: 1px solid #FDBA74; background: #fff; color: #9A3412; border-radius: 6px; padding: 2px 8px; font-size: 0.75rem; cursor: pointer;
`;
const Backdrop = styled.div`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0; background: rgba(15, 23, 42, 0.08); z-index: 1000;
`;
const Dialog = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 1010; width: 880px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px);
  background: #fff; border-radius: 14px; box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.25);
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 640px) {
    top: calc(var(--pq-chrome-bottom, 56px) + 14px); bottom: auto; left: 16px; right: 16px;
    transform: none; width: auto; max-width: none;
    /* 키보드 시 visual viewport(--vvh)로 높이 제한 → 하단 입력·버튼 안 가림 (운영 #23) */
    max-height: calc(var(--vvh, 100vh) - 90px);
  }
`;
const Head = styled.div`
  display: flex; align-items: center; padding: 14px 18px;
  border-bottom: 1px solid #E2E8F0; flex-shrink: 0;
`;
const Title = styled.h2`
  flex: 1; font-size: 0.9375rem; font-weight: 700; color: #0F172A; letter-spacing: -0.1px; margin: 0;
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 30px; height: 30px; border: none; background: transparent; color: #64748B;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
// 발송 결과 화면
const SentBody = styled.div`
  padding: 28px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px;
`;
const SentIcon = styled.div`
  width: 56px; height: 56px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: #F0FDF4; color: #15803D; font-size: 1.75rem; font-weight: 700;
`;
const SentTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const SentList = styled.ul`
  margin: 4px 0; padding: 0 0 0 0;
  list-style: none; display: flex; flex-direction: column; gap: 6px;
  font-size: 0.8125rem; color: #475569; text-align: center;
  & li { padding: 6px 12px; background: #F8FAFC; border-radius: 8px; }
`;
const SentActions = styled.div`
  display: flex; gap: 8px; justify-content: center; margin-top: 8px;
`;
const SentSecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 0.8125rem; font-weight: 600; color: #0F766E;
  background: #fff; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  &:hover { background: #F0FDFA; }
`;
const SentPrimaryBtn = styled.button`
  padding: 9px 16px; font-size: 0.8125rem; font-weight: 600; color: #fff;
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
  font-size: 0.6875rem; color: #64748B; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SectionGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;
const FromCard = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FromName = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A; margin-bottom: 4px;`;
const FromMeta = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FromMetaRow = styled.div`display: flex; gap: 6px; font-size: 0.75rem;`;
const FromKey = styled.span`color: #94A3B8; min-width: 60px; flex-shrink: 0;`;
const FromVal = styled.span`color: #334155; flex: 1; min-width: 0;`;
const FromHint = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-top: 4px;`;
const ToCard = styled.div`display: flex; flex-direction: column; gap: 6px; margin-top: 4px;`;
const ToName = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A; margin-bottom: 4px;`;
const FieldHole = styled.span`color: #DC2626; font-size: 0.6875rem; font-weight: 500;`;
const NoBizMsg = styled.div`
  font-size: 0.75rem; color: #64748B;
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
  background: #F59E0B; color: #fff; font-size: 0.6875rem; font-weight: 700;
`;
const MissingTitle = styled.div`font-size: 0.75rem; font-weight: 700; color: #92400E;`;
const MissingDesc = styled.div`font-size: 0.6875rem; color: #92400E; line-height: 1.5; margin-bottom: 8px;`;
const MissingFields = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const MissingField = styled.div`display: flex; flex-direction: column; gap: 3px;`;
const MissingLabel = styled.label`font-size: 0.6875rem; font-weight: 600; color: #92400E;`;
const MissingInput = styled.input`
  width: 100%; padding: 6px 8px; font-size: 0.75rem; color: #0F172A;
  background: #fff; border: 1px solid #FDE68A; border-radius: 6px;
  &:focus { outline: none; border-color: #F59E0B; }
`;
// 외부 수신자 직접 입력 (운영 #1)
const RecipientModeRow = styled.div`display: inline-flex; gap: 4px; margin-bottom: 8px; background: #F1F5F9; border-radius: 8px; padding: 3px;`;
const RecipientModeBtn = styled.button<{ $active: boolean }>`
  padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  transition: all 0.15s;
`;
const ExtRecipientCard = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px; border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC;
`;
const ExtField = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const ExtLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #334155;`;
const ExtHint = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.5;`;
const SaveOnClient = styled.label`
  display: flex; align-items: center; gap: 6px;
  font-size: 0.6875rem; color: #92400E; margin-top: 8px; cursor: pointer;
`;
const SaveOnClientCheck = styled.input`accent-color: #F59E0B; cursor: pointer;`;
const DraftBar = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin: 0 0 10px; padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
`;
const DraftBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 36px; padding: 0 12px; border-radius: 6px;
  border: 1px solid #14B8A6; background: #fff; color: #0F766E;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover { background: #CCFBF1; }
`;
const DraftMeta = styled.span`font-size: 0.75rem; font-weight: 500; color: #64748B;`;
const DraftNote = styled.div`
  flex-basis: 100%; font-size: 0.75rem; line-height: 1.5; color: #64748B;
`;

const BankAuto = styled.div`
  display: flex; flex-direction: column; gap: 3px; padding: 12px 14px;
  background: #F8FAFC; border-radius: 8px;
`;
const BankAutoTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const BankAutoSub = styled.div`font-size: 0.6875rem; color: #64748B;`;
const OwnerOnlyNote = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;
  font-size: 0.75rem; color: #475569; line-height: 1.5;
`;
const ErrorPanel = styled.div`
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px;
`;
const ErrorRow = styled.div`font-size: 0.75rem; color: #991B1B; font-weight: 600;`;
const PrimaryBtn = styled.button`
  padding: 9px 18px; font-size: 0.8125rem; font-weight: 700;
  background: #14B8A6; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 0.8125rem; font-weight: 600;
  background: #fff; color: #334155; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// 출처 문서
const SourceEmpty = styled.div`
  font-size: 0.75rem; color: #64748B; padding: 8px 10px; background: #F8FAFC; border-radius: 6px;
`;
const SourceHint = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const ProjectLink = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
`;
const ProjectName = styled.span`
  font-weight: 700; color: #0F172A;
  &::before { content: '· '; color: #94A3B8; font-weight: 400; }
`;
const SourceBadge = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
`;
const SourceKindBadge = styled.span<{ $kind: string }>`
  font-size: 0.625rem; font-weight: 700;
  padding: 3px 8px; border-radius: 4px;
  background: ${p =>
    p.$kind === 'contract' ? '#FEF3C7' :
    p.$kind === 'quote' ? '#E0F2FE' :
    p.$kind === 'sow' ? '#F0FDFA' :
    '#FEE2E2'};
  color: ${p =>
    p.$kind === 'contract' ? '#92400E' :
    p.$kind === 'quote' ? '#0284C7' :
    p.$kind === 'sow' ? '#6B21A8' :
    '#991B1B'};
`;
const SourceTitle = styled.div`flex: 1; font-size: 0.8125rem; font-weight: 600; color: #0F172A; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const SourceMeta = styled.div`font-size: 0.6875rem; color: #64748B; flex-shrink: 0;`;

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
const DeliverTitle = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const DeliverTarget = styled.div`font-size: 0.75rem; color: #64748B;`;
const NoChannelHint = styled.span`color: #92400E;`;
const NoChannelLink = styled.span`color: #0F766E; font-weight: 600; cursor: pointer; &:hover { text-decoration: underline; }`;
const PdfToggle = styled.label`
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 0.6875rem; color: #475569; margin-top: 4px;
  input { accent-color: #14B8A6; }
`;

const BizRegRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0 8px;`;
const BizRegMsg = styled.span`font-size: 0.75rem; color: #B45309;`;
