// pages/QSale/SaleDetailPage.tsx — Q sale 고객 상세 (docs/Q_SALE_DESIGN.md §5.3)
//
// 상단 크롬은 **두 밴드**다(CLAUDE.md 페이지 레이아웃 3): 밴드1 PanelHeader(제목 + 액션 칸),
// 밴드2 DetailMetaBar(접근·단계·담당 칩). 규격을 손으로 다시 쓰지 않는다.
// ★ 프로필 입력은 AutoSaveField — 저장 버튼이 없다. 대상이 바뀌면 key 로 인스턴스를 가른다
//   (같은 인스턴스를 다른 고객에 재사용하면 떠난 고객의 마지막 입력이 새 고객으로 저장된다).
// ★ 다른 워크스페이스 고객 id 는 404 로 온다 — findOtherWorkspaceOf 로 물어 "전환 안내" 를 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import PanelHeader, { PanelSubTitle, DetailMetaBar, DetailMetaLeft, DetailMetaRight } from '../../components/Layout/PanelHeader';
import ChipPopover from '../../components/Common/ChipPopover';
import ActionButton from '../../components/Common/ActionButton';
import AutoSaveField from '../../components/Common/AutoSaveField';
import StandardModal from '../../components/Common/StandardModal';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import DetailFallback from '../../components/Common/DetailFallback';
import ClientTimeline from '../../components/Clients/ClientTimeline';
import SummaryCard from '../../components/QSale/SummaryCard';
import { findOtherWorkspaceOf } from '../../utils/workspaceMatch';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
// 불발 사유 창은 **공용**이다 — 우측 패널도 같은 것을 쓴다(자리마다 다른 동작을 만들지 않는다)
import LostReasonModal from '../../components/QSale/LostReasonModal';
import {
  getSaleClient, patchSaleClient, setSaleStage, getSaleTimeline,
  createInteraction, deleteInteraction, reviewInteraction,
  SALE_STAGES, INTERACTION_KINDS, SALE_SOURCES,
  type SaleClientDetail, type SaleStage, type TimelineItem, type TimelineType,
  type InteractionKind, type SaleSource,
} from '../../services/sale';

type LoadStatus = 'loading' | 'ready' | 'not_found' | 'forbidden' | 'error' | 'other_workspace';
const CHANNELS: TimelineType[] = ['chat', 'email', 'task', 'invoice', 'interaction', 'stage', 'guest'];
const PAGE = 30;

