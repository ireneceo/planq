// pages/QSale/SalePage.tsx — Q sale 목록 (docs/Q_SALE_DESIGN.md §5.2)
//   관리 리스트 패턴(PageShell) — 고객 관리 목록과 같은 규격.
//   ★ 접근 종류·한도 포함 여부는 서버가 준 값만 쓴다(화면이 user_id 로 판정하지 않는다).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { FilterBar, FilterSlot, ToggleFilter, CheckFilter, axisOption } from '../../components/Common/filterBar';
import { ChipRow, FilterChip, ChipDivider, ChipRight } from '../../components/Common/filterChip';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import ActionButton from '../../components/Common/ActionButton';
import StandardModal from '../../components/Common/StandardModal';
import LetterAvatar from '../../components/Common/LetterAvatar';
// ★ 2026-09-12 Irene: "상세(채팅, 메일, 전화, 등등) > 고객 이렇게 들어가야지 · 상담리스트, 고객리스트 2가지 다 보여줘도 좋고"
//   입구를 상담(고객 미등록 문의)으로 바꾸고 고객 목록은 옆 탭으로 둔다. 목록·액션은 SaleInboxList 한 곳.
import SaleInboxList from '../../components/QSale/SaleInboxList';
import SaleCueBar from '../../components/QSale/SaleCueBar';
// 응대 내역 입력칸은 **공용 한 벌** — RecordModal 과 같은 것을 쓴다
import InteractionFields, { emptyInteraction, type InteractionValue } from '../../components/QSale/InteractionFields';
// 이메일·전화는 **공용 입력**을 쓴다 — 형식을 입력 중에 맞춰 주고 틀리면 그 자리에서 말한다
import EmailInput, { isEmailUsable } from '../../components/Common/EmailInput';
import PhoneInput, { isPhoneUsable } from '../../components/Common/PhoneInput';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import {
  listSaleClients, getSaleSummary, saveAsClient,
  SALE_STAGES, IN_PROGRESS_STAGES, SALE_SOURCES,
  type SaleClient, type SaleSummary, type SaleStage, type AccessKind, type SaleSource,
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
  // ★ 2026-09-14 — 상담 탭 필터도 **부모가 들고 있다.** 두 탭이 같은 축(단계·접근·담당)을 쓰므로
  //   탭을 오갈 때 고른 것이 유지되고, 필터 UI 도 한 벌만 그린다(자식 안에 또 그리면 갈라진다).
  const [replyOnly, setReplyOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [inboxCounts, setInboxCounts] = useState<{ needs_reply: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // ★ 행을 눌러도 **페이지를 갈아타지 않는다** (Irene 2026-09-12: "고객탭에서는 리스트 누르면
  //   페이지 전환하지 말고 우측패널 나오게 하고"). 전체를 보려면 패널 헤더의 전체보기 아이콘.
  // ★ 우측 패널은 **URL 과 묶는다**(UI_DESIGN_GUIDE §1.9 · CLAUDE.md 상세/드로어 URL 싱크).
  //   state 로만 열면 새로고침하면 사라지고, 링크를 보내도 상대는 목록만 본다.
  //   ★ 초기값으로만 읽지 않는다 — keep-alive 탭에서는 컴포넌트가 살아 있어 초기값이 다시 안 돈다
  //     (memory feedback_url_param_read_once_keepalive). searchParams 를 그대로 정본으로 쓴다.
  const [searchParams, setSearchParams] = useSearchParams();
  const panelClientId = (() => {
    const raw = searchParams.get('client');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const setPanelClientId = useCallback((next: number | null | ((prev: number | null) => number | null)) => {
    setSearchParams((sp) => {
      const cur = (() => { const r = sp.get('client'); const n = r ? Number(r) : NaN; return Number.isFinite(n) && n > 0 ? n : null; })();
      const v = typeof next === 'function' ? (next as (p: number | null) => number | null)(cur) : next;
      const out = new URLSearchParams(sp);
      if (v) out.set('client', String(v)); else out.delete('client');
      return out;
    }, { replace: true });
  }, [setSearchParams]);
  // ★ 2026-09-14 (Irene: *"확인필요에서 영업 링크 누르면 우측패널이 고객정보 나오는데 상담관리가 안되네.
  //   그냥 상담에서 검색해서 해당 상담이 딱 리스트업된 상태가 되게 해줘."*)
  //   확인필요·알림이 `/sale?q=이름` 으로 보낸다. 열자마자 **상담 탭에서 그 건만 걸러진 상태**가 되고,
  //   단계 바꾸기·메모·일정을 그 행에서 바로 할 수 있다(고객 패널에서는 못 하던 것들이다).
  //   ★ 초기값으로만 읽지 않는다 — keep-alive 탭은 컴포넌트가 살아 있어 초기값이 다시 안 돈다.
  const urlQ = searchParams.get('q') || '';
  useEffect(() => {
    if (!urlQ) return;
    setQ(urlQ);
    setTab('inbox');
  }, [urlQ]);

  // 상담 목록을 다시 읽게 하는 신호 — 문의를 추가하면 **그 목록에** 들어와야 한다
  const [inboxRefresh, setInboxRefresh] = useState(0);

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

  // 한도의 80% 를 넘었는가 — 늘리는 길을 내보일지 판정한다(무제한이면 언제나 아니다).
  const quotaTight = !!summary && (
    (!!summary.quota.clients_max && summary.quota.clients / summary.quota.clients_max >= 0.8)
    || (!!summary.quota.prospects_max && summary.quota.prospects / summary.quota.prospects_max >= 0.8)
  );

  // ★ 2026-09-14 2차 — 첫 옵션의 라벨은 **축 이름**이다 (Irene: *"항목명으로 필요 없고 전체가
  //   필요없는 거야."*). 고르기 전에는 무슨 축인지 보이고, 이 옵션을 다시 고르면 필터가 풀린다.
  //   `axisOption` 한 함수로만 만든다 — 손으로 쓰면 화면마다 "전체"/축 이름이 섞인다.
  const stageOptions = useMemo(() => ([
    axisOption(t('stage.label') as string),
    { value: 'in_progress', label: t('list.stageInProgress') as string },
    ...SALE_STAGES.map((s) => ({ value: s, label: t(`stage.${s}`) as string })),
  ]), [t]);
  const accessOptions = useMemo(() => ([
    axisOption(t('access.label') as string),
    { value: 'guest', label: t('access.guest') as string },
    { value: 'invited', label: t('access.invited') as string },
    { value: 'member', label: t('access.member') as string },
  ]), [t]);
  const assigneeOptions = useMemo(() => {
    const names = new Map<number, string>();
    for (const c of items) if (c.assigned_member) names.set(c.assigned_member.id, c.assigned_member.name);
    return [
      axisOption(t('list.assignee') as string),
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
          {/* ★ 2026-09-14 (Irene: *"Q sale UI를 Q task 처럼 해줘. 우측 상단에 연회색 탭으로 상담, 고객을
              넣어주고 … 색상이나 디자인 막 바꾸지 말고 배치를 맞춰봐."*)
              탭이 **머리 오른쪽**으로 올라간다. Q task 의 [내 업무 | 전체 업무] 와 같은 컴포넌트다
              (`components/Common/segmentedToggle` — 베끼지 않고 빼서 같이 쓴다).

              ★ 2026-09-14 2차 (Irene: *"검색 · [고객응대 내역 추가] 를 우측 상단 헤더에 붙여줘.
                추가 버튼은 상담/고객 탭 뒤에."*) — 검색과 주 액션이 **필터줄에서 헤더로** 올라왔다.
                필터줄에는 이제 **거르는 것만** 남는다(축 셀렉트 3 + 대응필요만 + 종료가리기).
                자리: [검색] [상담|고객] [+ 고객응대 내역 추가] */}
          <HeaderSearch>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)}
              data-testid="sale-search"
              placeholder={t('list.searchPlaceholder') as string}
              aria-label={t('list.searchPlaceholder') as string} />
          </HeaderSearch>
          <SegmentedToggle role="tablist">
            <SegmentedBtn type="button" role="tab" aria-selected={tab === 'inbox'} data-testid="sale-tab-inbox"
              $active={tab === 'inbox'} onClick={() => setTab('inbox')}>
              {t('list.tabInbox') as string}
            </SegmentedBtn>
            <SegmentedBtn type="button" role="tab" aria-selected={tab === 'clients'} data-testid="sale-tab-clients"
              $active={tab === 'clients'} onClick={() => setTab('clients')}>
              {t('list.tabClients') as string}
            </SegmentedBtn>
          </SegmentedToggle>
          {/* ★ 2026-09-14 2차 (Irene: *"`+` 를 붙이는 것이 기존 버튼 스타일이야. 색상도 덜 진해야 하고."*)
              다른 목록 화면의 추가 버튼과 같은 모양 — 앞에 `+`, secondary 톤, 작은 크기(xs). */}
          <ActionButton tone="secondary" size="xs" data-testid="sale-add-inquiry"
            icon={<PlusIcon aria-hidden />} onClick={() => setAddOpen(true)}>
            {t('action.addRecord') as string}
          </ActionButton>
        </Actions>
      )}
    >
      {/* ★ Cue 에게 말하기는 **탭 위**다 (Irene 2026-09-13: "Cue 에게 말하기는 상담/고객 탭 위로 둬.
          어차피 같은 맥락으로 추가되는 거니까 상위가 맞아").
          두 탭 어디서 말하든 같은 곳(상담)에 들어가므로 탭에 종속된 자리가 아니다 —
          탭 아래에 두면 "이 탭에만 해당하는 입력" 으로 읽힌다. */}
      {businessId && (
        <SaleCueBar businessId={businessId}
          onCreated={() => {
            // ★ 등록했으면 **그 자리(상담 탭)** 에서 보인다 — 고객 탭으로 튕기지 않는다.
            //   상담 목록은 진행 중인 고객도 포함하므로 재조회하면 방금 넣은 것이 맨 위에 온다.
            // ★ 2026-09-14 (Irene: *"그대로 리스트에 추가하면 되지 우측패널 왜 열려?"*)
            //   여기서 `setPanelClientId` 를 불러 우측 패널을 열고 있었다. 확인은 이미 Cue 바의
            //   **정리 단계**에서 끝났다 — 그 뒤에 패널을 여는 것은 한 번 더 확인을 시키는 셈이다.
            setInboxRefresh((n) => n + 1);
            load({ silent: true, page: 1 });
          }} />
      )}

      {/* ★ 2026-09-14 2차 — 여기 남은 것은 **거르는 것뿐**이다(검색·추가는 헤더로 올라갔다).
          · 축 이름은 셀렉트 **안**(첫 옵션). "전체" 라는 낱말은 쓰지 않지만 되돌릴 길은 그 옵션이다.
          · 같은 축(단계·접근·담당)을 **두 탭에 똑같이** 건다.
          · 대응 필요만 = 알약(지금 이것만 본다) / 종료 가리기 = 체크박스(늘 이렇게 본다). 쓰임이 다르다.
          · 좁아지면 가로로 숨기지 않고 **줄이 바뀐다**. */}
      <FilterBar data-testid="sale-filter-row">
        <FilterSlot width={130} testId="sale-stage-filter">
          <PlanQSelect size="sm" isSearchable={false} options={stageOptions}
            aria-label={t('stage.label') as string}
            value={stageOptions.find((o) => o.value === stage) || stageOptions[0]}
            onChange={(opt: unknown) => setStage(String((opt as { value?: string } | null)?.value ?? ''))} />
        </FilterSlot>
        <FilterSlot width={120} testId="sale-access-filter">
          <PlanQSelect size="sm" isSearchable={false} options={accessOptions}
            aria-label={t('access.label') as string}
            value={accessOptions.find((o) => o.value === access) || accessOptions[0]}
            onChange={(opt: unknown) => setAccess(String((opt as { value?: string } | null)?.value ?? ''))} />
        </FilterSlot>
        <FilterSlot width={130} testId="sale-assignee-filter">
          <PlanQSelect size="sm" isSearchable={false} options={assigneeOptions}
            aria-label={t('list.assignee') as string}
            value={assigneeOptions.find((o) => o.value === assignee) || assigneeOptions[0]}
            onChange={(opt: unknown) => setAssignee(String((opt as { value?: string } | null)?.value ?? ''))} />
        </FilterSlot>
        {tab === 'inbox' && (
          <>
            {/* 참/거짓 하나짜리는 셀렉트로 만들지 않는다 — 켜고 끄는 것이 곧 뜻이다 */}
            <ToggleFilter type="button" data-testid="sale-inbox-needs-reply" $accent
              $on={replyOnly} onClick={() => setReplyOnly((v) => !v)}>
              {t('inbox.needsReplyOnly') as string}
              {inboxCounts ? <b>{inboxCounts.needs_reply}</b> : null}
            </ToggleFilter>
            {/* ★ 종료 가리기는 **체크박스**로 되돌렸다 (Irene 2026-09-14: *"기존대로 체크박스."*)
                기본 켜짐인 상시 설정이라 알약으로 강조할 것이 아니다. */}
            <CheckFilter data-testid="sale-inbox-hide-closed">
              <input type="checkbox" checked={hideClosed}
                onChange={(e) => setHideClosed(e.target.checked)} />
              {t('inbox.hideClosed') as string}
            </CheckFilter>
          </>
        )}
      </FilterBar>

      {tab === 'inbox' ? (
        businessId ? (
          <SaleInboxList businessId={businessId} q={q} refreshKey={inboxRefresh}
            stage={stage} access={access} assignee={assignee}
            replyOnly={replyOnly} hideClosed={hideClosed}
            onCounts={setInboxCounts}
            onRegistered={() => { setInboxRefresh((n) => n + 1); load({ silent: true, page: 1 }); }}
            />
        ) : null
      ) : (
      <>
      {/* ★ 2026-09-14 2차 (Irene: *"세일에서 고객탭은 필터랑 버튼 디자인들 위치 맞추라고 한거야."*)
          상담 탭의 칩 줄과 **같은 껍데기**를 쓴다(`components/Common/filterChip`).
          전에는 두 탭이 알약을 각자 선언해 줄 시작 y 가 10px, 켜진 테두리색이 달랐다. */}
      {summary && (
        <ChipRow data-testid="sale-clients-chip-row">
            {/* ★ 2026-09-12 Irene: "Q sales 가면 전체가 없어" — 설계 §5.2 는 "전체 칩 항상" 이었는데 구현에서 빠졌다.
                칩으로 필터를 건 뒤 전체로 돌아갈 길이 같은 칩 재클릭뿐이라, 무엇을 보고 있는지도 알 수 없었다. */}
            <FilterChip type="button" data-testid="sale-stage-chip-all"
              $on={stage === ''}
              onClick={() => setStage('')}>
              {t('list.filterAll') as string} <b>{total}</b>
            </FilterChip>
            <ChipDivider aria-hidden />
            {IN_PROGRESS_STAGES.map((s) => (
              <FilterChip key={s} type="button" data-testid={`sale-stage-chip-${s}`}
                $on={stage === s}
                title={t(`stage.${s}_hint`) as string}
                onClick={() => setStage((prev) => (prev === s ? '' : s))}>
                {t(`stage.${s}`) as string} <b>{summary.stage_counts[s] ?? 0}</b>
              </FilterChip>
            ))}
            <ChipDivider aria-hidden />
            <FilterChip type="button" $on={stage === 'won'} title={t('stage.won_hint') as string}
              onClick={() => setStage((prev) => (prev === 'won' ? '' : 'won'))}>
              {t('stage.won') as string} <b>{summary.this_month.won}</b>
            </FilterChip>
            <FilterChip type="button" $on={stage === 'lost'} title={t('stage.lost_hint') as string}
              onClick={() => setStage((prev) => (prev === 'lost' ? '' : 'lost'))}>
              {t('stage.lost') as string} <b>{summary.this_month.lost}</b>
            </FilterChip>
            <ChipDivider aria-hidden />
            <FilterChip type="button" $on={stage === 'none'} title={t('stage.none_hint') as string}
              onClick={() => setStage((prev) => (prev === 'none' ? '' : 'none'))}>
              {t('stage.none') as string} <b>{summary.stage_counts.none ?? 0}</b>
            </FilterChip>

          {/* ★ 2026-09-14 (Irene: *"정식 4/100 · 문의 4/300 이거 누르면 왜 구독플랜으로 가? 이게 무슨 상황이야?"*)
              이건 **현황 표시**다. 그런데 통째로 버튼이라 눌리면 결제 화면으로 튀었다 —
              숫자를 확인하려고 누른 사람에게는 아무 설명 없이 장소가 바뀌는 일이다.
              이제 ①평소엔 누를 수 없는 표시이고 ②무슨 숫자인지 말해 주며
              ③**한도에 가까울 때만**(80%) 늘리는 길을 따로 내놓는다. */}
          <ChipRight>
          <QuotaBox data-testid="sale-quota" title={t('quota.tip', {
            defaultValue: '정식 = 계정을 만들어 드린 고객 · 문의 = 아직 초대하지 않은 상담 상대. 숫자는 현재 / 플랜 한도입니다.',
          }) as string}>
            <span>{quotaLabel}</span>
            {quotaTight && (
              <QuotaCta type="button" data-testid="sale-quota-raise"
                onClick={() => navigate('/business/settings/plan')}>
                {t('quota.raise', { defaultValue: '한도 늘리기' }) as string}
              </QuotaCta>
            )}
          </QuotaBox>
          </ChipRight>
        </ChipRow>
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
        onDone={(clientId) => {
          // ★ 여태 패널만 열고 **목록을 다시 읽지 않았다**(Irene: "우측 패널만 생기고 실제로 리스트에
          //   추가 안 되고 있어"). 상담 목록·고객 목록 둘 다 갱신하고, 탭은 그대로 둔다.
          setAddOpen(false);
          setInboxRefresh((n) => n + 1);
          load({ silent: true, page: 1 });
          setPanelClientId(clientId);
        }}
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
  // 응대 내역 값 — 공용 칸(InteractionFields)이 쓰는 모양 그대로
  const [rec, setRec] = useState<InteractionValue>(() => emptyInteraction());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 붙여넣은 글·상담 메모는 길다 — 쓰다 닫아도 남는다(입력 초안 계약).
  //   대상이 하나뿐인 폼이라 entityId 는 고정값이고, 비우는 것은 **저장 성공**뿐이다.
  const note = useDraftText(useDraftKey('sale-inquiry-add', 'note', businessId));

  const sourceOptions = useMemo(() => SALE_SOURCES.map((x) => ({ value: x as string, label: t(`source.${x}`) as string })), [t]);

  useEffect(() => {
    // ★ 초안(붙여넣은 글·메모)은 **여기서 비우지 않는다** — 열 때마다 지우면 초안이 아니다.
    if (open) { setName(''); setCompany(''); setPhone(''); setEmail(''); setSource('manual'); setRec(emptyInteraction()); setErr(null); }
  }, [open]);

  const submit = async () => {
    if (!businessId || saving) return;              // 중복 제출 가드
    if (!name.trim() && !company.trim()) { setErr(t('inquiry.nameRequired') as string); return; }
    // 형식이 틀린 값은 **보내지 않는다** — 서버 400 을 받고 나서 말하면 사용자는 무엇이 틀렸는지 모른다
    if (!isEmailUsable(email)) { setErr(t('inquiry.invalidEmail') as string); return; }
    if (!isPhoneUsable(phone)) { setErr(t('inquiry.invalidPhone') as string); return; }
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
        // 시각·제목·길이까지 같이 보낸다 — 칸이 생겼는데 안 보내면 사용자가 적은 것이 사라진다
        interaction: body ? {
          kind: rec.kind, body,
          direction: rec.direction || 'inbound',
          occurred_at: rec.date && rec.time ? `${rec.date}T${rec.time}` : undefined,
          title: rec.title.trim() || undefined,
          duration_minutes: rec.minutes ? Number(rec.minutes) : undefined,
        } : undefined,
      });
      // 저장이 끝난 뒤에만 초안을 비운다 — 실패를 삼키고 비우면 저장 실패가 곧 글 삭제다
      note.clear();
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
    <StandardModal open={open} onClose={onClose} title={t('action.addRecord') as string} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="sale-inquiry-submit">
            {t('inquiry.submit') as string}
          </ActionButton>
        </>
      )}>
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
        <PhoneInput id="sale-inq-phone" value={phone} onChange={setPhone} />
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-inq-email">{t('inquiry.emailLabel') as string}</FieldLabel>
        <EmailInput id="sale-inq-email" value={email} onChange={setEmail} />
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
      {/* ★ 응대 내역 칸은 **공용 한 벌**(InteractionFields) — `RecordModal` 과 같은 것을 쓴다.
          2026-09-13 이전엔 여기만 종류·내용 둘뿐이라, 어디서 적느냐에 따라 남는 정보가 달랐다. */}
      <InteractionFields
        idPrefix="sale-inq"
        value={rec}
        onChange={(patch) => setRec((v) => ({ ...v, ...patch }))}
        bodySlot={(
          <TextArea id="sale-inq-body" rows={3} data-draft-kind="sale-inquiry-add"
            placeholder={t('inquiry.notePlaceholder') as string}
            value={note.text} onChange={(e) => note.setText(e.target.value)} />
        )}
      />
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
/* 헤더의 검색칸 — 머리 줄에 서므로 헤더 컨트롤 높이(32)에 맞춘다.
   폭은 데스크탑에서 적당히 고정하고, 폰에서는 남는 만큼 늘린다(머리 줄이 가로로 스크롤된다). */
const HeaderSearch = styled.div`
  flex: 0 1 200px; min-width: 120px;
  @media (max-width: 640px) { flex: 1 1 140px; }
`;
const PlusIcon = styled.span.attrs({
  children: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
})`display: inline-flex; align-items: center;`;
const SearchInput = styled.input`
  height: 32px; width: 100%; padding: 0 10px; box-sizing: border-box;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
// 현황 표시 — 누르는 것이 아니다. 늘리는 길은 안쪽의 작은 버튼이 따로 갖는다.
const QuotaBox = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 12px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600; color: #475569;
  background: #F8FAFC; border: 1px solid #E2E8F0;
`;
const QuotaCta = styled.button`
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 0.75rem; font-weight: 700; color: #F43F5E;
  text-decoration: underline; text-underline-offset: 2px;
  &:hover { color: #E11D48; }
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
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
