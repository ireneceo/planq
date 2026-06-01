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
import { useAuth, apiFetch, getAccessToken } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import RichEditor from '../../components/Common/RichEditor';
import AttachmentField from '../../components/Common/AttachmentField';
import ActionButton from '../../components/Common/ActionButton';
import { uploadMyFile } from '../../services/files';

type Folder = 'reply_needed' | 'inbox' | 'spam' | 'archived';

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
}

const FOLDERS: Array<{ key: Folder; defaultLabel: string }> = [
  { key: 'reply_needed', defaultLabel: '답변 필요' },
  { key: 'inbox', defaultLabel: '인박스' },
  { key: 'spam', defaultLabel: '스팸' },
  { key: 'archived', defaultLabel: '보관' },
];

const MailPage: React.FC = () => {
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const { formatTimeAgo } = useTimeFormat();
  const [sp, setSp] = useSearchParams();
  const businessId = user?.business_id ? Number(user.business_id) : null;

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
    reply_needed: 0, inbox: 0, spam: 0, archived: 0,
  });
  const [accounts, setAccounts] = useState<MailAccount[]>([]);

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

  // 폴더 카운트 fetch (4 폴더 병렬)
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
    <PageShell title="Q Mail">
      <Grid>
        {/* 좌: 폴더 트리 */}
        <FolderCol>
          <FolderHeader>{t('folders.title', { defaultValue: '메일함' }) as string}</FolderHeader>
          {FOLDERS.map(({ key, defaultLabel }) => (
            <FolderItem
              key={key}
              type="button"
              $active={folder === key}
              onClick={() => setFolder(key)}
            >
              <FolderLabel>{t(`folders.${key}`, { defaultValue: defaultLabel }) as string}</FolderLabel>
              {folderCounts[key] > 0 && <FolderCount>{folderCounts[key]}</FolderCount>}
            </FolderItem>
          ))}

          {/* 계정 그룹 (회사 / 개인) — 2개 이상일 때만 노출 */}
          {accounts.length > 1 && (
            <AcctSection>
              {accountFilter !== null && (
                <AcctItem type="button" $active={false} onClick={() => setAccount(null)}>
                  <AcctEmail>{t('accounts.all', { defaultValue: '전체 계정 보기' }) as string}</AcctEmail>
                </AcctItem>
              )}
              {(['company', 'personal'] as const).map((group) => {
                const list = accounts.filter(a => (group === 'personal' ? a.is_personal : !a.is_personal));
                if (!list.length) return null;
                return (
                  <AcctGroup key={group}>
                    <AcctGroupLabel>
                      {group === 'company'
                        ? t('accounts.company', { defaultValue: '회사' }) as string
                        : t('accounts.personal', { defaultValue: '개인' }) as string}
                    </AcctGroupLabel>
                    {list.map((a) => (
                      <AcctItem
                        key={a.id}
                        type="button"
                        $active={accountFilter === a.id}
                        onClick={() => setAccount(a.id)}
                        title={a.email}
                      >
                        <AcctEmail>{a.display_name || a.email}</AcctEmail>
                        {a.unread > 0 && <FolderCount>{a.unread}</FolderCount>}
                      </AcctItem>
                    ))}
                  </AcctGroup>
                );
              })}
            </AcctSection>
          )}
        </FolderCol>

        {/* 중: 스레드 리스트 */}
        <ListCol>
          <ListHeader>
            <ListTitle>{t(`folders.${folder}`, { defaultValue: FOLDERS.find(f => f.key === folder)?.defaultLabel }) as string}</ListTitle>
            <ListCount>{threads.length}</ListCount>
          </ListHeader>
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
              {threads.map(t => (
                <ThreadItem
                  key={t.id}
                  type="button"
                  $active={activeId === t.id}
                  $unread={t.unread_count > 0}
                  onClick={() => setActive(t.id)}
                >
                  <ThreadRow1>
                    <ThreadSender>
                      {t.client?.display_name || t.client?.company_name || t.account?.display_name || t.account?.email || '(unknown)'}
                    </ThreadSender>
                    <ThreadTime>{formatTimeAgo(t.last_message_at)}</ThreadTime>
                  </ThreadRow1>
                  <ThreadSubject $unread={t.unread_count > 0}>
                    {t.unread_count > 0 && <UnreadDot />}
                    {t.subject || '(no subject)'}
                  </ThreadSubject>
                  {t.last_message_preview && <ThreadPreview>{t.last_message_preview}</ThreadPreview>}
                </ThreadItem>
              ))}
            </ThreadList>
          )}
        </ListCol>

        {/* 우: 상세 */}
        <DetailCol>
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
              <DetailHeader>
                <DetailSubject>{detail.subject || '(no subject)'}</DetailSubject>
                <DetailMeta>
                  {detail.message_count > 1 && <MetaChip>{t('messageCount', { defaultValue: '{{n}}개 메시지', n: detail.message_count }) as string}</MetaChip>}
                  {detail.client && <MetaChip>{detail.client.display_name || detail.client.company_name}</MetaChip>}
                  <DangerBtn type="button" onClick={onMarkSpam}>
                    {detail.status === 'spam'
                      ? t('actions.notSpam', { defaultValue: '스팸 해제' }) as string
                      : t('actions.markSpam', { defaultValue: '스팸으로' }) as string}
                  </DangerBtn>
                </DetailMeta>
              </DetailHeader>
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
                      <ComposerHint>{t('reply.shortcut', { defaultValue: '⌘/Ctrl + Enter 로 보내기' }) as string}</ComposerHint>
                      <ComposerBtns>
                        <ActionButton tone="secondary" size="md" onClick={() => setReplyOpen(false)} disabled={sending}>
                          {t('reply.cancel', { defaultValue: '취소' }) as string}
                        </ActionButton>
                        <ActionButton tone="primary" size="md" loading={sending} onClick={sendReply}>
                          {t('reply.send', { defaultValue: '보내기' }) as string}
                        </ActionButton>
                      </ComposerBtns>
                    </ComposerActions>
                  </Composer>
                )}
              </DetailFooter>
            </>
          )}
        </DetailCol>
      </Grid>
    </PageShell>
  );
};

