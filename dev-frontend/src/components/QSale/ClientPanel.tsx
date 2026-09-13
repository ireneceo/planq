// ClientPanel — 고객 정보 **우측 패널** (Q sale 상담·고객 탭 공용)
//
// Irene 2026-09-12: *"설정에서 고객/파트너에 나오는 정보랑 통합해서 제대로 만들어줘. 그리고 전체보기
//   아이콘 만들어서 누르면 지금처럼 전체 고객페이지 보게 해주고, 고객들 이름 여기 저기 나오면
//   고객페이지 보기 기능이 있어서 누르면 전체보기 형태로 다 보게 해줘."*
//   그리고: *"설정에 있는 건 관리자가 하는 관리도 있는 거고 Q sale에는 관리설정은 빠지고 잘 동기화 하면 돼"*
//
// ★ 경계 — **정보는 공유, 관리는 설정에만.**
//   여기 있는 것: 프로필 · 연락처(종류별) · 사업자 정보 · 단계 · 연결된 프로젝트/대화 수
//   여기 **없는** 것: 초대/재초대 · 보관 스위치 · 삭제 · 한도 포함 여부 — 그건 /business/clients 의 몫이다.
//
// ★ 정본은 `GET /api/sale/:biz/clients/:id` 하나다. 화면마다 따로 모으면 반드시 갈라진다.
//   목록용 직렬화는 이메일을 하나로 접지만(초대→계정→청구), 상세는 **종류별로 펴서** 내려온다 —
//   그래야 "어떤 주소인지" 를 말할 수 있다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
// 실시간 — 이 패널은 소켓도 복귀 갱신도 없이 열려 있었다(CLAUDE.md 운영 안정성 16). 전체 프로필과 같은 두 벌을 쓴다.
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import LetterAvatar from '../Common/LetterAvatar';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  getSaleClient, setSaleStage, getSaleTimeline,
  type SaleClientDetail, type LostReason, type TimelineItem,
} from '../../services/sale';
import { createPost } from '../../services/posts';
import { apiFetch } from '../../contexts/AuthContext';
// 히스토리는 상세와 **같은 컴포넌트**로 그린다 — 패널과 전체페이지가 다르면 고장으로 읽힌다
import ClientTimeline from '../Clients/ClientTimeline';
import { openSaleTimelineItem } from '../../utils/saleTimelineTarget';
// 불발 사유 창은 **공용**(상세 페이지와 같은 것) — 여기서 단계만 넘기면 왜 깨졌는지가 원장에 안 남는다
import LostReasonModal from './LostReasonModal';
// 단계 칩은 전체 프로필과 **같은 것**을 쓴다 — 화면마다 따로 그리면 동작이 갈라진다.
import ChipPopover from '../Common/ChipPopover';
import { OptionList, OptionBtn, OptName, OptHint } from '../Common/optionList';
import { SALE_STAGES, type SaleStage } from '../../services/sale';
// 초대는 **되돌릴 수 없다**(고객에게 메일이 나간다) — 누르기 전에 묻는다(Irene 2026-09-12: "확인을 받아")
import ConfirmDialog from '../Common/ConfirmDialog';
// 상담 관리의 다음 액션 — 상세 페이지와 **같은 창**을 쓴다(자리마다 다른 동작을 만들지 않는다)
import RecordModal from './RecordModal';
import NextContactModal from './NextContactModal';
import TaskCreateForm from '../QTask/TaskCreateForm';

/** 아직 고객이 아닌 문의(상담 행)를 그릴 때 쓰는 값 — 원본에서 **가져올 수 있는 것은 다 넣는다**.
 *  Irene 2026-09-12: *"만약 고객이 아니고 게스트면 가져올 수 있는 정보를 다 넣어야지. 이름 이메일주소 등등."* */
export interface InquiryView {
  who: string | null;
  email: string | null;
  company: { name: string; estimated: boolean } | null;
  title: string | null;
  preview: string | null;
  at: string | null;
  needsReply: boolean;
  source: string;
  /** 등록 가능하면 누를 수 있다(링크 없는 순수 대화방은 서버가 못 받는다) */
  canRegister: boolean;
  emailVerified?: boolean;
  /** 원본 화면 경로 — [보기] 가 목록과 **같은 곳**으로 간다(경로를 화면마다 조립하지 않는다) */
  openPath: string;
}

