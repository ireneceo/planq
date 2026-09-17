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
import { useInboxItemActions } from './useInboxItemActions';
import { useTranslation } from 'react-i18next';
import { joinRoom, onSocket } from '../../services/socket';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import ActionButton from '../Common/ActionButton';
import { ChipRow, FilterChip, ChipRight } from '../Common/filterChip';
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
  listSaleInbox, dismissInboxItem, purgeInboxItem,
  SALE_STAGES, type SaleInboxItem, type SaleInboxCounts, type SaleInboxSource,
  type SaleStage,
} from '../../services/sale';
// 단계 칩은 우측 패널·전체 프로필과 **같은 것**을 쓴다(자리마다 따로 그리면 동작이 갈라진다)
import ChipPopover from '../Common/ChipPopover';
import { OptionList, OptionBtn, OptName, OptHint } from '../Common/optionList';
// 일정 추가 — 상세·패널과 같은 창(다음 연락 정하기). 고객이 일정에 연결된다
import NextContactModal from './NextContactModal';
// 상담 기록(메모) — 같은 창을 쓴다
import { useAuth } from '../../contexts/AuthContext';
// 메모(댓글)는 별도 파일 — 이 파일이 800줄을 넘어 분리했다(god-file 가드)
import SaleNoteThread from './SaleNoteThread';
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
  // 메모 있음/없음을 **글자로도** 말한다 — 점(색)만으로는 색을 못 보는 사용자에게 전달되지 않고,
  // 마우스를 올린 사람에게도 이유가 보여야 한다. 폭에는 영향이 없다(title·aria-label).
  const memoHint = (it: { note_count?: number | null }) => {
    const n = it.note_count ?? 0;
    return (n > 0
      ? t('action.memoWith', { n, defaultValue: '메모 {{n}}개 — 눌러서 보기' })
      : t('action.memoNone', { defaultValue: '메모 없음 — 눌러서 남기기' })) as string;
  };
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

  // 행 액션(되돌리기·보관·영구삭제)은 한 벌로 묶여 있다 — useInboxItemActions.
  //   ★ `promoteItem`(상담으로 보내기)은 여기서 안 쓴다 — 그 문은 **Q mail** 에 있다
  //     (메일 목록 우클릭 · 상세 ⋯). 후보 칸을 뺐으므로 이 화면에는 올릴 대상이 없다.
  //     훅에는 남겨 두되 **쓰는 곳이 없다** — Q mail·채팅은 `services/sale.ts promoteInboxItem` 을 직접 부른다.
  const { restoreItem, ensureClient, applyStage } = useInboxItemActions({
    businessId, busyId, setBusyId, setActionError,
    errorText: t('error.loadFailed') as string, saveErrorText: t('error.saveFailed') as string,
    reload: () => load({ silent: true }),
  });

  const rows = useMemo(() => items, [items]);
  // ★ 6차 — 버튼은 행마다 독립이라 **자동으로 같이 늘지 않는다.** min-width 를 빼면 1자리 행과
  //   2자리 행의 폭이 갈린다(3차에 없애라고 한 그것). 그래서 «목록 최대 자릿수» 를 여기서 한 번
  //   세어 전 버튼에 같이 준다. ★ 이 값은 **한 곳에서만** 나온다 — 행마다 세면 폭이 다시 갈린다.
  const countCh = useMemo(
    () => Math.max(1, ...rows.map((r) => String(r.note_count ?? 0).length)),
    [rows],
  );
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
      <ChipRow data-testid="sale-inbox-chip-row">
        {SOURCES.map((s) => (
          <FilterChip key={s || 'all'} type="button" data-testid={`sale-inbox-source-${s || 'all'}`}
            $on={source === s} onClick={() => setSource(s)}>
            {sourceLabel(s)} <b>{sourceCount(s)}</b>
          </FilterChip>
        ))}
        
        {/* ★ 보관함은 **소스가 아니라 판단의 결과**다(사람이 [문의 아님] 이라고 내린 것).
            일반 소스 칩 사이에 끼우면 "게스트/메일/채팅" 과 같은 층으로 읽힌다 — 오른쪽에 따로 둔다. */}
        <ChipRight>
          {/* ★ 2026-09-17 — **«후보» 칩을 뺐다.** 2026-09-16 에 «걸러진 것을 볼 자리» 로 두었는데,
              운영에 쌓인 22건을 전수로 열어 보니 **진짜 문의가 0건**이었다(자동메일 오판이 모이는 자리였다).
              행동도 그것을 말한다 — [상담으로 보내기] 0회 · [보관/무시] 7회. 열어서 버리기만 했다.
              ★ [상담으로 보내기] **문은 Q mail 목록 우클릭·상세 ⋯ 에 그대로 있다.**
                메일을 읽다가 «이건 문의다» 하고 올리는 쪽이 노이즈를 뒤지는 것보다 자연스럽다. */}
          <FilterChip type="button" data-testid="sale-inbox-source-dismissed"
            $on={source === 'dismissed'}
            onClick={() => setSource((v) => (v === 'dismissed' ? '' : 'dismissed'))}>
            {t('inbox.source.dismissed') as string} <b>{counts.dismissed ?? 0}</b>
          </FilterChip>
        </ChipRight>
      </ChipRow>
      {/* ★ 2026-09-14 — 단계 필터·대응 필요만·종료 가리기는 **검색 옆 한 줄**(SalePage)로 옮겼다.
          여기 남은 것은 접점 **종류**(게스트/메일/채팅)와 보관함 — 목록 자신의 축이다. */}
      {/* ★ 기준은 화면이 **짧게** 알려준다 — 왜 여기 없는지 모르면 사용자는 고장으로 읽는다
          (memory feedback_rules_must_be_explained_briefly). */}
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
            const memoOpen = memoFor === it.id;
            return (
              /* ★ 2026-09-14 2차 (Irene: *"메모가 열리는 모양 — 리스트와 별개로 아래에 회색 영역이
                 좌우 풀폭으로 열려. 리스트는 움직이지 않아."*)
                 메모판을 **행 카드 안**에 두면 가로 flex 의 네 번째 칸이 되어 액션 오른쪽에
                 찌그러져 붙는다(데스크탑 실측). 카드(Row)와 메모판을 `RowWrap` 으로 감싸
                 메모판이 카드 **아래 · 좌우 풀폭**으로 열리게 한다 — 카드 자체는 그대로다. */
              <RowWrap key={it.id}>
              <Row data-testid={`sale-inbox-row-${it.id}`}>
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
                      {/* ★ 확인완료한 건은 **목록에 남되** 답할 차례가 아니다 — 그 사실을 화면이 말한다.
                          안 그러면 처리한 것과 안 한 것이 같은 모양이라 왜 여기 있는지 알 수 없다
                          (memory feedback_backend_done_ui_missing — 서버만 넣고 화면을 안 붙이면 안 고친 것이다). */}
                      {it.handled && <HandledTag>{t('inbox.handled', { defaultValue: '확인완료' }) as string}</HandledTag>}
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
                <StageSlot data-testid={`sale-inbox-stageslot-${it.id}`}>
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
                <RowActions>
                  {/* 나머지 순서는 종전대로: 보기 · 메모 · 일정 · 업무 · ✕ */}
                  {/* ★ 2026-09-17 정정 — 위 주석은 **후보 칸이 있던 시절**의 것이고 지금은 거짓이다.
                      보관함 행에도 메모·일정·업무는 **그려진다**(후보 도입 전부터 그랬다).
                      감췄던 것은 «후보» 행이었고 그 칸은 없앴다. 사실과 다른 주석은 다음 사람을 속인다. */}

                  {/* ① 보기 — **다른 화면으로 나간다**.
                      ★ 2026-09-14 2차 (Irene: *"[메일 보기]·[고객 상세 보기] 는 이름을 빼고
                        링크 아이콘 + 보기 만."*) 라벨을 한 낱말로 고정하니 **폭이 행마다 같아진다** —
                        `ViewSlot` 의 고정폭(148)으로 떠받치던 열 어긋남(실측 left 888 vs 908)의
                        원인 자체가 사라져 그 칸을 없앴다([[feedback_variable_label_breaks_column_align]]).
                      ★ 목적지는 라벨에서 사라지지만 **말하지 않는 것은 아니다** — title·aria-label 이
                        "메일 보기"·"고객 상세 보기" 를 그대로 들고 있다(이름 없는 버튼 금지). */}
                  <ActionButton tone="secondary" size="xs" disabled={busy}
                    data-testid={`sale-inbox-open-${it.id}`} onClick={() => openRow(it)}
                    title={viewInLabel(it)} aria-label={viewInLabel(it)}>
                    <OutIcon aria-hidden />
                    {t('action.view') as string}
                  </ActionButton>

                  {/* ② 메모 — 행 아래에서 열린다. 계약이 하루에 네 번 바뀌었다(2차 개수삭제 →
                      4차 점 → 5차 숫자+좌측정렬 → 6차 색구분·간격·최대자릿수 공유폭).
                      **정본은 6차. 숫자를 다시 지우지 말 것** — 2차를 Irene 이 되돌렸다.
                      좌측 정렬은 1→2자리에서 «메모» 글자가 반 칸 밀리지 않게. 폭은 행마다 같다(3차). */}
                  <MemoBtn tone="secondary" size="xs" disabled={busy}
                    data-testid={`sale-inbox-memo-${it.id}`}
                    data-has-notes={(it.note_count ?? 0) > 0 ? '1' : '0'}
                    aria-expanded={memoOpen}
                    title={memoHint(it)} aria-label={memoHint(it)}
                    onClick={() => setMemoFor((v) => (v === it.id ? null : it.id))}>
                    {t('action.memo') as string}
                    <MemoCount $on={(it.note_count ?? 0) > 0} $ch={countCh}
                      data-testid={`sale-inbox-memo-count-${it.id}`}>
                      {it.note_count ?? 0}
                    </MemoCount>
                  </MemoBtn>

                  {/* ③ 일정 — 이 상담 **고객이 일정에 연결**된다 */}
                  <ActionButton tone="secondary" size="xs" disabled={busy}
                    data-testid={`sale-inbox-event-${it.id}`}
                    onClick={() => setEventFor(it)}>
                    {t('action.addEvent') as string}
                  </ActionButton>

                  {/* ④ 업무 — 프로젝트·고객이 연결된 업무로 만들어진다 */}
                  <ActionButton tone="secondary" size="xs" disabled={busy}
                    data-testid={`sale-inbox-task-${it.id}`}
                    onClick={() => setTaskFor(it)}>
                    {t('action.addTask') as string}
                  </ActionButton>

                  {/* ⑥ ✕ — 상담 목록에서 치운다. 누르면 **묻는다**(되돌릴 수 있다는 것도 문구로 말한다).
                      보관함 행에서는 되돌리기가 그 자리를 대신한다. */}
                  {it.source === 'dismissed' ? (
                    <>
                      <ActionButton tone="secondary" size="xs" disabled={busy}
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
              </Row>
              {/* ★ 2026-09-14 4차 — 행 아래 [메모보기 ⌄] 손잡이를 **없앴다**(Irene 지시).
                  여는 문은 위 [메모] 버튼 하나다. 손잡이가 있던 동안은 같은 상태(`memoFor`)를
                  두 곳에서 여닫았는데, 문이 하나면 그 어긋남이 생길 자리 자체가 없다. */}
              {/* ★ 메모는 **행 아래**에서 열린다 (Irene: "리스트에서 메모보기 하면 리스트 아래
                  열려서 메모 붙인거 나오게 해줘"). 나가지 않으니 목록의 맥락을 잃지 않는다.
                  카드 **밖**이라 좌우 풀폭이고, 카드 자체는 한 픽셀도 움직이지 않는다. */}
              {memoOpen && (
                <MemoPane data-testid={`sale-inbox-memo-pane-${it.id}`}>
                  <SaleNoteThread businessId={businessId} item={it} myUserId={myUserId}
                    onChanged={() => { void load({ silent: true }); }} />
                </MemoPane>
              )}
              </RowWrap>
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
/* 행 한 벌 = 카드 + (메모보기 손잡이) + (메모판). 메모가 열려도 **카드는 그대로**이고
   메모판이 카드 아래에 좌우 풀폭으로 붙는다(Irene 2026-09-14). */
const RowWrap = styled.div`display: flex; flex-direction: column;`;
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
/** 확인완료 — «답할 차례»(ReplyTag, 붉은 톤)와 **반대 뜻**이라 조용한 회색으로 둔다.
 *  같은 줄에 둘이 함께 뜨는 일은 없다(확인완료면 needs_reply 가 false 다). */
const HandledTag = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  color: #64748B; background: #F1F5F9;
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
/* 단계 칸 — 행마다 **같은 자리·같은 폭**이라 위아래로 열이 맞는다.
   ★ 2026-09-14 실측: 처음엔 이 칸을 RowActions **안**에 넣었는데, 액션 묶음이 `margin-left:auto`
     로 오른쪽에 붙는 탓에 **묶음 전체 폭만큼 왼쪽 끝이 흔들렸다**([보기] 라벨이 "메일 보기"·
     "고객 상세 보기" 처럼 행마다 달라서다 — left 888 vs 908 로 20px 어긋났다).
     그래서 RowActions 밖, **RowMain(flex:1) 바로 뒤**로 옮겼다. RowMain 이 남는 폭을 다 먹으므로
     이 칸의 왼쪽 끝은 행마다 **항상 같은 x** 다. */
const StageSlot = styled.div`
  flex: 0 0 auto; width: 150px; display: flex; justify-content: center;
  /* ★ 2026-09-14 2차 (Irene: *"단계 버튼이 행 높이의 세로 중앙에 있지 않아."*)
     Row 가 align-items: flex-start 라 이 칸도 맨 위에 붙어 있었다. 행 높이는 왼쪽 본문
     (제목+내용 1~2줄)이 정하므로, 단계 칩은 **그 높이의 한가운데**에 서야 열이 보인다.
     Row 전체를 center 로 바꾸지 않는다 — 그러면 본문 텍스트 정렬까지 따라 움직인다. */
  align-self: center;
  @media (max-width: 640px) { width: 100%; justify-content: flex-start; align-self: stretch; }
`;

/* ✕ — 아이콘 전용이지만 aria-label·title 로 뜻을 말한다(이름 없는 버튼 금지).
   ★ 2026-09-14 2차 (Irene: *"X 버튼 — 불필요한 박스를 빼. 높이값도 달라서 이상해."*)
     테두리·배경을 없앴다. 옆의 글자 버튼들은 테두리가 곧 누를 수 있는 범위인데, ✕ 는 글자가
     없어서 같은 상자를 두르면 **빈 네모** 하나가 줄 끝에 남는다.
     높이는 **32** — 옆 액션 버튼(ActionButton size="xs")과 같은 수다. 28 이라 4px 어긋나 있었다.
     누를 수 있는 자리는 그대로 32×32 이고, 눌린다는 신호는 hover 의 옅은 배경이 준다. */
const IconX = styled.button`
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px; background: transparent; color: #94A3B8;
  cursor: pointer; flex-shrink: 0; padding: 0;
  &:hover:not(:disabled) { background: #FFF1F2; color: #BE123C; }
  &:focus-visible { outline: 2px solid #FDA4AF; outline-offset: 1px; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

/* [메모 N] — 공용 ActionButton 을 **상속**한다(규격을 다시 쓰지 않는다).
   좌측 정렬 이유는 위 호출부 주석 참조(5차). */
const MemoBtn = styled(ActionButton)`
  justify-content: flex-start;
`;
/* 숫자 칸. 버튼 전체에 px 폭을 박지 않는다 — 글꼴이 바뀌면 거짓이 되고,
   규격 토큰(32/36/40/44) 밖의 값은 UI 가드가 센다. */
const MemoCount = styled.span<{ $on: boolean; $ch: number }>`
  display: inline-block;
  min-width: ${(p) => p.$ch}ch;  /* 목록 최대 자릿수 — 전부 1자리면 여백 0,
                                    2자리가 생기면 전 버튼이 같이 늘어난다. */
  /* «메모» 와 숫자 사이 (Irene 6차). ActionButton 의 gap 은 icon 슬롯에만 걸리고 이 숫자는
     children(Label span) 안이라 닿지 않는다. ★ 주석에 백틱 금지 — styled 템플릿이 끊긴다. */
  margin-left: 4px;
  text-align: left;
  font-variant-numeric: tabular-nums;  /* 자릿수마다 글자폭이 달라지지 않게 */
  font-weight: 700;                    /* 숫자가 라벨보다 먼저 읽히게 */
  /* 색은 COLOR_GUIDE 정본만 쓴다(새로 만들지 않는다): 1 이상 = Primary600 #0D9488
     (글자용 녹색은 500 이 아니라 600 이다 — 500 은 fill 색이라 흰 배경에서 흐리다) ·
     0 = Text Tertiary #94A3B8 */
  color: ${(p) => (p.$on ? '#0D9488' : '#94A3B8')};
`;
/* 행 아래 메모 — 카드 **밖**(RowWrap 의 둘째 칸)이라 좌우 **풀폭**이다.
   grid-column 은 여기 쓰이지 않는다(부모가 grid 가 아니다) — 있던 것을 지웠다.
   배경을 낮춰 카드와 구분하되, 위 카드에 붙여 어느 행의 메모인지 보이게 한다. */
const MemoPane = styled.div`
  width: 100%; margin: 4px 0 2px; padding: 12px 14px; box-sizing: border-box;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
