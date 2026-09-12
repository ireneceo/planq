// pages/QSale/SalePage.tsx — Q sale 목록 (docs/Q_SALE_DESIGN.md §5.2)
//   관리 리스트 패턴(PageShell) — 고객 관리 목록과 같은 규격.
//   ★ 접근 종류·한도 포함 여부는 서버가 준 값만 쓴다(화면이 user_id 로 판정하지 않는다).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import PageShell from '../../components/Layout/PageShell';
import ClientPanel from '../../components/QSale/ClientPanel';
import ClientLink from '../../components/QSale/ClientLink';
import PlanQSelect from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import StandardModal from '../../components/Common/StandardModal';
import LetterAvatar from '../../components/Common/LetterAvatar';
// ★ 2026-09-12 Irene: "상세(채팅, 메일, 전화, 등등) > 고객 이렇게 들어가야지 · 상담리스트, 고객리스트 2가지 다 보여줘도 좋고"
//   입구를 상담(고객 미등록 문의)으로 바꾸고 고객 목록은 옆 탭으로 둔다. 목록·액션은 SaleInboxList 한 곳.
import SaleInboxList from '../../components/QSale/SaleInboxList';
import AiActionButton from '../../components/Common/AiActionButton';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import {
  listSaleClients, getSaleSummary, saveAsClient, extractInquiry,
  SALE_STAGES, IN_PROGRESS_STAGES, SALE_SOURCES, INTERACTION_KINDS,
  type SaleClient, type SaleSummary, type SaleStage, type AccessKind, type SaleSource,
  type InteractionKind,
} from '../../services/sale';

const PAGE = 50;