interface Props {
  businessId: number;
  clientId: number | null;
  /** clientId 가 없고 이것이 있으면 **미등록 문의**를 그린다 */
  inquiry?: InquiryView | null;
  onClose: () => void;
  /** 단계가 바뀌면 부모 목록도 다시 읽는다 */
  onChanged?: () => void;
  /** 미등록 문의를 고객으로 등록 */
  onRegister?: () => void;
  /** 등록 진행 중 — 버튼 중복 제출 가드 */
  registerBusy?: boolean;
}

const ClientPanel: React.FC<Props> = ({
  businessId, clientId, inquiry = null, onClose, onChanged, onRegister, registerBusy = false,
}) => {
  const { t } = useTranslation('qsale');
  const navigate = useChromeNav();
  // 시각은 목록과 **같은 포맷터**로 — 날 ISO 문자열을 그대로 내보내면 사람이 읽는 값이 아니다
  const { formatDateTime } = useTimeFormat();
  const [data, setData] = useState<SaleClientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // 히스토리를 읽는 길 — effect 와 액션 뒤(reload)가 **같은 함수**를 쓴다.
  //   ★ 이것을 effect 안에만 두었더니 업무·메모를 추가해도 히스토리가 그대로였다.
  //     의존이 [businessId, clientId] 뿐이라 액션 뒤에 다시 돌 이유가 없었기 때문이다 —
  //     사용자에게는 "추가했는데 안 보인다" 로 보인다(memory feedback_backend_done_ui_missing).
  const loadHistory = useCallback(async () => {
    if (!clientId) { setItems([]); return; }
    setHistLoading(true);
    try {
      // ★ 채널을 **명시**한다 — 안 넘기면 서버 기본값이 적용돼 `note`(메모 모아보기)가 빠진다.
      // ★ balanced — 8칸을 한 채널이 다 먹지 않게 채널 쿼터를 건다(서버 clientTimeline.balancedPick).
      //   실측: 이 옵션 없이는 채팅 6칸이 자리를 먹어 업무·청구 기록이 밀려났다.
      //   전체 기록은 아래 "더 보기" 로 간다 — 거기서는 시간순 그대로다.
      const out = await getSaleTimeline(businessId, clientId, {
        limit: 8,
        channels: ['chat', 'email', 'task', 'invoice', 'interaction', 'stage', 'guest', 'note'],
        balanced: true,
      });
      setItems(out.items || []);
    } catch { setItems([]); }
    finally { setHistLoading(false); }
  }, [businessId, clientId]);

  // 액션(메모·다음 연락·업무 추가) 뒤에 다시 읽는 길 — 프로필과 히스토리를 **같이** 되읽는다
  const reload = useCallback(async () => {
    if (!clientId) return;
    try { setData(await getSaleClient(businessId, clientId)); onChanged?.(); }
    catch { setError(true); }
    void loadHistory();
  }, [businessId, clientId, onChanged, loadHistory]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // 실시간 — 다른 사람이 이 고객의 업무·메모·단계를 바꾸면 패널이 스스로 따라간다(CLAUDE.md 운영 안정성 16).
  //   전체 프로필과 **같은 이벤트 목록**을 듣는다 — 두 화면이 서로 다른 것을 들으면 한쪽만 조용히 낡는다.
  useEffect(() => {
    if (!clientId) return undefined;
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void reload(); }, 250);
    };
    const offs = [
      onSocket('client:updated', debounced),
      onSocket('interaction:new', debounced),
      onSocket('interaction:updated', debounced),
      onSocket('interaction:deleted', debounced),
      onSocket('task:new', debounced),
      onSocket('task:updated', debounced),
      onSocket('task:deleted', debounced),
      onSocket('mail:updated', debounced),
    ];
    return () => { if (pending) window.clearTimeout(pending); offs.forEach((off) => off()); };
  }, [clientId, reload]);
  useVisibilityRefresh(reload);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    let alive = true;
    setLoading(true); setError(false);
    getSaleClient(businessId, clientId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [businessId, clientId]);

  const [lostOpen, setLostOpen] = useState(false);
  // 다음 액션 — 메모(상담 기록) · 다음 연락(일정) · 업무 추가. 청구·프로젝트는 그 화면으로 넘긴다.
  const [recordOpen, setRecordOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const [inviteAsk, setInviteAsk] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  // 히스토리 — 최근 것 몇 건만. 전체는 전체보기(상세)에서 본다.
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const applyStage = useCallback(async (
    // 칩이 7단계를 모두 넘긴다 — 여기서 'won'|'lost' 로 좁히면 나머지 다섯은 **조용히 막힌다**.
    stage: SaleStage,
    extra?: { lost_reason?: LostReason; lost_note?: string },
  ) => {
    if (!clientId || busy) return;
    setBusy(true);
    try {
      // ★ 시그니처는 **객체**다(`{ to, reason?, lost_reason?, lost_note? }`). 문자열을 넘기면 서버가 단계를 못 읽는다.
      await setSaleStage(businessId, clientId, { to: stage, ...(extra || {}) });
      const fresh = await getSaleClient(businessId, clientId);
      setData(fresh);
      onChanged?.();
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, clientId, busy, onChanged]);

  // 불발은 **사유를 받고** 넘긴다 — 사유 없이 닫으면 왜 깨졌는지가 원장에 남지 않는다.
  // 칩에서 7단계를 모두 넘긴다 — 'won'|'lost' 로 좁혀두면 칩이 그 둘 말고는 아무 일도 못 한다.
  const changeStage = useCallback((stage: SaleStage) => {
    if (stage === 'lost') { setLostOpen(true); return; }
    void applyStage(stage);
  }, [applyStage]);

  // 미등록 문의도 같은 패널에서 그린다 — 고객 레코드가 없을 뿐이고 **보여줄 정보는 있다**.
  const isInquiry = !clientId && !!inquiry;
  const inviteEmail = data?.contact?.invite_email || data?.contact?.account_email || data?.email || '';

  // 초대 — 기존 라우트를 그대로 부른다(초대 메일·토큰·중복 판정이 전부 거기 있다)
  const sendInvite = useCallback(async () => {
    if (!clientId || !data || busy || !inviteEmail) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/clients/${businessId}/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.display_name || data.company_name || inviteEmail,
          email: inviteEmail,
          company_name: data.company_name || undefined,
        }),
      });
      if (!r.ok) { setError(true); return; }
      await reload();
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, clientId, data, busy, inviteEmail, reload]);

  // 계약서 — Q docs 문서를 만들고 그 문서를 연다(받는 화면이 `?post=` 를 읽는다)
  const createContract = useCallback(async () => {
    if (!clientId || !data || busy) return;
    setBusy(true);
    try {
      const who = data.display_name || data.company_name || `#${clientId}`;
      const post = await createPost({
        business_id: businessId,
        title: `${t('action.contractTitle', { defaultValue: '계약서' }) as string} — ${who}`,
        status: 'draft',
      });
      navigate(`/docs?post=${post.id}`);
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, clientId, data, busy, navigate, t]);

  const name = clientId
    ? (data?.display_name || data?.company_name || '')
    : (inquiry?.who || '');

  return (
    <DetailDrawer open={!!clientId || isInquiry} onClose={onClose} width={420} ariaLabel={name || 'client'}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadRow>
          <HeadName title={name}>{name || '—'}</HeadName>
          {/* 전체보기 — 지금처럼 고객 페이지 전체를 본다 */}
          {clientId && (
            <IconBtn type="button" data-testid="client-panel-full"
              title={t('panel.openFull') as string} aria-label={t('panel.openFull') as string}
              onClick={() => navigate(`/sale/${clientId}`)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" /><path d="M10 14L21 3" />
                <path d="M21 14v7H3V3h7" />
              </svg>
            </IconBtn>
          )}
        </HeadRow>
      </DetailDrawer.Header>

      <DetailDrawer.Body>
        {isInquiry && inquiry ? (
          <>
            <Top>
              <LetterAvatar name={name || '—'} size={44} variant="neutral" />
              <TopText>
                <TopName>{name || (t('inbox.unknownWho') as string)}</TopName>
                {inquiry.company && (
                  <TopSub>
                    {inquiry.company.name}
                    {inquiry.company.estimated && ` (${t('panel.companyEstimated') as string})`}
                  </TopSub>
                )}
                <StageTag>{t('panel.notClientYet') as string}</StageTag>
              </TopText>
            </Top>

            <Section>
              <SectionTitle>{t('panel.contact') as string}</SectionTitle>
              {/* 확인 여부는 주소 옆에 붙인다 — 별도 줄로 빼면 "예" 만 남아 무엇이 확인됐는지 모른다 */}
              <Row label={t('panel.email') as string}
                value={inquiry.email
                  ? inquiry.email + (inquiry.emailVerified ? ` (${t('panel.emailVerified') as string})` : '')
                  : null} />
              <Row label={t('panel.source') as string} value={t(`inbox.source.${inquiry.source}`) as string} />
            </Section>

            <Section>
              <SectionTitle>{t('panel.inquiry') as string}</SectionTitle>
              <Row label={t('panel.subject') as string} value={inquiry.title || (t('inbox.noSubject') as string)} />
              <Row label={t('panel.at') as string} value={inquiry.at ? formatDateTime(inquiry.at) : null} />
              {inquiry.needsReply && <Row label={t('panel.state') as string} value={t('inbox.needsReply') as string} />}
              {inquiry.preview && (
                <PreviewBox>{inquiry.preview}</PreviewBox>
              )}
            </Section>
          </>
        ) : loading ? (
          <Dim>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
        ) : error || !data ? (
          <Dim>{t('error.loadFailed') as string}</Dim>
        ) : (
          <>
            <Top>
              <LetterAvatar name={name || '—'} size={44} variant="neutral" />
              <TopText>
                <TopName>{name || '—'}</TopName>
                {data.company_name && data.display_name && <TopSub>{data.company_name}</TopSub>}
                {/* ★ 2026-09-13 — 단계는 **여기서 바꾼다**(Irene: "우측패널에 액션버튼 다 나오게 하고
                    단계도 바꾸게 하고"). 하단의 계약 성사/불발 버튼을 없앤 자리를 이것이 대신한다.
                    ★ 전체 프로필(SaleDetailPage)과 **같은 ChipPopover** 다 — 새로 그리면 두 화면이 갈라진다.
                    'lost' 를 고르면 changeStage 가 사유 모달로 보낸다(왜 깨졌는지가 원장에 남아야 한다). */}
                <ChipPopover
                  prefix={t('stage.label') as string}
                  label={t(`stage.${data.sales_stage}`) as string}
                  active={data.sales_stage !== 'none'}
                  data-testid="client-panel-stage-chip"
                  width={260}
                >
                  {(close) => (
                    <OptionList role="listbox">
                      {SALE_STAGES.map((s) => (
                        <OptionBtn key={s} type="button" role="option" aria-selected={data.sales_stage === s}
                          $on={data.sales_stage === s}
                          data-testid={`client-panel-stage-${s}`}
                          onClick={() => { close(); changeStage(s); }}>
                          <OptName>{t(`stage.${s}`) as string}</OptName>
                          <OptHint>{t(`stage.${s}_hint`) as string}</OptHint>
                        </OptionBtn>
                      ))}
                    </OptionList>
                  )}
                </ChipPopover>
              </TopText>
            </Top>

            <Section>
              <SectionTitle>{t('panel.contact') as string}</SectionTitle>
              <Row label={t('panel.phone') as string} value={data.contact?.phone} />
              {/* ★ 이메일은 **종류별로** 보여준다 — 목록처럼 하나로 접으면 어떤 주소인지 알 수 없다 */}
              <Row label={t('panel.accountEmail') as string} value={data.contact?.account_email} />
              <Row label={t('panel.inviteEmail') as string} value={data.contact?.invite_email} />
              <Row label={t('panel.billingEmail') as string} value={data.contact?.billing_email} />
              <Row label={t('panel.taxEmail') as string} value={data.contact?.tax_invoice_email} />
            </Section>

            {data.biz && (
              <Section>
                <SectionTitle>{t('panel.biz') as string}</SectionTitle>
                <Row label={t('panel.bizName') as string} value={data.biz.name} />
                <Row label={t('panel.bizCeo') as string} value={data.biz.ceo} />
                <Row label={t('panel.bizTaxId') as string} value={data.biz.tax_id} />
                <Row label={t('panel.bizAddress') as string} value={data.biz.address} />
              </Section>
            )}

            <Section>
              <SectionTitle>{t('panel.registered') as string}</SectionTitle>
              {/* 누가 언제 등록했는가 — 값은 줄곧 원장에 있었고 **화면에 없었을 뿐**이다(Irene 2026-09-12) */}
              <Row label={t('panel.registeredBy') as string} value={data.registered_by?.name || null} />
              <Row label={t('panel.registeredAt') as string}
                value={data.registered_at ? formatDateTime(data.registered_at) : null} />
            </Section>

            <Section>
              <SectionTitle>{t('panel.linked') as string}</SectionTitle>
              {/* ★ 숫자를 누르면 **그 채널만** 보이는 히스토리로 간다 (Irene 2026-09-12:
                  "숫자들이나 내용들 누르면 연결되어야지"). 죽은 숫자를 두지 않는다. */}
              <LinkRow>
                <FieldLabel>{t('panel.conversations') as string}</FieldLabel>
                <CountLink type="button" data-testid="panel-link-chat"
                  disabled={!(data.channels?.conversations)}
                  onClick={() => clientId && navigate(`/sale/${clientId}?channel=chat`)}>
                  {data.channels?.conversations ?? 0}
                </CountLink>
              </LinkRow>
              <LinkRow>
                <FieldLabel>{t('panel.emailThreads') as string}</FieldLabel>
                <CountLink type="button" data-testid="panel-link-mail"
                  disabled={!(data.channels?.email_threads)}
                  onClick={() => clientId && navigate(`/sale/${clientId}?channel=email`)}>
                  {data.channels?.email_threads ?? 0}
                </CountLink>
              </LinkRow>
              {/* 프로젝트 상세는 /projects/p/:id 다 — /projects/:id 는 목록 라우트(:view)에 걸려 엉뚱한 화면이 열린다 */}
              {data.projects?.length > 0 && (
                <ProjList>
                  {data.projects.map((p) => (
                    <ProjItem key={p.id} type="button" onClick={() => navigate(`/projects/p/${p.id}`)}>{p.name}</ProjItem>
                  ))}
                </ProjList>
              )}
            </Section>

            {/* 히스토리 — 상세와 같은 컴포넌트. 여기서는 최근 몇 건만, 전체는 전체보기에서. */}
            <Section>
              <SectionTitle>{t('panel.history') as string}</SectionTitle>
              {histLoading ? (
                <Dim>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
              ) : items.length === 0 ? (
                <Dim>{t('timeline.empty') as string}</Dim>
              ) : (
                <>
                  <ClientTimeline items={items} onOpen={(it) => openSaleTimelineItem(it, navigate)} />
                  {clientId && (
                    <MoreLink type="button" data-testid="panel-history-more"
                      onClick={() => navigate(`/sale/${clientId}`)}>
                      {t('panel.historyMore') as string}
                    </MoreLink>
                  )}
                </>
              )}
            </Section>

            {/* ★ 보관·삭제·한도 같은 **관리**는 여기 없다 — 설정 > 고객/파트너의 몫이다.
                초대는 상담에서 바로 필요하다는 지시(2026-09-12)에 따라 아래 액션에 둔다. */}
          </>
        )}
      </DetailDrawer.Body>

      <DetailDrawer.Footer>
        {isInquiry && inquiry ? (
          <>
            <ActionButton tone="secondary" size="md" data-testid="inquiry-panel-view"
              onClick={() => navigate(inquiry.openPath)}>
              {t('action.view') as string}
            </ActionButton>
            {inquiry.canRegister && (
              <ActionButton tone="primary" size="md" loading={registerBusy}
                data-testid="inquiry-panel-register" onClick={() => onRegister?.()}>
                {t('action.registerClient') as string}
              </ActionButton>
            )}
          </>
        ) : (
          <>
        {/* ★ 2026-09-12 Irene: "액션버튼 어디갔어? 프로젝트/고객 추가 초대, 청구서 발행, 메모" ·
            "그 다음 언제 연락해야 하는지 미팅 일정도 넣고 연결해야지."
            상담 관리의 다음 액션을 여기 모은다 — 상세 페이지와 **같은 창**을 쓴다. */}
        <ActionButton tone="secondary" size="md" disabled={!data}
          data-testid="client-panel-record" onClick={() => setRecordOpen(true)}>
          {t('action.addRecord') as string}
        </ActionButton>
        <ActionButton tone="secondary" size="md" disabled={!data}
          data-testid="client-panel-next" onClick={() => setNextOpen(true)}>
          {t('next.title') as string}
        </ActionButton>
        <ActionButton tone="secondary" size="md" disabled={!data}
          data-testid="client-panel-task" onClick={() => setTaskOpen(true)}>
          {t('action.addTask') as string}
        </ActionButton>
        <ActionButton tone="secondary" size="md" disabled={!data}
          data-testid="client-panel-invoice"
          // ★ 경로는 **/bills** 다(`/bill` 은 라우트가 없다 — 가드 `--category=routelink` 가 잡았다).
          //   그리고 기본 탭은 개요라 `tab=invoices` 를 지정해야 청구서 모달이 있는 화면이 뜬다.
          onClick={() => clientId && navigate(`/bills?tab=invoices&new=1&client=${clientId}`)}>
          {t('action.createInvoice') as string}
        </ActionButton>
        <ActionButton tone="secondary" size="md" disabled={!data}
          data-testid="client-panel-project"
          onClick={() => clientId && navigate(`/projects?new=1&client=${clientId}`)}>
          {t('action.createProject') as string}
        </ActionButton>
        {/* 계약서 — Q docs 문서를 만들어 바로 연다. 분류는 제목으로 정해진다(docs 의 기존 규칙 `inferKindFromTitle`). */}
        <ActionButton tone="secondary" size="md" disabled={!data || busy}
          data-testid="client-panel-contract" onClick={createContract}>
          {t('action.createContract') as string}
        </ActionButton>
        {/* 초대 — 문의 고객에게만(이미 초대·계정이 있으면 할 일이 없다). 주소가 없으면 설정에서 넣는다. */}
        {data?.status === 'prospect' && (
          <ActionButton tone="secondary" size="md" disabled={busy || !inviteEmail}
            data-testid="client-panel-invite"
            title={inviteEmail ? undefined : (t('action.inviteNoEmail') as string)}
            onClick={() => setInviteAsk(true)}>
            {t('action.invite') as string}
          </ActionButton>
        )}
        {/* ★ 2026-09-13 (Irene: "계약성사는 버튼도 아니고 그냥 계약을 하면 한거고. 그리고 계약 성사를
            눌렀더니 그냥 성사라고 표시되는데 이게 뭐야.") — **계약 성사/불발 버튼을 없앴다.**
            그 둘은 *할 일*이 아니라 **일어난 일의 기록**이고, 위 단계 칩이 이미 같은 일을 한다.
            버튼과 칩이 같은 값을 두 벌로 바꾸고 있었다(누르면 단계만 '성사' 로 바뀌니 "이게 뭐야" 가 된다).
            불발 사유는 단계 칩에서 'lost' 를 고를 때 그대로 묻는다(LostReasonModal). */}
          </>
        )}
      </DetailDrawer.Footer>

      {clientId && data && (
        <>
          <RecordModal open={recordOpen} businessId={businessId} clientId={clientId}
            onClose={() => setRecordOpen(false)}
            onSaved={() => { setRecordOpen(false); void reload(); }} />
          <NextContactModal open={nextOpen} businessId={businessId} clientId={clientId}
            clientName={name || '—'}
            onClose={() => setNextOpen(false)}
            onSaved={() => { setNextOpen(false); void reload(); }} />
          {/* ★ 발송 전 확인 — 주소를 **보여주고** 묻는다. "정말?" 만 묻는 창은 확인이 아니다. */}
          <ConfirmDialog
            isOpen={inviteAsk}
            title={t('action.inviteConfirmTitle') as string}
            message={t('action.inviteConfirmBody', { email: inviteEmail }) as string}
            confirmText={t('action.invite') as string}
            cancelText={t('inquiry.cancel') as string}
            variant="info"
            onClose={() => setInviteAsk(false)}
            onConfirm={() => { setInviteAsk(false); void sendInvite(); }}
          />
          {/* ★ 고객을 실어 보낸다 — 여기서 만든 업무는 **그 고객의 업무**다(tasks.client_id).
              이 줄이 없으면 폼은 열리는데 만들어진 업무가 고객에 안 붙어, 다시 열어도 아무것도 안 보인다. */}
          {taskOpen && (
            <TaskCreateForm businessId={businessId} layout="drawer" fixedClientId={clientId}
              onClose={() => setTaskOpen(false)} onCreated={() => { setTaskOpen(false); void reload(); }} />
          )}
        </>
      )}

      {clientId && (
        <LostReasonModal
          open={lostOpen}
          businessId={businessId}
          clientId={clientId}
          onClose={() => setLostOpen(false)}
          onConfirm={async (reason, note) => {
            await applyStage('lost', { lost_reason: reason, lost_note: note });
            setLostOpen(false);
          }}
        />
      )}
    </DetailDrawer>
  );
};

const Row: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  value ? <FieldRow><FieldLabel>{label}</FieldLabel><FieldValue>{value}</FieldValue></FieldRow> : null
);

