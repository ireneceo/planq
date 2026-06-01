// Q Mail M2 — 인박스 read-only UI (사이클 N+75-D 박제)
//
// 3컬럼 구조 (Q_MAIL_SPEC §4.1 정합):
//   좌: MailFolderTree (폴더 선택 — 답변필요/인박스/스팸/보관)
//   중: MailThreadList (스레드 리스트 — 필터된 결과 + pagination)
//   우: MailThreadDetail (스레드 상세 — 모든 message + iframe sandbox HTML)
//
// read-only: 답장/전송 X (M3 후속), 라벨/스타/할당 X (M3 후속)
// 가능: 폴더 전환, 스레드 조회, 읽음 처리 (open 시 자동), 스팸 마킹

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { io, type Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import PanelHeader, { PanelTitle, PanelSubTitle } from '../../components/Layout/PanelHeader';
import { PanelLayout, Panel } from '../../components/Layout/PanelLayout';
import { useAuth, apiFetch, getAccessToken } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import RichEditor from '../../components/Common/RichEditor';
import AttachmentField from '../../components/Common/AttachmentField';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { uploadMyFile } from '../../services/files';

type Folder = 'reply_needed' | 'inbox' | 'assigned' | 'following' | 'spam' | 'archived';

// 메일 계정 (회사 공용 / 개인) — 폴더트리 그룹 (외부 연동 Phase 3)
interface MailAccount {
  id: number;
  email: string;
  display_name: string | null;
  is_personal: boolean;
  unread: number;
}

interface Thread {
  id: number;
  subject: string | null;
  last_message_preview: string | null;
  last_message_at: string;
  status: string;
  reply_needed: boolean;
  is_starred: boolean;
  unread_count: number;
  message_count: number;
  labels: string[];
  account: { id: number; email: string; display_name?: string | null } | null;
  client: { id: number; display_name?: string; company_name?: string } | null;
}

interface Message {
  id: number;
  direction: 'inbound' | 'outbound';
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  is_read: boolean;
  attachments: Array<{ id: number; file_name: string; file_size: number; mime_type: string }>;
}

interface ThreadDetail extends Thread {
  messages: Message[];
  assignee_user_id?: number | null;
  assignee_name?: string | null;
  my_following?: boolean;
}

interface MailLabel { name: string; color: string }
interface MailMember { user_id: number; name: string }

const FOLDERS: Array<{ key: Folder; defaultLabel: string }> = [
  { key: 'reply_needed', defaultLabel: '답변 필요' },
  { key: 'inbox', defaultLabel: '인박스' },
  { key: 'assigned', defaultLabel: '내 담당' },
  { key: 'following', defaultLabel: '팔로우' },
  { key: 'spam', defaultLabel: '스팸' },
  { key: 'archived', defaultLabel: '보관' },
];

const MailPage: React.FC = () => {
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const { formatTimeAgo } = useTimeFormat();
  const [sp, setSp] = useSearchParams();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const myUserId = user?.id ? Number(user.id) : null;

  const folderParam = (sp.get('folder') as Folder) || 'inbox';
  const folder: Folder = useMemo(
    () => (FOLDERS.find(f => f.key === folderParam)?.key || 'inbox'),
    [folderParam],
  );
  const threadIdParam = sp.get('thread');
  const activeId = threadIdParam ? Number(threadIdParam) : null;
  // 계정(회사/개인) 필터 — null = 전체 (외부 연동 Phase 3)
  const accountParam = sp.get('account');
  const accountFilter = accountParam ? Number(accountParam) : null;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [folderCounts, setFolderCounts] = useState<Record<Folder, number>>({
    reply_needed: 0, inbox: 0, assigned: 0, following: 0, spam: 0, archived: 0,
  });
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [labelMaster, setLabelMaster] = useState<MailLabel[]>([]);
  const [members, setMembers] = useState<MailMember[]>([]);

  const setFolder = (f: Folder) => {
    const nsp = new URLSearchParams(sp);
    nsp.set('folder', f);
    nsp.delete('thread');
    setSp(nsp, { replace: true });
  };

  const setActive = (id: number | null) => {
    const nsp = new URLSearchParams(sp);
    if (id === null || activeId === id) nsp.delete('thread');
    else nsp.set('thread', String(id));
    setSp(nsp, { replace: true });
  };

  // 계정 필터 토글 (재클릭 해제 — 공통 UX 규칙)
  const setAccount = (id: number | null) => {
    const nsp = new URLSearchParams(sp);
    if (id === null || accountFilter === id) nsp.delete('account');
    else nsp.set('account', String(id));
    nsp.delete('thread');
    setSp(nsp, { replace: true });
  };

  // 폴더 list fetch (계정 필터 반영)
  const loadList = useCallback(async () => {
    if (!businessId) return;
    setListLoading(true);
    setErrorMsg(null);
    try {
      const acctQ = accountFilter ? `&account_id=${accountFilter}` : '';
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads?folder=${folder}&limit=100${acctQ}`);
      const j = await r.json();
      if (j.success) setThreads(j.data || []);
      else setErrorMsg(j.message || (t('errors.loadList', { defaultValue: '인박스 로딩 실패' }) as string));
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setListLoading(false);
    }
  }, [businessId, folder, accountFilter, t]);

  // 메일 계정 목록 (회사/개인 그룹 + unread)
  const loadAccounts = useCallback(async () => {
    if (!businessId) return;
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/mail-accounts`);
      const j = await r.json();
      if (j.success) setAccounts(j.data || []);
    } catch { /* silent — 계정 그룹은 부가 */ }
  }, [businessId]);

  // 폴더 카운트 fetch (병렬)
  const loadCounts = useCallback(async () => {
    if (!businessId) return;
    const results = await Promise.all(
      FOLDERS.map(async ({ key }) => {
        try {
          const r = await apiFetch(`/api/businesses/${businessId}/email-threads?folder=${key}&limit=1`);
          const j = await r.json();
          return [key, j.pagination?.total || 0] as [Folder, number];
        } catch { return [key, 0] as [Folder, number]; }
      })
    );
    setFolderCounts(Object.fromEntries(results) as Record<Folder, number>);
  }, [businessId]);

  // 라벨 마스터 + 멤버 (M3-B 라벨/할당용)
  const loadLabels = useCallback(async () => {
    if (!businessId) return;
    try {
      const j = await apiFetch(`/api/businesses/${businessId}/email-labels`).then(r => r.json());
      if (j.success) setLabelMaster(j.data || []);
    } catch { /* silent */ }
  }, [businessId]);
  const loadMembers = useCallback(async () => {
    if (!businessId) return;
    try {
      const j = await apiFetch(`/api/businesses/${businessId}/members`).then(r => r.json());
      if (j.success) setMembers((j.data || []).map((m: { user_id: number; name?: string | null; User?: { name: string } }) => ({ user_id: m.user_id, name: m.name || m.User?.name || `#${m.user_id}` })));
    } catch { /* silent */ }
  }, [businessId]);

  // 스레드 부분 수정 (스타/라벨/보관) — 낙관적 갱신
  const patchThread = useCallback(async (id: number, patch: Record<string, unknown>) => {
    if (!businessId) return;
    setThreads(prev => prev.map(t => (t.id === id ? { ...t, ...patch } as Thread : t)));
    setDetail(prev => (prev && prev.id === id ? { ...prev, ...patch } as ThreadDetail : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      loadCounts();
    } catch { /* 실패 시 silentReload 로 복원 */ silentReloadRef.current?.(); }
  }, [businessId, loadCounts]);

  const toggleStar = useCallback((e: React.MouseEvent, th: Thread) => {
    e.stopPropagation();
    patchThread(th.id, { is_starred: !th.is_starred });
  }, [patchThread]);

  // 라벨 토글 (상세) — 현재 라벨 배열에 추가/제거
  const toggleLabel = useCallback((name: string) => {
    if (!detail) return;
    const cur = detail.labels || [];
    const next = cur.includes(name) ? cur.filter(l => l !== name) : [...cur, name];
    patchThread(detail.id, { labels: next });
  }, [detail, patchThread]);

  // 팔로우 토글 (상세)
  const toggleFollow = useCallback(async () => {
    if (!detail || !businessId) return;
    const next = !detail.my_following;
    setDetail(prev => (prev ? { ...prev, my_following: next } : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/follow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ follow: next }),
      });
      loadCounts();
    } catch { /* noop */ }
  }, [detail, businessId, loadCounts]);

  // 담당 토글 (상세) — 본인 ↔ 해제
  const toggleAssignMe = useCallback(async () => {
    if (!detail || !businessId || !myUserId) return;
    const mine = detail.assignee_user_id === myUserId;
    const uid = mine ? null : myUserId;
    setDetail(prev => (prev ? { ...prev, assignee_user_id: uid, assignee_name: mine ? null : (members.find(m => m.user_id === myUserId)?.name || null) } : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid }),
      });
      loadCounts();
    } catch { /* noop */ }
  }, [detail, businessId, myUserId, members, loadCounts]);

  const labelColor = useCallback((name: string) => labelMaster.find(l => l.name === name)?.color || '#14B8A6', [labelMaster]);
  const assignOptions = useMemo(() => [
    { value: 0, label: t('actions.unassigned', { defaultValue: '담당 없음' }) as string },
    ...members.map(m => ({ value: m.user_id, label: m.name })),
  ], [members, t]);

  // 담당자 지정 (멤버 선택 — PlanQSelect)
  const assignTo = useCallback(async (uid: number | null) => {
    if (!detail || !businessId) return;
    setDetail(prev => (prev ? { ...prev, assignee_user_id: uid, assignee_name: uid ? (members.find(m => m.user_id === uid)?.name || null) : null } : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid }),
      });
      loadCounts();
    } catch { /* noop */ }
  }, [detail, businessId, members, loadCounts]);

  // 새 라벨 생성 (마스터 추가 후 현재 스레드에 적용)
  const [newLabelName, setNewLabelName] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const createLabel = useCallback(async () => {
    const nm = newLabelName.trim();
    if (!nm || !businessId || labelBusy) return;
    setLabelBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-labels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }),
      });
      const j = await r.json();
      if (j.success) {
        setLabelMaster(j.data || []);
        setNewLabelName('');
        if (detail && !(detail.labels || []).includes(nm)) toggleLabel(nm);
      }
    } catch { /* noop */ } finally { setLabelBusy(false); }
  }, [newLabelName, businessId, labelBusy, detail, toggleLabel]);


  // 스레드 detail fetch + auto mark-read
  const loadDetail = useCallback(async (id: number) => {
    if (!businessId) return;
    setDetailLoading(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${id}`);
      const j = await r.json();
      if (j.success) {
        setDetail(j.data);
        // 자동 읽음 처리 (unread_count 있을 때만)
        if (j.data.unread_count > 0) {
          await apiFetch(`/api/businesses/${businessId}/email-threads/${id}/mark-read`, { method: 'POST' });
          loadList();
          loadCounts();
        }
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, [businessId, loadList, loadCounts]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadLabels(); }, [loadLabels]);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => {
    if (activeId) loadDetail(activeId);
    else setDetail(null);
  }, [activeId, loadDetail]);

  const onMarkSpam = async () => {
    if (!detail || !businessId) return;
    const path = detail.status === 'spam' ? 'mark-not-spam' : 'mark-spam';
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/${path}`, { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        setActive(null);
        loadList();
        loadCounts();
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  };

  // ── 실시간 silent 갱신 (socket / visibility) — 스피너 없이 list+counts+열린 detail 갱신
  const silentReload = useCallback(() => {
    loadList();
    loadCounts();
    loadAccounts();
    if (activeId) loadDetail(activeId);
  }, [loadList, loadCounts, loadAccounts, activeId, loadDetail]);
  const silentReloadRef = useRef(silentReload);
  useEffect(() => { silentReloadRef.current = silentReload; }, [silentReload]);

  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    if (!user || !businessId || !getAccessToken()) return;
    const s = io({
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true, reconnectionDelay: 1500, reconnectionDelayMax: 8000, reconnectionAttempts: Infinity,
    });
    socketRef.current = s;
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentReloadRef.current(); }, 250);
    };
    s.on('connect', () => { s.emit('join:business', businessId); });
    s.on('mail:new', debounced);
    s.on('mail:updated', debounced);
    const onLocal = () => debounced();
    window.addEventListener('mail:refresh', onLocal);
    return () => {
      if (pending) window.clearTimeout(pending);
      window.removeEventListener('mail:refresh', onLocal);
      s.emit('leave:business', businessId);
      s.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, businessId]);

  useVisibilityRefresh(useCallback(() => {
    silentReloadRef.current();
    const s = socketRef.current;
    if (s && !s.connected) s.connect();
  }, []));

  // ── 답장 컴포저 ──
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyHtml, setReplyHtml] = useState('');
  const [replyUploads, setReplyUploads] = useState<File[]>([]);
  const [replyFileIds, setReplyFileIds] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // AI 답변 제안 (Cue) — 마지막 inbound 기반 초안 → 컴포저 채움
  const aiSuggest = useCallback(async () => {
    if (!detail || !businessId || aiBusy) return;
    setAiBusy(true);
    setReplyError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/ai-suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!j.success) {
        const map: Record<string, string> = {
          cue_usage_limit_exceeded: t('reply.aiLimitExceeded', { defaultValue: '이번 달 Cue 사용량을 모두 썼어요.' }) as string,
          ai_unavailable: t('reply.aiUnavailable', { defaultValue: 'AI 서비스를 잠시 사용할 수 없어요.' }) as string,
          no_inbound_message: t('reply.aiNoInbound', { defaultValue: '답장할 받은 메일이 없어요.' }) as string,
        };
        setReplyError(map[j.message] || (t('reply.aiFailed', { defaultValue: 'AI 제안 생성 실패' }) as string));
        return;
      }
      if (j.data?.suggestion) setReplyHtml(j.data.suggestion);
    } catch (e) {
      setReplyError((e as Error).message);
    } finally { setAiBusy(false); }
  }, [detail, businessId, aiBusy, t]);

  // 스레드 전환 시 컴포저 초기화
  useEffect(() => {
    setReplyOpen(false); setReplyHtml(''); setReplyUploads([]); setReplyFileIds([]); setReplyError(null);
  }, [activeId]);

  // 답장 받는 사람 힌트 (마지막 inbound 발신자)
  const replyToHint = useMemo(() => {
    if (!detail) return '';
    const lastInbound = [...detail.messages].reverse().find(m => m.direction === 'inbound');
    return lastInbound?.from_email || detail.client?.company_name || '';
  }, [detail]);

  const isEmptyHtml = (h: string) =>
    !h.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();

  const sendReply = async () => {
    if (!detail || !businessId || sending) return;
    if (isEmptyHtml(replyHtml)) {
      setReplyError(t('reply.emptyBody', { defaultValue: '내용을 입력해 주세요' }) as string);
      return;
    }
    setSending(true);
    setReplyError(null);
    try {
      // 새 업로드 먼저 올려 file id 확보 → 기존 선택 파일과 합침
      const fileIds = [...replyFileIds];
      for (const f of replyUploads) {
        const up = await uploadMyFile(businessId, f);
        if (up.success && up.file) fileIds.push(Number(String(up.file.id).replace('direct-', '')));
        else throw new Error(up.message || (t('reply.uploadFailed', { defaultValue: '첨부 업로드 실패' }) as string));
      }
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_html: replyHtml, attachment_file_ids: fileIds }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || (t('reply.sendFailed', { defaultValue: '발송 실패' }) as string));
      // 성공 — 컴포저 닫고 갱신 (성공 토스트 금지)
      setReplyOpen(false); setReplyHtml(''); setReplyUploads([]); setReplyFileIds([]);
      await loadDetail(detail.id);
      loadList();
      loadCounts();
    } catch (e) {
      setReplyError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onComposerKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendReply();
    }
  };

  if (!businessId) return <PageShell title="Q Mail"><Empty>{t('selectWorkspace', { defaultValue: '워크스페이스를 선택해 주세요.' }) as string}</Empty></PageShell>;

  return (
    <PanelLayout>
      {/* 좌: 메일 리스트 (폴더 = 상단 탭) — 2-pane, Q Talk LeftPanel 패턴 */}
      <Panel $width={340}>
        <PanelHeader>
          <PanelTitle>Q Mail</PanelTitle>
          <ListCount>{threads.length}</ListCount>
        </PanelHeader>
        <FolderTabs>
          {FOLDERS.map(({ key, defaultLabel }) => (
            <FolderTab key={key} type="button" $active={folder === key} onClick={() => setFolder(key)}>
              {t(`folders.${key}`, { defaultValue: defaultLabel }) as string}
              {folderCounts[key] > 0 && <TabCount $active={folder === key}>{folderCounts[key]}</TabCount>}
            </FolderTab>
          ))}
        </FolderTabs>
        {accounts.length > 1 && (
          <AcctFilterRow>
            <AcctChip type="button" $active={accountFilter === null} onClick={() => setAccount(null)}>
              {t('accounts.all', { defaultValue: '전체' }) as string}
            </AcctChip>
            {accounts.map((a) => (
              <AcctChip key={a.id} type="button" $active={accountFilter === a.id} onClick={() => setAccount(a.id)} title={a.email}>
                {a.display_name || a.email}{a.unread > 0 ? ` ${a.unread}` : ''}
              </AcctChip>
            ))}
          </AcctFilterRow>
        )}
          {errorMsg && <ErrorBar>{errorMsg}</ErrorBar>}
          {listLoading && threads.length === 0 ? (
            <Loading>
              <Spinner />
              {t('loading', { defaultValue: '불러오는 중…' }) as string}
            </Loading>
          ) : threads.length === 0 ? (
            <EmptyList>
              <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 6l-10 7L2 6" /><rect x="2" y="4" width="20" height="16" rx="2" />
              </EmptyIcon>
              <EmptyText>{t('emptyFolder', { defaultValue: '이 폴더에 메일이 없어요' }) as string}</EmptyText>
            </EmptyList>
          ) : (
            <ThreadList>
              {threads.map(mt => (
                <ThreadItem
                  key={mt.id}
                  type="button"
                  $active={activeId === mt.id}
                  $unread={mt.unread_count > 0}
                  onClick={() => setActive(mt.id)}
                >
                  <ThreadRow1>
                    <ThreadSender>
                      {mt.client?.display_name || mt.client?.company_name || mt.account?.display_name || mt.account?.email || '(unknown)'}
                    </ThreadSender>
                    <ThreadRow1Right>
                      <StarSpan
                        role="button"
                        aria-label={mt.is_starred
                          ? t('actions.unstar', { defaultValue: '별표 해제' }) as string
                          : t('actions.star', { defaultValue: '별표' }) as string}
                        $on={mt.is_starred}
                        onClick={(e) => toggleStar(e, mt)}
                      >{mt.is_starred ? '★' : '☆'}</StarSpan>
                      <ThreadTime>{formatTimeAgo(mt.last_message_at)}</ThreadTime>
                    </ThreadRow1Right>
                  </ThreadRow1>
                  <ThreadSubject $unread={mt.unread_count > 0}>
                    {mt.unread_count > 0 && <UnreadDot />}
                    {mt.subject || '(no subject)'}
                  </ThreadSubject>
                  {mt.last_message_preview && <ThreadPreview>{mt.last_message_preview}</ThreadPreview>}
                  {mt.labels && mt.labels.length > 0 && (
                    <RowLabels>
                      {mt.labels.map(l => <LabelChip key={l} $color={labelColor(l)}>{l}</LabelChip>)}
                    </RowLabels>
                  )}
                </ThreadItem>
              ))}
            </ThreadList>
          )}
        </Panel>

        {/* 우: 상세 */}
        <Panel $grow $last $hideTablet>
          {detailLoading && !detail ? (
            <Loading><Spinner /></Loading>
          ) : !detail ? (
            <EmptyDetail>
              <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 6l-10 7L2 6" /><rect x="2" y="4" width="20" height="16" rx="2" />
              </EmptyIcon>
              <EmptyText>{t('selectThread', { defaultValue: '스레드를 선택해 주세요' }) as string}</EmptyText>
            </EmptyDetail>
          ) : (
            <>
              <PanelHeader>
                <PanelSubTitle>{detail.subject || '(no subject)'}</PanelSubTitle>
                <DetailHeaderRight>
                  {detail.message_count > 1 && <MetaChip>{t('messageCount', { defaultValue: '{{n}}개 메시지', n: detail.message_count }) as string}</MetaChip>}
                  {detail.client && <MetaChip>{detail.client.display_name || detail.client.company_name}</MetaChip>}
                  <DangerBtn type="button" onClick={onMarkSpam}>
                    {detail.status === 'spam'
                      ? t('actions.notSpam', { defaultValue: '스팸 해제' }) as string
                      : t('actions.markSpam', { defaultValue: '스팸으로' }) as string}
                  </DangerBtn>
                </DetailHeaderRight>
              </PanelHeader>
              <DetailToolbar>
                <DetailControls>
                  <CtrlBtn type="button" $on={detail.is_starred} onClick={() => patchThread(detail.id, { is_starred: !detail.is_starred })}>
                    {detail.is_starred ? '★' : '☆'} {t('actions.star', { defaultValue: '별표' }) as string}
                  </CtrlBtn>
                  <CtrlBtn type="button" $on={!!detail.my_following} onClick={toggleFollow}>
                    {detail.my_following
                      ? t('actions.following', { defaultValue: '팔로우 중' }) as string
                      : t('actions.follow', { defaultValue: '팔로우' }) as string}
                  </CtrlBtn>
                  {myUserId && (
                    <CtrlBtn type="button" $on={detail.assignee_user_id === myUserId} onClick={toggleAssignMe}>
                      {detail.assignee_user_id === myUserId
                        ? t('actions.assignedToMe', { defaultValue: '내 담당 ✓' }) as string
                        : t('actions.assignMe', { defaultValue: '내가 담당' }) as string}
                    </CtrlBtn>
                  )}
                  <AssignWrap>
                    <PlanQSelect
                      size="sm"
                      value={assignOptions.find(o => o.value === (detail.assignee_user_id || 0))}
                      onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; assignTo(v > 0 ? v : null); }}
                      options={assignOptions}
                      isSearchable
                      menuPlacement="bottom"
                    />
                  </AssignWrap>
                </DetailControls>
                <DetailLabels>
                  {(detail.labels || []).map(l => (
                    <LabelChip key={l} $color={labelColor(l)} $clickable onClick={() => toggleLabel(l)} title={t('actions.removeLabel', { defaultValue: '라벨 제거' }) as string}>
                      {l} ✕
                    </LabelChip>
                  ))}
                  {labelMaster.filter(lm => !(detail.labels || []).includes(lm.name)).map(lm => (
                    <AddLabelChip key={lm.name} type="button" $color={lm.color} onClick={() => toggleLabel(lm.name)}>+ {lm.name}</AddLabelChip>
                  ))}
                  <NewLabelInput
                    value={newLabelName}
                    disabled={labelBusy}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createLabel(); } }}
                    placeholder={t('actions.newLabel', { defaultValue: '+ 새 라벨' }) as string}
                  />
                </DetailLabels>
              </DetailToolbar>
              <MessagesScroll>
                {detail.messages.map(m => (
                  <MessageCard key={m.id} $outbound={m.direction === 'outbound'}>
                    <MessageHeader>
                      <MessageFrom>
                        {m.direction === 'outbound'
                          ? `${t('me', { defaultValue: '나' }) as string} <${detail.account?.email || ''}>`
                          : `${m.from_name || ''} <${m.from_email || ''}>`}
                      </MessageFrom>
                      <MessageTime>{formatTimeAgo(m.sent_at)}</MessageTime>
                    </MessageHeader>
                    {/* iframe sandbox — body_html 의 script/style 차단, 외부 리소스 only */}
                    {m.body_html ? (
                      <MessageBodyFrame
                        sandbox=""
                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;font-size:14px;color:#0F172A;margin:0;padding:12px;line-height:1.6;}img{max-width:100%;height:auto;}a{color:#0D9488;}</style></head><body>${m.body_html}</body></html>`}
                        title={`message-${m.id}`}
                      />
                    ) : (
                      <MessageBodyText>{m.body_text || '(no content)'}</MessageBodyText>
                    )}
                    {m.attachments.length > 0 && (
                      <Attachments>
                        {m.attachments.map(a => (
                          <Attachment key={a.id}>
                            📎 {a.file_name} ({Math.round(a.file_size / 1024)} KB)
                          </Attachment>
                        ))}
                      </Attachments>
                    )}
                  </MessageCard>
                ))}
              </MessagesScroll>
              <DetailFooter>
                {!replyOpen ? (
                  <ReplyBar>
                    <ActionButton tone="primary" size="md" onClick={() => setReplyOpen(true)}>
                      {t('reply.button', { defaultValue: '답장' }) as string}
                    </ActionButton>
                  </ReplyBar>
                ) : (
                  <Composer onKeyDown={onComposerKeyDown}>
                    {replyToHint && (
                      <ComposerTo>
                        {t('reply.to', { defaultValue: '받는 사람' }) as string}: <strong>{replyToHint}</strong>
                      </ComposerTo>
                    )}
                    <RichEditor
                      value={replyHtml}
                      onChange={setReplyHtml}
                      placeholder={t('reply.placeholder', { defaultValue: '답장 내용을 입력하세요…' }) as string}
                    />
                    <AttachmentField
                      businessId={businessId}
                      uploads={replyUploads}
                      onUploadsChange={setReplyUploads}
                      existingFileIds={replyFileIds}
                      onExistingFileIdsChange={setReplyFileIds}
                    />
                    {replyError && <ComposerError>{replyError}</ComposerError>}
                    <ComposerActions>
                      <AiSuggestBtn type="button" onClick={aiSuggest} disabled={aiBusy || sending}>
                        {aiBusy
                          ? t('reply.aiThinking', { defaultValue: 'Cue 작성 중…' }) as string
                          : t('reply.aiSuggest', { defaultValue: '✨ AI 답변 제안' }) as string}
                      </AiSuggestBtn>
                      <ComposerBtns>
                        <ActionButton tone="secondary" size="md" onClick={() => setReplyOpen(false)} disabled={sending}>
                          {t('reply.cancel', { defaultValue: '취소' }) as string}
                        </ActionButton>
                        <ActionButton tone="primary" size="md" loading={sending} onClick={sendReply}>
                          {t('reply.send', { defaultValue: '보내기' }) as string}
                        </ActionButton>
                      </ComposerBtns>
                    </ComposerActions>
                    <ComposerHint>{t('reply.shortcut', { defaultValue: '⌘/Ctrl + Enter 로 보내기' }) as string}</ComposerHint>
                  </Composer>
                )}
              </DetailFooter>
            </>
          )}
        </Panel>
    </PanelLayout>
  );
};

