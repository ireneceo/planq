// SaleInboxList — Q sale "상담" 목록 (고객으로 **등록되지 않은** 문의)
//
// Irene 2026-09-12: *"이게 왜 고객 > 상세야? 상세(채팅, 메일, 전화, 등등) > 고객 이렇게 들어가야지."*
//   *"실제 세일에서 할 일을 해야지. 액션이 있어야지. 내용은 여기서 확인하고 보러가게 하고 답변하게 하거나
//     업무추가하거나 고객으로 등록하거나. 게스트가 문의하거나 이메일로 문의온 경우 고객으로 등록 안된 경우."*
//
// 서버(services/saleInbox)는 새 테이블 없이 원본(게스트 링크·메일 스레드·고객 대화방)에서 client_id 가 빈 것만 읽는다.
// 여기서 하는 일은 셋뿐이다 — **보고**(미리보기·원본 열기) · **고객으로 등록** · **업무 추가**.
// ★ "고객으로 등록" 은 서버가 guest_link·email_thread 만 받는다(routes/sale_save.js).
//   그래서 판정은 **source 가 아니라 `ref.kind`** 다 — 게스트가 채팅에서 이메일을 남기면
//   그 대화에 링크가 붙고, 서버는 그 링크로 등록할 수 있다(2026-09-12 Irene: "채팅할 때 고객이 이메일 넣으면?").
//   링크가 없는 순수 대화방(`ref.kind === 'conversation'`)에만 버튼을 숨긴다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, onSocket } from '../../services/socket';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import ActionButton from '../Common/ActionButton';
import TaskCreateForm from '../QTask/TaskCreateForm';
import ClientPanel, { type InquiryView } from './ClientPanel';
import LetterAvatar from '../Common/LetterAvatar';
import HighlightText from '../Common/HighlightText';
import { listSaleInbox, dismissInboxItem, type SaleInboxItem, type SaleInboxCounts, type SaleInboxSource } from '../../services/sale';

interface Props {
  businessId: number;
  /** 부모가 올리면 목록을 다시 읽는다 — 문의를 추가하면 **이 목록에** 들어와야 한다 */
  refreshKey?: number;
  /** 등록된 상담(고객) 행을 누르면 부모의 고객 패널을 연다 — 패널이 두 벌이 되지 않게 */
  onOpenClient?: (clientId: number) => void;
  /** 상단 검색어 — 목록 필터에 그대로 넘긴다(서버가 제목·상대·미리보기에서 찾는다) */
  q: string;
  /** 고객으로 등록이 끝나면 고객 탭 숫자가 바뀐다 — 부모가 다시 읽는다 */
  onRegistered?: () => void;
}

const SOURCES: Array<SaleInboxSource | ''> = ['', 'guest_link', 'email', 'chat'];