export default ClientPanel;

const HeadRow = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;`;
const HeadName = styled.div`
  font-size: 0.9375rem; font-weight: 700; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
`;
const IconBtn = styled.button`
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF; color: #475569;
  cursor: pointer; flex-shrink: 0;
  &:hover { background: #F8FAFC; }
`;
const Top = styled.div`display: flex; align-items: center; gap: 12px; padding: 4px 0 16px;`;
const TopText = styled.div`min-width: 0;`;
const TopName = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const TopSub = styled.div`margin-top: 2px; font-size: 0.8125rem; color: #64748B;`;
const StageTag = styled.span`
  display: inline-block; margin-top: 6px; padding: 3px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; font-size: 0.75rem; font-weight: 600;
`;
const Section = styled.section`padding: 14px 0; border-top: 1px solid #F1F5F9;`;
const SectionTitle = styled.h3`margin: 0 0 8px; font-size: 0.8125rem; font-weight: 700; color: #475569;`;
const FieldRow = styled.div`display: flex; gap: 10px; padding: 4px 0; font-size: 0.8125rem;`;
const FieldLabel = styled.span`min-width: 92px; color: #94A3B8; flex-shrink: 0;`;
const FieldValue = styled.span`color: #0F172A; word-break: break-all;`;
const ProjList = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;`;
const ProjItem = styled.button`
  padding: 4px 10px; border: 1px solid #E2E8F0; border-radius: 999px; background: #FFFFFF;
  color: #334155; font-size: 0.75rem; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const PreviewBox = styled.div`
  margin-top: 8px; padding: 10px 12px; background: #F8FAFC; border: 1px solid #F1F5F9;
  border-radius: 8px; font-size: 0.8125rem; color: #334155; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow-y: auto;
`;
const LinkRow = styled.div`display: flex; align-items: center; gap: 10px; padding: 4px 0; font-size: 0.8125rem;`;
const CountLink = styled.button`
  padding: 2px 10px; border-radius: 999px; border: 1px solid #E2E8F0; background: #FFFFFF;
  color: #0F766E; font-size: 0.8125rem; font-weight: 700; cursor: pointer; font-family: inherit;
  &:hover:not(:disabled) { background: #F0FDFA; border-color: #5EEAD4; }
  &:disabled { color: #94A3B8; cursor: default; }
`;
const MoreLink = styled.button`
  margin-top: 8px; padding: 0; background: none; border: none; color: #0F766E;
  font-size: 0.75rem; font-weight: 600; cursor: pointer; font-family: inherit;
  &:hover { text-decoration: underline; }
`;
const Dim = styled.div`padding: 32px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