export default function SaleDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { t } = useTranslation('qsale');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { formatDateTime } = useTimeFormat();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const cid = Number(clientId);

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [otherBiz, setOtherBiz] = useState<number | null>(null);
  const [client, setClient] = useState<SaleClientDetail | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [filter, setFilter] = useState<'all' | TimelineType>('all');
  const [hasMore, setHasMore] = useState(false);
  const beforeRef = useRef<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  // 요약 문장의 ⓘ근거 — 누르면 타임라인이 **그 항목들만** 보여준다(§10.6 ①)
  const [refFilter, setRefFilter] = useState<Array<{ type: TimelineType; id: number | string }> | null>(null);

  const loadClient = useCallback(async (silent = false) => {
    if (!businessId || !Number.isInteger(cid)) { setStatus('not_found'); return; }
    if (!silent) setStatus('loading');
    try {
      const data = await getSaleClient(businessId, cid);
      setClient(data);
      setStatus('ready');
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 404) {
        // URL 에 현재 워크스페이스를 넣어 부르는 문이라 남의 것은 404 다 — 내 다른 워크스페이스인지 서버에 묻는다
        const other = await findOtherWorkspaceOf('client', cid, businessId);
        if (other) { setOtherBiz(other); setStatus('other_workspace'); return; }
        setStatus('not_found');
      } else if (st === 403) setStatus('forbidden');
      else setStatus('error');
    }
  }, [businessId, cid]);

  const loadTimeline = useCallback(async (reset: boolean) => {
    if (!businessId || !Number.isInteger(cid)) return;
    try {
      const channels = filter === 'all' ? CHANNELS : [filter];
      const out = await getSaleTimeline(businessId, cid, {
        limit: PAGE, before: reset ? null : beforeRef.current, channels,
      });
      setItems((prev) => (reset ? out.items : [...prev, ...out.items]));
      setHasMore(out.has_more);
      beforeRef.current = out.next_before;
    } catch { /* 타임라인 실패는 상세 전체를 죽이지 않는다 — 아래 빈 상태로 보인다 */ }
  }, [businessId, cid, filter]);

  useEffect(() => { loadClient(); }, [loadClient]);
  useEffect(() => { beforeRef.current = null; loadTimeline(true); }, [loadTimeline]);

  const silentReload = useCallback(() => { loadClient(true); loadTimeline(true); }, [loadClient, loadTimeline]);
  useEffect(() => {
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentReload(); }, 250);
    };
    const offs = [
      onSocket('client:updated', debounced),
      onSocket('interaction:new', debounced),
      onSocket('interaction:updated', debounced),
      onSocket('interaction:deleted', debounced),
      onSocket('task:updated', debounced),
      onSocket('mail:updated', debounced),
    ];
    return () => { if (pending) window.clearTimeout(pending); offs.forEach((off) => off()); };
  }, [silentReload]);
  useVisibilityRefresh(silentReload);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    if (!businessId || !client) return;
    const next = await patchSaleClient(businessId, client.id, patch);
    setClient((prev) => (prev ? { ...prev, ...next } : prev));
  }, [businessId, client]);

  const changeStage = useCallback(async (to: SaleStage) => {
    if (!businessId || !client) return;
    if (to === 'lost') { setLostOpen(true); return; }
    await setSaleStage(businessId, client.id, { to });
    silentReload();
  }, [businessId, client, silentReload]);

  const title = client ? (client.display_name || client.company_name || client.email || `#${cid}`) : '';

  if (status !== 'ready' || !client) {
    return (
      <Page>
        <PanelHeader onBack={() => navigate('/sale')}>
          <TitleSlot><PanelSubTitle>{t('page.title') as string}</PanelSubTitle></TitleSlot>
          <ActionSlot />
        </PanelHeader>
        <DetailFallback status={status === 'ready' ? 'loading' : status} businessId={otherBiz}
          onRetry={() => loadClient()} onBack={() => navigate('/sale')} />
      </Page>
    );
  }

  return (
    <Page>
      {/* 밴드1 — 제목 + 액션 한 칸 */}
      <PanelHeader onBack={() => navigate('/sale')} backLabel={t('page.detailBack') as string}>
        <TitleSlot>
          <PanelSubTitle>{title}</PanelSubTitle>
          {client.company_name && client.display_name && <HeaderSub>{client.company_name}</HeaderSub>}
        </TitleSlot>
        <ActionSlot>
          <ActionButton tone="primary" size="sm" data-testid="sale-add-record" onClick={() => setRecordOpen(true)}>
            {t('action.addRecord') as string}
          </ActionButton>
        </ActionSlot>
      </PanelHeader>

      {/* 밴드2 — 접근·단계·담당 칩 (값은 칩, 고치는 컨트롤은 누를 때만) */}
      <DetailMetaBar data-testid="sale-detail-meta">
        <DetailMetaLeft>
          <AccessPill $kind={client.access_kind} title={t(`access.${client.access_kind}_hint`) as string}>
            {t(`access.${client.access_kind}`) as string}
          </AccessPill>
          <QuotaPill>{client.quota_counted ? (t('quota.counted') as string) : (t('quota.not_counted') as string)}</QuotaPill>
          <ChipPopover
            prefix={t('stage.label') as string}
            label={t(`stage.${client.sales_stage}`) as string}
            active={client.sales_stage !== 'none'}
            data-testid="sale-stage-chip"
            width={260}
          >
            {(close) => (
              <OptionList role="listbox">
                {SALE_STAGES.map((s) => (
                  <OptionBtn key={s} type="button" role="option" aria-selected={client.sales_stage === s}
                    $on={client.sales_stage === s}
                    data-testid={`sale-stage-option-${s}`}
                    onClick={async () => { close(); await changeStage(s); }}>
                    <OptName>{t(`stage.${s}`) as string}</OptName>
                    <OptHint>{t(`stage.${s}_hint`) as string}</OptHint>
                  </OptionBtn>
                ))}
              </OptionList>
            )}
          </ChipPopover>
          {client.sales_stage === 'lost' && client.lost_reason && (
            <LostPill>{t(`lost.reason.${client.lost_reason}`) as string}</LostPill>
          )}
          {client.sales_stage_changed_at && (
            <MetaDim title={formatDateTime(client.sales_stage_changed_at)}>
              {t('stage.days_in', { count: daysSince(client.sales_stage_changed_at) }) as string}
            </MetaDim>
          )}
        </DetailMetaLeft>
        <DetailMetaRight>
          <MetaDim>{client.assigned_member?.name || (t('list.assigneeNone') as string)}</MetaDim>
        </DetailMetaRight>
      </DetailMetaBar>

      <Body>
        <LeftCol>
          {/* 히스토리 요약 — 좌측 최상단(§5.3). 요약이 틀렸을 때 **원문으로 내려가는 길**을 같이 둔다 */}
          <SummaryCard
            key={`summary-${client.id}`}
            businessId={businessId}
            clientId={cid}
            onFilterRefs={(refs) => setRefFilter(refs)}
            refFilterActive={!!refFilter}
            onClearFilter={() => setRefFilter(null)}
          />
          <Card>
            <CardTitle>{t('detail.profile') as string}</CardTitle>
            <ProfileForm
              key={`profile-${client.id}`}
              client={client}
              onSave={save}
            />
          </Card>

          <Card>
            <CardTitle>{t('stage.history') as string}</CardTitle>
            {client.stage_history.length === 0 ? (
              <Dim>{t('stage.historyEmpty') as string}</Dim>
            ) : (
              <HistoryList>
                {client.stage_history.map((h) => (
                  <HistoryRow key={h.id}>
                    <HistoryText>
                      {t('timeline.stageChanged', {
                        from: h.from ? (t(`stage.${h.from}`) as string) : '—',
                        to: t(`stage.${h.to}`) as string,
                      }) as string}
                      {h.origin === 'auto' && <TagDim>{t('record.auto') as string}</TagDim>}
                    </HistoryText>
                    <HistoryMeta title={formatDateTime(h.at)}>
                      {h.changed_by?.name || (t('stage.changed_manual') as string)}
                    </HistoryMeta>
                  </HistoryRow>
                ))}
              </HistoryList>
            )}
          </Card>

          <Card>
            <CardTitle>{t('detail.channels') as string}</CardTitle>
            <ChannelRow>
              <Dim>{t('detail.channelChat', { count: client.channels.conversations }) as string}</Dim>
              <Dim>{t('detail.channelMail', { count: client.channels.email_threads }) as string}</Dim>
              <Dim>{t('detail.channelGuest', { count: client.channels.guest_links }) as string}</Dim>
            </ChannelRow>
          </Card>

          <Card>
            <CardTitle>{t('detail.projects') as string}</CardTitle>
            {client.projects.length === 0 ? (
              <Dim>{t('detail.projectsEmpty') as string}</Dim>
            ) : (
              <ProjectList>
                {client.projects.map((p) => (
                  <ProjectRow key={p.id} type="button" onClick={() => navigate(`/projects/p/${p.id}`)}>
                    {p.name}
                  </ProjectRow>
                ))}
              </ProjectList>
            )}
          </Card>
        </LeftCol>

        <RightCol>
          <FilterRow role="tablist">
            <FilterChip type="button" role="tab" aria-selected={filter === 'all'} $on={filter === 'all'}
              onClick={() => setFilter('all')}>{t('timeline.all') as string}</FilterChip>
            {CHANNELS.map((c) => (
              <FilterChip key={c} type="button" role="tab" aria-selected={filter === c} $on={filter === c}
                onClick={() => setFilter((prev) => (prev === c ? 'all' : c))}>
                {t(`timeline.channel.${c}`) as string}
              </FilterChip>
            ))}
          </FilterRow>
          {refFilter && (
            <FilterNotice role="status">
              {t('summary.evidence', { count: refFilter.length }) as string}
              <MiniBtn type="button" onClick={() => setRefFilter(null)}>{t('summary.clearFilter') as string}</MiniBtn>
            </FilterNotice>
          )}
          <ClientTimeline
            items={refFilter
              ? items.filter((it) => refFilter.some((r) => r.type === it.type && String(r.id) === String(it.id)))
              : items}
            onOpen={(it) => openTimelineItem(it, navigate)}
            renderActions={(it) => {
              const meta = (it.meta || {}) as Record<string, unknown>;
              if (it.type !== 'interaction') return null;
              return (
                <RowActions onClick={(e) => e.stopPropagation()}>
                  {meta.origin === 'auto' && meta.reviewed === false && (
                    <MiniBtn type="button" onClick={async () => {
                      if (!businessId) return;
                      await reviewInteraction(businessId, cid, Number(it.id));
                      silentReload();
                    }}>{t('record.markReviewed') as string}</MiniBtn>
                  )}
                  <MiniBtn type="button" data-testid={`sale-record-delete-${it.id}`}
                    onClick={() => setDeleteTarget(Number(it.id))}>{t('record.delete') as string}</MiniBtn>
                </RowActions>
              );
            }}
          />
          {hasMore && (
            <MoreRow>
              <ActionButton tone="secondary" size="sm" onClick={() => loadTimeline(false)}>
                {t('timeline.more') as string}
              </ActionButton>
            </MoreRow>
          )}
        </RightCol>
      </Body>

      <RecordModal
        open={recordOpen}
        businessId={businessId}
        clientId={cid}
        onClose={() => setRecordOpen(false)}
        onSaved={() => { setRecordOpen(false); silentReload(); }}
      />
      <LostReasonModal
        open={lostOpen}
        businessId={businessId}
        clientId={cid}
        onClose={() => setLostOpen(false)}
        onConfirm={async (reason, note) => {
          if (!businessId) return;
          await setSaleStage(businessId, cid, { to: 'lost', lost_reason: reason, lost_note: note });
          setLostOpen(false);
          silentReload();
        }}
      />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('record.delete') as string}
        message={t('record.deleteConfirm') as string}
        confirmText={t('record.delete') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="danger"
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (businessId && deleteTarget) await deleteInteraction(businessId, cid, deleteTarget);
          setDeleteTarget(null);
          silentReload();
        }}
      />
    </Page>
  );
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(1, Math.floor(ms / 86400000) + 1);
}

