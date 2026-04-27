// 서명 진행 표 + 양사 완료 시 후속 액션 카드 (Phase A4)
// - 표: Avatar · 이름/이메일 · 상태 badge · 시각 · 액션 dropdown (재발송·취소)
// - 서명 thumbnail (signed 시) — 클릭 시 큰 이미지 lightbox
// - 빈 상태: "아직 서명 요청 없음" + 서명 받기 CTA
// - 양사 모두 signed → 후속 액션 카드 (계약/SOW → 분할 청구, 견적 → 청구서)
// - 거절 1명 → 거절 알림 카드

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listSignatures, cancelSignature, remindSignature, type SignatureRequest, type SignatureStatus } from '../../services/posts';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import ConfirmDialog from '../Common/ConfirmDialog';

interface Props {
  postId: number;
  postTitle: string;
  /** category 또는 제목으로 추정한 종류 — 후속 액션 결정 */
  inferredKind: 'contract' | 'nda' | 'sow' | 'proposal' | 'quote' | 'other';
  /** 모달에서 발송 직후 또는 외부에서 새로고침 트리거 */
  reloadTrigger?: number;
  /** "서명 받기" 모달 열기 콜백 */
  onAddMore: () => void;
}

const SignatureProgressSection: React.FC<Props> = ({ postId, postTitle, inferredKind, reloadTrigger, onAddMore }) => {
  const { t } = useTranslation('qdocs');
  const { formatDateTime, formatTimeAgo } = useTimeFormat();
  const navigate = useNavigate();
  const [list, setList] = useState<SignatureRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMenuId, setActionMenuId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ image: string; signer: string; signedAt: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SignatureRequest | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSignatures(postId);
      setList(r);
    } finally { setLoading(false); }
  }, [postId]);

  useEffect(() => { reload(); }, [reload, reloadTrigger]);

  // 외부 클릭 시 액션 메뉴 닫기
  useEffect(() => {
    if (actionMenuId === null) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setActionMenuId(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [actionMenuId]);

  const visible = useMemo(() => (list || []).filter(s => s.status !== 'canceled'), [list]);

  // 양사 진행 집계
  const allSigned = visible.length > 0 && visible.every(s => s.status === 'signed');
  const anyRejected = visible.some(s => s.status === 'rejected');
  const allFinal = visible.length > 0 && visible.every(s => s.status === 'signed' || s.status === 'rejected' || s.status === 'expired');

  const onCopy = async (sr: SignatureRequest) => {
    try {
      await navigator.clipboard.writeText(sr.sign_url);
      setCopiedToken(sr.token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {/* noop */}
    setActionMenuId(null);
  };

  const onRemind = async (sr: SignatureRequest) => {
    if (busyId) return;
    setBusyId(sr.id); setActionMenuId(null);
    try {
      await remindSignature(sr.id);
      await reload();
    } finally { setBusyId(null); }
  };

  const onCancel = (sr: SignatureRequest) => {
    setCancelTarget(sr);
    setActionMenuId(null);
  };

  const confirmCancel = async () => {
    if (!cancelTarget || busyId) return;
    setBusyId(cancelTarget.id);
    try {
      await cancelSignature(cancelTarget.id);
      setCancelTarget(null);
      await reload();
    } finally { setBusyId(null); }
  };

  const onFollowupClick = () => {
    // 견적 → 단일 청구, 계약/SOW → 분할 청구 자동 분기
    const split = inferredKind === 'quote' ? '0' : '1';
    navigate(`/bills?tab=invoices&new=1&split=${split}&from_post=${postId}`);
  };

  // ─── 렌더 ───

  if (loading && !list) {
    return (
      <Section>
        <SectionHeader>
          <Title>{t('signProgress.title', '서명 진행')}</Title>
        </SectionHeader>
        <SkeletonRow /><SkeletonRow /><SkeletonRow />
      </Section>
    );
  }

  if (!list || list.length === 0) return null; // 발급 전: 표시 X (헤더 "서명 받기" 버튼만)

  return (
    <Section>
      <SectionHeader>
        <Title>
          {t('signProgress.title', '서명 진행')}
          <Count>{visible.length}</Count>
        </Title>
        <HeaderActions>
          <ReloadBtn type="button" onClick={reload} title={t('signProgress.reload', '새로고침') as string} aria-label={t('signProgress.reload', '새로고침') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </ReloadBtn>
          <AddMoreBtn type="button" onClick={onAddMore}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            {t('signProgress.addMore', '서명 추가')}
          </AddMoreBtn>
        </HeaderActions>
      </SectionHeader>

      {/* 후속 액션 카드 — 양사 모두 signed */}
      {allSigned && (
        <FollowupCard $tone="ok" onClick={onFollowupClick} role="button" tabIndex={0}>
          <FollowupIcon $tone="ok">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </FollowupIcon>
          <FollowupBody>
            <FollowupTitle>{t('signProgress.followup.allSigned', '양사 모두 서명 완료')}</FollowupTitle>
            <FollowupDesc>
              {inferredKind === 'quote'
                ? t('signProgress.followup.toInvoice', '이 견적으로 청구서를 발행하세요')
                : t('signProgress.followup.toSplit', '계약 금액 기반 분할 청구 일정을 만들어보세요')}
            </FollowupDesc>
          </FollowupBody>
          <FollowupArrow>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </FollowupArrow>
        </FollowupCard>
      )}

      {/* 거절 알림 카드 */}
      {anyRejected && allFinal && !allSigned && (
        <FollowupCard $tone="reject" as="div">
          <FollowupIcon $tone="reject">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </FollowupIcon>
          <FollowupBody>
            <FollowupTitle>{t('signProgress.followup.rejected', '서명 거절됨')}</FollowupTitle>
            <FollowupDesc>{t('signProgress.followup.rejectedDesc', '서명자 측에서 거절했습니다. 사유를 확인하고 협의 후 새로 요청해주세요.')}</FollowupDesc>
          </FollowupBody>
        </FollowupCard>
      )}

      {/* 진행 표 */}
      <Table>
        <THead>
          <Th style={{ width: '36%' }}>{t('signProgress.col.signer', '서명자')}</Th>
          <Th style={{ width: '18%' }}>{t('signProgress.col.status', '상태')}</Th>
          <Th style={{ width: '24%' }}>{t('signProgress.col.time', '시간')}</Th>
          <Th style={{ width: '14%' }}>{t('signProgress.col.signature', '서명')}</Th>
          <Th style={{ width: '8%' }}></Th>
        </THead>
        <TBody>
          {visible.map(sr => (
            <Tr key={sr.id} $rejected={sr.status === 'rejected'} $signed={sr.status === 'signed'}>
              <Td>
                <SignerCell>
                  <Avatar $signed={sr.status === 'signed'}>{(sr.signer_name || sr.signer_email)[0]?.toUpperCase()}</Avatar>
                  <SignerInfo>
                    <SignerName>{sr.signer_name || sr.signer_email}</SignerName>
                    {sr.signer_name && <SignerEmail>{sr.signer_email}</SignerEmail>}
                    {sr.note && sr.id === visible[0].id && <SignerNote title={sr.note}>{sr.note}</SignerNote>}
                  </SignerInfo>
                </SignerCell>
              </Td>
              <Td>
                <StatusBadge $status={sr.status}>{statusLabel(sr.status, t as (k: string, fb?: string) => string)}</StatusBadge>
                {sr.status === 'rejected' && sr.rejected_reason && (
                  <RejectReason title={sr.rejected_reason}>"{sr.rejected_reason}"</RejectReason>
                )}
                {sr.reminder_count > 0 && sr.status !== 'signed' && sr.status !== 'rejected' && (
                  <ReminderHint>{t('signProgress.reminderCount', '재발송 {{n}}회', { n: sr.reminder_count })}</ReminderHint>
                )}
              </Td>
              <Td>
                {sr.signed_at ? (
                  <TimeText title={formatDateTime(sr.signed_at)}>{formatTimeAgo(sr.signed_at)}</TimeText>
                ) : sr.viewed_at ? (
                  <TimeText title={formatDateTime(sr.viewed_at)}>
                    {t('signProgress.viewedAgo', '{{ago}} 검토', { ago: formatTimeAgo(sr.viewed_at) })}
                  </TimeText>
                ) : (
                  <TimeText title={formatDateTime(sr.created_at)}>{formatTimeAgo(sr.created_at)}</TimeText>
                )}
              </Td>
              <Td>
                {sr.signature_image_b64 && sr.signature_image_b64 !== '(present)' ? (
                  <SigThumb onClick={() => setLightbox({ image: sr.signature_image_b64!, signer: sr.signer_name || sr.signer_email, signedAt: sr.signed_at || '' })}>
                    <img src={sr.signature_image_b64} alt="signature" />
                  </SigThumb>
                ) : sr.status === 'signed' ? (
                  <SigPlaceholder>—</SigPlaceholder>
                ) : null}
              </Td>
              <Td>
                {sr.status !== 'signed' && sr.status !== 'rejected' && sr.status !== 'expired' && (
                  <ActionWrap>
                    <ActionToggle type="button" onClick={() => setActionMenuId(actionMenuId === sr.id ? null : sr.id)} aria-label={t('signProgress.action', '액션') as string} title={t('signProgress.action', '액션') as string}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/></svg>
                    </ActionToggle>
                    {actionMenuId === sr.id && (
                      <ActionMenu ref={menuRef}>
                        <MenuItem type="button" onClick={() => onCopy(sr)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          {copiedToken === sr.token ? t('signProgress.urlCopied', '복사됨') : t('signProgress.copyUrl', 'URL 복사')}
                        </MenuItem>
                        <MenuItem type="button" disabled={busyId === sr.id} onClick={() => onRemind(sr)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                          {t('signProgress.resend', '재발송')}
                        </MenuItem>
                        <MenuItem type="button" $danger disabled={busyId === sr.id} onClick={() => onCancel(sr)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          {t('signProgress.cancel', '요청 취소')}
                        </MenuItem>
                      </ActionMenu>
                    )}
                  </ActionWrap>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        title={t('signProgress.cancelTitle', '서명 요청 취소') as string}
        message={t('signProgress.cancelMessage', '"{{email}}" 의 서명 요청을 취소합니다. 받은 토큰 URL은 즉시 만료됩니다.', { email: cancelTarget?.signer_email || '' }) as string}
        confirmText={t('signProgress.cancelConfirmBtn', '취소하기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="danger"
      />

      {/* 서명 이미지 라이트박스 */}
      {lightbox && (
        <Lightbox onClick={() => setLightbox(null)}>
          <LightboxInner onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={postTitle}>
            <LightboxClose type="button" onClick={() => setLightbox(null)} aria-label={t('common.close', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </LightboxClose>
            <LightboxImg src={lightbox.image} alt="signature" />
            <LightboxMeta>
              <strong>{lightbox.signer}</strong>
              {lightbox.signedAt && ` · ${formatDateTime(lightbox.signedAt)}`}
            </LightboxMeta>
          </LightboxInner>
        </Lightbox>
      )}
    </Section>
  );
};

export default SignatureProgressSection;

function statusLabel(s: SignatureStatus, t: (k: string, fb?: string) => string): string {
  switch (s) {
    case 'sent': return t('signProgress.statusSent', '발송됨');
    case 'viewed': return t('signProgress.statusViewed', '검토 중');
    case 'signed': return t('signProgress.statusSigned', '서명 완료');
    case 'rejected': return t('signProgress.statusRejected', '거절됨');
    case 'expired': return t('signProgress.statusExpired', '만료');
    case 'canceled': return t('signProgress.statusCanceled', '취소');
    default: return t('signProgress.statusPending', '대기');
  }
}

// ─── styled ───
const Section = styled.section`
  margin-top: 20px; padding: 20px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
`;
const SectionHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
`;
const Title = styled.h3`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: #0F172A; margin: 0;
`;
const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  height: 20px; padding: 0 8px;
  font-size: 11px; font-weight: 700; color: #0F766E;
  background: #CCFBF1; border-radius: 999px;
`;
const HeaderActions = styled.div`display:flex;align-items:center;gap:6px;`;
const ReloadBtn = styled.button`
  width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; color: #64748B;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const AddMoreBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 28px; padding: 0 12px;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #14B8A6; color: #fff; }
`;

// 후속 액션 카드
const FollowupCard = styled.button<{ $tone: 'ok' | 'reject' }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  display: flex; align-items: center; gap: 12px; width: 100%;
  margin-bottom: 12px; padding: 12px 14px;
  background: ${p => p.$tone === 'ok'
    ? 'linear-gradient(135deg, #F0FDFA 0%, #FFF7ED 100%)'
    : '#FEF2F2'};
  border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#EF4444'};
  border-radius: 10px;
  transition: transform 0.15s, box-shadow 0.15s;
  &:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.06); }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const FollowupIcon = styled.span<{ $tone: 'ok' | 'reject' }>`
  width: 32px; height: 32px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff;
  color: ${p => p.$tone === 'ok' ? '#0F766E' : '#DC2626'};
  border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#EF4444'};
  border-radius: 50%;
`;
const FollowupBody = styled.div`flex:1;display:flex;flex-direction:column;gap:2px;`;
const FollowupTitle = styled.span`font-size:13px;font-weight:700;color:#0F172A;`;
const FollowupDesc = styled.span`font-size:11px;color:#64748B;line-height:1.5;`;
const FollowupArrow = styled.span`color:#14B8A6;flex-shrink:0;`;

// 표
const Table = styled.div`
  display: flex; flex-direction: column;
  border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;
  background: #fff;
`;
const THead = styled.div`
  display: flex; padding: 8px 12px;
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Th = styled.div``;
const TBody = styled.div`display:flex;flex-direction:column;`;
const Tr = styled.div<{ $rejected?: boolean; $signed?: boolean }>`
  display: flex; align-items: flex-start; padding: 12px;
  font-size: 13px; color: #0F172A;
  background: ${p => p.$rejected ? '#FEF2F2' : p.$signed ? '#F0FDFA' : '#fff'};
  & + & { border-top: 1px solid #EEF2F6; }
  transition: background 0.15s;
  &:hover { background: ${p => p.$rejected ? '#FEE2E2' : p.$signed ? '#CCFBF1' : '#F8FAFC'}; }
`;
const Td = styled.div`min-width: 0;`;

// 서명자
const SignerCell = styled.div`display:flex;align-items:center;gap:10px;min-width:0;`;
const Avatar = styled.div<{ $signed?: boolean }>`
  width: 32px; height: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: ${p => p.$signed
    ? 'linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)'
    : 'linear-gradient(135deg, #94A3B8 0%, #64748B 100%)'};
  color: #fff; font-size: 13px; font-weight: 700; border-radius: 50%;
`;
const SignerInfo = styled.div`display:flex;flex-direction:column;gap:1px;min-width:0;`;
const SignerName = styled.span`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SignerEmail = styled.span`
  font-size: 11px; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SignerNote = styled.span`
  font-size: 11px; color: #94A3B8; margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
`;

// 상태 badge
const StatusBadge = styled.span<{ $status: SignatureStatus }>`
  display: inline-flex; align-items: center;
  height: 22px; padding: 0 8px;
  font-size: 11px; font-weight: 700;
  border-radius: 999px;
  ${p => {
    switch (p.$status) {
      case 'signed': return `background:#CCFBF1;color:#0F766E;`;
      case 'rejected': return `background:#FEE2E2;color:#DC2626;`;
      case 'viewed': return `background:#DBEAFE;color:#1E40AF;`;
      case 'expired': return `background:#F1F5F9;color:#64748B;`;
      case 'canceled': return `background:#F1F5F9;color:#94A3B8;`;
      default: return `background:#FEF3C7;color:#92400E;`;
    }
  }}
`;
const RejectReason = styled.div`
  font-size: 11px; color: #DC2626; margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
`;
const ReminderHint = styled.div`
  font-size: 11px; color: #94A3B8; margin-top: 2px;
`;
const TimeText = styled.span`font-size:12px;color:#475569;`;

// 서명 thumbnail
const SigThumb = styled.button`
  all: unset; cursor: pointer; display: inline-flex;
  width: 60px; height: 32px;
  background: #FAFBFC; border: 1px solid #E2E8F0; border-radius: 6px; overflow: hidden;
  transition: border-color 0.15s, transform 0.15s;
  & img { width: 100%; height: 100%; object-fit: contain; }
  &:hover { border-color: #14B8A6; transform: scale(1.05); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const SigPlaceholder = styled.span`
  display: inline-block; width: 60px; text-align: center;
  font-size: 13px; color: #CBD5E1;
`;

// 액션 dropdown
const ActionWrap = styled.div`position:relative;display:flex;justify-content:flex-end;`;
const ActionToggle = styled.button`
  width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #94A3B8;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const ActionMenu = styled.div`
  position: absolute; top: 32px; right: 0; z-index: 10;
  min-width: 160px; padding: 4px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15,23,42,0.12);
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px;
  font-size: 12px; font-weight: 600;
  color: ${p => p.$danger ? '#DC2626' : '#334155'};
  background: transparent; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: ${p => p.$danger ? '#FEF2F2' : '#F1F5F9'}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// 라이트박스
const Lightbox = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.65);
  display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 24px;
`;
const LightboxInner = styled.div`
  position: relative; background: #fff; border-radius: 14px; padding: 24px;
  max-width: 600px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
`;
const LightboxClose = styled.button`
  position: absolute; top: 12px; right: 12px;
  width: 28px; height: 28px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const LightboxImg = styled.img`
  max-width: 100%; max-height: 60vh; object-fit: contain;
  background: #FAFBFC; border-radius: 10px; border: 1px solid #E2E8F0;
`;
const LightboxMeta = styled.div`font-size:13px;color:#64748B;text-align:center;`;

// 스켈레톤
const SkeletonRow = styled.div`
  height: 56px;
  margin-bottom: 8px;
  background: linear-gradient(90deg, #F1F5F9 0%, #F8FAFC 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 8px;
  animation: shimmer 1.4s infinite ease-in-out;
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;
