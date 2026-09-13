// ClientPanel — Q sale 우측 패널. **어디서 열든 한 벌이다.**
//
// Irene 2026-09-13: *"q sale 우측패널은 모두 동일해야 해. 상담에서 열든 고객에서 열든 우측 패널은
//   고객에서 연 창이야. 액션버튼도 모두 동일해야 하고. 어떻게 보든 무슨 상관이야. 상담 종류에 따라
//   다르고 고객 기준으로 저장하고 고객기준으로 응대하는 거야. … 전체 프로필에 나오는 거 다 우측패널에
//   나와야해. 그리고 수정 입력 추가 등 기능 우측패널에서 모두 되는 거야."*
//
// ★ 계약 (docs/Q_SALE_DESIGN.md §N.1)
//   · 저장·응대의 단위는 **고객**이다. 상담 종류(메일·채팅·전화·게스트링크)는 **표시 축**일 뿐
//     화면을 가르지 않는다. 2026-09-13 이전에는 `isInquiry` 로 패널이 **두 벌**이라
//     문의로 열면 고객 기능(기록·다음 연락·업무·연결·단계·청구)이 통째로 없었다.
//   · 상담에서 열었다는 사실은 **상단 문의 박스 하나**로만 표현한다. 그 아래는 고객 패널 그대로다.
//   · 아직 고객이 아닌 문의는 **여는 것만으로는 아무것도 만들지 않는다.** 저장이 필요한 첫 액션에서
//     확인을 받고 `prospect` 를 만든 뒤 그 액션을 이어서 실행한다(`withClient`).
//     ★ 그 자동 등록은 **초대 메일을 보내지 않는다** — 기록을 남겼을 뿐인데 고객에게 메일이 나가면 안 된다
//       (CLAUDE.md "외부 발송은 확인을 받는다"). 초대는 [초대] 버튼의 몫이다.
//
// ★ 정본은 `GET /api/sale/:biz/clients/:id` 하나다. 화면마다 따로 모으면 반드시 갈라진다.
//   목록용 직렬화는 이메일을 하나로 접지만(초대→계정→청구), 상세는 **종류별로 펴서** 내려온다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
// 실시간 — 이 패널은 소켓도 복귀 갱신도 없이 열려 있었다(CLAUDE.md 운영 안정성 16). 전체 프로필과 같은 두 벌을 쓴다.
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import OverflowMenu, { type OverflowItem } from '../Common/OverflowMenu';
import LetterAvatar from '../Common/LetterAvatar';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  getSaleClient, setSaleStage, getSaleTimeline, patchSaleClient,
  type SaleClientDetail, type LostReason, type TimelineItem, type TimelineType,
  type SaleInboxItem,
} from '../../services/sale';
import { createPost } from '../../services/posts';
import { apiFetch } from '../../contexts/AuthContext';
// 등록(+초대)은 한 벌 — 상담 목록·확인 필요·이 패널이 같은 함수를 부른다
import { registerInquiryAsClient } from '../../services/saleRegister';
// 히스토리는 상세와 **같은 컴포넌트**로 그린다 — 패널과 전체페이지가 다르면 고장으로 읽힌다
import ClientTimeline from '../Clients/ClientTimeline';
// 업무·파일·프로젝트 연결 — 전체 프로필과 같은 한 벌(따로 그리면 갈라진다)
import ClientLinksSection from './ClientLinksSection';
// 프로필 입력 — 전체 프로필과 **같은 폼**. 여기서 고칠 수 있어야 한다(Irene 2026-09-13)
import ClientProfileForm from './ClientProfileForm';
import { openSaleTimelineItem } from '../../utils/saleTimelineTarget';
// 불발 사유 창은 **공용**(상세 페이지와 같은 것) — 여기서 단계만 넘기면 왜 깨졌는지가 원장에 안 남는다
import LostReasonModal from './LostReasonModal';
// 단계 칩은 전체 프로필과 **같은 것**을 쓴다 — 화면마다 따로 그리면 동작이 갈라진다.
import ChipPopover from '../Common/ChipPopover';
import { OptionList, OptionBtn, OptName, OptHint } from '../Common/optionList';
import { SALE_STAGES, type SaleStage } from '../../services/sale';
// 되돌릴 수 없는 일(외부 발송·원장 생성) 앞에서는 묻는다
import ConfirmDialog from '../Common/ConfirmDialog';
// 상담 관리의 다음 액션 — 상세 페이지와 **같은 창**을 쓴다(자리마다 다른 동작을 만들지 않는다)
import RecordModal from './RecordModal';
import NextContactModal from './NextContactModal';
import TaskCreateForm from '../QTask/TaskCreateForm';