function openTimelineItem(it: TimelineItem, navigate: (to: string) => void) {
  if (it.type === 'chat' && it.conversation_id) navigate(`/talk?conv=${it.conversation_id}`);
  else if (it.type === 'email' && it.thread_id) navigate(`/mail?thread=${it.thread_id}`);
  else if (it.type === 'task') navigate(`/tasks?task=${it.id}`);
  else if (it.type === 'invoice') navigate(`/bills?invoice=${it.id}`);
  else if (it.type === 'guest' && it.conversation_id) navigate(`/talk?conv=${it.conversation_id}`);
}

// ─── 프로필 (AutoSaveField — 저장 버튼 없음) ───────────────────────
function ProfileForm({ client, onSave }: { client: SaleClientDetail; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation('qsale');
  const [name, setName] = useState(client.display_name || '');
  const [company, setCompany] = useState(client.company_name || '');
  const [phone, setPhone] = useState(client.phone || '');
  const [email, setEmail] = useState(client.email || '');
  const [amount, setAmount] = useState(client.expected_amount != null ? String(client.expected_amount) : '');
  const [source, setSource] = useState<SaleSource | ''>(client.sales_source || '');
  const emailLocked = client.status !== 'prospect';
  const sourceOptions = useMemo(() => ([
    { value: '', label: '—' },
    ...SALE_SOURCES.map((s) => ({ value: s as string, label: t(`source.${s}`) as string })),
  ]), [t]);

  return (
    <Fields>
      <Field>
        <FieldLabel htmlFor="sale-name">{t('detail.name') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ display_name: name }); }}>
          <TextInput id="sale-name" value={name} onChange={(e) => setName(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-company">{t('detail.company') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ company_name: company }); }}>
          <TextInput id="sale-company" value={company} onChange={(e) => setCompany(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-phone">{t('detail.phone') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ phone }); }}>
          <TextInput id="sale-phone" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-email">{t('detail.email') as string}</FieldLabel>
        {emailLocked ? (
          <>
            <ReadOnlyValue id="sale-email">{email || '—'}</ReadOnlyValue>
            <HintText>{t('detail.emailLocked') as string}</HintText>
          </>
        ) : (
          <AutoSaveField onSave={async () => { await onSave({ email }); }}>
            <TextInput id="sale-email" value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          </AutoSaveField>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-amount">{t('detail.expectedAmount') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ expected_amount: amount === '' ? null : Number(amount), expected_currency: amount === '' ? null : (client.expected_currency || 'KRW') }); }}>
          <TextInput id="sale-amount" value={amount} inputMode="numeric"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel>{t('source.label') as string}</FieldLabel>
        <AutoSaveField type="select" onSave={async () => { await onSave({ sales_source: source || null }); }}>
          <PlanQSelect size="sm" isSearchable={false} options={sourceOptions}
            aria-label={t('source.label') as string}
            value={sourceOptions.find((o) => o.value === source) || sourceOptions[0]}
            onChange={(opt: unknown) => setSource(((opt as { value?: string } | null)?.value || '') as SaleSource | '')} />
        </AutoSaveField>
      </Field>
    </Fields>
  );
}

// ─── 기록 추가 ────────────────────────────────────────────────────
function RecordModal({ open, businessId, clientId, onClose, onSaved }: {
  open: boolean; businessId: number | null; clientId: number; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation('qsale');
  const [kind, setKind] = useState<InteractionKind>('call');
  const [direction, setDirection] = useState<'inbound' | 'outbound' | ''>('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 통화·미팅 메모는 길다 — 모달을 닫아도 남는다(제출 성공에만 비운다). docs/DRAFT_PERSISTENCE_DESIGN.md
  const draftKey = useDraftKey('sale-interaction-body', clientId, businessId);
  const bodyDraft = useDraftText(draftKey);
  const body = bodyDraft.text;

  useEffect(() => {
    if (!open) return;
    setKind('call'); setDirection(''); setTitle(''); setMinutes(''); setErr(null);
    setDate(new Date().toISOString().slice(0, 10));
    setTime(new Date().toTimeString().slice(0, 5));
  }, [open]);

  const kindOptions = useMemo(() => INTERACTION_KINDS.map((k) => ({ value: k as string, label: t(`record.kind.${k}`) as string })), [t]);
  const dirOptions = useMemo(() => ([
    { value: '', label: '—' },
    { value: 'inbound', label: t('record.direction.inbound') as string },
    { value: 'outbound', label: t('record.direction.outbound') as string },
  ]), [t]);

  const submit = async () => {
    if (!businessId || saving) return;                 // 중복 제출 가드
    if (!title.trim() && !body.trim()) { setErr(t('record.contentRequired') as string); return; }
    setSaving(true);
    try {
      await createInteraction(businessId, clientId, {
        kind,
        direction: direction || null,
        occurred_at: new Date(`${date}T${time || '00:00'}`).toISOString(),
        duration_seconds: minutes ? Math.round(Number(minutes) * 60) : null,
        title: title.trim() || null,
        body: body.trim() || null,
      });
      bodyDraft.clear();          // 제출 성공에만 비운다 — 실패를 삼키고 비우면 그게 곧 글 삭제다
      onSaved();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === 'occurred_in_future' ? (t('record.futureNotAllowed') as string)
        : m === 'content_required' ? (t('record.contentRequired') as string)
          : (t('error.saveFailed') as string));
    } finally { setSaving(false); }
  };

  return (
    <StandardModal open={open} onClose={onClose} title={t('action.addRecord') as string} size="md"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="sale-record-submit">
            {t('record.save') as string}
          </ActionButton>
        </>
      )}>
      <TwoCol>
        <Field>
          <FieldLabel>{t('record.kind.label') as string}</FieldLabel>
          <PlanQSelect size="md" isSearchable={false} options={kindOptions}
            aria-label={t('record.kind.label') as string}
            value={kindOptions.find((o) => o.value === kind)}
            onChange={(opt: unknown) => setKind(((opt as { value?: string } | null)?.value || 'call') as InteractionKind)} />
        </Field>
        <Field>
          <FieldLabel>{t('record.direction.label') as string}</FieldLabel>
          <PlanQSelect size="md" isSearchable={false} options={dirOptions}
            aria-label={t('record.direction.label') as string}
            value={dirOptions.find((o) => o.value === direction)}
            onChange={(opt: unknown) => setDirection((((opt as { value?: string } | null)?.value) || '') as 'inbound' | 'outbound' | '')} />
        </Field>
      </TwoCol>
      <TwoCol>
        <Field>
          <FieldLabel>{t('record.occurredAt') as string}</FieldLabel>
          <SingleDateField value={date} onChange={setDate} size="md" />
        </Field>
        <Field>
          <FieldLabel htmlFor="sale-rec-time">{t('record.occurredAt') as string}</FieldLabel>
          <TextInput id="sale-rec-time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="14:20" />
        </Field>
      </TwoCol>
      <Field>
        <FieldLabel htmlFor="sale-rec-title">{t('record.title') as string}</FieldLabel>
        <TextInput id="sale-rec-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-rec-body">{t('record.body') as string}</FieldLabel>
        <TextArea id="sale-rec-body" rows={5} {...bodyDraft.bind} />
        {bodyDraft.restored && <HintText>{t('record.draftRestored') as string}</HintText>}
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-rec-min">{t('record.duration') as string}</FieldLabel>
        <TextInput id="sale-rec-min" value={minutes} inputMode="numeric"
          onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
      </Field>
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
}

// ─── 종결 (사유 필수) ─────────────────────────────────────────────
// ─── styled ──────────────────────────────────────────────────────
const Page = styled.div`display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC;`;
const TitleSlot = styled.div`display: flex; align-items: baseline; gap: 8px; min-width: 0;`;
const ActionSlot = styled.div`display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;
const HeaderSub = styled.span`font-size: 0.8125rem; color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Body = styled.div`
  flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 88px;
  display: grid; grid-template-columns: 360px 1fr; gap: 16px; align-items: start;
  @media (max-width: 1024px) { grid-template-columns: 1fr; }
  @media (max-width: 640px) { padding: 14px 14px 88px; }
`;
const LeftCol = styled.div`display: flex; flex-direction: column; gap: 12px; min-width: 0;`;
const RightCol = styled.div`display: flex; flex-direction: column; gap: 10px; min-width: 0;`;
const Card = styled.section`background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px;`;
const CardTitle = styled.h2`margin: 0 0 10px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const Fields = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const TextInput = styled.input`
  height: 36px; padding: 0 30px 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; width: 100%;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const TextArea = styled.textarea`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; width: 100%; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const ReadOnlyValue = styled.div`font-size: 0.8125rem; color: #334155; padding: 8px 0;`;
const HintText = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const Dim = styled.span`font-size: 0.8125rem; color: #64748B;`;
const MetaDim = styled.span`font-size: 0.75rem; color: #94A3B8; white-space: nowrap;`;
const TagDim = styled.span`margin-left: 6px; font-size: 0.6875rem; font-weight: 700; color: #64748B; background: #F1F5F9; border-radius: 999px; padding: 1px 6px;`;
const HistoryList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const HistoryRow = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 10px;`;
const HistoryText = styled.div`font-size: 0.8125rem; color: #0F172A; min-width: 0;`;
const HistoryMeta = styled.div`font-size: 0.75rem; color: #94A3B8; white-space: nowrap;`;
const ChannelRow = styled.div`display: flex; gap: 14px; flex-wrap: wrap;`;
const ProjectList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const ProjectRow = styled.button`
  text-align: left; font-size: 0.8125rem; color: #0F766E; background: none; border: none;
  padding: 4px 0; cursor: pointer; &:hover { text-decoration: underline; }
`;
const FilterRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const FilterChip = styled.button<{ $on: boolean }>`
  height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? '#5EEAD4' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')};
  color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
`;
const MoreRow = styled.div`display: flex; justify-content: center; padding: 8px 0;`;
const RowActions = styled.div`display: flex; gap: 6px;`;
/* 근거 필터가 걸려 있음을 타임라인 위에서 알린다 (요약 카드의 ⓘ근거 클릭 결과) */
const FilterNotice = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4;
`;
const MiniBtn = styled.button`
  height: 36px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  font-size: 0.6875rem; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0;
  &:hover { background: #F8FAFC; }
`;
const ACCESS_STYLE = {
  guest: { bg: '#F1F5F9', fg: '#475569' },
  invited: { bg: '#FEF9C3', fg: '#854D0E' },
  member: { bg: '#DBEAFE', fg: '#1D4ED8' },
} as const;
/* 배지·칩은 컨트롤 높이 토큰(36/40/44) 대상이 아니다 — padding 으로 키워 글자 배율을 따라가게 한다 */
const AccessPill = styled.span<{ $kind: keyof typeof ACCESS_STYLE }>`
  display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; line-height: 1.3;
  font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
  background: ${(p) => ACCESS_STYLE[p.$kind].bg}; color: ${(p) => ACCESS_STYLE[p.$kind].fg};
`;
const QuotaPill = styled.span`
  display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; line-height: 1.3;
  font-size: 0.6875rem; font-weight: 600; color: #64748B; background: #F8FAFC; border: 1px solid #E2E8F0;
  white-space: nowrap;
`;
const LostPill = styled(QuotaPill)`color: #991B1B; background: #FEE2E2; border-color: #FECACA;`;
const OptionList = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const OptionBtn = styled.button<{ $on: boolean }>`
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')};
  border: 1px solid ${(p) => (p.$on ? '#5EEAD4' : 'transparent')};
  &:hover { background: #F8FAFC; }
`;
const OptName = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const OptHint = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
const TwoCol = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
