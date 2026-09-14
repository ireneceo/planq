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
import { joinRoom, onSocket } from '../../services/socket';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import TaskCreateForm from '../QTask/TaskCreateForm';
import ClientPanel from './ClientPanel';
// 상담 한 줄 → 패널이 그리는 값. 확인 필요(Todo)도 **같은 변환**을 쓴다(베끼면 갈라진다)
import { inquiryViewOf } from '../../utils/saleInquiryView';
// 등록(+초대)도 한 벌 — 확인 필요(Todo)의 같은 버튼이 같은 함수를 부른다
import { registerInquiryAsClient } from '../../services/saleRegister';
import LetterAvatar from '../Common/LetterAvatar';
import HighlightText from '../Common/HighlightText';
import {
  listSaleInbox, dismissInboxItem, restoreInboxItem, purgeInboxItem, setSaleStage,
  listConsultNotes, addConsultNote, deleteConsultNote, type SaleNote, type ConsultRefKind,
  SALE_STAGES, type SaleInboxItem, type SaleInboxCounts, type SaleInboxSource,
  type SaleStage,
} from '../../services/sale';
// 단계 칩은 우측 패널·전체 프로필과 **같은 것**을 쓴다(자리마다 따로 그리면 동작이 갈라진다)
import ChipPopover from '../Common/ChipPopover';
import { OptionList, OptionBtn, OptName, OptHint } from '../Common/optionList';
// 일정 추가 — 상세·패널과 같은 창(다음 연락 정하기). 고객이 일정에 연결된다
import NextContactModal from './NextContactModal';
// 상담 기록(메모) — 같은 창을 쓴다
// 메모는 채팅방·메일과 **같은 댓글 컴포넌트**를 쓴다(공개범위·초안 보존 내장)
import NoteThread from '../Common/NoteThread';
import { useAuth } from '../../contexts/AuthContext';
// 히스토리 항목 → 갈 곳. 새 탭으로 연다(목록을 잃지 않게)

interface Props {
  businessId: number;
  /** 부모가 올리면 목록을 다시 읽는다 — 문의를 추가하면 **이 목록에** 들어와야 한다 */
  refreshKey?: number;
  /** 상단 검색어 — 목록 필터에 그대로 넘긴다(서버가 제목·상대·미리보기에서 찾는다) */
  q: string;
  /** ★ 2026-09-14 — 필터는 **부모(SalePage)의 한 줄**이 들고 있다.
   *  여기서 다시 그리면 같은 축이 두 벌이 되고, 탭을 오갈 때 값이 갈라진다.
   *  (Irene: *"고객탭이랑 같은 필터 나오게 해. 상담탭에도."*) */
  stage?: string;
  access?: string;
  assignee?: string;
  replyOnly?: boolean;
  hideClosed?: boolean;
  /** 대응 필요 건수를 위로 올려 준다 — 필터 칩의 숫자가 목록과 갈라지지 않게 */
  onCounts?: (c: SaleInboxCounts) => void;
  /** 고객으로 등록이 끝나면 고객 탭 숫자가 바뀐다 — 부모가 다시 읽는다 */
  onRegistered?: () => void;
}

const SOURCES: Array<SaleInboxSource | ''> = ['', 'guest_link', 'email', 'chat'];