const SaleInboxList: React.FC<Props> = ({ businessId, q, refreshKey = 0, onRegistered, onOpenClient }) => {
  const { t } = useTranslation('qsale');
  const navigate = useChromeNav();
  const { formatDateTime, formatTimeAgo } = useTimeFormat();

  const [source, setSource] = useState<SaleInboxSource | ''>('');
  const [replyOnly, setReplyOnly] = useState(false);
  const [items, setItems] = useState<SaleInboxItem[]>([]);
  const [counts, setCounts] = useState<SaleInboxCounts>({ total: 0, needs_reply: 0, guest_link: 0, email: 0, chat: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 행을 누르면 **우측 패널**이 열린다 (Irene 2026-09-12: *"리스트 누르면 해당 고객 정보가
  //   우측 패널에 뜨게 해달라고 했잖아. 만약 고객이 아니고 게스트면 가져올 수 있는 정보를 다 넣어야지."*)
  //   ★ 펼치기 토글을 없앴다 — 패널이 같은 내용을 더 많이 보여주므로 두 동작이 한 클릭을 다투면
  //     "눌렀는데 뭐가 열린 건지" 가 된다. 재클릭 해제는 패널 쪽 규칙(CLAUDE.md 리스트 재클릭 토글).
  const [selected, setSelected] = useState<SaleInboxItem | null>(null);
  // 업무 추가 — 메일 내용을 베끼지 않고 **빈 입력**을 연다(Irene 2026-09-12).
  //   ★ 사람이 직접 쓰는 글이라 **쓰다 닫아도 남아야 한다**(입력 초안 계약).
  //     비우는 곳은 제출 성공·명시 취소뿐이다 — 대상 전환 이펙트에서 지우지 않는다.
  const [taskFor, setTaskFor] = useState<SaleInboxItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 최신 값은 ref 로 — 리스너·타이머가 옛 값에 굳지 않게(배경 갱신 규칙)
  const argsRef = useRef({ source, replyOnly, q });
  argsRef.current = { source, replyOnly, q };

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(false);
    try {
      const { source: s, replyOnly: r, q: query } = argsRef.current;
      const res = await listSaleInbox(businessId, { source: s, q: query, needsReply: r, limit: 100 });
      setItems(res.items);
      setCounts(res.counts);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void load(); }, [load, source, replyOnly, q, refreshKey]);

  // 실시간 — 새 문의가 오면 새로고침 없이 뜬다 (CLAUDE.md 운영 16번).
  //
  // ★ **새 이벤트를 만들지 않는다.** 이 목록의 원본 셋은 이미 신호를 쏘고 있다:
  //   메일 도착 `mail:new`(services/emailImapCron) · 대화 메시지 `message:new`(conversations·guest) ·
  //   뱃지 갱신 `inbox:refresh`(services/mailBroadcast 등). 셋 다 이 목록을 흔드는 사건이다.
  //   새 이름으로 쏘면 **수신부가 0곳**이 되는 계열의 사고를 되풀이한다.
  // ★ 목록이 커서 setState merge 가 아니라 **서버 fresh 재조회**다(silent).
  //   덜 온 것만 합치면 등록되어 빠진 행이 남는다.
  const reloadTimer = useRef<number | null>(null);
  const silentReload = useCallback(() => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => { void load({ silent: true }); }, 250);
  }, [load]);

  useEffect(() => {
    if (!businessId) return undefined;
    // room 은 refCount 관리 — 서버가 connection 시 소속 워크스페이스를 자동 join 하므로 이중 보장(멱등).
    joinRoom(`business:${businessId}`);
    const offs = ['message:new', 'mail:new', 'inbox:refresh'].map((ev) => onSocket(ev, silentReload));
    return () => {
      offs.forEach((off) => off());
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    };
  }, [businessId, silentReload]);

  // 소켓이 끊겼던 동안 놓친 것 회복 — 모바일 PWA background → foreground.
  useVisibilityRefresh(silentReload);

  // 'client' 는 칩이 아니라 **행 표시**용이다(등록된 상담) — 칩 목록에는 없고 라벨만 필요하다
  const sourceLabel = useCallback((s: SaleInboxSource | '' | 'client') => (
    s === '' ? (t('inbox.sourceAll') as string) : (t(`inbox.source.${s}`) as string)
  ), [t]);
  const sourceCount = useCallback((s: SaleInboxSource | '') => (
    s === '' ? counts.total : counts[s]
  ), [counts]);

  // 원본으로 — 채팅은 대화방, 메일은 그 스레드. 보던 화면을 덮지 않게 새 탭 규칙을 따른다.
  const openRow = useCallback((it: SaleInboxItem) => { navigate(it.open_path); }, [navigate]);

  // 고객으로 등록 — 기존 라우트를 그대로 부른다(서버가 중복 연결·한도까지 판정한다)
  const registerClient = useCallback(async (it: SaleInboxItem) => {
    if (busyId) return;
    setBusyId(it.id);
    setActionError(null);
    try {
      const body = it.ref.kind === 'guest_link'
        ? { from: 'guest_link', guest_link_id: it.ref.id }
        : { from: 'email_thread', email_thread_id: it.ref.id };
      const r = await apiFetch(`/api/sale/${businessId}/save-as-client`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.success === false) { setActionError(j?.message || `HTTP ${r.status}`); return; }
      const clientId = j?.data?.client?.id ?? j?.data?.id;
      // 등록되면 원본의 client_id 가 채워져 이 목록에서 자연히 빠진다 — 다시 읽는다
      await load({ silent: true });
      onRegistered?.();
      if (clientId) navigate(`/sale/${clientId}`);
    } catch {
      setActionError(t('error.loadFailed') as string);
    } finally {
      setBusyId(null);
    }
  }, [busyId, businessId, load, navigate, onRegistered, t]);

  const rows = useMemo(() => items, [items]);
  const selectedId = selected?.id ?? null;

  // 업무 추가 — **기존 업무 추가 폼 그대로**(components/QTask/TaskCreateForm).
  //   Irene 2026-09-12: *"업무추가 팝업이 왜 새거야? 기존 업무추가 항목들하고 기능하고 다르고?"*
  //   여기서 따로 그리면 프로젝트·담당자·마감·태그·첨부가 빠진 "다른 업무 추가" 가 된다.
  // ★ 입력은 빈 칸으로 연다(메일 제목·본문을 베끼지 않는다 — 상담에서 할 일은 메일 제목과 다르다).
  //   그 입력은 쓰다 닫아도 남는다(draft kind 'sale-task-add', 대상 = 이 상담 행).
  const taskModal = taskFor ? (
    <TaskCreateForm
      businessId={businessId}
      layout="drawer"
      drawerTitle={t('taskAdd.title') as string}
      draftKind="sale-task-add"
      draftId={taskFor.id}
      onClose={() => setTaskFor(null)}
      onCreated={(task) => navigate(`/tasks?task=${task.id}`)}
    />
  ) : null;

  return (
    <>
      <FilterRow>
        {SOURCES.map((s) => (
          <Chip key={s || 'all'} type="button" data-testid={`sale-inbox-source-${s || 'all'}`}
            $on={source === s} onClick={() => setSource(s)}>
            {sourceLabel(s)} <b>{sourceCount(s)}</b>
          </Chip>
        ))}
        <Spacer />
        <Chip type="button" data-testid="sale-inbox-needs-reply"
          $on={replyOnly} $accent onClick={() => setReplyOnly((v) => !v)}>
          {t('inbox.needsReplyOnly') as string} <b>{counts.needs_reply}</b>
        </Chip>
      </FilterRow>
      <Hint>{t('inbox.hint') as string}</Hint>

      {actionError && <ErrorBar role="alert">{actionError}</ErrorBar>}

      {loading ? (
        <Center>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Center>
      ) : error ? (
        <Center>{t('error.loadFailed') as string}</Center>
      ) : rows.length === 0 ? (
        <EmptyBox>
          <EmptyTitle>{t('inbox.empty.title') as string}</EmptyTitle>
          <EmptyDesc>{t('inbox.empty.body') as string}</EmptyDesc>
        </EmptyBox>
      ) : (
        <List>
          {rows.map((it) => {
            const who = it.who || (t('inbox.unknownWho') as string);
            const busy = busyId === it.id;
            return (
              <Row key={it.id} data-testid={`sale-inbox-row-${it.id}`}>
                <RowMain type="button" $sel={selectedId === it.id}
                  onClick={() => {
                    // 등록된 상담(고객)은 **고객 패널**로, 미등록 문의는 이 목록의 문의 패널로.
                    if (it.ref.kind === 'client' && onOpenClient) { onOpenClient(it.ref.id); return; }
                    setSelected((v) => (v && v.id === it.id ? null : it));
                  }}
                  aria-pressed={selectedId === it.id}>
                  <LetterAvatar name={who} size={32} variant="neutral" />
                  <RowBody>
                    <RowTop>
                      <SourceTag $s={it.source}>{sourceLabel(it.source)}</SourceTag>
                      {it.stage && <StageTag>{t(`stage.${it.stage}`) as string}</StageTag>}
                      <Who><HighlightText text={who} query={q} /></Who>
                      {it.needs_reply && <ReplyTag>{t('inbox.needsReply') as string}</ReplyTag>}
                      <At title={it.at ? formatDateTime(it.at) : ''}>{it.at ? formatTimeAgo(it.at) : '—'}</At>
                    </RowTop>
                    <Title><HighlightText text={it.title || (t('inbox.noSubject') as string)} query={q} /></Title>
                    {it.preview && <Preview><HighlightText text={it.preview} query={q} /></Preview>}
                  </RowBody>
                </RowMain>
                <RowActions>
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-open-${it.id}`} onClick={() => openRow(it)}>
                    {t('action.view') as string}
                  </ActionButton>
                  {it.ref.kind !== 'conversation' && it.ref.kind !== 'client' && (
                    <ActionButton tone="primary" size="sm" disabled={busy}
                      data-testid={`sale-inbox-register-${it.id}`} onClick={() => registerClient(it)}>
                      {t('action.registerClient') as string}
                    </ActionButton>
                  )}
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-task-${it.id}`}
                    onClick={() => setTaskFor(it)}>
                    {t('action.addTask') as string}
                  </ActionButton>
                  {/* ★ [문의 아님] — 기계가 못 가르는 알림·명세서를 사람이 한 번 눌러 정정한다.
                      메일 행에만 둔다(오분류가 거기서 난다). 누르면 메일 분류까지 고쳐진다. */}
                  {it.ref.kind === 'email_thread' && (
                    <ActionButton tone="secondary" size="sm" disabled={busy}
                      data-testid={`sale-inbox-dismiss-${it.id}`}
                      title={t('action.notInquiryHint') as string}
                      onClick={async () => {
                        if (busyId) return;
                        setBusyId(it.id); setActionError(null);
                        try {
                          await dismissInboxItem(businessId, 'email_thread', it.ref.id);
                          if (selected?.id === it.id) setSelected(null);
                          await load({ silent: true });
                        } catch { setActionError(t('error.saveFailed') as string); }
                        finally { setBusyId(null); }
                      }}>
                      {t('action.notInquiry') as string}
                    </ActionButton>
                  )}
                </RowActions>
              </Row>
            );
          })}
        </List>
      )}
      {taskModal}
      {/* 미등록 문의도 **같은 패널**에서 본다 — 고객이면 ClientPanel, 문의면 inquiry 분기.
          화면을 따로 만들면 필드가 갈라진다(2026-09-12 박제). */}
      <ClientPanel
        businessId={businessId}
        clientId={null}
        inquiry={selected ? inquiryViewOf(selected) : null}
        registerBusy={!!selected && busyId === selected.id}
        onClose={() => setSelected(null)}
        onRegister={() => { if (selected) void registerClient(selected); }}
      />
    </>
  );
};