export default MailPage;

// ─────────────────────────────────────────────
// styles
// ─────────────────────────────────────────────
const Grid = styled.div`
  display: grid;
  grid-template-columns: 220px minmax(280px, 360px) 1fr;
  gap: 0;
  height: calc(100vh - 140px);
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  overflow: hidden;
  @media (max-width: 1024px) {
    grid-template-columns: 180px 1fr;
    & > :last-child { display: none; }
  }
  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    & > :nth-child(1) { display: none; }
  }
`;

const FolderCol = styled.div`
  border-right: 1px solid #E2E8F0;
  background: #F8FAFC;
  padding: 16px 8px;
  display: flex; flex-direction: column; gap: 4px;
  overflow-y: auto;
`;
const FolderHeader = styled.div`
  padding: 4px 12px 8px;
  font-size: 11px; font-weight: 600;
  color: #94A3B8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;
const FolderItem = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 8px 12px;
  background: ${p => p.$active ? '#CCFBF1' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#334155'};
  border: none; border-radius: 6px;
  font-size: 13px; font-weight: ${p => p.$active ? 600 : 500};
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: ${p => p.$active ? '#CCFBF1' : '#F1F5F9'}; }
`;
const FolderLabel = styled.span``;
const FolderCount = styled.span`
  min-width: 20px; padding: 0 6px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 11px; font-weight: 700;
  border-radius: 999px;
  text-align: center;
`;
// 계정 그룹 (회사/개인) — 외부 연동 Phase 3
const AcctSection = styled.div`
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 4px;
`;
const AcctGroup = styled.div`
  display: flex; flex-direction: column; gap: 2px; margin-top: 4px;
`;
const AcctGroupLabel = styled.div`
  padding: 4px 12px 2px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
  color: #94A3B8; text-transform: uppercase;
`;
const AcctItem = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  width: 100%; padding: 7px 12px;
  background: ${p => p.$active ? '#EDE9FE' : 'transparent'};
  color: ${p => p.$active ? '#6D28D9' : '#334155'};
  border: none; border-radius: 6px;
  font-size: 12.5px; font-weight: ${p => p.$active ? 600 : 500};
  cursor: pointer; text-align: left;
  transition: background 0.12s;
  &:hover { background: ${p => p.$active ? '#EDE9FE' : '#F1F5F9'}; }
`;
const AcctEmail = styled.span`
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;

const ListCol = styled.div`
  border-right: 1px solid #E2E8F0;
  display: flex; flex-direction: column;
  overflow: hidden;
`;
const ListHeader = styled.div`
  display: flex; align-items: baseline; gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid #E2E8F0;
  background: #FFFFFF;
`;
const ListTitle = styled.h2`
  margin: 0;
  font-size: 14px; font-weight: 700;
  color: #0F172A;
`;
const ListCount = styled.span`
  font-size: 12px; color: #94A3B8;
`;
const ThreadList = styled.div`
  flex: 1; overflow-y: auto;
`;
const ThreadItem = styled.button<{ $active: boolean; $unread: boolean }>`
  display: block; width: 100%;
  padding: 12px 16px;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border: none;
  border-bottom: 1px solid #F1F5F9;
  border-left: 3px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
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

const DetailCol = styled.div`
  display: flex; flex-direction: column;
  overflow: hidden;
  background: #FFFFFF;
`;
const DetailHeader = styled.div`
  padding: 16px 24px;
  border-bottom: 1px solid #E2E8F0;
`;
const DetailSubject = styled.h2`
  margin: 0 0 8px;
  font-size: 18px; font-weight: 700;
  color: #0F172A;
  line-height: 1.4;
`;
const DetailMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
`;
const MetaChip = styled.span`
  padding: 2px 8px;
  background: #F1F5F9; color: #475569;
  font-size: 11px; font-weight: 500;
  border-radius: 999px;
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
