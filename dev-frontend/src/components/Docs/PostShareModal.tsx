// 문서 공유 모달 — 링크 공유 + 탭(이메일 / 채팅방)
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  sharePost, revokePostShare, emailPostShare, sharePostToChat,
  type PostDetail,
} from '../../services/posts';
import { listBusinessConversations, listProjectConversations, type ApiConversation } from '../../services/qtalk';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface Props {
  open: boolean;
  onClose: () => void;
  post: PostDetail;
  onChanged: (updated: PostDetail) => void;
}

type Tab = 'email' | 'chat';

const PostShareModal: React.FC<Props> = ({ open, onClose, post, onChanged }) => {
  const { t } = useTranslation('qdocs');
  const [shareToken, setShareToken] = useState<string | null>(post.share_token);
  const [shareUrl, setShareUrl] = useState<string | null>(post.share_url);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>('email');

  // Email
  const [emailTo, setEmailTo] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailSentInfo, setEmailSentInfo] = useState<{ recipients: string[]; smtpDown: boolean } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Chat
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [chatTarget, setChatTarget] = useState<number | null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const [chatSentInfo, setChatSentInfo] = useState<{ convId: number } | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  useEffect(() => {
    setShareToken(post.share_token);
    setShareUrl(post.share_url);
  }, [post.id, post.share_token, post.share_url]);

  useEffect(() => {
    if (!open) return;
    // 프로젝트 문서 → 그 프로젝트의 채팅방만, 전역 문서 → 워크스페이스 전체
    const fetcher = post.project_id
      ? listProjectConversations(post.project_id)
      : listBusinessConversations(post.business_id);
    fetcher.then(setConversations).catch(() => setConversations([]));
  }, [open, post.business_id, post.project_id]);

  const isPublic = !!shareToken;

  const togglePublic = async () => {
    setBusy(true);
    try {
      if (isPublic) {
        await revokePostShare(post.id);
        setShareToken(null); setShareUrl(null);
        onChanged({ ...post, share_token: null, share_url: null, shared_at: null });
      } else {
        const info = await sharePost(post.id);
        setShareToken(info.share_token); setShareUrl(info.share_url);
        onChanged({ ...post, share_token: info.share_token, share_url: info.share_url, shared_at: info.shared_at });
      }
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {/* noop */}
  };

  const sendEmail = async () => {
    setEmailError(null); setEmailSentInfo(null);
    const list = emailTo.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (list.length === 0) { setEmailError(t('share.emailRequired', '받는 사람 이메일을 입력하세요') as string); return; }
    setBusy(true);
    try {
      const res = await emailPostShare(post.id, { to: list, message: emailMsg.trim() || undefined });
      const recipients = res.results.map(r => r.to);
      const sentCount = res.results.filter(r => r.sent).length;
      setEmailSentInfo({ recipients, smtpDown: sentCount === 0 });
      setShareUrl(res.share_url);
      setShareToken(res.share_url.split('/').pop() || shareToken);
      setEmailTo(''); setEmailMsg('');
    } catch (e) {
      setEmailError(((e as Error).message) || (t('share.emailError', '발송 실패') as string));
    } finally {
      setBusy(false);
    }
  };

  const sendToChat = async () => {
    setChatError(null); setChatSentInfo(null);
    if (!chatTarget) { setChatError(t('share.chatRequired', '채팅방을 선택하세요') as string); return; }
    setBusy(true);
    try {
      const res = await sharePostToChat(post.id, { conversation_id: chatTarget, message: chatMsg.trim() || undefined });
      setChatSentInfo({ convId: chatTarget });
      setShareUrl(res.share_url);
      setChatMsg('');
    } catch (e) {
      setChatError(((e as Error).message) || (t('share.chatError', '전송 실패') as string));
    } finally {
      setBusy(false);
    }
  };

  const sortedConvs = useMemo(() => [...conversations].sort((a, b) => {
    const ad = a.last_message_at || a.created_at; const bd = b.last_message_at || b.created_at;
    return (bd || '').localeCompare(ad || '');
  }), [conversations]);

  const convOptions: PlanQSelectOption[] = useMemo(
    () => sortedConvs.map(c => ({ value: c.id, label: c.display_name || c.title || `#${c.id}` })),
    [sortedConvs]
  );

  const sentChatLabel = useMemo(() => {
    if (!chatSentInfo) return '';
    const c = sortedConvs.find(x => x.id === chatSentInfo.convId);
    return c ? (c.display_name || c.title || `#${c.id}`) : `#${chatSentInfo.convId}`;
  }, [chatSentInfo, sortedConvs]);

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('share.title', '공유') as string}>
        <Header>
          <Title>{t('share.title', '공유')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>

        {/* 링크로 공유 — URL 카드 */}
        <Section>
          <SectionTitle>{t('share.link.title', '링크로 공유')}</SectionTitle>
          <CheckRow>
            <CheckLabel>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={togglePublic}
                disabled={busy}
                aria-describedby="share-link-desc"
              />
              <CheckTexts>
                <CheckTitle>{t('share.link.enable', '공개 링크 활성화')}</CheckTitle>
                <CheckDesc id="share-link-desc">
                  {isPublic
                    ? t('share.link.descOn', '현재 공개 중. 체크 해제 시 링크가 즉시 만료됩니다.')
                    : t('share.link.descOff', '체크하면 외부에 URL을 공유할 수 있는 추측 불가능한 링크가 생성됩니다.')}
                </CheckDesc>
              </CheckTexts>
            </CheckLabel>
          </CheckRow>
          {isPublic && (
            <UrlCard>
              <UrlIcon>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
              </UrlIcon>
              <UrlText title={shareUrl || ''}>{shareUrl}</UrlText>
              <CopyBtn type="button" onClick={copyUrl}>
                {copied ? (
                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>{t('share.link.copied', '복사됨')}</>
                ) : (
                  t('share.link.copy', 'URL 복사')
                )}
              </CopyBtn>
            </UrlCard>
          )}
        </Section>

        {/* 탭: 이메일 / 채팅방 */}
        <TabBar role="tablist">
          <TabBtn type="button" role="tab" aria-selected={tab === 'email'} $active={tab === 'email'} onClick={() => setTab('email')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            {t('share.email.tab', '이메일')}
          </TabBtn>
          <TabBtn type="button" role="tab" aria-selected={tab === 'chat'} $active={tab === 'chat'} onClick={() => setTab('chat')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {t('share.chat.tab', '채팅방')}
          </TabBtn>
        </TabBar>

        {tab === 'email' && (
          <TabPanel role="tabpanel">
            {emailSentInfo ? (
              <Done>
                <DoneIcon $tone={emailSentInfo.smtpDown ? 'warn' : 'ok'}>
                  {emailSentInfo.smtpDown ? '!' : '✓'}
                </DoneIcon>
                <DoneTitle>
                  {emailSentInfo.smtpDown
                    ? t('share.email.smtpDown', '이메일 서버가 아직 설정되지 않아 실제 발송은 보류됐습니다 (관리자 설정 후 자동 활성).')
                    : t('share.email.sentTo', '{{to}} 에게 발송 완료', { to: emailSentInfo.recipients.join(', ') })}
                </DoneTitle>
                <Actions>
                  <SecondaryBtn type="button" onClick={() => { setEmailSentInfo(null); }}>
                    {t('share.email.again', '다시 보내기')}
                  </SecondaryBtn>
                  <PrimaryBtn type="button" onClick={onClose}>{t('common.close', '닫기')}</PrimaryBtn>
                </Actions>
              </Done>
            ) : (
              <>
                <Field>
                  <Label>{t('share.email.to', '받는 사람')}</Label>
                  <Input type="text" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="name@example.com, name2@..." />
                </Field>
                <Field>
                  <Label>{t('share.email.message', '메모 (선택)')}</Label>
                  <Textarea rows={2} value={emailMsg} onChange={e => setEmailMsg(e.target.value)} placeholder={t('share.email.messagePh', '검토 부탁드립니다') as string} />
                </Field>
                {emailError && <ErrorBox>{emailError}</ErrorBox>}
                <Actions>
                  <PrimaryBtn type="button" disabled={busy || !emailTo.trim()} onClick={sendEmail}>{busy ? '...' : t('share.email.send', '이메일 발송')}</PrimaryBtn>
                </Actions>
              </>
            )}
          </TabPanel>
        )}

        {tab === 'chat' && (
          <TabPanel role="tabpanel">
            {chatSentInfo ? (
              <Done>
                <DoneIcon $tone="ok">✓</DoneIcon>
                <DoneTitle>{t('share.chat.sentTo', '"{{name}}" 에 전송 완료', { name: sentChatLabel })}</DoneTitle>
                <Actions>
                  <SecondaryBtn type="button" onClick={() => { setChatSentInfo(null); setChatTarget(null); }}>
                    {t('share.chat.again', '다른 채팅방에 보내기')}
                  </SecondaryBtn>
                  <PrimaryBtn type="button" onClick={onClose}>{t('common.close', '닫기')}</PrimaryBtn>
                </Actions>
              </Done>
            ) : (
              <>
                <Field>
                  <Label>
                    {post.project_id
                      ? t('share.chat.targetProject', '이 프로젝트 채팅방')
                      : t('share.chat.target', '채팅방 선택')}
                  </Label>
                  <PlanQSelect
                    size="sm"
                    options={convOptions}
                    value={convOptions.find(o => o.value === chatTarget) || null}
                    onChange={(opt) => setChatTarget(opt ? Number((opt as PlanQSelectOption).value) : null)}
                    placeholder={
                      convOptions.length === 0
                        ? (t('share.chat.noneInProject', '연결된 채팅방이 없습니다') as string)
                        : (t('share.chat.placeholder', '— 선택 —') as string)
                    }
                    isClearable
                    isSearchable
                    isDisabled={convOptions.length === 0}
                  />
                </Field>
                <Field>
                  <Label>{t('share.chat.message', '메모 (선택)')}</Label>
                  <Textarea rows={2} value={chatMsg} onChange={e => setChatMsg(e.target.value)} placeholder={t('share.chat.messagePh', '같이 봐주세요') as string} />
                </Field>
                {chatError && <ErrorBox>{chatError}</ErrorBox>}
                <Actions>
                  <PrimaryBtn type="button" disabled={busy || !chatTarget} onClick={sendToChat}>{busy ? '...' : t('share.chat.send', '채팅방에 보내기')}</PrimaryBtn>
                </Actions>
              </>
            )}
          </TabPanel>
        )}
      </Dialog>
    </Backdrop>
  );
};

export default PostShareModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
  padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 520px; width: 100%;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 12px; border-bottom: 1px solid #F1F5F9;
  position: sticky; top: 0; background: #fff; z-index: 1;
`;
const Title = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0;`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Section = styled.section`
  padding: 16px 22px; border-bottom: 1px solid #F1F5F9;
`;
const SectionTitle = styled.h3`font-size:13px;font-weight:700;color:#0F172A;margin:0 0 10px 0;`;
const CheckRow = styled.div`margin-bottom:8px;`;
const CheckLabel = styled.label`
  display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
  padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 10px;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
  input[type="checkbox"] {
    margin-top: 2px; width: 16px; height: 16px; cursor: pointer;
    accent-color: #14B8A6;
  }
`;
const CheckTexts = styled.div`display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;`;
const CheckTitle = styled.span`font-size:13px;font-weight:600;color:#0F172A;`;
const CheckDesc = styled.span`font-size:11px;color:#64748B;line-height:1.5;`;
// URL 카드
const UrlCard = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const UrlIcon = styled.span`
  width: 28px; height: 28px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #0F766E; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const UrlText = styled.div`
  flex: 1; min-width: 0; font-size: 12px; color: #334155;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const CopyBtn = styled.button`
  flex-shrink: 0; padding: 7px 12px; font-size: 12px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 4px;
  &:hover { background: #14B8A6; color: #fff; }
`;

// 탭
const TabBar = styled.div`
  display: flex; padding: 0 22px; gap: 4px;
  border-bottom: 1px solid #F1F5F9;
`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px; margin-bottom: -1px;
  font-size: 13px; font-weight: 600;
  background: transparent; border: none; cursor: pointer;
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  transition: color 0.15s, border-color 0.15s;
  &:hover { color: #0F766E; }
`;
const TabPanel = styled.div`padding: 16px 22px 20px;`;

const Field = styled.div`display:flex;flex-direction:column;gap:5px;margin-bottom:10px;`;
const Label = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const Input = styled.input`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Textarea = styled.textarea`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff; resize: vertical;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Actions = styled.div`display:flex;justify-content:flex-end;gap:6px;margin-top:8px;`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const ErrorBox = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;margin-bottom:6px;`;

// 발송 완료 화면
const Done = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 12px 4px;
`;
const DoneIcon = styled.div<{ $tone: 'ok' | 'warn' }>`
  width: 44px; height: 44px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700;
  background: ${p => p.$tone === 'ok' ? '#F0FDFA' : '#FFF7ED'};
  color: ${p => p.$tone === 'ok' ? '#0F766E' : '#C2410C'};
  border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#FED7AA'};
`;
const DoneTitle = styled.div`
  font-size: 14px; font-weight: 600; color: #0F172A;
  text-align: center; line-height: 1.5; max-width: 380px;
`;