export default MailPage;

// ─────────────────────────────────────────────
// styles
// ─────────────────────────────────────────────
// Q Talk 의 Layout 과 동일 — flex row, full-bleed (PageShell·카드 X)
// 컨테이너·패널은 공통 components/Layout/PanelLayout 의 PanelLayout/Panel 사용 (통일)
// 폴더 탭 (답변필요/인박스/내담당/팔로우/스팸/보관) — 좌측 상단 가로 탭
const FolderTabs = styled.div`
  display: flex; gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const FolderTab = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  flex-shrink: 0;
  padding: 8px 10px 9px;
  border: none; background: transparent;
  font-size: 13px; font-weight: ${p => p.$active ? 700 : 500};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  cursor: pointer; white-space: nowrap;
  transition: color 0.12s;
  &:hover { color: #0F766E; }
`;
const TabCount = styled.span<{ $active: boolean }>`
  min-width: 16px; padding: 0 5px;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  font-size: 10px; font-weight: 700;
  border-radius: 999px; text-align: center;
`;
// 계정 필터 칩 (회사/개인) — 탭 아래
const AcctFilterRow = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 8px 10px;
  border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const AcctChip = styled.button<{ $active: boolean }>`
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  border: 1px solid ${p => p.$active ? '#5EEAD4' : '#E2E8F0'};
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { border-color: #5EEAD4; }
`;