/** 상담에서 열었을 때 **상단 문의 박스**가 그리는 값 — 원본에서 가져올 수 있는 것은 다 넣는다.
 *  ★ 고객으로 등록된 상담(`ref.kind === 'client'`)도 이 박스를 갖는다 — 그 건이 무엇이었는지는
 *    등록 여부와 무관하게 보여야 한다(Irene: "상담탭에서 열면 해당 내용을 문의정보로 상단에"). */
export interface InquiryView {
  /** 원본 참조 — 자동 등록이 이것을 서버로 넘긴다 */
  ref: SaleInboxItem['ref'];
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
  /** 상담·확인 필요에서 열었을 때 그 건. `clientId` 와 **함께** 올 수 있다(등록된 상담) */
  inquiry?: InquiryView | null;
  onClose: () => void;
  /** 단계·프로필·기록이 바뀌면 부모 목록도 다시 읽는다 */
  onChanged?: () => void;
  /** 미등록 문의를 고객으로 등록(+초대) — 부모가 목록 갱신까지 맡는다 */
  onRegister?: () => void;
  /** 액션 결과(등록 실패·초대 실패 등) — 부르는 쪽이 자기 문구로 번역해 넘긴다.
   *  ★ 패널 안에서 일어난 일은 패널 안에서 말한다. 목록 바닥에만 적으면 패널에 가려 안 보인다. */
  notice?: string | null;
  /** 등록 진행 중 — 버튼 중복 제출 가드 */
  registerBusy?: boolean;
}

const HISTORY_PAGE = 20;
const HISTORY_CHANNELS: TimelineType[] = ['chat', 'email', 'task', 'invoice', 'interaction', 'stage', 'guest', 'note'];

