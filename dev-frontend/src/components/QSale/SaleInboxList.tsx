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
import StandardModal from '../Common/StandardModal';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import LetterAvatar from '../Common/LetterAvatar';
import HighlightText from '../Common/HighlightText';
import { listSaleInbox, type SaleInboxItem, type SaleInboxCounts, type SaleInboxSource } from '../../services/sale';

interface Props {
  businessId: number;
  /** 상단 검색어 — 목록 필터에 그대로 넘긴다(서버가 제목·상대·미리보기에서 찾는다) */
  q: string;
  /** 고객으로 등록이 끝나면 고객 탭 숫자가 바뀐다 — 부모가 다시 읽는다 */
  onRegistered?: () => void;
}

const SOURCES: Array<SaleInboxSource | ''> = ['', 'guest_link', 'email', 'chat'];

const SaleInboxList: React.FC<Props> = ({ businessId, q, onRegistered }) => {
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
  const [openId, setOpenId] = useState<string | null>(null);
  // 업무 추가 — 메일 내용을 베끼지 않고 **빈 입력**을 연다(Irene 2026-09-12).
  //   ★ 사람이 직접 쓰는 글이라 **쓰다 닫아도 남아야 한다**(입력 초안 계약).
  //     비우는 곳은 제출 성공·명시 취소뿐이다 — 대상 전환 이펙트에서 지우지 않는다.
  const [taskFor, setTaskFor] = useState<SaleInboxItem | null>(null);
  const [taskErr, setTaskErr] = useState<string | null>(null);
  const taskTitleKey = useDraftKey('sale-task-add', taskFor ? `${taskFor.id}:title` : null, businessId);
  const taskDescKey = useDraftKey('sale-task-add', taskFor ? `${taskFor.id}:desc` : null, businessId);
  const taskTitleDraft = useDraftText(taskTitleKey);
  const taskDescDraft = useDraftText(taskDescKey);
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

  useEffect(() => { void load(); }, [load, source, replyOnly, q]);

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

  const sourceLabel = useCallback((s: SaleInboxSource | '') => (
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

  // 업무 추가 — 제목은 그 문의에서 가져온다. 만든 뒤 그 업무를 연다.
  // ★ 2026-09-12 (Irene: "업무추가 버튼은 왜 메일 정보를 다 가져가? 그냥 업무추가 하면 입력을 하게 해.")
  //   여태는 메일 제목·미리보기를 그대로 베껴 업무를 만들었다. 상담에서 할 일은 메일 제목과 다르다
  //   ("견적서 보내기" 지 "Re: 문의드립니다" 가 아니다). **빈 입력**을 열고 사용자가 쓴 것만 저장한다.
  const submitTask = useCallback(async (it: SaleInboxItem, title: string, description: string) => {
    if (busyId) return;
    setBusyId(it.id);
    setActionError(null);
    try {
      const r = await apiFetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          title: title.trim().slice(0, 200),
          description: description.trim() || null,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.success === false) { setActionError(j?.message || `HTTP ${r.status}`); return; }
      const taskId = j?.data?.id;
      if (taskId) navigate(`/tasks?task=${taskId}`);
    } catch {
      setActionError(t('error.loadFailed') as string);
    } finally {
      setBusyId(null);
    }
  }, [busyId, businessId, navigate, t]);

  const rows = useMemo(() => items, [items]);

  const taskModal = taskFor ? (
    <StandardModal open onClose={() => setTaskFor(null)} title={t('taskAdd.title') as string} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={() => setTaskFor(null)}>
            {t('taskAdd.cancel') as string}
          </ActionButton>
          <ActionButton tone="primary" size="md" loading={busyId === taskFor.id}
            data-testid="sale-inbox-task-submit"
            onClick={async () => {
              if (!taskTitleDraft.text.trim()) { setTaskErr(t('taskAdd.titleRequired') as string); return; }
              const target = taskFor;
              const title = taskTitleDraft.text;
              const desc = taskDescDraft.text;
              setTaskFor(null);
              await submitTask(target, title, desc);
              // 제출이 끝난 뒤에만 비운다 — 실패를 삼키고 비우면 저장 실패가 곧 글 삭제다.
              taskTitleDraft.clear();
              taskDescDraft.clear();
            }}>
            {t('taskAdd.submit') as string}
          </ActionButton>
        </>
      )}>
      <FieldLabel htmlFor="sale-task-title">{t('taskAdd.titleLabel') as string}</FieldLabel>
      <TextInput id="sale-task-title" data-draft-kind="sale-task-add" value={taskTitleDraft.text} autoFocus
        placeholder={t('taskAdd.titlePlaceholder') as string}
        onChange={(e) => { taskTitleDraft.setText(e.target.value); setTaskErr(null); }} />
      <FieldLabel htmlFor="sale-task-desc">{t('taskAdd.descLabel') as string}</FieldLabel>
      <TextArea id="sale-task-desc" data-draft-kind="sale-task-add" value={taskDescDraft.text} rows={4}
        placeholder={t('taskAdd.descPlaceholder') as string}
        onChange={(e) => taskDescDraft.setText(e.target.value)} />
      {taskErr && <ErrorBar>{taskErr}</ErrorBar>}
    </StandardModal>
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
            const expanded = openId === it.id;
            const busy = busyId === it.id;
            return (
              <Row key={it.id} data-testid={`sale-inbox-row-${it.id}`}>
                <RowMain type="button" onClick={() => setOpenId((v) => (v === it.id ? null : it.id))}
                  aria-expanded={expanded}>
                  <LetterAvatar name={who} size={32} variant="neutral" />
                  <RowBody>
                    <RowTop>
                      <SourceTag $s={it.source}>{sourceLabel(it.source)}</SourceTag>
                      <Who><HighlightText text={who} query={q} /></Who>
                      {it.needs_reply && <ReplyTag>{t('inbox.needsReply') as string}</ReplyTag>}
                      <At title={it.at ? formatDateTime(it.at) : ''}>{it.at ? formatTimeAgo(it.at) : '—'}</At>
                    </RowTop>
                    <Title><HighlightText text={it.title || (t('inbox.noSubject') as string)} query={q} /></Title>
                    {it.preview && <Preview $open={expanded}><HighlightText text={it.preview} query={q} /></Preview>}
                  </RowBody>
                </RowMain>
                <RowActions>
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-open-${it.id}`} onClick={() => openRow(it)}>
                    {t('action.view') as string}
                  </ActionButton>
                  {it.ref.kind !== 'conversation' && (
                    <ActionButton tone="primary" size="sm" disabled={busy}
                      data-testid={`sale-inbox-register-${it.id}`} onClick={() => registerClient(it)}>
                      {t('action.registerClient') as string}
                    </ActionButton>
                  )}
                  <ActionButton tone="secondary" size="sm" disabled={busy}
                    data-testid={`sale-inbox-task-${it.id}`}
                    onClick={() => { setTaskFor(it); setTaskErr(null); }}>
                    {t('action.addTask') as string}
                  </ActionButton>
                </RowActions>
              </Row>
            );
          })}
        </List>
      )}
      {taskModal}
    </>
  );
};

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
const FieldLabel = styled.label`
  display: block; margin: 12px 0 6px; font-size: 0.8125rem; font-weight: 600; color: #475569;
  &:first-child { margin-top: 0; }
`;
const TextInput = styled.input`
  width: 100%; height: 40px; padding: 0 12px; box-sizing: border-box;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A;
  &:focus { outline: none; border-color: #0D9488; }
`;
const TextArea = styled.textarea`
  width: 100%; padding: 10px 12px; box-sizing: border-box; resize: vertical;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A;
  font-family: inherit; line-height: 1.5;
  &:focus { outline: none; border-color: #0D9488; }
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
const RowMain = styled.button`
  display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0;
  background: none; border: none; padding: 0; text-align: left; cursor: pointer; font-family: inherit;
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
const Preview = styled.div<{ $open: boolean }>`
  margin-top: 2px; font-size: 0.75rem; color: #94A3B8; line-height: 1.5;
  ${(p) => (p.$open ? '' : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;')}
`;
const RowActions = styled.div`
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  @media (max-width: 640px) { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
`;