export default function SalePage() {
  const { t } = useTranslation('qsale');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { formatTimeAgo, formatDateTime } = useTimeFormat();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [items, setItems] = useState<SaleClient[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<SaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  // 입구는 상담(고객 미등록 문의)이다 — 고객 목록은 옆 탭. Irene 2026-09-12
  const [tab, setTab] = useState<'inbox' | 'clients'>('inbox');
  const [stage, setStage] = useState<string>('');
  const [access, setAccess] = useState<string>('');
  const [assignee, setAssignee] = useState<string>('');
  const [addOpen, setAddOpen] = useState(false);
  // ★ 행을 눌러도 **페이지를 갈아타지 않는다** (Irene 2026-09-12: "고객탭에서는 리스트 누르면
  //   페이지 전환하지 말고 우측패널 나오게 하고"). 전체를 보려면 패널 헤더의 전체보기 아이콘.
  const [panelClientId, setPanelClientId] = useState<number | null>(null);

  const filters = useMemo(() => ({ q, stage, access, assignee }), [q, stage, access, assignee]);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async (opts: { silent?: boolean; page?: number } = {}) => {
    if (!businessId) return;
    const p = opts.page || 1;
    if (!opts.silent) setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        listSaleClients(businessId, { ...filtersRef.current, limit: PAGE, page: p }),
        p === 1 ? getSaleSummary(businessId) : Promise.resolve(null),
      ]);
      setItems((prev) => (p === 1 ? list.items : [...prev, ...list.items]));
      setTotal(list.total);
      setHasMore(list.hasMore);
      setPage(p);
      if (sum) setSummary(sum);
      setError(null);
    } catch {
      setError('load_failed');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  // 검색·필터는 300ms 디바운스 (타이핑마다 서버를 치지 않는다)
  useEffect(() => {
    const h = window.setTimeout(() => { load({ page: 1 }); }, q ? 300 : 0);
    return () => window.clearTimeout(h);
  }, [q, stage, access, assignee, load]);

  // 실시간 — 다른 사람이 고객을 저장·수정하면 즉시 반영 (CLAUDE.md 운영 안정성 16)
  const silentLoad = useCallback(() => { load({ silent: true, page: 1 }); }, [load]);
  useEffect(() => {
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    };
    const offs = [
      onSocket('client:new', debounced),
      onSocket('client:updated', debounced),
      onSocket('interaction:new', debounced),
      onSocket('interaction:updated', debounced),
      onSocket('interaction:deleted', debounced),
    ];
    return () => { if (pending) window.clearTimeout(pending); offs.forEach((off) => off()); };
  }, [silentLoad]);
  useVisibilityRefresh(silentLoad);

  const quotaLabel = summary ? t('quota.header', {
    clients: summary.quota.clients,
    clients_max: summary.quota.clients_max ?? (t('quota.unlimited', { defaultValue: '무제한' }) as string),
    prospects: summary.quota.prospects,
    prospects_max: summary.quota.prospects_max ?? (t('quota.unlimited', { defaultValue: '무제한' }) as string),
  }) as string : '';

  const stageOptions = useMemo(() => ([
    { value: '', label: t('list.filterAll') as string },
    { value: 'in_progress', label: t('list.stageInProgress') as string },
    ...SALE_STAGES.map((s) => ({ value: s, label: t(`stage.${s}`) as string })),
  ]), [t]);
  const accessOptions = useMemo(() => ([
    { value: '', label: t('list.filterAll') as string },
    { value: 'guest', label: t('access.guest') as string },
    { value: 'invited', label: t('access.invited') as string },
    { value: 'member', label: t('access.member') as string },
  ]), [t]);
  const assigneeOptions = useMemo(() => {
    const names = new Map<number, string>();
    for (const c of items) if (c.assigned_member) names.set(c.assigned_member.id, c.assigned_member.name);
    return [
      { value: '', label: t('list.filterAll') as string },
      { value: 'none', label: t('list.assigneeNone') as string },
      ...[...names.entries()].map(([id, name]) => ({ value: String(id), label: name })),
    ];
  }, [items, t]);

  return (
    <PageShell
      title={t('page.title') as string}
      count={summary ? summary.in_progress : undefined}
      actions={(
        <Actions>
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('list.searchPlaceholder') as string}
            aria-label={t('list.searchPlaceholder') as string} />
          {/* ★ 필터는 헤더가 아니라 **탭 아래**다 (Irene 2026-09-12: "필터는 원래 탭 아래 있는 거 아니야?
              왜 우측 상단에 있어?"). 헤더에는 검색과 새로 만들기만 남긴다 — 목록 페이지 공통 규격. */}
          <ActionButton tone="primary" size="sm" data-testid="sale-add-inquiry" onClick={() => setAddOpen(true)}>
            {t('action.addInquiry') as string}
          </ActionButton>
        </Actions>
      )}
    >
      {/* 탭 — 상담이 기본, 고객은 옆. "상담 > 고객" 순서가 실제 일의 순서다 (Irene 2026-09-12) */}
      <TabRow role="tablist">
        <TabBtn type="button" role="tab" aria-selected={tab === 'inbox'} data-testid="sale-tab-inbox"
          $on={tab === 'inbox'} onClick={() => setTab('inbox')}>
          {t('list.tabInbox') as string}
        </TabBtn>
        <TabBtn type="button" role="tab" aria-selected={tab === 'clients'} data-testid="sale-tab-clients"
          $on={tab === 'clients'} onClick={() => setTab('clients')}>{/* 필터는 이 줄 아래에 온다 */}
          {t('list.tabClients') as string}
        </TabBtn>
      </TabRow>

      {tab === 'inbox' ? (
        businessId ? (
          <SaleInboxList businessId={businessId} q={q} onRegistered={() => load({ silent: true, page: 1 })} />
        ) : null
      ) : (
      <>
      {/* ★ 필터는 **탭 아래** (Irene 2026-09-12: "필터는 원래 탭 아래 있는 거 아니야? 왜 우측 상단에 있어?").
          단계·접근·담당자는 고객 목록의 축이라 이 탭에서만 그린다. */}
      <FilterRow data-testid="sale-filter-row">
        <SelectWrap $w={150} data-testid="sale-stage-filter">
          <PlanQSelect size="sm" isSearchable={false} options={stageOptions}
            aria-label={t('stage.label') as string}
            value={stageOptions.find((o) => o.value === stage) || stageOptions[0]}
            onChange={(opt: unknown) => setStage(String((opt as { value?: string } | null)?.value ?? ''))} />
        </SelectWrap>
        <SelectWrap $w={130} data-testid="sale-access-filter">
          <PlanQSelect size="sm" isSearchable={false} options={accessOptions}
            aria-label={t('access.label') as string}
            value={accessOptions.find((o) => o.value === access) || accessOptions[0]}
            onChange={(opt: unknown) => setAccess(String((opt as { value?: string } | null)?.value ?? ''))} />
        </SelectWrap>
        <SelectWrap $w={140} data-testid="sale-assignee-filter">
          <PlanQSelect size="sm" isSearchable={false} options={assigneeOptions}
            aria-label={t('list.assignee') as string}
            value={assigneeOptions.find((o) => o.value === assignee) || assigneeOptions[0]}
            onChange={(opt: unknown) => setAssignee(String((opt as { value?: string } | null)?.value ?? ''))} />
        </SelectWrap>
      </FilterRow>
      {summary && (
        <StripRow>
          <StageStrip>
            {/* ★ 2026-09-12 Irene: "Q sales 가면 전체가 없어" — 설계 §5.2 는 "전체 칩 항상" 이었는데 구현에서 빠졌다.
                칩으로 필터를 건 뒤 전체로 돌아갈 길이 같은 칩 재클릭뿐이라, 무엇을 보고 있는지도 알 수 없었다. */}
            <StageChip type="button" data-testid="sale-stage-chip-all"
              $on={stage === ''}
              onClick={() => setStage('')}>
              {t('list.filterAll') as string} <b>{total}</b>
            </StageChip>
            <Divider aria-hidden />
            {IN_PROGRESS_STAGES.map((s) => (
              <StageChip key={s} type="button" data-testid={`sale-stage-chip-${s}`}
                $on={stage === s}
                title={t(`stage.${s}_hint`) as string}
                onClick={() => setStage((prev) => (prev === s ? '' : s))}>
                {t(`stage.${s}`) as string} <b>{summary.stage_counts[s] ?? 0}</b>
              </StageChip>
            ))}
            <Divider aria-hidden />
            <StageChip type="button" $on={stage === 'won'} title={t('stage.won_hint') as string}
              onClick={() => setStage((prev) => (prev === 'won' ? '' : 'won'))}>
              {t('stage.won') as string} <b>{summary.this_month.won}</b>
            </StageChip>
            <StageChip type="button" $on={stage === 'lost'} title={t('stage.lost_hint') as string}
              onClick={() => setStage((prev) => (prev === 'lost' ? '' : 'lost'))}>
              {t('stage.lost') as string} <b>{summary.this_month.lost}</b>
            </StageChip>
            <Divider aria-hidden />
            <StageChip type="button" $on={stage === 'none'} title={t('stage.none_hint') as string}
              onClick={() => setStage((prev) => (prev === 'none' ? '' : 'none'))}>
              {t('stage.none') as string} <b>{summary.stage_counts.none ?? 0}</b>
            </StageChip>
          </StageStrip>
          <QuotaChip type="button" onClick={() => navigate('/business/settings/plan')}>{quotaLabel}</QuotaChip>
        </StripRow>
      )}

      {loading ? (
        <Center>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Center>
      ) : error ? (
        <Center>{t('error.loadFailed') as string}</Center>
      ) : items.length === 0 ? (
        <EmptyBox>
          <EmptyTitle>{t('empty.title') as string}</EmptyTitle>
          <EmptyDesc>{t('empty.body') as string}</EmptyDesc>
          <StageGuide>
            {SALE_STAGES.filter((s) => s !== 'none').map((s) => (
              <GuideRow key={s}><GuideName>{t(`stage.${s}`) as string}</GuideName><GuideHint>{t(`stage.${s}_hint`) as string}</GuideHint></GuideRow>
            ))}
          </StageGuide>
        </EmptyBox>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th style={{ width: 44 }} />
                <Th>{t('list.columns.client') as string}</Th>
                <Th style={{ width: 96 }}>{t('list.columns.access') as string}</Th>
                <Th style={{ width: 104 }}>{t('list.columns.stage') as string}</Th>
                <Th style={{ width: 110 }}>{t('list.columns.assignee') as string}</Th>
                <Th style={{ width: 130 }}>{t('list.columns.lastTouch') as string}</Th>
                <Th style={{ width: 130, textAlign: 'right' }}>{t('list.columns.expected') as string}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const name = c.display_name || c.company_name || c.email || '—';
                return (
                  <Tr key={c.id} data-testid={`sale-row-${c.id}`}
                    onClick={() => setPanelClientId((prev) => (prev === c.id ? null : c.id))}>
                    <Td><LetterAvatar name={name} size={32} variant="neutral" /></Td>
                    <Td>
                      <NameCell>
                        {/* ★ 이름은 공통 컴포넌트로 — 어디서 이름이 나오든 같은 방식으로 열린다.
                            행 전체도 패널을 열지만, 이름을 직접 눌러도 **같은 패널**이라 동작이 갈라지지 않는다. */}
                        <ClientLink clientId={c.id} name={name}
                          onOpen={(id) => setPanelClientId((prev) => (prev === id ? null : id))} />
                        {c.company_name && c.display_name && <CompanySub>{c.company_name}</CompanySub>}
                      </NameCell>
                    </Td>
                    <Td><AccessBadge $kind={c.access_kind} title={t(`access.${c.access_kind}_hint`) as string}>{t(`access.${c.access_kind}`) as string}</AccessBadge></Td>
                    <Td><StageBadge $stage={c.sales_stage} title={t(`stage.${c.sales_stage}_hint`) as string}>{t(`stage.${c.sales_stage}`) as string}</StageBadge></Td>
                    <Td><Dim>{c.assigned_member?.name || '—'}</Dim></Td>
                    <Td>
                      {c.last_touch_at
                        ? <Dim title={formatDateTime(c.last_touch_at)}>{formatTimeAgo(c.last_touch_at)}</Dim>
                        : <Dim>{t('list.noTouch') as string}</Dim>}
                    </Td>
                    <Td style={{ textAlign: 'right' }}>
                      {c.expected_amount != null
                        ? <Dim>{Number(c.expected_amount).toLocaleString()} {c.expected_currency || 'KRW'}</Dim>
                        : <Dim>—</Dim>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <FootRow>
            <Dim>{t('list.count', { count: total }) as string}</Dim>
            {hasMore && (
              <ActionButton tone="secondary" size="sm" onClick={() => load({ page: page + 1 })}>
                {t('timeline.more') as string}
              </ActionButton>
            )}
          </FootRow>
        </>
      )}
      </>
      )}

      <AddInquiryModal
        open={addOpen}
        businessId={businessId}
        onClose={() => setAddOpen(false)}
        onDone={(clientId) => { setAddOpen(false); setPanelClientId(clientId); }}
      />
      <ClientPanel
        businessId={businessId as number}
        clientId={panelClientId}
        onClose={() => setPanelClientId(null)}
        onChanged={() => load({ silent: true })}
      />
    </PageShell>
  );
}

