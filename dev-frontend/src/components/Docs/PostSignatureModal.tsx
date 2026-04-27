// 서명 받기 모달 — 30년차 디자이너 수준
// - 서명자 입력 N행 (이메일+이름) · 키보드 친화 (Enter 새 행, ↑↓ 이동, Backspace 빈 행 삭제)
// - 만료일 quick chip (7/14/30일) + 직접 선택
// - 메모 (선택)
// - 채팅 발송 토글 (post.conversation_id 또는 project_id 의 첫 customer 채널 자동)
// - 발송 → 결과 화면 (✓ + 진행 상태 확인 / 닫기)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { requestSignatures, type PostDetail, type SignatureRequest } from '../../services/posts';
import { listProjectConversations, listBusinessConversations, type ApiConversation } from '../../services/qtalk';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface Props {
  open: boolean;
  onClose: () => void;
  post: PostDetail;
  onSent: (signatures: SignatureRequest[]) => void;
}

interface SignerRow { id: number; email: string; name: string; }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let nextRowId = 1;

const PostSignatureModal: React.FC<Props> = ({ open, onClose, post, onSent }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('qdocs');
  const [signers, setSigners] = useState<SignerRow[]>([{ id: nextRowId++, email: '', name: '' }]);
  const [note, setNote] = useState('');
  const [expiryPick, setExpiryPick] = useState<7 | 14 | 30 | 'custom'>(14);
  const [customExpiry, setCustomExpiry] = useState<string>('');
  const [sendChat, setSendChat] = useState(true);
  const [convOptions, setConvOptions] = useState<PlanQSelectOption[]>([]);
  const [convId, setConvId] = useState<number | null>(post.conversation_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; viaChat: boolean; convId: number | null } | null>(null);
  const firstEmailRef = useRef<HTMLInputElement | null>(null);

  useBodyScrollLock(open);
  useEscapeStack(open && !busy, onClose);

  // 모달 진입 시 첫 입력 focus
  useEffect(() => {
    if (open) setTimeout(() => firstEmailRef.current?.focus(), 50);
  }, [open]);

  // 대화방 목록 (프로젝트 scope면 그 프로젝트, 전역이면 워크스페이스 전체)
  useEffect(() => {
    if (!open) return;
    const fetcher = post.project_id
      ? listProjectConversations(post.project_id)
      : listBusinessConversations(post.business_id);
    fetcher.then((list: ApiConversation[]) => {
      const sorted = [...list].sort((a, b) => {
        const ad = a.last_message_at || a.created_at; const bd = b.last_message_at || b.created_at;
        return (bd || '').localeCompare(ad || '');
      });
      const opts = sorted.map(c => ({ value: c.id, label: c.display_name || c.title || `#${c.id}` }));
      setConvOptions(opts);
      // 현재 connected conv 가 없으면 첫 customer 또는 첫 대화방 자동
      if (!convId && opts.length > 0) {
        const firstCustomer = sorted.find(c => c.channel_type === 'customer');
        setConvId(firstCustomer?.id || sorted[0].id);
      }
    }).catch(() => setConvOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post.project_id, post.business_id]);

  // 만료 일자 계산
  const expiresInDays = useMemo(() => {
    if (expiryPick === 'custom' && customExpiry) {
      const d = new Date(customExpiry);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return Math.max(1, Math.ceil((d.getTime() - today.getTime()) / 86400000));
    }
    return typeof expiryPick === 'number' ? expiryPick : 14;
  }, [expiryPick, customExpiry]);

  // 서명자 행 조작
  const addRow = () => setSigners(prev => [...prev, { id: nextRowId++, email: '', name: '' }]);
  const removeRow = (id: number) => {
    setSigners(prev => prev.length === 1 ? prev : prev.filter(r => r.id !== id));
  };
  const updateRow = (id: number, patch: Partial<SignerRow>) => {
    setSigners(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  // 키보드: Enter → 새 행, Backspace 빈 이메일 → 행 삭제
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: 'email' | 'name') => {
    if (e.key === 'Enter' && field === 'name') {
      e.preventDefault();
      addRow();
      setTimeout(() => {
        const next = document.querySelectorAll<HTMLInputElement>('[data-signer-email]');
        next[idx + 1]?.focus();
      }, 30);
    }
    if (e.key === 'Backspace' && field === 'email' && !signers[idx].email && signers.length > 1) {
      e.preventDefault();
      removeRow(signers[idx].id);
      setTimeout(() => {
        const next = document.querySelectorAll<HTMLInputElement>('[data-signer-email]');
        next[Math.max(0, idx - 1)]?.focus();
      }, 30);
    }
  };

  const validSigners = signers.filter(s => EMAIL_RE.test(s.email.trim()));
  const canSubmit = validSigners.length > 0 && !busy;

  const submit = async () => {
    setError(null);
    if (validSigners.length === 0) { setError(t('sign.noSigners', '서명자 이메일을 1명 이상 입력하세요') as string); return; }
    setBusy(true);
    try {
      const r = await requestSignatures(post.id, {
        signers: validSigners.map(s => ({ email: s.email.trim().toLowerCase(), name: s.name.trim() || undefined })),
        note: note.trim() || undefined,
        expires_in_days: expiresInDays,
        send_chat: sendChat && !!convId,
        conversation_id: sendChat && convId ? convId : undefined,
      });
      setDone({ count: r.signatures.length, viaChat: !!r.chat_message_id, convId: sendChat && convId ? convId : null });
      onSent(r.signatures);
    } catch (e) {
      setError(((e as Error).message) || (t('sign.failed', '서명 요청 실패') as string));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSigners([{ id: nextRowId++, email: '', name: '' }]);
    setNote(''); setExpiryPick(14); setCustomExpiry('');
    setError(null); setDone(null);
  };

  const closeAll = () => { reset(); onClose(); };

  if (!open) return null;

  return (
    <Backdrop onClick={() => !busy && closeAll()}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('sign.title', '서명 받기') as string}>
        <Header>
          <Title>
            <PenIcon>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            </PenIcon>
            {t('sign.title', '서명 받기')}
          </Title>
          <CloseBtn type="button" onClick={closeAll} disabled={busy} aria-label={t('common.close', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>

        {done ? (
          <DoneBody>
            <DoneCircle>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </DoneCircle>
            <DoneTitle>{t('sign.doneTitle', '서명 요청을 보냈습니다')}</DoneTitle>
            <DoneList>
              <li>{t('sign.doneEmail', '{{n}}명에게 이메일을 발송했습니다', { n: done.count })}</li>
              {done.viaChat && <li>{t('sign.doneChat', '채팅에도 카드 메시지를 보냈습니다')}</li>}
              <li>{t('sign.doneExpiry', '서명 진행 상태는 문서 상세에서 확인할 수 있습니다')}</li>
            </DoneList>
            <DoneActions>
              <SecondaryBtn type="button" onClick={() => { reset(); }}>{t('sign.again', '추가 요청')}</SecondaryBtn>
              {done.viaChat && done.convId && (
                <SecondaryBtn type="button" onClick={() => { closeAll(); navigate(`/talk/${done.convId}`); }}>
                  {t('sign.goChat', '채팅방 가서 보기')}
                </SecondaryBtn>
              )}
              <PrimaryBtn type="button" onClick={closeAll}>{t('common.close', '닫기')}</PrimaryBtn>
            </DoneActions>
          </DoneBody>
        ) : (
          <Body>
            <Section>
              <SectionLabel>{t('sign.signers', '서명자')}</SectionLabel>
              <SectionHint>{t('sign.signersHint', 'Enter 로 새 서명자를 추가합니다.')}</SectionHint>
              <SignerList>
                {signers.map((s, idx) => {
                  const valid = !s.email || EMAIL_RE.test(s.email.trim());
                  return (
                    <SignerRowWrap key={s.id} $invalid={!valid}>
                      <Avatar>{(s.email || '?').trim()[0]?.toUpperCase() || '?'}</Avatar>
                      <SignerFields>
                        <SignerEmailInput
                          ref={idx === 0 ? firstEmailRef : undefined}
                          data-signer-email
                          type="email"
                          value={s.email}
                          onChange={e => updateRow(s.id, { email: e.target.value })}
                          onKeyDown={e => handleKey(e, idx, 'email')}
                          placeholder="email@example.com"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <SignerNameInput
                          data-signer-name
                          type="text"
                          value={s.name}
                          onChange={e => updateRow(s.id, { name: e.target.value })}
                          onKeyDown={e => handleKey(e, idx, 'name')}
                          placeholder={t('sign.namePh', '이름 (선택)') as string}
                          autoComplete="off"
                        />
                      </SignerFields>
                      <RemoveSigner type="button" onClick={() => removeRow(s.id)} disabled={signers.length === 1} aria-label={t('sign.remove', '제거') as string} title={t('sign.remove', '제거') as string}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </RemoveSigner>
                    </SignerRowWrap>
                  );
                })}
              </SignerList>
              <AddSigner type="button" onClick={addRow}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                {t('sign.addSigner', '서명자 추가')}
              </AddSigner>
            </Section>

            <Section>
              <SectionLabel>{t('sign.message', '메모 (선택)')}</SectionLabel>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t('sign.messagePh', '검토 부탁드립니다.') as string} disabled={busy} />
            </Section>

            <SectionTwoCol>
              <SectionHalf>
                <SectionLabel>{t('sign.expiry', '만료')}</SectionLabel>
                <ExpiryRow>
                  {[7, 14, 30].map(d => (
                    <ExpiryChip key={d} type="button" $active={expiryPick === d} onClick={() => setExpiryPick(d as 7|14|30)}>
                      {t('sign.daysShort', '{{n}}일', { n: d })}
                    </ExpiryChip>
                  ))}
                  <ExpiryChip type="button" $active={expiryPick === 'custom'} onClick={() => setExpiryPick('custom')}>
                    {t('sign.customDate', '직접')}
                  </ExpiryChip>
                </ExpiryRow>
                {expiryPick === 'custom' && (
                  <Input type="date" value={customExpiry} onChange={e => setCustomExpiry(e.target.value)} min={new Date(Date.now() + 86400000).toISOString().slice(0,10)} />
                )}
                <SectionHint>{t('sign.expiresOn', '{{date}} 까지 유효', { date: new Date(Date.now() + expiresInDays * 86400000).toLocaleDateString('ko-KR') })}</SectionHint>
              </SectionHalf>
              <SectionHalf>
                <SectionLabel>{t('sign.chatChannel', '채팅 카드')}</SectionLabel>
                <CheckLabel>
                  <input type="checkbox" checked={sendChat && convOptions.length > 0} onChange={e => setSendChat(e.target.checked)} disabled={convOptions.length === 0 || busy} />
                  <span>{convOptions.length === 0 ? t('sign.noChat', '연결된 채팅방 없음') : t('sign.chatToggle', '채팅에도 카드 보내기')}</span>
                </CheckLabel>
                {sendChat && convOptions.length > 0 && (
                  <PlanQSelect
                    size="sm"
                    options={convOptions}
                    value={convOptions.find(o => o.value === convId) || null}
                    onChange={(opt) => setConvId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                    placeholder={t('sign.chatPick', '대화방 선택') as string}
                    isSearchable
                  />
                )}
              </SectionHalf>
            </SectionTwoCol>

            {error && <ErrorBox role="alert">{error}</ErrorBox>}
          </Body>
        )}

        {!done && (
          <Footer>
            <SecondaryBtn type="button" onClick={closeAll} disabled={busy}>{t('cancel', '취소')}</SecondaryBtn>
            <PrimaryBtn type="button" onClick={submit} disabled={!canSubmit}>
              {busy ? (
                <><Spinner />{t('sign.sending', '발송 중…')}</>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  {t('sign.send', '서명 요청 보내기')}
                  {validSigners.length > 0 && <span style={{ opacity: 0.7, marginLeft: 4 }}>· {validSigners.length}</span>}
                </>
              )}
            </PrimaryBtn>
          </Footer>
        )}
      </Dialog>
    </Backdrop>
  );
};

export default PostSignatureModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 560px; width: 100%;
  max-height: 92vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  display: flex; flex-direction: column;
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9; flex-shrink: 0;
`;
const Title = styled.h2`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
`;
const PenIcon = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 8px;
  background: #F0FDFA; color: #0F766E;
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  transition: background 0.15s, color 0.15s;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Body = styled.div`padding: 16px 22px 8px;`;
const Section = styled.section`margin-bottom: 14px;`;
const SectionTwoCol = styled.section`
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;
  @media (max-width: 540px) { grid-template-columns: 1fr; }
`;
const SectionHalf = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const SectionLabel = styled.label`font-size: 12px; font-weight: 600; color: #0F172A; display: block; margin-bottom: 6px;`;
const SectionHint = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.5; margin-top: 4px;`;

// 서명자 입력
const SignerList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const SignerRowWrap = styled.div<{ $invalid: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border: 1px solid ${p => p.$invalid ? '#EF4444' : '#E2E8F0'};
  border-radius: 10px; background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Avatar = styled.div`
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #14B8A6 0%, #0D9488 100%);
  color: #fff; font-size: 12px; font-weight: 700;
`;
const SignerFields = styled.div`flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 110px; gap: 6px;`;
const SignerEmailInput = styled.input`
  border: none; background: transparent; padding: 4px 0;
  font-size: 13px; color: #0F172A; min-width: 0;
  &::placeholder { color: #CBD5E1; }
  &:focus { outline: none; }
`;
const SignerNameInput = styled(SignerEmailInput)`
  text-align: right; color: #64748B;
  &::placeholder { color: #CBD5E1; }
`;
const RemoveSigner = styled.button`
  width: 24px; height: 24px; padding: 0; flex-shrink: 0;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #94A3B8;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s, background 0.15s;
  ${SignerRowWrap}:hover & { opacity: 1; }
  &:hover:not(:disabled) { background: #FEF2F2; color: #DC2626; }
  &:disabled { display: none; }
`;
const AddSigner = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; margin-top: 8px;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: transparent; border: 1px dashed #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #F0FDFA; }
`;

// 메모
const Textarea = styled.textarea`
  width: 100%; padding: 10px 12px;
  font-size: 13px; color: #0F172A; line-height: 1.55;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  resize: vertical; font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;

// 만료
const ExpiryRow = styled.div`display: flex; gap: 4px; flex-wrap: wrap;`;
const ExpiryChip = styled.button<{ $active: boolean }>`
  height: 28px; padding: 0 12px;
  font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#0F766E' : '#fff'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0F766E' : '#E2E8F0'};
  border-radius: 999px; cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  &:hover { border-color: ${p => p.$active ? '#0D9488' : '#CBD5E1'}; }
`;
const Input = styled.input`
  width: 100%; padding: 8px 10px;
  font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  margin-top: 4px;
  &:focus { outline: none; border-color: #14B8A6; }
`;

// 채팅 토글
const CheckLabel = styled.label`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 12px; color: #334155;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
  input { accent-color: #14B8A6; cursor: pointer; }
`;

const ErrorBox = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;margin-top:8px;`;

// Footer
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 14px 22px 18px;
  border-top: 1px solid #F1F5F9; flex-shrink: 0;
`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center;
  height: 36px; padding: 0 18px;
  font-size: 13px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #0D9488; transform: translateY(-1px); }
  &:active:not(:disabled) { transform: translateY(0); }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const SecondaryBtn = styled.button`
  height: 36px; padding: 0 16px;
  font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Spinner = styled.span`
  width: 12px; height: 12px; margin-right: 6px;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  border-radius: 50%; animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// 발송 완료 화면
const DoneBody = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 36px 24px 28px; gap: 14px;
`;
const DoneCircle = styled.div`
  width: 56px; height: 56px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0F766E;
  border: 1px solid #14B8A6;
  animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  @keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
`;
const DoneTitle = styled.div`
  font-size: 16px; font-weight: 700; color: #0F172A;
`;
const DoneList = styled.ul`
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 13px; color: #475569; line-height: 1.55;
  text-align: center;
  & li::before { content: '·'; margin-right: 6px; color: #94A3B8; }
`;
const DoneActions = styled.div`
  display: flex; gap: 6px; margin-top: 8px;
`;