/** 상담 행 → 패널이 그리는 값. **목록이 받은 것에서만** 만든다(화면이 따로 모으지 않는다). */
function inquiryViewOf(it: SaleInboxItem): InquiryView {
  return {
    who: it.who,
    email: it.email,
    company: it.company,
    title: it.title,
    preview: it.preview,
    at: it.at,
    needsReply: it.needs_reply,
    source: it.source,
    // 서버(routes/sale_save)가 받는 것은 게스트 링크·메일 스레드뿐 — 링크 없는 순수 대화방은 못 받는다
    canRegister: it.ref.kind !== 'conversation',
    emailVerified: !!(it.meta as { email_verified?: boolean })?.email_verified,
    openPath: it.open_path,
  };
}

export default SaleInboxList;

const FilterRow = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 10px 0 4px;
`;
const Spacer = styled.div`flex: 1; min-width: 8px;`;
const Chip = styled.button<{ $on?: boolean; $accent?: boolean }>`
  height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? (p.$accent ? '#F43F5E' : '#0D9488') : '#E2E8F0')};
  background: ${(p) => (p.$on ? (p.$accent ? '#FFF1F2' : '#F0FDFA') : '#FFFFFF')};
  color: ${(p) => (p.$on ? (p.$accent ? '#BE123C' : '#0F766E') : '#475569')};
  b { margin-left: 4px; font-weight: 700; }
  &:hover { background: ${(p) => (p.$on ? undefined : '#F8FAFC')}; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 0 0 10px;`;
const ErrorBar = styled.div`
  margin-bottom: 8px; padding: 8px 12px; border-radius: 8px;
  background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem;
`;
const Center = styled.div`padding: 48px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
const EmptyBox = styled.div`padding: 56px 20px; text-align: center;`;
const EmptyTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const EmptyDesc = styled.div`margin-top: 6px; font-size: 0.8125rem; color: #64748B;`;

const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px; border: 1px solid #E2E8F0; border-radius: 10px; background: #FFFFFF;
  &:hover { border-color: #CBD5E1; }
  @media (max-width: 640px) { flex-direction: column; gap: 8px; }
`;
const RowMain = styled.button<{ $sel?: boolean }>`
  display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0;
  background: none; border: none; padding: 0; text-align: left; cursor: pointer; font-family: inherit;
  /* 선택된 행 — 우측 패널이 무엇을 보여주는지 목록에서 알 수 있게 */
  ${(p) => (p.$sel ? 'outline: 2px solid #99F6E4; outline-offset: 4px; border-radius: 6px;' : '')}
`;
const RowBody = styled.div`flex: 1; min-width: 0;`;
const RowTop = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const SourceTag = styled.span<{ $s: string }>`
  font-size: 0.6875rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  color: ${(p) => (p.$s === 'guest_link' ? '#92400E' : p.$s === 'email' ? '#0F766E' : '#3730A3')};
  background: ${(p) => (p.$s === 'guest_link' ? '#FEF3C7' : p.$s === 'email' ? '#F0FDFA' : '#EEF2FF')};
`;
const Who = styled.span`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const ReplyTag = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  color: #BE123C; background: #FFF1F2;
`;
const At = styled.span`margin-left: auto; font-size: 0.6875rem; color: #94A3B8;`;
const Title = styled.div`
  margin-top: 2px; font-size: 0.8125rem; color: #334155;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Preview = styled.div`
  margin-top: 2px; font-size: 0.75rem; color: #94A3B8; line-height: 1.5;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const StageTag = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  color: #0F766E; background: #F0FDFA;
`;
const RowActions = styled.div`
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  @media (max-width: 640px) { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
`;