// ─── 문의 추가 ────────────────────────────────────────────────────
function AddInquiryModal({ open, businessId, onClose, onDone }: {
  open: boolean; businessId: number | null; onClose: () => void; onDone: (clientId: number) => void;
}) {
  const { t } = useTranslation('qsale');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<SaleSource>('manual');
  // 첫 상담 기록 — 전화·방문 내용은 **등록하는 그 순간**에만 손에 있다(Irene 2026-09-12).
  //   여기서 안 받으면 저장 후 상세로 들어가 한 번 더 써야 하고, 대개 안 쓴다.
  const [noteKind, setNoteKind] = useState<InteractionKind>('call');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // AI — 전화 메모·메일 본문을 붙여넣으면 칸을 채운다. **저장은 사람이 한다.**
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiFilled, setAiFilled] = useState(false);

  // 붙여넣은 글·상담 메모는 길다 — 쓰다 닫아도 남는다(입력 초안 계약).
  //   대상이 하나뿐인 폼이라 entityId 는 고정값이고, 비우는 것은 **저장 성공**뿐이다.
  const pasteKey = useDraftKey('sale-inquiry-add', 'paste', businessId);
  const noteKey = useDraftKey('sale-inquiry-add', 'note', businessId);
  const paste = useDraftText(pasteKey);
  const note = useDraftText(noteKey);

  const sourceOptions = useMemo(() => SALE_SOURCES.map((x) => ({ value: x as string, label: t(`source.${x}`) as string })), [t]);
  // 종류 라벨은 상담 원장이 쓰는 **record.kind.*** 를 그대로 쓴다(같은 값의 라벨을 두 벌 만들지 않는다)
  const kindOptions = useMemo(() => INTERACTION_KINDS.map((k) => ({ value: k as string, label: t(`record.kind.${k}`) as string })), [t]);

  useEffect(() => {
    // ★ 초안(붙여넣은 글·메모)은 **여기서 비우지 않는다** — 열 때마다 지우면 초안이 아니다.
    if (open) { setName(''); setCompany(''); setPhone(''); setEmail(''); setSource('manual'); setNoteKind('call'); setErr(null); setAiMsg(null); setAiFilled(false); }
  }, [open]);

  const runAi = async () => {
    if (!businessId || aiBusy || !paste.text.trim()) return;
    setAiBusy(true); setAiMsg(null);
    try {
      const out = await extractInquiry(businessId, paste.text);
      if (!out.found) { setAiMsg(t('inquiry.aiNotFound') as string); }
      else {
        // 시스템이 채운 값이다 — 사람이 확인·수정할 수 있고, 화면이 그 사실을 말한다
        if (out.display_name) setName(out.display_name);
        if (out.company_name) setCompany(out.company_name);
        if (out.phone) setPhone(out.phone);
        if (out.email) setEmail(out.email);
        if (out.sales_source) setSource(out.sales_source);
        setAiFilled(true);
        setAiMsg(null);
      }
      // 요약은 상담 기록 제목 자리로 — 메모 본문은 붙여넣은 원문을 쓴다
      if (out.summary && !note.text.trim()) note.setText(paste.text);
    } catch (e) {
      const msg = (e as Error).message;
      setAiMsg(msg === 'usage_limit' ? (t('inquiry.aiUsageLimit') as string)
        : msg === 'empty' ? (t('inquiry.aiEmpty') as string)
          : (t('inquiry.aiFailed') as string));
    } finally { setAiBusy(false); }
  };

  const submit = async () => {
    if (!businessId || saving) return;              // 중복 제출 가드
    if (!name.trim() && !company.trim()) { setErr(t('inquiry.nameRequired') as string); return; }
    setSaving(true);
    try {
      const body = note.text.trim();
      const out = await saveAsClient(businessId, {
        from: 'manual',
        display_name: name.trim() || undefined,
        company_name: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        sales_source: source,
        // 내용이 있을 때만 기록을 만든다(빈 기록은 원장을 더럽힌다)
        interaction: body ? { kind: noteKind, body, direction: 'inbound' } : undefined,
      });
      // 저장이 끝난 뒤에만 초안을 비운다 — 실패를 삼키고 비우면 저장 실패가 곧 글 삭제다
      paste.clear(); note.clear();
      onDone(out.client.id);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === 'invalid_email' ? (t('inquiry.invalidEmail') as string)
        : msg === 'prospects_quota_exceeded' ? (t('quota.header') as string)
          : (t('error.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StandardModal open={open} onClose={onClose} title={t('inquiry.title') as string} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="sale-inquiry-submit">
            {t('inquiry.submit') as string}
          </ActionButton>
        </>
      )}>
      {/* AI 로 채우기 — 전화 메모·메일 본문을 그대로 붙여넣는다. 값은 아래 칸에 들어가고 사람이 확인한다. */}
      <Field>
        <FieldLabel htmlFor="sale-inq-paste">{t('inquiry.pasteLabel') as string}</FieldLabel>
        <TextArea id="sale-inq-paste" rows={4} data-draft-kind="sale-inquiry-add"
          placeholder={t('inquiry.pastePlaceholder') as string}
          value={paste.text} onChange={(e) => paste.setText(e.target.value)} />
        <AiRow>
          <AiActionButton size="sm" testId="sale-inquiry-ai"
            onClick={runAi} loading={aiBusy} disabled={!paste.text.trim()}
            label={t('inquiry.aiFill') as string}
            title={t('inquiry.aiFillHint') as string} />
          {aiFilled && <AiHint>{t('inquiry.aiFilled') as string}</AiHint>}
          {aiMsg && <AiHint role="status">{aiMsg}</AiHint>}
        </AiRow>
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-name">{t('inquiry.nameLabel') as string}</FieldLabel>
        <TextInput id="sale-inq-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-company">{t('inquiry.companyLabel') as string}</FieldLabel>
        <TextInput id="sale-inq-company" value={company} onChange={(e) => setCompany(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-phone">{t('inquiry.phoneLabel') as string}</FieldLabel>
        <TextInput id="sale-inq-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-email">{t('inquiry.emailLabel') as string}</FieldLabel>
        <TextInput id="sale-inq-email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
      </Field>
      <Field>
        <FieldLabel>{t('inquiry.sourceLabel') as string}</FieldLabel>
        <PlanQSelect size="md" isSearchable={false}
          aria-label={t('inquiry.sourceLabel') as string}
          options={sourceOptions}
          value={sourceOptions.find((o) => o.value === source)}
          onChange={(opt: unknown) => {
            const v = (opt as { value?: string } | null)?.value;
            if (v) setSource(v as SaleSource);
          }} />
      </Field>
      {/* 첫 상담 기록 — 종류(전화·미팅·방문·메모)와 내용. 내용이 있으면 상담 원장에 1건 남는다. */}
      <Field>
        <FieldLabel>{t('inquiry.noteKindLabel') as string}</FieldLabel>
        <PlanQSelect size="md" isSearchable={false}
          aria-label={t('inquiry.noteKindLabel') as string}
          options={kindOptions}
          value={kindOptions.find((o) => o.value === noteKind)}
          onChange={(opt: unknown) => {
            const v = (opt as { value?: string } | null)?.value;
            if (v) setNoteKind(v as InteractionKind);
          }} />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-note">{t('inquiry.noteLabel') as string}</FieldLabel>
        <TextArea id="sale-inq-note" rows={3} data-draft-kind="sale-inquiry-add"
          placeholder={t('inquiry.notePlaceholder') as string}
          value={note.text} onChange={(e) => note.setText(e.target.value)} />
      </Field>
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
}

// ─── styled ──────────────────────────────────────────────────────
/* 폰에서는 액션 줄이 가로로 스크롤된다(PageShell). 그대로 두면 **주 액션이 화면 밖 오른쪽**에 있어
   스크롤해야 닿는다(실측 390px: 검색+셀렉트 3개가 앞을 다 먹고 "+ 문의 추가" 가 뷰포트 밖).
   → 폰에서는 주 액션을 맨 앞으로 돌린다. 필터는 오른쪽으로 흘러도 스크롤로 닿는다. */
const Actions = styled.div`
  display: flex; align-items: center; gap: 8px;
  @media (max-width: 640px) { > *:last-child { order: -1; } }
`;
/* PlanQSelect 는 react-select 라 폭을 직접 받지 않는다 — 감싸는 칸이 폭을 준다 */
const SelectWrap = styled.div<{ $w: number }>`width: ${(p) => p.$w}px; flex-shrink: 0;
  @media (max-width: 640px) { width: ${(p) => Math.min(p.$w, 128)}px; }`;
const SearchInput = styled.input`
  height: 36px; width: 200px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #5EEAD4; }
  @media (max-width: 640px) { width: 150px; }
`;
// 탭 — 상담(기본) / 고객. 밑줄 탭(관리 리스트 패턴)과 같은 톤으로 가볍게.
const TabRow = styled.div`
  display: flex; align-items: center; gap: 4px;
  border-bottom: 1px solid #E2E8F0; margin-bottom: 12px;
`;
const TabBtn = styled.button<{ $on: boolean }>`
  position: relative; height: 36px; padding: 0 12px;
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 0.8125rem; font-weight: ${(p) => (p.$on ? 700 : 600)};
  color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
  &::after {
    content: ''; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px;
    background: ${(p) => (p.$on ? '#0D9488' : 'transparent')};
  }
  &:hover { color: ${(p) => (p.$on ? '#0F766E' : '#334155')}; }
`;
const StripRow = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;`;
const StageStrip = styled.div`display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 2px;
  scrollbar-width: none; &::-webkit-scrollbar { display: none; }`;
const StageChip = styled.button<{ $on?: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? '#5EEAD4' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')};
  color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
  b { color: #0F172A; font-size: 0.8125rem; }
  &:hover { border-color: #5EEAD4; }
`;
const Divider = styled.span`width: 1px; height: 18px; background: #E2E8F0; flex-shrink: 0;`;
// 탭 바로 아래 필터 줄 — 폰에서는 감긴다(고정 폭 셀렉트가 가로로 넘치지 않게).
const FilterRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 0 2px;
`;
const QuotaChip = styled.button`
  height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; color: #475569;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  &:hover { background: #F1F5F9; }
`;
const Table = styled.table`
  width: 100%; border-collapse: separate; border-spacing: 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
`;
const Th = styled.th`
  text-align: left; font-size: 0.75rem; font-weight: 600; color: #64748B;
  padding: 10px 12px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; white-space: nowrap;
`;
const Tr = styled.tr`
  cursor: pointer;
  &:hover { background: #F8FAFC; }
  td { border-bottom: 1px solid #F1F5F9; }
  &:last-child td { border-bottom: none; }
`;
const Td = styled.td`padding: 10px 12px; font-size: 0.8125rem; color: #0F172A; vertical-align: middle;`;
const NameCell = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;
  strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;
const CompanySub = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const Dim = styled.span`font-size: 0.75rem; color: #64748B;`;
const ACCESS_STYLE: Record<AccessKind, { bg: string; fg: string }> = {
  guest: { bg: '#F1F5F9', fg: '#475569' },
  invited: { bg: '#FEF9C3', fg: '#854D0E' },
  member: { bg: '#DBEAFE', fg: '#1D4ED8' },
};
/* 배지는 컨트롤이 아니다 — 높이를 고정하지 않고 padding 으로 키운다(글자 배율을 따라가야 한다) */
const AccessBadge = styled.span<{ $kind: AccessKind }>`
  display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; line-height: 1.3;
  font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
  background: ${(p) => ACCESS_STYLE[p.$kind].bg}; color: ${(p) => ACCESS_STYLE[p.$kind].fg};
`;
const STAGE_STYLE: Record<SaleStage, { bg: string; fg: string }> = {
  none: { bg: '#F8FAFC', fg: '#94A3B8' },
  inquiry: { bg: '#F1F5F9', fg: '#475569' },
  consulting: { bg: '#ECFEFF', fg: '#0E7490' },
  proposal: { bg: '#F0FDFA', fg: '#0F766E' },
  negotiation: { bg: '#FEF3C7', fg: '#92400E' },
  won: { bg: '#DCFCE7', fg: '#166534' },
  lost: { bg: '#FEE2E2', fg: '#991B1B' },
};
const StageBadge = styled.span<{ $stage: SaleStage }>`
  display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; line-height: 1.3;
  font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
  background: ${(p) => STAGE_STYLE[p.$stage].bg}; color: ${(p) => STAGE_STYLE[p.$stage].fg};
`;
const FootRow = styled.div`display: flex; align-items: center; justify-content: space-between; padding: 12px 4px;`;
const Center = styled.div`display: flex; align-items: center; justify-content: center; padding: 60px 24px; font-size: 0.8125rem; color: #94A3B8;`;
const EmptyBox = styled.div`display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 56px 24px; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;`;
const EmptyTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #334155;`;
const EmptyDesc = styled.div`font-size: 0.8125rem; color: #94A3B8; text-align: center; max-width: 420px; line-height: 1.6;`;
const StageGuide = styled.div`display: flex; flex-direction: column; gap: 4px; margin-top: 12px; width: 100%; max-width: 420px;`;
const GuideRow = styled.div`display: flex; gap: 10px; font-size: 0.75rem;`;
const GuideName = styled.span`width: 60px; flex-shrink: 0; font-weight: 700; color: #475569;`;
const GuideHint = styled.span`color: #94A3B8;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const TextInput = styled.input`
  height: 40px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.875rem; color: #0F172A;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const TextArea = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; resize: vertical;
  &:focus { outline: none; border-color: #5EEAD4; }
  &::placeholder { color: #94A3B8; }
`;
const AiRow = styled.div`display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;`;
const AiHint = styled.span`font-size: 0.75rem; color: #64748B; line-height: 1.4;`;
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
