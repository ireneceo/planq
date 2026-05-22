// 통합 공유 모달 — 모든 entity 재사용 (사이클 N+4 박제 docs/SHARE_SYSTEM_UNIFIED.md)
//
// 사용처:
//   <ShareModal entityType="task" entityId={42} entityTitle="..." onClose={...} />
//
// 지원 entity: task / file / kb_document / calendar_event / post / document / invoice / quote / report
// 1차: task (이번 사이클). 나머지는 backend route 가 추가되는 대로 자연스럽게 동작.
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useTimeFormat } from '../../hooks/useTimeFormat';

// N+44 — ShareModal 실 사용 5 entity 만 유지. document/invoice/quote/report 는 별도 UI 흐름
// (PostSignatureModal, Invoice send 라우트 자체 발급) 사용 — ShareModal 통한 호출 dead code 였음.
export type ShareEntityType =
  | 'task' | 'file' | 'kb_document' | 'calendar_event' | 'post';

interface Props {
  open: boolean;
  entityType: ShareEntityType;
  entityId: number;
  entityTitle?: string;
  onClose: () => void;
}

// entity → API path 매핑 (각 라우트는 동일 패턴: POST /share, DELETE /share, public/by-token/:token)
const PATH_MAP: Record<ShareEntityType, string> = {
  task: 'tasks',
  file: 'files',
  kb_document: 'kb-documents',
  calendar_event: 'calendar-events',
  post: 'posts',
};

// 미리보기 URL 패턴 (frontend 라우트)
const PUBLIC_PATH_MAP: Record<ShareEntityType, string> = {
  task: '/public/tasks',
  file: '/public/files',
  kb_document: '/public/kb',
  calendar_event: '/public/calendar',
  post: '/public/posts',
};