const SaleInboxList: React.FC<Props> = ({
  businessId, q, refreshKey = 0, onRegistered,
  stage = '', access = '', assignee = '', replyOnly = false, hideClosed = true, onCounts,
}) => {
  const { t } = useTranslation('qsale');
  const navigate = useChromeNav();
  const { formatDateTime, formatTimeAgo } = useTimeFormat();
  // 메모(댓글)에서 "내 것" 판정 — 본인 메모만 지울 수 있고, personal 은 본인에게만 보인다
  const { user } = useAuth();
  const myUserId = user ? Number(user.id) : null;

  const [source, setSource] = useState<SaleInboxSource | ''>('');
  // 단계·대응필요·종료가리기·접근·담당자는 **부모가 들고 있다**(위 Props 주석).
  //   종료 가리기 기본 켜짐은 그대로다 — 판정은 서버가 한다(화면에서 거르면 목록 숫자와 갈라진다).
  // 메모 펼치기 — 행 **아래**에서 열린다(Irene: "리스트에서 메모보기 하면 리스트 아래 열려서")
  const [memoFor, setMemoFor] = useState<string | null>(null);
  // 일정 추가 — 이 상담 **고객이 일정에 연결**된다
  const [eventFor, setEventFor] = useState<SaleInboxItem | null>(null);
  // ✕ — 상담 목록에서 치울지 묻는다(삭제가 아니라 보관이라는 것을 문구로 말한다)
  const [dismissAsk, setDismissAsk] = useState<SaleInboxItem | null>(null);
  // 보관함의 ✕ — **영구히 뺀다**(Irene 2026-09-14). 메일 자체는 Q mail 에 그대로 남는다.
  const [purgeAsk, setPurgeAsk] = useState<SaleInboxItem | null>(null);
  // 고객 행의 ✕ — 상담 목록에서 치운다(단계를 '없음' 으로). 고객 정보는 그대로다.
  const [clearStageAsk, setClearStageAsk] = useState<SaleInboxItem | null>(null);
  // 단계를 바꾸려는데 아직 고객이 아니면 먼저 등록해야 한다 — 패널과 **같은 흐름**
  const [stageAsk, setStageAsk] = useState<{ it: SaleInboxItem; to: SaleStage } | null>(null);
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
  // ★ 외부 발송은 확인을 받는다 — 이 버튼은 등록만 하는 게 아니라 **그 주소로 초대 메일을 보낸다**.
  //   패널 쪽 [고객으로 등록]도 같은 확인을 거친다(ClientPanel). 두 문이 같은 문구를 쓴다.
  const [registerAsk, setRegisterAsk] = useState<SaleInboxItem | null>(null);

  // 최신 값은 ref 로 — 리스너·타이머가 옛 값에 굳지 않게(배경 갱신 규칙)
  const argsRef = useRef({ source, replyOnly, q, stage, hideClosed, access, assignee });
  argsRef.current = { source, replyOnly, q, stage, hideClosed, access, assignee };

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(false);
    try {
      const { source: s, replyOnly: r, q: query, stage: st, hideClosed: hc, access: ac, assignee: asg } = argsRef.current;
      const res = await listSaleInbox(businessId, {
        source: s, q: query, needsReply: r, limit: 100,
        stage: (st || undefined) as SaleStage | undefined, includeClosed: !hc,
        access: ac || undefined, assignee: asg || undefined,
      });
      setItems(res.items);
      setCounts(res.counts);
      onCounts?.(res.counts);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, onCounts]);

  useEffect(() => { void load(); },
    [load, source, replyOnly, q, stage, hideClosed, access, assignee, refreshKey]);

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

  // 아직 고객이 아닌 행에 **고객 기준 동작**(단계·메모·일정)을 걸려면 먼저 등록해야 한다.
  //   ★ 우측 패널의 `withClient` 와 같은 뜻이다 — 여는 것만으로는 아무것도 만들지 않고,
  //     저장이 필요한 첫 액션에서 한 번 묻는다. 초대 메일은 보내지 않는다(`invite: false`).
  const ensureClient = useCallback(async (it: SaleInboxItem): Promise<number | null> => {
    if (it.client_id) return it.client_id;
    if (it.ref.kind === 'client') return it.ref.id;
    const out = await registerInquiryAsClient(businessId, it, { invite: false });
    if (!out.ok || !out.clientId) { setActionError(out.message || (t('error.saveFailed') as string)); return null; }
    await load({ silent: true });
    return out.clientId;
  }, [businessId, load, t]);

  // 단계 바꾸기 — **고객 기준**이므로 같은 고객의 다른 상담 행도 함께 바뀐다(서버가 고객을 바꾸므로).
  //   어느 문의에서 바꿨는지를 `source_ref` 로 같이 보낸다(Irene: "히스토리에 어느 문의 내용에서
  //   단계를 바꿨는지 표시해주고").
  const applyStage = useCallback(async (it: SaleInboxItem, to: SaleStage) => {
    if (busyId) return;
    setBusyId(it.id); setActionError(null);
    try {
      const cid = await ensureClient(it);
      if (!cid) return;
      await setSaleStage(businessId, cid, {
        to,
        source_ref: { kind: it.ref.kind, id: it.ref.id, title: it.title || it.preview || null },
      });
      await load({ silent: true });
    } catch { setActionError(t('error.saveFailed') as string); }
    finally { setBusyId(null); }
  }, [busyId, businessId, ensureClient, load, t]);

  // [보기] 라벨 — **어디로 가는지**를 말한다.
  //   ★ 2026-09-13 (Irene: *"sale 리스트에 채팅이 아닌데 채팅보기가 나와. 이상한데로 보내고."*)
  //     여태 `source === 'email' ? 'mail' : 'chat'` **이분법**이라 `client`·`guest_link`·`dismissed`
  //     가 전부 "채팅 보기" 로 떨어졌다. 목적지는 서버가 준 `open_path` 인데 라벨만 거짓이었다.
  //   ★ 목적지의 진실은 `ref.kind` 다(source 는 표시 축이다 — 보관함 행도 원본은 메일 스레드다).
  //     전수 분기이고 **기본값으로 조용히 떨어뜨리지 않는다**(CLAUDE.md 상태값 규약):
  //     새 kind 가 생기면 그 kind 이름이 그대로 보여 바로 눈에 띈다.
  const viewInLabel = useCallback((it: SaleInboxItem): string => {
    const key = it.ref.kind === 'email_thread' ? 'mail'
      : it.ref.kind === 'client' ? 'client'
        : it.ref.kind === 'guest_link' ? 'guest'
          : it.ref.kind === 'conversation' ? 'chat'
            : null;
    if (!key) return it.ref.kind;
    return t(`action.viewIn.${key}`) as string;
  }, [t]);

  // 고객으로 등록 — 기존 라우트를 그대로 부른다(서버가 중복 연결·한도까지 판정한다)
  const registerClient = useCallback(async (it: SaleInboxItem) => {
    if (busyId) return;
    setBusyId(it.id);
    setActionError(null);
    try {
      const res = await registerInquiryAsClient(businessId, it);
      if (!res.ok) { setActionError(res.message || (t('error.loadFailed') as string)); return; }
      // 등록은 됐고 초대만 어긋난 경우 — 조용히 넘어가지 않는다
      if (res.warn === 'invite_failed') setActionError(res.message || (t('inbox.inviteFailed') as string));
      else if (res.warn === 'invite_no_email') setActionError(t('inbox.inviteNoEmail') as string);
      // 등록되면 원본의 client_id 가 채워져 이 목록에서 자연히 빠진다 — 다시 읽는다
      await load({ silent: true });
      onRegistered?.();
      // ★ 페이지로 튕기지 않는다 — 맥락을 잃는다. 방금 만든 고객을 **우측 패널**로 이어 보여준다.
      //   이때 문의 패널은 닫는다. 안 닫으면 고객 패널 위에 옛 문의 패널이 겹쳐 남는다.
      // 등록되면 **같은 패널이 그 자리에서 고객 쪽으로 채워진다** — 닫았다 다시 열게 하지 않는다.
      //   ★ 열려 있는 `selected` 는 등록 **전**의 행이다(client_id 가 비어 있다). 다시 읽은 목록으로
      //     갈아끼우지 않으면 패널은 계속 "미등록 문의" 로 남는다 — 사용자에겐 "등록했는데 그대로" 다.
      if (res.clientId) {
        const newId = res.clientId;
        setSelected((v) => (v && v.id === it.id ? { ...v, client_id: newId } : v));
      }
    } catch {
      setActionError(t('error.loadFailed') as string);
    } finally {
      setBusyId(null);
    }
  }, [busyId, businessId, load, onRegistered, t]);

  // 보관함에서 되돌리기 — 되돌리면 그 행은 보관함에서 빠지고 상담으로 돌아간다.
  const restoreItem = useCallback(async (it: SaleInboxItem) => {
    if (busyId || it.ref.kind !== 'email_thread') return;
    setBusyId(it.id);
    setActionError(null);
    try {
      await restoreInboxItem(businessId, 'email_thread', it.ref.id);
      await load({ silent: true });
    } catch {
      setActionError(t('error.loadFailed') as string);
    } finally {
      setBusyId(null);
    }
  }, [busyId, businessId, load, t]);

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
        {/* ★ 보관함은 **소스가 아니라 판단의 결과**다(사람이 [문의 아님] 이라고 내린 것).
            일반 소스 칩 사이에 끼우면 "게스트/메일/채팅" 과 같은 층으로 읽힌다 — 오른쪽에 따로 둔다. */}
        <Chip type="button" data-testid="sale-inbox-source-dismissed"
          $on={source === 'dismissed'}
          onClick={() => setSource((v) => (v === 'dismissed' ? '' : 'dismissed'))}>
          {t('inbox.source.dismissed') as string} <b>{counts.dismissed ?? 0}</b>
        </Chip>
      </FilterRow>
      {/* ★ 2026-09-14 — 단계 필터·대응 필요만·종료 가리기는 **검색 옆 한 줄**(SalePage)로 옮겼다.
          여기 남은 것은 접점 **종류**(게스트/메일/채팅)와 보관함 — 목록 자신의 축이다. */}
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
                    // ★ 2026-09-13 — 행이 무엇이든 **같은 패널**을 연다(Irene: "상담에서 열든 고객에서
                    //   열든 우측 패널은 고객에서 연 창이야"). 등록된 상담이면 고객 id 가 같이 실리고,
                    //   미등록이면 문의 박스만 있는 같은 패널이 열린다. 재클릭은 해제(CLAUDE.md).
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
                    {/* ★ 2026-09-13 (Irene: "전화나 채팅은 제목 없는데 제목 내용 분리하면 안되는 거 아니야?
                        제목 없으면 제목없음 뜨지 말고 내용만 떠야지. 그리고 내용없음을 표시해.")
                        제목이 있을 때만 제목 줄을 그린다. 없으면 내용이 그 자리를 대신한다.
                        둘 다 없을 때만 "내용 없음" — 빈 줄로 두면 무엇이 없는 건지 알 수 없다. */}
                    {it.title && <Title><HighlightText text={it.title} query={q} /></Title>}
                    {it.preview
                      ? <Preview $lead={!it.title}><HighlightText text={it.preview} query={q} /></Preview>
                      : !it.title && <Preview $muted>{t('inbox.noBody') as string}</Preview>}
                  </RowBody>
                </RowMain>
                <RowActions>
                  {/* ★ 2026-09-14 순서 변경 (Irene: *"Q sale 에서 단계 바꾸는 거 맨 끝에 두지 말고
                      버튼들 가장 처음에 중앙배치 열 맞춰서 배치해줘."*)
                      단계가 **맨 앞**이다 — 상담에서 가장 자주 바꾸는 것이고, 행마다 자리가 같아야
                      눈으로 훑을 수 있다. 그래서 고정 폭 칸(StageSlot)에 넣어 **열을 맞춘다.**
                      나머지는 종전 순서: 보기 · 메모 · 일정 · 업무 · ✕ */}
                  <StageSlot>
                  {/* 단계 — **리스트에서 바꾼다**. 고객 기준이라 같은 고객의 다른 상담도 함께 바뀐다.
                      전체 프로필·우측 패널과 **같은 ChipPopover** 다(자리마다 새로 그리지 않는다). */}
                  <ChipPopover
                    prefix={t('stage.label') as string}
                    label={it.stage ? (t(`stage.${it.stage}`) as string) : (t('stage.none') as string)}
                    active={!!it.stage && it.stage !== 'none'}
                    data-testid={`sale-inbox-stage-${it.id}`}
                    width={260}
                  >
                    {(close) => (
                      <OptionList role="listbox">
                        {SALE_STAGES.map((sg) => (
                          <OptionBtn key={sg} type="button" role="option" aria-selected={it.stage === sg}
                            $on={it.stage === sg}
                            data-testid={`sale-inbox-stage-${it.id}-${sg}`}
                            onClick={() => {
                              close();
                              // 아직 고객이 아니면 먼저 등록해야 단계가 붙는다 — 한 번 묻는다
                              if (!it.client_id && it.ref.kind !== 'client') { setStageAsk({ it, to: sg }); return; }
                              void applyStage(it, sg);
                            }}>
                            <OptName>{t(`stage.${sg}`) as string}</OptName>
                            <OptHint>{t(`stage.${sg}_hint`) as string}</OptHint>
                          </OptionBtn>
                        ))}
                      </OptionList>
                    )}
                  </ChipPopover>

                  </StageSlot>

                  {/* ① 보기 — **다른 화면으로 나간다**. 라벨이 목적지를 말한다(고객 상세·메일·채팅·게스트) */}
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-open-${it.id}`} onClick={() => openRow(it)}>
                    <OutIcon aria-hidden />
                    {viewInLabel(it)}
                  </ActionButton>

                  {/* ② 메모 — 행 **아래**에서 열린다(나가지 않는다). 건수를 같이 보여준다 */}
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-memo-${it.id}`}
                    onClick={() => setMemoFor((v) => (v === it.id ? null : it.id))}>
                    {t('action.memo') as string}{it.note_count ? ` ${it.note_count}` : ''}
                  </ActionButton>

                  {/* ③ 일정 — 이 상담 **고객이 일정에 연결**된다 */}
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-event-${it.id}`}
                    onClick={() => setEventFor(it)}>
                    {t('action.addEvent') as string}
                  </ActionButton>

                  {/* ④ 업무 — 프로젝트·고객이 연결된 업무로 만들어진다 */}
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-task-${it.id}`}
                    onClick={() => setTaskFor(it)}>
                    {t('action.addTask') as string}
                  </ActionButton>

                  {/* ⑥ ✕ — 상담 목록에서 치운다. 누르면 **묻는다**(되돌릴 수 있다는 것도 문구로 말한다).
                      보관함 행에서는 되돌리기가 그 자리를 대신한다. */}
                  {it.source === 'dismissed' ? (
                    <>
                      <ActionButton tone="secondary" size="sm" disabled={busy}
                        data-testid={`sale-inbox-restore-${it.id}`} onClick={() => restoreItem(it)}>
                        {t('action.restoreToInbox') as string}
                      </ActionButton>
                      {/* 보관함의 ✕ = **영구히 빼기** (Irene 2026-09-14) */}
                      <IconX type="button" disabled={busy}
                        data-testid={`sale-inbox-purge-${it.id}`}
                        aria-label={t('action.purgeFromInbox', { defaultValue: '상담에서 영구히 빼기' }) as string}
                        title={t('action.purgeFromInbox', { defaultValue: '상담에서 영구히 빼기' }) as string}
                        onClick={() => setPurgeAsk(it)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                      </IconX>
                    </>
                  ) : it.ref.kind !== 'email_thread' ? (
                    /* ★ 2026-09-14 (Irene: *"X가 왜 따로 추가한 고객응대내역 추가한 리스트에는 안 떠?"*)
                       여태 ✕ 는 **메일에서 온 행에만** 있었다. 손으로 추가한 상담(고객 행)에는 치울 길이
                       없어서 목록에 영원히 남았다. 고객 행의 ✕ 는 단계를 '없음' 으로 돌린다 —
                       고객 정보·기록은 그대로 두고 **상담 목록에서만** 빠진다(되돌리려면 단계를 다시 준다). */
                    <IconX type="button" disabled={busy}
                      data-testid={`sale-inbox-clear-${it.id}`}
                      aria-label={t('action.removeFromInbox') as string}
                      title={t('action.removeFromInbox') as string}
                      onClick={() => setClearStageAsk(it)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                    </IconX>
                  ) : (
                    <IconX type="button" disabled={busy}
                      data-testid={`sale-inbox-dismiss-${it.id}`}
                      aria-label={t('action.removeFromInbox') as string}
                      title={t('action.removeFromInbox') as string}
                      onClick={() => setDismissAsk(it)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                    </IconX>
                  )}
                </RowActions>
                {/* ★ 메모는 **행 아래**에서 열린다 (Irene: "리스트에서 메모보기 하면 리스트 아래
                    열려서 메모 붙인거 나오게 해줘"). 나가지 않으니 목록의 맥락을 잃지 않는다. */}
                {memoFor === it.id && (
                  <MemoPane data-testid={`sale-inbox-memo-pane-${it.id}`}>
                    <SaleNoteThread businessId={businessId} item={it} myUserId={myUserId}
                      onChanged={() => { void load({ silent: true }); }} />
                  </MemoPane>
                )}
              </Row>
            );
          })}
        </List>
      )}
      {taskModal}

      {/* 일정 추가 — 상세·패널과 **같은 창**. 고객이 일정에 연결된다 */}
      {eventFor && (
        <NextContactEnsure item={eventFor} businessId={businessId}
          onEnsureClient={() => ensureClient(eventFor)}
          onClose={() => setEventFor(null)}
          onSaved={() => { setEventFor(null); void load({ silent: true }); }} />
      )}

      {/* ✕ — 상담 목록에서 치울지 묻는다. 삭제가 아니라 보관이며 되돌릴 수 있다고 적는다 */}
      <ConfirmDialog
        isOpen={!!dismissAsk}
        title={t('action.removeFromInboxTitle') as string}
        message={t('action.removeFromInboxBody') as string}
        confirmText={t('action.removeFromInbox') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="danger"
        onClose={() => setDismissAsk(null)}
        onConfirm={async () => {
          const it = dismissAsk; setDismissAsk(null);
          if (!it || busyId) return;
          setBusyId(it.id); setActionError(null);
          try {
            await dismissInboxItem(businessId, 'email_thread', it.ref.id);
            if (selected?.id === it.id) setSelected(null);
            await load({ silent: true });
          } catch { setActionError(t('error.saveFailed') as string); }
          finally { setBusyId(null); }
        }}
      />

      {/* 보관함의 ✕ — 영구히 뺀다. **메일은 지우지 않는다**는 것을 문구가 분명히 말한다 */}
      <ConfirmDialog
        isOpen={!!purgeAsk}
        title={t('action.purgeTitle', { defaultValue: '상담에서 영구히 뺄까요?' }) as string}
        message={t('action.purgeBody', { defaultValue: '이 건은 다시는 상담 목록과 보관함에 나타나지 않습니다. 메일 자체는 Q mail 에 그대로 남습니다.' }) as string}
        confirmText={t('action.purgeConfirm', { defaultValue: '영구히 빼기' }) as string}
        cancelText={t('inquiry.cancel') as string}
        variant="danger"
        onClose={() => setPurgeAsk(null)}
        onConfirm={async () => {
          const it = purgeAsk; setPurgeAsk(null);
          if (!it || busyId) return;
          setBusyId(it.id); setActionError(null);
          try {
            await purgeInboxItem(businessId, 'email_thread', it.ref.id);
            if (selected?.id === it.id) setSelected(null);
            await load({ silent: true });
          } catch { setActionError(t('error.saveFailed') as string); }
          finally { setBusyId(null); }
        }}
      />

      {/* 고객 행의 ✕ — 상담 목록에서만 치운다(고객 정보는 그대로) */}
      <ConfirmDialog
        isOpen={!!clearStageAsk}
        title={t('action.clearStageTitle', { defaultValue: '상담 목록에서 치울까요?' }) as string}
        message={t('action.clearStageBody', { defaultValue: '고객 정보와 기록은 그대로 남고, 영업 단계만 «없음» 이 됩니다. 단계를 다시 주면 상담 목록으로 돌아옵니다.' }) as string}
        confirmText={t('action.removeFromInbox') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="danger"
        onClose={() => setClearStageAsk(null)}
        onConfirm={() => { const it = clearStageAsk; setClearStageAsk(null); if (it) void applyStage(it, 'none'); }}
      />

      {/* 단계를 바꾸려는데 아직 고객이 아니면 — 먼저 등록할지 묻는다(메일은 나가지 않는다) */}
      <ConfirmDialog
        isOpen={!!stageAsk}
        title={t('action.ensureClientTitle') as string}
        message={t('action.ensureClientBody', { who: stageAsk?.it.who || '—' }) as string}
        confirmText={t('action.ensureClientConfirm') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="info"
        onClose={() => setStageAsk(null)}
        onConfirm={() => { const a = stageAsk; setStageAsk(null); if (a) void applyStage(a.it, a.to); }}
      />
      <ConfirmDialog
        isOpen={!!registerAsk}
        title={t('action.registerConfirmTitle') as string}
        message={registerAsk?.email
          ? (t('action.registerConfirmBody', { email: registerAsk.email }) as string)
          : (t('action.registerConfirmNoEmail') as string)}
        confirmText={t('action.registerClient') as string}
        cancelText={t('inquiry.cancel') as string}
        variant="info"
        onClose={() => setRegisterAsk(null)}
        onConfirm={() => { const it = registerAsk; setRegisterAsk(null); if (it) void registerClient(it); }}
      />
      {/* 미등록 문의도 **같은 패널**에서 본다 — 고객이면 ClientPanel, 문의면 inquiry 분기.
          화면을 따로 만들면 필드가 갈라진다(2026-09-12 박제). */}
      <ClientPanel
        businessId={businessId}
        /* 등록된 상담이면 고객 id 가 있다 — 같은 패널이 고객 쪽으로 채워진다.
           ★ `client_id` 를 먼저 본다: 게스트 링크가 나중에 고객에 붙은 행은 ref 가 여전히
             guest_link 이지만 고객은 이미 있다(그때 문의 박스 + 고객 내용이 함께 보여야 한다). */
        clientId={selected ? (selected.client_id ?? (selected.ref.kind === 'client' ? selected.ref.id : null)) : null}
        inquiry={selected ? inquiryViewOf(selected) : null}
        registerBusy={!!selected && busyId === selected.id}
        onClose={() => setSelected(null)}
        onChanged={() => { void load({ silent: true }); }}
        onRegister={() => { if (selected) void registerClient(selected); }}
      />
    </>
  );
};

/* 상담 행 → 패널이 그리는 값의 변환은 utils/saleInquiryView 로 옮겼다 —
   확인 필요(Todo)도 같은 문의를 열기 때문에 한 벌이어야 한다. */

/** 행 아래에서 여는 메모 — 그 고객의 상담 기록을 보여주고 새로 남긴다.
 *
 *  ★ 목록을 떠나지 않는다. 우측 패널·전체 프로필과 **같은 원천**(타임라인 interaction·note)을 읽으므로
 *    여기서 남긴 메모가 그쪽에도 바로 보인다(Irene: "상담 리스트에 메모 남기는 거 … 우측 패널
 *    고객페이지에도 나와야 해").
 *  ★ 아직 고객이 아닌 행이면 메모를 붙일 곳이 없다 — 남기려 할 때 한 번 묻고 등록한다. */
/** 상담 메모 = **댓글 스레드**. (2026-09-14)
 *
 *  Irene: *"이 메모를 고객응대 내역이랑 섞은 거야? 그냥 담당자 메모야. … 리스트에 댓글이 달리는 것처럼
 *  붙여달라는 거고 그걸 열였다 접었다 할 수 잇게 해줘. … 채팅방 보면 메모를 공개범위 선택해서 할 수
 *  잇잖아. 그거 그대로 하자."*
 *
 *  ★ 여기 있던 것은 **고객응대 내역(ClientInteraction) 타임라인 전체**였다 — [메모] 를 누르면
 *    원장이 통째로 펼쳐졌다. 그건 메모가 아니다. 원장은 [보기]·우측 패널에서 본다.
 *  ★ 컴포넌트는 채팅방·메일 맥락 패널과 **같은 것**(`components/Common/NoteThread`) —
 *    공개범위 고르기·초안 보존·본인 것만 삭제가 이미 그 안에 있다. 새로 그리지 않는다.
 *  ★ 어떤 문의를 기준으로 남겼는지는 **저장 대상 자체**가 말한다(메일 스레드·대화방·고객).
 */
function SaleNoteThread({ businessId, item, myUserId, onChanged }: {
  businessId: number; item: SaleInboxItem; myUserId: number | null; onChanged: () => void;
}) {
  const { t } = useTranslation('qsale');
  const { formatTimeAgo } = useTimeFormat();
  const [notes, setNotes] = useState<SaleNote[] | null>(null);

  // 이 행의 메모가 어디에 붙는가 — 메일이면 스레드, 게스트/채팅이면 대화방, 등록된 상담이면 고객.
  const target = useMemo((): { kind: ConsultRefKind; id: number } | null => {
    const r = item.ref;
    if (r.kind === 'email_thread') return { kind: 'email_thread', id: r.id };
    if (r.kind === 'conversation') return { kind: 'conversation', id: r.id };
    if (r.kind === 'guest_link' && r.conversation_id) return { kind: 'conversation', id: r.conversation_id };
    if (r.kind === 'client') return { kind: 'client', id: r.id };
    if (item.client_id) return { kind: 'client', id: item.client_id };
    return null;
  }, [item]);

  const reload = useCallback(() => {
    if (!target) { setNotes([]); return; }
    listConsultNotes(businessId, target.kind, target.id)
      .then(setNotes).catch(() => setNotes([]));
  }, [businessId, target]);

  useEffect(() => { reload(); }, [reload]);

  if (!target) return <MemoDim>{t('note.noTarget', { defaultValue: '이 행에는 메모를 붙일 수 없습니다.' }) as string}</MemoDim>;

  return (
    <NoteThread
      notes={(notes || []).map((n) => ({
        id: n.id, body: n.body, visibility: n.visibility,
        author_user_id: n.author_user_id, author_name: n.author_name, created_at: n.created_at,
      }))}
      myUserId={myUserId}
      canChooseVisibility
      formatTime={formatTimeAgo}
      onAdd={async (body, visibility) => {
        // ★ 성공 여부를 돌려준다 — NoteThread 는 true 일 때만 쓰던 글을 비운다(실패하면 글이 남아야 한다)
        try {
          await addConsultNote(businessId, target.kind, target.id, body, visibility);
          reload(); onChanged();
          return true;
        } catch { return false; }
      }}
      onDelete={async (id) => {
        try { await deleteConsultNote(businessId, target.kind, target.id, id); reload(); onChanged(); }
        catch { /* 실패는 목록 그대로 둔다 */ }
      }}
      draftKind="sale-note"
      draftEntityId={`${target.kind}:${target.id}`}
      draftBizId={businessId}
      emptyText={t('note.empty', { defaultValue: '아직 메모가 없습니다' }) as string}
      placeholder={t('note.placeholder', { defaultValue: '메모 작성... (⌘/Ctrl+Enter 저장)' }) as string}
    />
  );
}

/** 일정 추가 — 고객이 있어야 일정에 연결된다. 없으면 한 번 묻고 등록한 뒤 연다.
 *  창 자체는 상세·패널과 **같은 것**(NextContactModal)이다. */
function NextContactEnsure({ businessId, item, onEnsureClient, onClose, onSaved }: {
  businessId: number; item: SaleInboxItem;
  onEnsureClient: () => Promise<number | null>;
  onClose: () => void; onSaved: () => void;
}) {
  const [cid, setCid] = useState<number | null>(item.client_id ?? (item.ref.kind === 'client' ? item.ref.id : null));
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (cid || tried) return;
    setTried(true);
    void onEnsureClient().then((id) => { if (id) setCid(id); else onClose(); });
  }, [cid, tried, onEnsureClient, onClose]);
  if (!cid) return null;
  return (
    <NextContactModal open businessId={businessId} clientId={cid}
      clientName={item.who || '—'} onClose={onClose} onSaved={onSaved} />
  );
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
/** 바깥으로 나가는 화살표 — ClientPanel 의 전체보기 아이콘과 **같은 모양**(새로 그리지 않는다).
 *  이 버튼은 우측 패널이 아니라 다른 화면으로 이동한다는 뜻을 아이콘이 먼저 말한다. */