const ListCount = styled.span`
  font-size: 13px; font-weight: 600; color: #94A3B8;
`;
// Q Talk ChatList 와 동일 — 둥근 행이 측면 여백 갖도록 padding
const ThreadList = styled.div`
  flex: 1; overflow-y: auto;
  padding: 6px 6px 12px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;
// Q Talk ChatRow 정확값 — 둥근 행, active=#F0FDFA + inset 3px 0 0 #0D9488, hover #F8FAFC
const ThreadItem = styled.button<{ $active: boolean; $unread: boolean }>`
  display: block; width: 100%;
  padding: 10px 10px;
  margin: 2px 0;
  border-radius: 10px;
  border: none;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  ${p => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
  &:hover { ${p => !p.$active && 'background: #F8FAFC;'} }
`;
const ThreadRow1 = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 4px;
`;
const ThreadSender = styled.span`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 70%;
`;
const ThreadTime = styled.span`
  font-size: 11px; color: #94A3B8; flex-shrink: 0;
`;
const ThreadSubject = styled.div<{ $unread: boolean }>`
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
  font-weight: ${p => p.$unread ? 600 : 500};
  color: #334155;
  margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const UnreadDot = styled.span`
  display: inline-block; flex-shrink: 0;
  width: 8px; height: 8px; border-radius: 50%;
  background: #14B8A6;
`;
const ThreadPreview = styled.div`
  font-size: 12px; color: #64748B;
  line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;
// M3-B — 행 별표 + 라벨 칩
const ThreadRow1Right = styled.span`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
`;
const StarSpan = styled.span<{ $on: boolean }>`
  font-size: 14px; line-height: 1; cursor: pointer;
  color: ${p => p.$on ? '#F59E0B' : '#CBD5E1'};
  &:hover { color: ${p => p.$on ? '#D97706' : '#94A3B8'}; }
`;
const RowLabels = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
`;
const LabelChip = styled.span<{ $color: string; $clickable?: boolean }>`
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  color: ${p => p.$color};
  background: ${p => p.$color}1A;
  border: 1px solid ${p => p.$color}55;
  cursor: ${p => p.$clickable ? 'pointer' : 'default'};
`;

// 상세 헤더 우측 (메시지 수·고객 칩 + 스팸) — PanelHeader 안 오른쪽 슬롯
const DetailHeaderRight = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  flex-shrink: 0;
`;
// 상세 부가 툴바 (컨트롤·라벨) — PanelHeader 아래 별도 줄
const DetailToolbar = styled.div`
  padding: 12px 20px;
  border-bottom: 1px solid #F1F5F9;
  background: #FFFFFF;
`;
const MetaChip = styled.span`
  padding: 2px 8px;
  background: #F1F5F9; color: #475569;
  font-size: 11px; font-weight: 500;
  border-radius: 999px;
`;
// M3-B — 상세 헤더 컨트롤 (별표/팔로우/담당) + 라벨
const DetailControls = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 0;
`;
const CtrlBtn = styled.button<{ $on: boolean }>`
  height: 28px; padding: 0 12px;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  border: 1px solid ${p => p.$on ? '#5EEAD4' : '#E2E8F0'};
  background: ${p => p.$on ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$on ? '#0F766E' : '#64748B'};
  transition: background 0.12s, border-color 0.12s;
  &:hover { border-color: #5EEAD4; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const DetailLabels = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
`;
const AddLabelChip = styled.button<{ $color: string }>`
  padding: 2px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  color: ${p => p.$color};
  background: #FFFFFF;
  border: 1px dashed ${p => p.$color}88;
  &:hover { background: ${p => p.$color}12; }
`;
const NewLabelInput = styled.input`
  height: 24px; padding: 0 10px;
  border: 1px dashed #CBD5E1; border-radius: 999px;
  font-size: 11px; color: #334155;
  width: 96px;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; border-style: solid; }
  &:disabled { opacity: 0.5; }
`;
const AssignWrap = styled.div`
  min-width: 150px;
`;
const DangerBtn = styled.button`
  margin-left: auto;
  height: 28px; padding: 0 12px;
  background: transparent; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
`;

const MessagesScroll = styled.div`
  flex: 1; overflow-y: auto;
  padding: 16px 24px;
  display: flex; flex-direction: column; gap: 16px;
`;
const MessageCard = styled.div<{ $outbound: boolean }>`
  background: ${p => p.$outbound ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$outbound ? '#5EEAD4' : '#E2E8F0'};
  border-radius: 10px;
  overflow: hidden;
`;
const MessageHeader = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 12px 16px;
  border-bottom: 1px solid #F1F5F9;
  background: #F8FAFC;
`;
const MessageFrom = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
const MessageTime = styled.div`
  font-size: 11px; color: #94A3B8;
`;
const MessageBodyFrame = styled.iframe`
  width: 100%;
  min-height: 240px;
  border: none;
  display: block;
`;
const MessageBodyText = styled.div`
  padding: 16px;
  font-size: 13px; color: #334155;
  white-space: pre-wrap;
  font-family: -apple-system, sans-serif;
  line-height: 1.6;
`;
const Attachments = styled.div`
  padding: 12px 16px;
  border-top: 1px solid #F1F5F9;
  display: flex; flex-direction: column; gap: 4px;
`;
const Attachment = styled.div`
  font-size: 12px; color: #475569;
`;
const DetailFooter = styled.div`
  padding: 14px 24px;
  border-top: 1px solid #E2E8F0;
  background: #F8FAFC;
  max-height: 55vh;
  overflow-y: auto;
`;
const ReplyBar = styled.div`
  display: flex;
`;
const Composer = styled.div`
  display: flex; flex-direction: column; gap: 10px;
`;
const ComposerTo = styled.div`
  font-size: 12px; color: #64748B;
  strong { color: #0F172A; font-weight: 600; }
`;
const ComposerError = styled.div`
  padding: 8px 10px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px;
`;
const ComposerActions = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  flex-wrap: wrap;
`;
const ComposerHint = styled.div`
  font-size: 11px; color: #94A3B8;
`;
const ComposerBtns = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin-left: auto;
`;
// AI 답변 제안 — Coral 강조 (AI 감지/액션 컬러)
const AiSuggestBtn = styled.button`
  height: 36px; padding: 0 14px;
  border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  color: #F43F5E;
  background: #FFF1F2;
  border: 1px solid #FECDD3;
  transition: background 0.12s, border-color 0.12s;
  &:hover:not(:disabled) { background: #FFE4E6; border-color: #FDA4AF; }
  &:disabled { opacity: 0.6; cursor: wait; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
`;

const Loading = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 24px;
  font-size: 13px; color: #94A3B8;
  gap: 12px;
`;
const Spinner = styled.div`
  width: 24px; height: 24px;
  border: 2px solid #E2E8F0;
  border-top-color: #14B8A6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const ErrorBar = styled.div`
  margin: 12px 16px;
  padding: 10px 12px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px;
`;
const EmptyList = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; padding: 48px 24px; gap: 12px;
`;
const EmptyDetail = styled(EmptyList)`
  flex: 1;
`;
const EmptyIcon = styled.svg`
  width: 48px; height: 48px;
  color: #CBD5E1;
`;
const EmptyText = styled.div`
  font-size: 13px; color: #64748B;
`;
const Empty = styled.div`
  padding: 60px 24px; text-align: center;
  font-size: 13px; color: #64748B;
`;