const ClientPanel: React.FC<Props> = ({
  businessId, clientId, inquiry = null, onClose, onChanged, onRegister, registerBusy = false,
  notice = null,
}) => {
  const { t } = useTranslation('qsale');
  const navigate = useChromeNav();
  // 시각은 목록과 **같은 포맷터**로 — 날 ISO 문자열을 그대로 내보내면 사람이 읽는 값이 아니다
  const { formatDateTime } = useTimeFormat();

  // ── 실효 고객 id ──────────────────────────────────────────────
  //   부모가 준 고객 id 가 없으면, 첫 액션에서 자동 등록으로 생긴 id 를 쓴다.
  //   ★ 대상이 바뀌면 **반드시 잊는다** — 안 그러면 다음 문의에 앞 고객의 원장이 붙는다
  //     (memory feedback_scope_key_split_but_content_mixed 와 같은 계열).
  const [autoId, setAutoId] = useState<number | null>(null);
  const inquiryKey = inquiry ? `${inquiry.ref.kind}:${inquiry.ref.id}` : '';
  useEffect(() => { setAutoId(null); }, [clientId, inquiryKey]);
  const cid = clientId ?? autoId;

  const [data, setData] = useState<SaleClientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  // 히스토리 — **패널에서 전체를 본다**(Irene: "전체 히스토리보기는 뭐야. 다 나오는데").
  //   그래서 balanced(채널 쿼터)를 쓰지 않는다 — 커서 페이지네이션에서는 건너뛴 항목이 커서를 거짓으로 만든다.
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histMore, setHistMore] = useState(false);
  const beforeRef = useRef<string | null>(null);

  const loadHistory = useCallback(async (opts: { more?: boolean } = {}) => {
    if (!cid) { setItems([]); setHistMore(false); beforeRef.current = null; return; }
    setHistLoading(true);
    try {
      // ★ 채널을 **명시**한다 — 안 넘기면 서버 기본값이 적용돼 `note`(메모 모아보기)가 빠진다.
      const out = await getSaleTimeline(businessId, cid, {
        limit: HISTORY_PAGE,
        before: opts.more ? beforeRef.current : null,
        channels: HISTORY_CHANNELS,
      });
      setItems((prev) => (opts.more ? [...prev, ...(out.items || [])] : (out.items || [])));
      setHistMore(!!out.has_more);
      beforeRef.current = out.next_before || null;
    } catch { if (!opts.more) { setItems([]); setHistMore(false); } }
    finally { setHistLoading(false); }
  }, [businessId, cid]);

  // 액션(메모·다음 연락·업무 추가) 뒤에 다시 읽는 길 — 프로필과 히스토리를 **같이** 되읽는다
  const reload = useCallback(async () => {
    if (!cid) return;
    try { setData(await getSaleClient(businessId, cid)); onChanged?.(); }
    catch { setError(true); }
    void loadHistory();
  }, [businessId, cid, onChanged, loadHistory]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // 실시간 — 다른 사람이 이 고객의 업무·메모·단계를 바꾸면 패널이 스스로 따라간다(CLAUDE.md 운영 안정성 16).
  //   전체 프로필과 **같은 이벤트 목록**을 듣는다 — 두 화면이 서로 다른 것을 들으면 한쪽만 조용히 낡는다.
  useEffect(() => {
    if (!cid) return undefined;
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
  }, [cid, reload]);
  useVisibilityRefresh(reload);

  useEffect(() => {
    if (!cid) { setData(null); return; }
    let alive = true;
    setLoading(true); setError(false);
    getSaleClient(businessId, cid)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [businessId, cid]);

  // ── 첫 액션에서 자동 등록 ─────────────────────────────────────
  //   Irene 결정(2026-09-13): 여는 것만으로는 아무것도 만들지 않는다. 저장이 필요한 액션을
  //   처음 누를 때 한 번 묻고 `prospect` 를 만든 뒤 **그 액션을 이어서** 실행한다.
  //   ★ 액션마다 이 흐름을 베끼지 않는다 — 문은 `withClient` 하나다.
  const pendingRef = useRef<((id: number) => void) | null>(null);
  const [ensureAsk, setEnsureAsk] = useState(false);
  const [ensuring, setEnsuring] = useState(false);

  const withClient = useCallback((run: (id: number) => void) => {
    if (cid) { run(cid); return; }
    if (!inquiry || !inquiry.canRegister) return;
    pendingRef.current = run;
    setEnsureAsk(true);
  }, [cid, inquiry]);

  const ensureClient = useCallback(async () => {
    if (!inquiry || ensuring) return;
    setEnsuring(true); setLocalNotice(null);
    try {
      // ★ invite: false — 원장만 만든다. 초대 메일은 [초대] 버튼에서 확인을 받고 보낸다.
      const out = await registerInquiryAsClient(businessId, {
        ref: inquiry.ref, who: inquiry.who, email: inquiry.email, company: inquiry.company,
      }, { invite: false });
      if (!out.ok || !out.clientId) {
        setLocalNotice(out.message || (t('error.saveFailed') as string));
        return;
      }
      setAutoId(out.clientId);
      onChanged?.();
      const run = pendingRef.current;
      pendingRef.current = null;
      if (run) run(out.clientId);
    } catch { setLocalNotice(t('error.saveFailed') as string); }
    finally { setEnsuring(false); }
  }, [businessId, inquiry, ensuring, onChanged, t]);

  const [lostOpen, setLostOpen] = useState(false);
  // 다음 액션 — 기록(상담) · 다음 연락(일정) · 업무 추가. 청구·프로젝트는 그 화면으로 넘긴다.
  const [recordOpen, setRecordOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const [inviteAsk, setInviteAsk] = useState(false);
  const [registerAsk, setRegisterAsk] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const applyStage = useCallback(async (
    // 칩이 7단계를 모두 넘긴다 — 여기서 'won'|'lost' 로 좁히면 나머지 다섯은 **조용히 막힌다**.
    stage: SaleStage,
    extra?: { lost_reason?: LostReason; lost_note?: string },
  ) => {
    if (!cid || busy) return;
    setBusy(true);
    try {
      // ★ 시그니처는 **객체**다(`{ to, reason?, lost_reason?, lost_note? }`). 문자열을 넘기면 서버가 단계를 못 읽는다.
      await setSaleStage(businessId, cid, { to: stage, ...(extra || {}) });
      const fresh = await getSaleClient(businessId, cid);
      setData(fresh);
      onChanged?.();
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, cid, busy, onChanged]);

  // 불발은 **사유를 받고** 넘긴다 — 사유 없이 닫으면 왜 깨졌는지가 원장에 남지 않는다.
  const changeStage = useCallback((stage: SaleStage) => {
    if (stage === 'lost') { setLostOpen(true); return; }
    void applyStage(stage);
  }, [applyStage]);

  // 프로필 저장 — 전체 프로필과 **같은 라우트**(patchSaleClient). 실패는 던져야 ! 뱃지가 뜬다.
  const saveProfile = useCallback(async (patch: Record<string, unknown>) => {
    if (!cid) return;
    await patchSaleClient(businessId, cid, patch);
    await reload();
  }, [businessId, cid, reload]);

  const inviteEmail = data?.contact?.invite_email || data?.contact?.account_email || data?.email || '';

  // 초대 — 기존 라우트를 그대로 부른다(초대 메일·토큰·중복 판정이 전부 거기 있다)
  const sendInvite = useCallback(async () => {
    if (!cid || !data || busy || !inviteEmail) return;
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
  }, [businessId, cid, data, busy, inviteEmail, reload]);

  // 계약서 — Q docs 문서를 만들고 그 문서를 연다(받는 화면이 `?post=` 를 읽는다)
  const createContract = useCallback(async (forId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const who = data?.display_name || data?.company_name || inquiry?.who || `#${forId}`;
      const post = await createPost({
        business_id: businessId,
        title: `${t('action.contractTitle', { defaultValue: '계약서' }) as string} — ${who}`,
        status: 'draft',
      });
      navigate(`/docs?post=${post.id}`);
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, data, inquiry, busy, navigate, t]);

  // 이름 — 고객이 있으면 고객 이름, 아니면 문의의 이름. **헤더에만 둔다**(본문 중복 제거).
  const name = (cid ? (data?.display_name || data?.company_name || '') : '') || inquiry?.who || '';

  // ── 가끔 쓰는 액션은 ⋯ 로 접는다 ──────────────────────────────
  //   Irene: *"우측 패널 액션버튼들 정리 안되서 다 레이아웃 나가는 것도 그렇고."*
  //   푸터는 `flex` 에 `flex-wrap` 이 없어 버튼이 늘면 그대로 넘쳐난다(19개였다).
  //   상세 밴드 계약과 같은 원칙 — 자주 쓰는 3개만 두고 나머지는 메뉴로.
  const overflowItems = useMemo<OverflowItem[]>(() => {
    const out: OverflowItem[] = [];
    out.push({
      key: 'invoice', label: t('action.createInvoice') as string, testId: 'client-panel-invoice',
      // ★ 경로는 **/bills** 다(`/bill` 은 라우트가 없다 — 가드 `--category=routelink` 가 잡았다).
      //   그리고 기본 탭은 개요라 `tab=invoices` 를 지정해야 청구서 모달이 있는 화면이 뜬다.
      onClick: () => withClient((id) => navigate(`/bills?tab=invoices&new=1&client=${id}`)),
    });
    out.push({
      key: 'project', label: t('action.createProject') as string, testId: 'client-panel-project',
      onClick: () => withClient((id) => navigate(`/projects?new=1&client=${id}`)),
    });
    out.push({
      key: 'contract', label: t('action.createContract') as string, testId: 'client-panel-contract',
      disabled: busy,
      onClick: () => withClient((id) => { void createContract(id); }),
    });
    // 초대 — 아직 계정이 없는 고객에게만(이미 계정이 있으면 할 일이 없다)
    if (cid && data?.status === 'prospect') {
      out.push({
        key: 'invite', label: t('action.invite') as string, testId: 'client-panel-invite',
        disabled: busy || !inviteEmail,
        onClick: () => setInviteAsk(true),
        dividerBefore: true,
      });
    }
    // 명시적 [고객으로 등록] — **초대 메일까지** 보낸다. 자동 등록(withClient)과는 다른 일이다.
    if (!cid && inquiry?.canRegister && onRegister) {
      out.push({
        key: 'register', label: t('action.registerClient') as string, testId: 'inquiry-panel-register',
        disabled: registerBusy, onClick: () => setRegisterAsk(true), dividerBefore: true,
      });
    }
    if (cid) {
      out.push({
        key: 'full', label: t('panel.openFull') as string, testId: 'client-panel-full-menu',
        onClick: () => navigate(`/sale/${cid}`), dividerBefore: true,
      });
    }
    return out;
  }, [t, withClient, navigate, busy, createContract, cid, data, inviteEmail, inquiry, onRegister, registerBusy]);

  // 액션은 **고객이든 문의든 같다** — 문의면 첫 클릭에서 등록을 묻고 이어서 실행한다.
  const actionsReady = !!cid || !!(inquiry && inquiry.canRegister);

  return (
    <DetailDrawer open={cid != null || !!inquiry} onClose={onClose} width={420} ariaLabel={name || 'client'}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadRow>
          <HeadName title={name}>{name || '—'}</HeadName>
          {/* 전체보기 — 지금처럼 고객 페이지 전체를 본다 */}
          {cid && (
            <IconBtn type="button" data-testid="client-panel-full"
              title={t('panel.openFull') as string} aria-label={t('panel.openFull') as string}
              onClick={() => navigate(`/sale/${cid}`)}>
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
        {/* 고객·문의 어느 쪽이든 **같은 자리**에서 말한다 — 분기마다 따로 두면 한쪽에서만 보인다 */}
        {(notice || localNotice) && <NoticeBar role="status">{notice || localNotice}</NoticeBar>}

        {/* ── 상단: 아바타 + 보조 정보 ──────────────────────────────
            ★ 이름을 여기 다시 쓰지 않는다 — 헤더에 이미 있다(Irene: "우측패널제목이랑 아래 나오는 거랑
              왜 겹쳐? 이름 두번 나오고 그러잖아"). 여기는 회사·단계처럼 **이름이 아닌 것**만. */}
        <Top>
          <LetterAvatar name={name || '—'} size={44} variant="neutral" />
          <TopText>
            {cid && data ? (
              <>
                {data.company_name && data.display_name && <TopSub>{data.company_name}</TopSub>}
                {/* 단계는 **여기서 바꾼다**. 전체 프로필과 같은 ChipPopover 다 — 새로 그리면 두 화면이 갈라진다.
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
              </>
            ) : (
              <>
                {inquiry?.company && (
                  <TopSub>
                    {inquiry.company.name}
                    {inquiry.company.estimated && ` (${t('panel.companyEstimated') as string})`}
                  </TopSub>
                )}
                <StageTag>{t('panel.notClientYet') as string}</StageTag>
              </>
            )}
          </TopText>
        </Top>

        {/* ── 문의 정보 박스 — 상담/확인 필요에서 열었을 때 **그 건** ──────────
            Irene: *"상담탭에서 열면 해당 내용을 문의정보로 상단에 다른 박스로 표시를 해줘.
            아래 히스토리 중 내용이 위에 클릭한 내용을 보여주는 거지."* */}
        {inquiry && (
          <InquiryBox data-testid="client-panel-inquiry-box">
            <InquiryHead>
              <SectionTitle>{t('panel.inquiry') as string}</SectionTitle>
              <InquiryTags>
                <SourceTag>{t(`inbox.source.${inquiry.source}`, { defaultValue: inquiry.source }) as string}</SourceTag>
                {inquiry.needsReply && <ReplyTag>{t('inbox.needsReply') as string}</ReplyTag>}
              </InquiryTags>
            </InquiryHead>
            {inquiry.title && <InquiryTitle>{inquiry.title}</InquiryTitle>}
            {inquiry.preview && <PreviewBox>{inquiry.preview}</PreviewBox>}
            <InquiryMeta>
              {inquiry.email && (
                <span>
                  {inquiry.email}
                  {inquiry.emailVerified && ` (${t('panel.emailVerified') as string})`}
                </span>
              )}
              {inquiry.at && <span>{formatDateTime(inquiry.at)}</span>}
            </InquiryMeta>
            {/* ★ 이 버튼은 **다른 화면으로 나간다**(패널 안이 아니다) */}
            <ActionButton tone="secondary" size="sm" data-testid="inquiry-panel-view"
              onClick={() => navigate(inquiry.openPath)}>
              {t('action.view') as string}
            </ActionButton>
          </InquiryBox>
        )}

        {/* ── 아래는 **고객 패널 그대로** ───────────────────────────── */}
        {cid ? (
          loading && !data ? (
            <Dim>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
          ) : error || !data ? (
            <Dim>{t('error.loadFailed') as string}</Dim>
          ) : (
            <>
              {/* 프로필 — **여기서 고친다**. 전체 프로필과 같은 폼이다.
                  ★ 대상이 바뀌면 key 로 인스턴스를 가른다(떠난 고객의 마지막 입력이 새 고객으로 저장되지 않게). */}
              <Section>
                <SectionTitle>{t('panel.profile') as string}</SectionTitle>
                <ClientProfileForm key={`panel-profile-${cid}`} client={data} onSave={saveProfile} compact />
              </Section>

              <Section>
                <SectionTitle>{t('panel.contact') as string}</SectionTitle>
                {/* ★ 이메일은 **종류별로** 보여준다 — 목록처럼 하나로 접으면 어떤 주소인지 알 수 없다 */}
                <Row label={t('panel.accountEmail') as string} value={data.contact?.account_email} />
                <Row label={t('panel.inviteEmail') as string} value={data.contact?.invite_email} />
                <Row label={t('panel.billingEmail') as string} value={data.contact?.billing_email} />
                <Row label={t('panel.taxEmail') as string} value={data.contact?.tax_invoice_email} />
                <Row label={t('panel.billingPhone', { defaultValue: '청구 전화' }) as string} value={data.contact?.billing_phone} />
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
                {/* ★ 숫자를 누르면 **그 채널만** 보이는 히스토리로 간다. 죽은 숫자를 두지 않는다. */}
                <LinkRow>
                  <FieldLabel>{t('panel.conversations') as string}</FieldLabel>
                  <CountLink type="button" data-testid="panel-link-chat"
                    disabled={!(data.channels?.conversations)}
                    onClick={() => navigate(`/sale/${cid}?channel=chat`)}>
                    {data.channels?.conversations ?? 0}
                  </CountLink>
                </LinkRow>
                <LinkRow>
                  <FieldLabel>{t('panel.emailThreads') as string}</FieldLabel>
                  <CountLink type="button" data-testid="panel-link-mail"
                    disabled={!(data.channels?.email_threads)}
                    onClick={() => navigate(`/sale/${cid}?channel=email`)}>
                    {data.channels?.email_threads ?? 0}
                  </CountLink>
                </LinkRow>
                {/* 업무·파일·프로젝트 연결 — 전체 프로필과 **같은 컴포넌트**다(자리마다 다르게 만들지 않는다).
                    여러 프로젝트·여러 이메일은 **각각 행**으로 나온다(Irene: "여러 프로젝트 여러 이메일이
                    연결이 되면 각각 표시하면 되는 거야"). */}
                <ClientLinksSection
                  businessId={businessId}
                  clientId={cid}
                  projects={data.projects || []}
                  onChanged={() => { void reload(); }}
                  onOpenTask={(id) => navigate(`/tasks?task=${id}`)}
                  onOpenProject={(id) => navigate(`/projects/p/${id}`)}
                />
              </Section>

              {/* 히스토리 — 상세와 같은 컴포넌트. **전체를 여기서 본다**(더 보기). */}
              <Section>
                <SectionTitle>{t('panel.history') as string}</SectionTitle>
                {histLoading && items.length === 0 ? (
                  <Dim>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
                ) : items.length === 0 ? (
                  <Dim>{t('timeline.empty') as string}</Dim>
                ) : (
                  <>
                    <ClientTimeline items={items} onOpen={(it) => openSaleTimelineItem(it, navigate)} />
                    {histMore && (
                      <MoreLink type="button" data-testid="panel-history-more" disabled={histLoading}
                        onClick={() => { void loadHistory({ more: true }); }}>
                        {t('timeline.more') as string}
                      </MoreLink>
                    )}
                  </>
                )}
              </Section>

              {/* ★ 보관·삭제·한도 같은 **관리**는 여기 없다 — 설정 > 고객/파트너의 몫이다. */}
            </>
          )
        ) : (
          // 아직 고객이 아니다 — 무엇이 없는지, 무엇을 하면 되는지 한 줄로 말한다
          <Section>
            <Dim data-testid="client-panel-not-client">{t('panel.notClientHint') as string}</Dim>
          </Section>
        )}
      </DetailDrawer.Body>

      {/* 푸터는 **어디서 열든 같다** — 자주 쓰는 3개 + 나머지는 ⋯ */}
      <DetailDrawer.Footer>
        <ActionButton tone="secondary" size="md" disabled={!actionsReady || ensuring}
          data-testid="client-panel-record" onClick={() => withClient(() => setRecordOpen(true))}>
          {t('action.addRecord') as string}
        </ActionButton>
        <ActionButton tone="secondary" size="md" disabled={!actionsReady || ensuring}
          data-testid="client-panel-next" onClick={() => withClient(() => setNextOpen(true))}>
          {t('next.title') as string}
        </ActionButton>
        <ActionButton tone="secondary" size="md" disabled={!actionsReady || ensuring}
          data-testid="client-panel-task" onClick={() => withClient(() => setTaskOpen(true))}>
          {t('action.addTask') as string}
        </ActionButton>
        <OverflowMenu label={t('action.more') as string} items={overflowItems}
          data-testid="client-panel-more" />
      </DetailDrawer.Footer>

      {/* 자동 등록 확인 — **원장을 만드는 일**이라 묻는다. 메일은 나가지 않는다는 것을 문구에 적는다. */}
      {inquiry && (
        <ConfirmDialog
          isOpen={ensureAsk}
          title={t('action.ensureClientTitle') as string}
          message={inquiry.email
            ? (t('action.ensureClientBody', { who: inquiry.who || inquiry.email }) as string)
            : (t('action.ensureClientBodyNoEmail') as string)}
          confirmText={t('action.ensureClientConfirm') as string}
          cancelText={t('inquiry.cancel') as string}
          variant="info"
          onClose={() => { setEnsureAsk(false); pendingRef.current = null; }}
          onConfirm={() => { setEnsureAsk(false); void ensureClient(); }}
        />
      )}

      {/* 명시적 등록(+초대) — 주소를 **보여주고** 묻는다 */}
      {inquiry && onRegister && (
        <ConfirmDialog
          isOpen={registerAsk}
          title={t('action.registerConfirmTitle') as string}
          message={inquiry.email
            ? (t('action.registerConfirmBody', { email: inquiry.email }) as string)
            : (t('action.registerConfirmNoEmail') as string)}
          confirmText={t('action.registerClient') as string}
          cancelText={t('inquiry.cancel') as string}
          variant="info"
          onClose={() => setRegisterAsk(false)}
          onConfirm={() => { setRegisterAsk(false); onRegister(); }}
        />
      )}

      {cid && data && (
        <>
          <RecordModal open={recordOpen} businessId={businessId} clientId={cid}
            onClose={() => setRecordOpen(false)}
            onSaved={() => { setRecordOpen(false); void reload(); }} />
          <NextContactModal open={nextOpen} businessId={businessId} clientId={cid}
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
          {/* ★ 고객을 실어 보낸다 — 여기서 만든 업무는 **그 고객의 업무**다(tasks.client_id). */}
          {taskOpen && (
            <TaskCreateForm businessId={businessId} layout="drawer" fixedClientId={cid}
              onClose={() => setTaskOpen(false)} onCreated={() => { setTaskOpen(false); void reload(); }} />
          )}
          <LostReasonModal
            open={lostOpen}
            businessId={businessId}
            clientId={cid}
            onClose={() => setLostOpen(false)}
            onConfirm={async (reason, note) => {
              await applyStage('lost', { lost_reason: reason, lost_note: note });
              setLostOpen(false);
            }}
          />
        </>
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
/** 액션 결과 한 줄 — 성공 토스트는 쓰지 않는다(금지). 실패·경고만 여기에 남는다. */
const NoticeBar = styled.div`
  margin: 0 0 12px; padding: 8px 12px; border-radius: 8px;
  background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; line-height: 1.45;
`;
const Top = styled.div`display: flex; align-items: center; gap: 12px; padding: 4px 0 16px;`;
const TopText = styled.div`min-width: 0;`;
const TopSub = styled.div`margin-top: 2px; font-size: 0.8125rem; color: #64748B;`;
const StageTag = styled.span`
  display: inline-block; margin-top: 6px; padding: 3px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; font-size: 0.75rem; font-weight: 600;
`;
const Section = styled.section`padding: 14px 0; border-top: 1px solid #F1F5F9;`;
const SectionTitle = styled.h3`margin: 0 0 8px; font-size: 0.8125rem; font-weight: 700; color: #475569;`;
/** 문의 정보 — 고객 정보와 **성격이 다른 박스**다. 배경으로 구분해 "이건 지금 누른 그 건" 임을 말한다. */
const InquiryBox = styled.section`
  margin: 0 0 4px; padding: 12px; border-radius: 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
  ${SectionTitle} { margin: 0; }
`;
const InquiryHead = styled.div`display: flex; align-items: center; gap: 8px; width: 100%; flex-wrap: wrap;`;
const InquiryTags = styled.div`display: flex; align-items: center; gap: 6px; margin-left: auto;`;
const SourceTag = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #EEF2FF; color: #4338CA;
  font-size: 0.6875rem; font-weight: 700;
`;
const ReplyTag = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #FFF1F2; color: #BE123C;
  font-size: 0.6875rem; font-weight: 700;
`;
const InquiryTitle = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; word-break: break-word;`;
const InquiryMeta = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.75rem; color: #64748B; word-break: break-all;
`;
const FieldRow = styled.div`display: flex; gap: 10px; padding: 4px 0; font-size: 0.8125rem;`;
const FieldLabel = styled.span`min-width: 92px; color: #94A3B8; flex-shrink: 0;`;
const FieldValue = styled.span`color: #0F172A; word-break: break-all;`;
const PreviewBox = styled.div`
  width: 100%; padding: 10px 12px; background: #FFFFFF; border: 1px solid #F1F5F9;
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
  &:disabled { color: #94A3B8; cursor: default; }
`;
const Dim = styled.div`padding: 32px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