const ShareModal: React.FC<Props> = ({ open, entityType, entityId, entityTitle, onClose }) => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { formatDate } = useTimeFormat();
  const [loading, setLoading] = useState(true);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [expires, setExpires] = useState<7 | 30 | 90 | null>(null);
  // 발급된 토큰의 실제 만료일 (백엔드 응답에서 받음). UI 표시용.
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwShow, setPwShow] = useState(false);
  const [pwSavedNote, setPwSavedNote] = useState(false);

  type ModalTab = 'link' | 'email' | 'chat';
  const [tab, setTab] = useState<ModalTab>('link');
  const [emailTo, setEmailTo] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: number; fail: number } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // 채팅방 탭
  const [conversations, setConversations] = useState<Array<{ id: number; title: string; last_message_at: string | null }>>([]);
  const [chatTarget, setChatTarget] = useState<number | null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSent, setChatSent] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // 이메일·채팅방 탭은 task/file/kb_document/calendar_event 만 (PostShareModal 은 별도 흐름 유지)
  const extendedTabsAvailable = ['task', 'file', 'kb_document', 'calendar_event'].includes(entityType);

  useBodyScrollLock(open);
  useEscapeStack(open && !busy, onClose);

  const apiPath = PATH_MAP[entityType];

  // payload 가 undefined 면 보내지 않음 — 기존 값 유지.
  const issueToken = useCallback(async (payload: { expires_in_days?: number | null; password?: string | null }) => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/${apiPath}/${entityId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.success && j.data?.share_token) {
        setShareToken(j.data.share_token);
        setShareUrl(j.data.share_url || `${window.location.origin}${PUBLIC_PATH_MAP[entityType]}/${j.data.share_token}`);
        setPasswordSet(!!j.data.password_set);
        setShareExpiresAt(j.data.share_expires_at || null);
      }
    } finally {
      setBusy(false);
    }
  }, [apiPath, entityId, entityType]);

  // 진입 시 token 발급/조회
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    issueToken({}).finally(() => setLoading(false));
  }, [open, issueToken]);

  // 채팅방 탭 — 첫 진입 시 conversations 로드
  useEffect(() => {
    if (!open || tab !== 'chat' || conversations.length > 0) return;
    if (!user?.business_id) return;
    apiFetch(`/api/share/conversations?business_id=${user.business_id}`)
      .then(r => r.json())
      .then(j => { if (j.success && Array.isArray(j.data)) setConversations(j.data); })
      .catch(() => { /* silent */ });
  }, [open, tab, conversations.length, user?.business_id]);

  const sendChat = async () => {
    if (chatBusy || !chatTarget) return;
    setChatError(null);
    setChatSent(false);
    setChatBusy(true);
    try {
      const r = await apiFetch('/api/share/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          conversation_id: chatTarget,
          message: chatMsg.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (j.success) {
        setChatSent(true);
        setChatMsg('');
        setChatTarget(null);
        setTimeout(() => setChatSent(false), 3000);
      } else {
        setChatError(j.message || (t('share.chat.sendFail', { defaultValue: '발송 실패' }) as string));
      }
    } catch {
      setChatError(t('share.chat.network', { defaultValue: '네트워크 오류' }) as string);
    } finally {
      setChatBusy(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 불가 환경 */ }
  };

  const setExpiry = async (days: 7 | 30 | 90 | null) => {
    setExpires(days);
    await issueToken({ expires_in_days: days });
  };

  const savePassword = async () => {
    if (busy) return;
    await issueToken({ password: pwInput });
    setPwInput('');
    setPwShow(false);
    setPwSavedNote(true);
    setTimeout(() => setPwSavedNote(false), 2000);
  };

  const removePassword = async () => {
    if (busy) return;
    await issueToken({ password: null });
    setPwInput('');
  };

  const sendEmail = async () => {
    if (emailBusy) return;
    setEmailError(null);
    setEmailResult(null);
    const list = emailTo.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (list.length === 0) {
      setEmailError(t('share.email.toRequired', { defaultValue: '받는 사람 이메일을 입력하세요' }) as string);
      return;
    }
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const e of list) {
      if (!re.test(e)) {
        setEmailError(t('share.email.invalid', { defaultValue: `잘못된 이메일: ${e}`, address: e }) as string);
        return;
      }
    }
    setEmailBusy(true);
    try {
      const r = await apiFetch('/api/share/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          to: list,
          message: emailMsg.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (j.success) {
        const ok = (j.data?.results || []).filter((x: { sent: boolean }) => x.sent).length;
        const fail = (j.data?.results || []).length - ok;
        setEmailResult({ ok, fail });
        setEmailTo('');
        setEmailMsg('');
      } else {
        setEmailError(j.message || (t('share.email.sendFail', { defaultValue: '발송 실패' }) as string));
      }
    } catch {
      setEmailError(t('share.email.network', { defaultValue: '네트워크 오류' }) as string);
    } finally {
      setEmailBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/${apiPath}/${entityId}/share`, { method: 'DELETE' });
      if (r.ok) {
        setShareToken(null);
        setShareUrl('');
        setConfirmRevoke(false);
        onClose();
      }
    } finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <Backdrop onClick={() => !busy && onClose()}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('share.title', { defaultValue: '공유' }) as string}>
        <Header>
          <Title>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            {t('share.title', { defaultValue: '공유' }) as string}
          </Title>
          <CloseBtn type="button" onClick={onClose} disabled={busy} aria-label={t('common.close', '닫기') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>
        <Body>
          {entityTitle && <EntityTitle>{entityTitle}</EntityTitle>}

          {extendedTabsAvailable && (
            <TabBar role="tablist">
              <TabBtn type="button" role="tab" aria-selected={tab === 'link'} $active={tab === 'link'} onClick={() => setTab('link')}>
                {t('share.tab.link', { defaultValue: '링크' }) as string}
              </TabBtn>
              <TabBtn type="button" role="tab" aria-selected={tab === 'email'} $active={tab === 'email'} onClick={() => setTab('email')}>
                {t('share.tab.email', { defaultValue: '이메일' }) as string}
              </TabBtn>
              <TabBtn type="button" role="tab" aria-selected={tab === 'chat'} $active={tab === 'chat'} onClick={() => setTab('chat')}>
                {t('share.tab.chat', { defaultValue: '채팅방' }) as string}
              </TabBtn>
            </TabBar>
          )}

          {tab === 'chat' && extendedTabsAvailable ? (
            <EmailPanel>
              <SectionLabel>{t('share.chat.target', { defaultValue: '대화방 선택' }) as string}</SectionLabel>
              {conversations.length === 0 ? (
                <Hint>{t('share.chat.empty', { defaultValue: '워크스페이스에 활성 대화방이 없습니다.' }) as string}</Hint>
              ) : (
                <ConvList>
                  {conversations.map(c => (
                    <ConvRow key={c.id} type="button"
                      $active={chatTarget === c.id}
                      onClick={() => setChatTarget(chatTarget === c.id ? null : c.id)}>
                      <ConvName>{c.title}</ConvName>
                      {c.last_message_at && <ConvDate>{new Date(c.last_message_at).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', timeZone: user?.workspace_timezone || 'Asia/Seoul' })}</ConvDate>}
                    </ConvRow>
                  ))}
                </ConvList>
              )}
              <SectionLabel>{t('share.chat.message', { defaultValue: '메시지 (선택)' }) as string}</SectionLabel>
              <EmailTextarea
                value={chatMsg}
                onChange={e => setChatMsg(e.target.value)}
                placeholder={t('share.chat.messagePlaceholder', { defaultValue: '대화방에 보낼 짧은 메모' }) as string}
                disabled={chatBusy}
                rows={2}
                maxLength={1000}
              />
              {chatError && <ErrLine>{chatError}</ErrLine>}
              {chatSent && <SuccessLine>{t('share.chat.sent', { defaultValue: '대화방으로 전송됨' }) as string}</SuccessLine>}
              <EmailActions>
                <PrimaryBtn type="button" onClick={sendChat} disabled={chatBusy || !chatTarget}>
                  {chatBusy
                    ? t('share.chat.sending', { defaultValue: '전송 중...' }) as string
                    : t('share.chat.send', { defaultValue: '전송' }) as string}
                </PrimaryBtn>
              </EmailActions>
              <Hint>{t('share.chat.hint', { defaultValue: '대화방 멤버에게 카드로 공유됩니다. 비밀번호 보호된 링크는 별도로 비밀번호도 알려주세요.' }) as string}</Hint>
            </EmailPanel>
          ) : tab === 'email' && extendedTabsAvailable ? (
            <EmailPanel>
              <SectionLabel>{t('share.email.to', { defaultValue: '받는 사람' }) as string}</SectionLabel>
              <PwInput
                as="input"
                type="text"
                value={emailTo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailTo(e.target.value)}
                placeholder={t('share.email.toPlaceholder', { defaultValue: 'a@example.com, b@example.com' }) as string}
                disabled={emailBusy}
              />
              <SectionLabel>{t('share.email.message', { defaultValue: '메시지 (선택)' }) as string}</SectionLabel>
              <EmailTextarea
                value={emailMsg}
                onChange={e => setEmailMsg(e.target.value)}
                placeholder={t('share.email.messagePlaceholder', { defaultValue: '받는 사람에게 보낼 짧은 메모' }) as string}
                disabled={emailBusy}
                rows={3}
                maxLength={1000}
              />
              {emailError && <ErrLine>{emailError}</ErrLine>}
              {emailResult && (
                <SuccessLine>
                  {t('share.email.sent', { defaultValue: '발송 완료', count: emailResult.ok }) as string}
                  {' '}({emailResult.ok}/{emailResult.ok + emailResult.fail})
                </SuccessLine>
              )}
              <EmailActions>
                <PrimaryBtn type="button" onClick={sendEmail} disabled={emailBusy || !emailTo}>
                  {emailBusy
                    ? t('share.email.sending', { defaultValue: '발송 중...' }) as string
                    : t('share.email.send', { defaultValue: '발송' }) as string}
                </PrimaryBtn>
              </EmailActions>
              <Hint>{t('share.email.hint', { defaultValue: '비밀번호로 보호된 링크는 받는 사람에게 비밀번호도 따로 알려주세요.' }) as string}</Hint>
            </EmailPanel>
          ) : loading ? (
            <Hint>{t('share.loading', { defaultValue: '링크 발급 중...' }) as string}</Hint>
          ) : !shareToken ? (
            <Hint>{t('share.failed', { defaultValue: '링크 발급 실패' }) as string}</Hint>
          ) : (
            <>
              <SectionLabel>{t('share.link', { defaultValue: '공유 링크' }) as string}</SectionLabel>
              <UrlRow>
                <UrlInput readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
                <CopyBtn type="button" onClick={copy}>
                  {copied ? t('share.copied', { defaultValue: '복사됨 ✓' }) as string : t('share.copy', { defaultValue: '복사' }) as string}
                </CopyBtn>
              </UrlRow>
              <Hint>{t('share.linkHint', { defaultValue: '링크를 가진 사람은 미리보기 페이지에서 항목을 볼 수 있습니다. PlanQ 멤버는 자동으로 앱 안에서 열립니다.' }) as string}</Hint>

              <SectionLabel>{t('share.expiry', { defaultValue: '만료' }) as string}</SectionLabel>
              <ChipRow>
                {([
                  { v: null, label: t('share.expiryNever', { defaultValue: '무기한' }) as string },
                  { v: 7,    label: t('share.expiry7d',    { defaultValue: '7일' }) as string },
                  { v: 30,   label: t('share.expiry30d',   { defaultValue: '30일' }) as string },
                  { v: 90,   label: t('share.expiry90d',   { defaultValue: '90일' }) as string },
                ] as const).map(opt => (
                  <Chip key={String(opt.v)} type="button"
                    $active={expires === opt.v}
                    onClick={() => setExpiry(opt.v as 7 | 30 | 90 | null)}
                    disabled={busy}>
                    {opt.label}
                  </Chip>
                ))}
              </ChipRow>
              {shareExpiresAt && (
                <Hint>
                  {t('share.expiresOn', {
                    date: formatDate(shareExpiresAt),
                    defaultValue: '이 링크는 {{date}} 에 만료됩니다',
                  }) as string}
                </Hint>
              )}

              <SectionLabel>
                {t('share.password', { defaultValue: '비밀번호' }) as string}
                {passwordSet && <PwSetBadge>{t('share.passwordSet', { defaultValue: '설정됨' }) as string}</PwSetBadge>}
              </SectionLabel>
              <PwRow>
                <PwInput
                  type={pwShow ? 'text' : 'password'}
                  value={pwInput}
                  onChange={e => setPwInput(e.target.value)}
                  placeholder={passwordSet
                    ? (t('share.passwordChange', { defaultValue: '새 비밀번호 (변경 시)' }) as string)
                    : (t('share.passwordPlaceholder', { defaultValue: '선택 — 링크 + 비밀번호 둘 다 알아야 접근' }) as string)}
                  disabled={busy}
                  onKeyDown={e => { if (e.key === 'Enter' && pwInput) savePassword(); }}
                />
                <PwToggle type="button" onClick={() => setPwShow(s => !s)} disabled={busy} aria-label="show/hide">
                  {pwShow ? t('share.passwordHide', { defaultValue: '숨기기' }) as string : t('share.passwordShow', { defaultValue: '보이기' }) as string}
                </PwToggle>
                <PwSaveBtn type="button" onClick={savePassword} disabled={busy || !pwInput}>
                  {pwSavedNote
                    ? t('share.passwordSaved', { defaultValue: '저장됨 ✓' }) as string
                    : t('share.passwordSave', { defaultValue: '저장' }) as string}
                </PwSaveBtn>
              </PwRow>
              {passwordSet && (
                <PwClearLink type="button" onClick={removePassword} disabled={busy}>
                  {t('share.passwordRemove', { defaultValue: '비밀번호 해제' }) as string}
                </PwClearLink>
              )}
              <Hint>{t('share.passwordHint', { defaultValue: '링크가 누설되어도 비밀번호를 모르면 열 수 없습니다.' }) as string}</Hint>
            </>
          )}
        </Body>
        {confirmRevoke && (
          <ConfirmInline>
            <ConfirmText>{t('share.revokeConfirm', { defaultValue: '공유 링크를 무효화합니다. 기존 링크는 더 이상 작동하지 않습니다.' }) as string}</ConfirmText>
            <ConfirmActions>
              <ConfirmCancel type="button" onClick={() => setConfirmRevoke(false)} disabled={busy}>
                {t('common.cancel', '취소') as string}
              </ConfirmCancel>
              <ConfirmYes type="button" onClick={revoke} disabled={busy}>
                {t('share.revokeYes', { defaultValue: '무효화' }) as string}
              </ConfirmYes>
            </ConfirmActions>
          </ConfirmInline>
        )}
        <Footer>
          {shareToken && !confirmRevoke && (
            <RevokeBtn type="button" onClick={() => setConfirmRevoke(true)} disabled={busy}>
              {t('share.revoke', { defaultValue: '링크 무효화' }) as string}
            </RevokeBtn>
          )}
          {!confirmRevoke && (
            <PrimaryBtn type="button" onClick={onClose}>{t('common.close', '닫기')}</PrimaryBtn>
          )}
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default ShareModal;

// styled
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 480px; width: 100%;
  display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(15,23,42,0.2);
  @media (max-width: 640px) { max-height: 100vh; height: 100vh; border-radius: 0; }
`;
const Header = styled.div`display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #F1F5F9;`;
const Title = styled.h2`display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const CloseBtn = styled.button`
  width: 26px; height: 26px; background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Body = styled.div`padding: 16px 20px; display: flex; flex-direction: column; gap: 8px;`;
const Footer = styled.div`display: flex; justify-content: space-between; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid #F1F5F9;`;
const EntityTitle = styled.div`font-size: 13px; font-weight: 600; color: #475569; padding: 8px 10px; background: #F8FAFC; border-radius: 6px; margin-bottom: 8px;`;
const SectionLabel = styled.label`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 8px;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.5;`;
const UrlRow = styled.div`display: flex; gap: 6px; align-items: center;`;
const UrlInput = styled.input`
  flex: 1; padding: 8px 10px; font-size: 12px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 6px; background: #F8FAFC;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const CopyBtn = styled.button`
  padding: 8px 12px; font-size: 12px; font-weight: 600; color: #fff;
  background: #14B8A6; border: none; border-radius: 6px; cursor: pointer; white-space: nowrap;
  &:hover { background: #0D9488; }
`;
const ChipRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const PwRow = styled.div`display: flex; gap: 6px; align-items: center;`;
const PwInput = styled.input`
  flex: 1; padding: 8px 10px; font-size: 12px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 6px; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { opacity: 0.5; }
`;
const PwToggle = styled.button`
  padding: 8px 10px; font-size: 11px; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer; white-space: nowrap;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PwSaveBtn = styled.button`
  padding: 8px 12px; font-size: 12px; font-weight: 600; color: #fff;
  background: #14B8A6; border: none; border-radius: 6px; cursor: pointer; white-space: nowrap;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PwSetBadge = styled.span`
  display: inline-flex; align-items: center; padding: 2px 8px; margin-left: 8px;
  font-size: 10px; font-weight: 700; color: #0F766E; background: #F0FDFA; border-radius: 999px;
  text-transform: none; letter-spacing: 0;
`;
const PwClearLink = styled.button`
  align-self: flex-start; margin-top: 4px;
  background: transparent; border: none; padding: 0;
  font-size: 11px; font-weight: 600; color: #DC2626; cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
  &:hover:not(:disabled) { color: #B91C1C; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Chip = styled.button<{ $active: boolean }>`
  height: 28px; padding: 0 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#0F766E' : '#fff'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0F766E' : '#E2E8F0'};
  border-radius: 999px; cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { border-color: ${p => p.$active ? '#0D9488' : '#CBD5E1'}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const ConfirmInline = styled.div`
  margin: 0 20px 12px; padding: 12px 14px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
  display: flex; flex-direction: column; gap: 10px;
`;
const ConfirmText = styled.div`font-size: 12px; color: #991B1B; line-height: 1.5;`;
const ConfirmActions = styled.div`display: flex; gap: 6px; justify-content: flex-end;`;
const ConfirmCancel = styled.button`
  padding: 6px 12px; font-size: 12px; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const ConfirmYes = styled.button`
  padding: 6px 14px; font-size: 12px; font-weight: 700; color: #fff;
  background: #DC2626; border: none; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #B91C1C; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const RevokeBtn = styled.button`
  padding: 8px 12px; font-size: 12px; font-weight: 600; color: #DC2626;
  background: #fff; border: 1px solid #FECACA; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const TabBar = styled.div`
  display: flex; gap: 4px; margin-bottom: 12px;
  border-bottom: 1px solid #E2E8F0;
`;
const TabBtn = styled.button<{ $active: boolean }>`
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  background: transparent; border: none;
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  margin-bottom: -1px; cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  &:hover { color: ${p => p.$active ? '#0F766E' : '#0F172A'}; }
`;
const EmailPanel = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const EmailTextarea = styled.textarea`
  padding: 8px 10px; font-size: 12px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 6px; background: #fff;
  font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { opacity: 0.5; }
`;
const EmailActions = styled.div`display: flex; justify-content: flex-end; margin-top: 4px;`;
const ErrLine = styled.div`font-size: 12px; color: #DC2626; padding: 4px 0;`;
const SuccessLine = styled.div`font-size: 12px; color: #0F766E; padding: 4px 0; font-weight: 600;`;
const ConvList = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  max-height: 180px; overflow-y: auto; padding: 4px;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #F8FAFC;
`;
const ConvRow = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-radius: 6px; cursor: pointer; text-align: left;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#fff'}; }
`;
const ConvName = styled.span`font-size: 13px; font-weight: 600; color: #0F172A;`;
const ConvDate = styled.span`font-size: 11px; color: #94A3B8;`;