const OutIcon = styled.span.attrs({
  children: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" /><path d="M10 14L21 3" /><path d="M21 14v7H3V3h7" />
    </svg>
  ),
})`
  display: inline-flex; align-items: center; margin-right: 4px; flex-shrink: 0;
`;
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
// $lead — 제목이 없는 항목(전화·채팅)에서는 **내용이 대표 줄**이다. 제목 자리를 대신하므로 같은 위계로.
// $muted — 제목도 내용도 없을 때의 "내용 없음". 빈 줄로 두면 무엇이 없는 건지 알 수 없다.
const Preview = styled.div<{ $lead?: boolean; $muted?: boolean }>`
  margin-top: ${(p) => (p.$lead ? '0' : '2px')};
  font-size: ${(p) => (p.$lead ? '0.8125rem' : '0.75rem')};
  color: ${(p) => (p.$muted ? '#CBD5E1' : p.$lead ? '#334155' : '#94A3B8')};
  font-style: ${(p) => (p.$muted ? 'italic' : 'normal')};
  line-height: 1.5;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const StageTag = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  color: #0F766E; background: #F0FDFA;
`;
/* ★ 2026-09-14 (Irene: *"모든 버튼은 우측정렬 하되 열이 제한되게 해서 해당 열이 되면
   엔터값들어가게 반응형 정리해줘."*)
   여태 **폰에서만** 감겼다(≤640). 그 사이 폭에서는 버튼이 줄어들지도 감기지도 않아
   행이 옆으로 밀렸다. 이제 어느 폭에서나 **오른쪽에 붙고, 넘치면 다음 줄로 내려간다.** */
const RowActions = styled.div`
  display: flex; align-items: center; gap: 6px;
  justify-content: flex-end; flex-wrap: wrap;
  margin-left: auto; min-width: 0;
  @media (max-width: 640px) { width: 100%; }
`;
/* 단계 칸 — 행마다 **같은 자리·같은 폭**이라 위아래로 열이 맞는다 */
const StageSlot = styled.div`
  flex: 0 0 auto; width: 150px; display: flex; justify-content: center;
  @media (max-width: 640px) { width: auto; justify-content: flex-start; }
`;

/* ✕ — 아이콘 전용이지만 aria-label·title 로 뜻을 말한다(이름 없는 버튼 금지) */
const IconX = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #E2E8F0; border-radius: 6px; background: #FFFFFF; color: #94A3B8;
  cursor: pointer; flex-shrink: 0;
  &:hover:not(:disabled) { background: #FFF1F2; border-color: #FDA4AF; color: #BE123C; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
/* 행 아래 메모 — 목록 안에서 열리므로 행과 붙어 보이게 배경을 낮춘다 */
const MemoPane = styled.div`
  grid-column: 1 / -1; margin: 4px 0 2px; padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const MemoDim = styled.div`padding: 12px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
