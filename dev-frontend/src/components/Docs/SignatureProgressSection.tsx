// 서명 진행 표 + 양사 완료 시 후속 액션 카드 (Phase A4)
// - 표: Avatar · 이름/이메일 · 상태 badge · 시각 · 액션 dropdown (재발송·취소)
// - 서명 thumbnail (signed 시) — 클릭 시 큰 이미지 lightbox
// - 빈 상태: "아직 서명 요청 없음" + 서명 받기 CTA
// - 양사 모두 signed → 후속 액션 카드 (계약/SOW → 분할 청구, 견적 → 청구서)
// - 거절 1명 → 거절 알림 카드

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listSignatures, cancelSignature, remindSignature, closeSignatureRound, type SignatureRequest, type SignatureStatus } from '../../services/posts';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import ConfirmDialog from '../Common/ConfirmDialog';
import ImageLightbox from '../Common/ImageLightbox';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import InternalSignModal from './InternalSignModal';
import { currentSignatureRows, pastSignatureRounds, resendSourceRound } from '../../utils/signatureRounds';

interface Props {
  postId: number;
  /** category 또는 제목으로 추정한 종류 — 후속 액션 결정 */
  inferredKind: 'contract' | 'nda' | 'sow' | 'proposal' | 'quote' | 'other';
  /** 모달에서 발송 직후 또는 외부에서 새로고침 트리거 */
  reloadTrigger?: number;
  /** "서명 받기" 모달 열기 콜백 */
  onAddMore: () => void;
  /** [고쳐서 다시 보내기] 로 회차를 닫은 뒤 — 편집 화면은 잠금을 풀고 쓰던 글을 저장한다 */
  onRoundClosed?: () => void;
  /** 취소·모두 취소·우리 쪽 서명·새로고침 — 잠금(편집 가능 여부)이 바뀔 수 있다. 부르는 쪽이 서명본을 다시 읽는다 */
  onChanged?: () => void;
  /** 편집 화면 — 잠금이 아니면 «다시 보내기» 차례(지금 회차 0 · 닫힌 회차 있음)일 때만 보인다 */
  onlyResend?: boolean;
}

const SignatureProgressSection: React.FC<Props> = ({ postId, inferredKind, reloadTrigger, onAddMore, onRoundClosed, onChanged, onlyResend }) => {
  const { t } = useTranslation('qdocs');
  const { formatDateTime, formatTimeAgo } = useTimeFormat();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  // 보내는 쪽(우리) 서명 — 내 칸이면 앱 안에서 바로 서명한다(메일·인증번호 없음)
  const [signTarget, setSignTarget] = useState<SignatureRequest | null>(null);
  // 내가 지금 이 칸에 서명할 수 있는가 — [서명하기] 버튼과 URL `?sign=` 자동 열기가 **같은 판정**을 쓴다.
  const canSignNow = useCallback((sr: SignatureRequest) => sr.party === 'us'
    && sr.status !== 'signed' && sr.status !== 'rejected' && sr.status !== 'expired' && sr.status !== 'canceled'
    && Number(sr.signer_user_id ?? sr.requester_user_id) === Number(me?.id), [me?.id]);
  // 확인 필요·받은 서명에서 «서명하기» 로 들어오면 `?sign=<요청 id>` 가 붙는다 → 문서만 열지 말고 서명 창을 바로 연다
  //   (Irene 2026-10-05: "나보고 서명하라는 건데 링크가 문서로 올 게 아니라 서명하기 누르면 나오는 페이지가 열려야"). 연 뒤에는 떼어
  //   새로고침·뒤로 가기에 창이 다시 뜨지 않게 한다. keep-alive 탭에서도 다시 들어올 때 걸리도록 searchParams 를 deps 로 본다.
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState<SignatureRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMenuId, setActionMenuId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // 서명 이미지 — 목록 응답은 본문 대신 '(present)' 를 싣는다(표 응답을 가볍게). 이미지는
  //   GET /api/signatures/:id/image 로 따로 받아 쓴다. 예전엔 그 GET 이 없어 서명된 행이 늘 «—» 였다(2026-09-22).
  //   <img> 는 인증 헤더를 못 싣으므로 apiFetch 로 받아 blob URL 로 만든다.
  //   ★ 서명 칸이 여럿(사인 + 회사 스탬프)이면 칸마다 한 장 — `?i=` 로 받는다. 첫 장만 그리면 «2개 했는데 1개» 다(2026-10-16).
  const [sigImg, setSigImg] = useState<Record<number, string[]>>({});
  const imgCount = (sr: SignatureRequest) => (sr.signature_image_b64 ? Math.max(1, sr.signature_image_count || 1) : 0);
  useEffect(() => {
    if (!list) return undefined;
    const need = list.filter((sr) => sr.signature_image_b64 === '(present)' && !sigImg[sr.id]);
    if (!need.length) return undefined;
    let alive = true;
    void (async () => {
      const got: Record<number, string[]> = {};
      for (const sr of need) {
        const urls: string[] = [];
        for (let i = 0; i < imgCount(sr); i += 1) {
          try {
            const r = await apiFetch(`/api/signatures/${sr.id}/image?i=${i}`);
            if (r.ok) urls.push(URL.createObjectURL(await r.blob()));
          } catch { /* 이미지 한 장 실패는 그 장만 빠진다 */ }
        }
        if (urls.length) got[sr.id] = urls;
      }
      if (alive && Object.keys(got).length) setSigImg((prev) => ({ ...prev, ...got }));
      else Object.values(got).flat().forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  // 만든 blob URL 은 화면을 떠날 때 한 번에 푼다(목록이 바뀔 때 풀면 아직 쓰는 이미지가 깨진다)
  const sigImgRef = useRef(sigImg);
  sigImgRef.current = sigImg;
  useEffect(() => () => { Object.values(sigImgRef.current).flat().forEach((u) => URL.revokeObjectURL(u)); }, []);
  const sigSrcs = (sr: SignatureRequest): string[] => (sr.signature_image_b64 && sr.signature_image_b64 !== '(present)'
    ? [sr.signature_image_b64] : (sigImg[sr.id] || []));
  const [lightboxAlt, setLightboxAlt] = useState<string>('');
  // 재발송 확인 — 외부로 메일이 나가므로 받는 주소를 보여 주고 확인을 받는다(CLAUDE.md «외부 발송은 확인을 받는다»).
  //   서명 링크(토큰)는 진행표 응답에 더 이상 오지 않는다(0-C C-1) — «URL 복사» 는 없앴다.
  const [remindTarget, setRemindTarget] = useState<SignatureRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SignatureRequest | null>(null);
  // 살아 있는 요청 모두 취소 — 서명 받을 문서가 아닌데 잘못 보낸 경우(2026-10-15, Irene: "잘못 넣었을 때 해결방법이 없네")
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
  // 회차 닫기 [고쳐서 다시 보내기] (2026-10-22 Fable D2·D3) — 받는 쪽 서명 0 일 때만. 닫으면 문서 잠금이 풀린다
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 접기 (2026-10-22, Irene: "서명진행관련 안내랑 고쳐서다시보내기 서명추가 이게 맨 위로 붙어서 나오고 접었다 폈다 하게") —
  //   본문 맨 위에 서므로 긴 표가 본문을 밀어내지 않게 접는다. 접혀도 머리줄(요약·[고쳐서 다시 보내기]·[서명 추가])은 보인다.
  //   null = 자동(할 일이 있으면 펼침). 사람이 누르면 그 값. 문서가 바뀌면 자동으로 돌아간다.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  useEffect(() => { setUserExpanded(null); }, [postId]);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const wantSign = Number(searchParams.get('sign')) || null;
  useEffect(() => {
    if (!wantSign || !list) return;
    const sr = list.find((x) => x.id === wantSign);
    if (sr && canSignNow(sr)) setSignTarget(sr);
    const next = new URLSearchParams(searchParams);
    next.delete('sign');
    setSearchParams(next, { replace: true });
  }, [wantSign, list, canSignNow, searchParams, setSearchParams]);

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

  // 지금 회차만 — 취소·닫힌 회차(superseded)는 표에서 뺀다(닫힌 회차는 아래 «이전 회차» 에 묶어 보인다)
  const visible = useMemo(() => currentSignatureRows(list), [list]);
  // 이전 회차 — 같은 superseded_at = 같은 회차(utils/signatureRounds 한 벌 — 다시 보내기 프리필도 같은 묶음). 최근 회차가 위
  const pastRounds = useMemo(() => pastSignatureRounds(list), [list]);
  // 닫을 수 있는가 — 서버 canCloseRows 와 같은 판정(서명 요청 행 ≥1 ∧ 받는 쪽 서명 0). 확인 요청은 회차 밖
  const roundRows = useMemo(() => visible.filter(s => (s.kind || 'sign') === 'sign'), [visible]);
  const canCloseRound = roundRows.length > 0 && !roundRows.some(s => (s.party || 'them') === 'them' && s.status === 'signed');
  // 받는 쪽이 고친 뒤 다시 보내 달라고 했나
  const revision = useMemo(() => roundRows.find(s => s.status === 'rejected' && s.rejected_kind === 'revise') || null, [roundRows]);
  // 아직 끝나지 않은 요청 — 취소할 수 있는 것(서버 DELETE 는 signed·rejected 만 거절한다).
  //   ★ 보내는 쪽(우리) 칸도 포함한다. 예전엔 ⋯ 메뉴가 받는 쪽에만 있어 우리 칸 pending 이 남으면
  //     문서가 «서명 요청을 취소하세요» 로 영영 잠겼는데 취소할 버튼이 없었다.
  const liveRows = useMemo(() => visible.filter(isLive), [visible]);

  // 양사 진행 집계
  const allSigned = visible.length > 0 && visible.every(s => s.status === 'signed');
  const anyRejected = visible.some(s => s.status === 'rejected');
  const allFinal = visible.length > 0 && visible.every(s => s.status === 'signed' || s.status === 'rejected' || s.status === 'expired');
  const signedCount = visible.filter(s => s.status === 'signed').length;
  // 고쳐서 다시 보낼 차례 — 회차를 닫았고 아직 새로 안 보냈다. 서명 받기 창이 이 회차의 받는 분을 그대로 채운다(같은 함수).
  //   2026-10-23 Irene «UI/UX 순서가 아예 잘못 … 수정 후 재발송이면 정보 넣었던 거 그대로 있어야»
  const resendRound = useMemo(() => resendSourceRound(list), [list]);
  const expanded = userExpanded ?? (!!revision || !!closeErr || !!resendRound || visible.some(canSignNow));
  // 잠금이 바뀔 수 있는 동작 뒤 — 부르는 쪽이 있으면 그쪽이 reloadTrigger 로 표까지 다시 읽게 한다(두 번 읽지 않게)
  const afterChange = async () => { if (onChanged) onChanged(); else await reload(); };

  const onRemind = (sr: SignatureRequest) => {
    setRemindTarget(sr);
    setActionMenuId(null);
  };

  const confirmRemind = async () => {
    if (!remindTarget || busyId) return;
    setBusyId(remindTarget.id);
    try {
      await remindSignature(remindTarget.id);
      setRemindTarget(null);
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
      await afterChange();
    } finally { setBusyId(null); }
  };

  const confirmCancelAll = async () => {
    if (busyId) return;
    setBusyId(-1);
    try {
      // 새 API 없이 한 건씩 — 한 건이 실패해도 나머지는 계속하고, 끝나면 표를 다시 읽어 실제 상태를 보여준다.
      for (const sr of liveRows) {
        try { await cancelSignature(sr.id); } catch { /* 그 건만 남는다 — 재조회로 보인다 */ }
      }
      setCancelAllOpen(false);
      await afterChange();
    } finally { setBusyId(null); }
  };

  const confirmCloseRound = async () => {
    if (busyId) return;
    setBusyId(-2); setCloseErr(null);
    try {
      await closeSignatureRound(postId);
      setCloseOpen(false);
      await reload();
      onRoundClosed?.();
    } catch (e) {
      setCloseOpen(false);
      setCloseErr((e as { code?: string }).code === 'round_has_counterparty_signature'
        ? t('signProgress.closeRound.blocked', '받는 쪽이 이미 서명해 고칠 수 없어요. 문서를 복사해 새로 보내 주세요.') as string
        : t('signProgress.closeRound.failed', '서명 요청을 닫지 못했어요. 잠시 뒤 다시 시도해 주세요.') as string);
    } finally { setBusyId(null); }
  };

  const onFollowupClick = () => {
    // 견적 → 단일 청구, 계약/SOW → 분할 청구 자동 분기
    const split = inferredKind === 'quote' ? '0' : '1';
    navigate(`/bills?tab=invoices&new=1&split=${split}&from_post=${postId}`);
  };

  // ─── 렌더 ───

  // 처음 읽는 동안은 자리를 잡지 않는다 — 본문 **위**에 서므로 뼈대를 그리면 서명 요청이 없는 문서도
  //   열 때마다 맨 위가 잠깐 밀렸다 돌아온다.
  if (loading && !list) return null;

  if (!list || list.length === 0) return null; // 발급 전: 표시 X (헤더 "서명 받기" 버튼만)
  if (onlyResend && !resendRound) return null;

  return (
    <Section>
      <SectionHeader>
        <TitleToggle type="button" data-testid="sign-progress-toggle" aria-expanded={expanded}
          aria-label={(expanded ? t('signProgress.collapse', '서명 진행 접기') : t('signProgress.expand', '서명 진행 펼치기')) as string}
          onClick={() => setUserExpanded(!expanded)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6"/></svg>
          {t('signProgress.title', '서명 진행')}
          <Count>{t('signProgress.summary', '{{signed}}/{{total}} 서명', { signed: signedCount, total: visible.length })}</Count>
        </TitleToggle>
        <HeaderActions>
          {canCloseRound && (
            <CloseRoundBtn type="button" data-testid="sign-close-round" disabled={busyId !== null} onClick={() => setCloseOpen(true)}>
              {t('signProgress.closeRound.button', '고쳐서 다시 보내기')}
            </CloseRoundBtn>
          )}
          {liveRows.length >= 2 && (
            <CancelAllBtn type="button" data-testid="sign-cancel-all" disabled={busyId !== null} onClick={() => setCancelAllOpen(true)}>
              {t('signProgress.cancelAll', '모두 취소')}
            </CancelAllBtn>
          )}
          <ReloadBtn type="button" onClick={() => { void afterChange(); }} title={t('signProgress.reload', '새로고침') as string} aria-label={t('signProgress.reload', '새로고침') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </ReloadBtn>
          <AddMoreBtn type="button" onClick={onAddMore} data-testid={resendRound ? 'sign-resend' : 'sign-add-more'}>
            {resendRound
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>}
            {resendRound ? t('signProgress.resendRound.button', '다시 보내기') : t('signProgress.addMore', '서명 추가')}
          </AddMoreBtn>
        </HeaderActions>
      </SectionHeader>

      {closeErr && <CloseErr role="alert">{closeErr}</CloseErr>}

      {expanded && (<>
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

      {/* 다시 보내기 카드 (2026-10-23) — 회차를 닫은 뒤 다음 할 일. 누르면 지난번 받는 분이 채워진 서명 받기 창 */}
      {resendRound && (
        <FollowupCard $tone="ok" type="button" onClick={onAddMore} data-testid="sign-resend-card">
          <FollowupIcon $tone="ok">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </FollowupIcon>
          <FollowupBody>
            <FollowupTitle>{t('signProgress.resendRound.title', '고친 문서를 다시 보내세요')}</FollowupTitle>
            <FollowupDesc>{t('signProgress.resendRound.desc', '누르면 지난번 받는 분 정보({{names}})가 그대로 들어간 서명 받기 창이 열려요. 바꿀 것만 고치면 됩니다.', {
              names: resendRound.filter(r => (r.party || 'them') === 'them').map(r => r.signer_name || r.signer_email).join(', ') || '-',
            })}</FollowupDesc>
          </FollowupBody>
          <FollowupArrow>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </FollowupArrow>
        </FollowupCard>
      )}

      {/* 수정 요청 카드 (2026-10-22) — 받는 쪽이 고쳐서 다시 보내 달라고 했다. 사유를 보이고, 닫을 수 있으면 바로 버튼 */}
      {revision && (
        <FollowupCard $tone="reject" as="div" data-testid="sign-revision-card">
          <FollowupIcon $tone="reject">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </FollowupIcon>
          <FollowupBody>
            <FollowupTitle>{t('signProgress.followup.revise', '{{name}} 님이 수정을 요청했어요', { name: revision.signer_name || revision.signer_email })}</FollowupTitle>
            {revision.rejected_reason && <FollowupDesc>"{revision.rejected_reason}"</FollowupDesc>}
            <FollowupDesc>{canCloseRound
              ? t('signProgress.followup.reviseDesc', '[고쳐서 다시 보내기] 를 누르면 문서를 고칠 수 있어요. 고친 뒤 서명 요청을 다시 보내면 우리 쪽 서명도 새로 합니다.')
              : t('signProgress.followup.reviseLocked', '다른 받는 분이 이미 서명해 이 문서는 고칠 수 없어요. 문서를 복사해 새로 보내 주세요.')}</FollowupDesc>
          </FollowupBody>
        </FollowupCard>
      )}

      {/* 거절 알림 카드 */}
      {!revision && anyRejected && allFinal && !allSigned && (
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
      {visible.length > 0 && <Table>
        <THead>
          <Th style={{ width: '36%' }}>{t('signProgress.col.signer', '서명자')}</Th>
          <Th style={{ width: '18%' }}>{t('signProgress.col.status', '상태')}</Th>
          <Th style={{ width: '24%' }}>{t('signProgress.col.time', '시간')}</Th>
          <Th style={{ width: '14%' }}>{t('signProgress.col.signature', '서명')}</Th>
          <Th style={{ width: '8%' }}></Th>
        </THead>
        <TBody>
          {visible.map(sr => (
            <Tr
              key={sr.id}
              data-testid="sign-row"
              data-party={sr.party === 'us' ? 'us' : 'them'}
              $rejected={sr.status === 'rejected'}
              $signed={sr.status === 'signed'}
            >
              <Td>
                <SignerCell>
                  <Avatar $signed={sr.status === 'signed'}>{(sr.signer_name || sr.signer_email)[0]?.toUpperCase()}</Avatar>
                  <SignerInfo>
                    <SignerName>
                      {sr.signer_name || sr.signer_email}
                      {sr.party === 'us' && (
                        <PartyChip $us>{t('signProgress.partyUs', { defaultValue: '보내는 쪽' }) as string}</PartyChip>
                      )}
                      {sr.slot != null && <SlotChip>{sr.slot}</SlotChip>}
                    </SignerName>
                    {sr.signer_name && <SignerEmail>{sr.signer_email}</SignerEmail>}
                    {sr.note && sr.id === visible[0].id && <SignerNote title={sr.note}>{sr.note}</SignerNote>}
                  </SignerInfo>
                </SignerCell>
              </Td>
              <Td>
                <StatusBadge $status={sr.status}>{sr.status === 'rejected' && sr.rejected_kind === 'revise'
                  ? t('signProgress.statusRevise', '수정 요청')
                  : statusLabel(sr.status, t as (k: string, fb?: string) => string)}</StatusBadge>
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
                {sigSrcs(sr).length ? (
                  <SigThumbs data-testid="sign-progress-images">
                    {sigSrcs(sr).map((src, i) => (
                      <SigThumb key={i} onClick={() => {
                        setLightboxSrc(src);
                        setLightboxAlt(`${sr.signer_name || sr.signer_email}${sr.signed_at ? ' · ' + formatDateTime(sr.signed_at) : ''}`);
                      }}>
                        <img src={src} alt="signature" />
                      </SigThumb>
                    ))}
                  </SigThumbs>
                ) : sr.status === 'signed' ? (
                  <SigPlaceholder>—</SigPlaceholder>
                ) : null}
              </Td>
              <Td>
                {/* 보내는 쪽 내 칸 — 메일 링크가 없다. 여기서 바로 서명한다. */}
                {canSignNow(sr) && (
                  <SignNowBtn type="button" data-testid="sign-internal-open" onClick={() => setSignTarget(sr)}>
                    {t('signProgress.signNow', { defaultValue: '서명하기' }) as string}
                  </SignNowBtn>
                )}
                {isLive(sr) && (
                  <ActionWrap>
                    <ActionToggle type="button" data-testid="sign-row-actions" onClick={() => setActionMenuId(actionMenuId === sr.id ? null : sr.id)} aria-label={t('signProgress.action', '액션') as string} title={t('signProgress.action', '액션') as string}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/></svg>
                    </ActionToggle>
                    {actionMenuId === sr.id && (
                      <ActionMenu ref={menuRef}>
                        {/* 보내는 쪽 칸은 메일이 안 나간다 — 재발송은 받는 쪽에만 */}
                        {sr.party !== 'us' && (
                          <MenuItem type="button" data-testid="sign-row-resend" disabled={busyId === sr.id} onClick={() => onRemind(sr)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            {t('signProgress.resendLink', '링크 다시 보내기')}
                          </MenuItem>
                        )}
                        <MenuItem type="button" data-testid="sign-row-cancel" $danger disabled={busyId === sr.id} onClick={() => onCancel(sr)}>
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
      </Table>}

      {/* 이전 회차 (D7) — 닫힌 회차는 기록으로만. 누가·언제·무엇(서명/수정 요청/거절)·사유 */}
      {pastRounds.length > 0 && (
        <History>
          <HistoryToggle type="button" data-testid="sign-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(v => !v)}>
            {t('signProgress.history.toggle', '이전 회차 {{n}}건', { n: pastRounds.length })}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: historyOpen ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9"/></svg>
          </HistoryToggle>
          {historyOpen && pastRounds.map(([at, rows]) => (
            <HistoryRound key={at} data-testid="sign-history-round">
              <HistoryHead>{t('signProgress.history.closedAt', '{{at}} 에 닫음', { at: at ? formatDateTime(at) : '—' })}</HistoryHead>
              {rows.map(sr => (
                <HistoryRow key={sr.id}>
                  <span>{sr.signer_name || sr.signer_email}{sr.party === 'us' ? ` · ${t('signProgress.partyUs', { defaultValue: '보내는 쪽' })}` : ''}</span>
                  <span>{pastLabel(sr, t as (k: string, fb?: string) => string)}{sr.rejected_reason ? ` — "${sr.rejected_reason}"` : ''}</span>
                </HistoryRow>
              ))}
            </HistoryRound>
          ))}
        </History>
      )}
      </>)}

      <ConfirmDialog
        isOpen={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={confirmCloseRound}
        title={t('signProgress.closeRound.title', '고쳐서 다시 보낼까요?') as string}
        message={t('signProgress.closeRound.message', '지금 서명 요청을 닫고 문서를 다시 고칠 수 있게 합니다. 보낸 서명 링크는 더 이상 열리지 않고, 우리 쪽 서명도 고친 문서에 다시 해야 합니다. 받는 분께 메일은 가지 않아요 — 고친 뒤 서명 요청을 다시 보내 주세요.') as string}
        confirmText={t('signProgress.closeRound.ok', '닫고 고치기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="info"
      />

      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        title={t('signProgress.cancelTitle', '서명 요청 취소') as string}
        message={(cancelTarget?.party === 'us'
          ? t('signProgress.cancelUsMessage', '{{name}} 님(보내는 쪽)의 서명 칸 요청을 취소합니다.', { name: cancelTarget?.signer_name || cancelTarget?.signer_email || '' })
          : t('signProgress.cancelMessage', '"{{email}}" 의 서명 요청을 취소합니다. 받은 토큰 URL은 즉시 만료됩니다.', { email: cancelTarget?.signer_email || '' })) as string}
        confirmText={t('signProgress.cancelConfirmBtn', '취소하기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={cancelAllOpen}
        onClose={() => setCancelAllOpen(false)}
        onConfirm={confirmCancelAll}
        title={t('signProgress.cancelAllTitle', '서명 요청 모두 취소') as string}
        message={t('signProgress.cancelAllMessage', '진행 중인 서명 요청 {{n}}건을 모두 취소합니다. 받는 쪽에 보낸 링크는 즉시 만료되고, 문서를 다시 고칠 수 있습니다.', { n: liveRows.length }) as string}
        confirmText={t('signProgress.cancelConfirmBtn', '취소하기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!remindTarget}
        onClose={() => setRemindTarget(null)}
        onConfirm={confirmRemind}
        title={t('signProgress.resendConfirm.title', '서명 링크를 다시 보낼까요?') as string}
        message={t('signProgress.resendConfirm.desc', '{{email}} 로 서명 링크 메일을 다시 보냅니다.', { email: remindTarget?.signer_email || '' }) as string}
        confirmText={t('signProgress.resendConfirm.ok', '보내기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="info"
      />

      <InternalSignModal
        open={!!signTarget}
        request={signTarget}
        onClose={() => setSignTarget(null)}
        onSigned={() => { setSignTarget(null); void afterChange(); }}
      />

      {/* 서명 이미지 라이트박스 — 공통 ImageLightbox */}
      <ImageLightbox src={lightboxSrc} alt={lightboxAlt} onClose={() => setLightboxSrc(null)} />
    </Section>
  );
};

export default SignatureProgressSection;

// 아직 끝나지 않은 요청 — 취소할 수 있는 것
function isLive(sr: SignatureRequest): boolean {
  return sr.status !== 'signed' && sr.status !== 'rejected' && sr.status !== 'expired' && sr.status !== 'canceled';
}

// 이전 회차 행의 그때 상태 — 닫히기 전에 무엇이었나(서명 완료 / 수정 요청 / 거절 / 응답 없음)
function pastLabel(sr: SignatureRequest, t: (k: string, fb?: string) => string): string {
  if (sr.signed_at) return t('signProgress.statusSigned', '서명 완료');
  if (sr.rejected_at) return sr.rejected_kind === 'revise' ? t('signProgress.statusRevise', '수정 요청') : t('signProgress.statusRejected', '거절됨');
  return t('signProgress.history.noAnswer', '응답 없음');
}

function statusLabel(s: SignatureStatus, t: (k: string, fb?: string) => string): string {
  switch (s) {
    case 'sent': return t('signProgress.statusSent', '발송됨');
    case 'viewed': return t('signProgress.statusViewed', '검토 중');
    case 'signed': return t('signProgress.statusSigned', '서명 완료');
    case 'rejected': return t('signProgress.statusRejected', '거절됨');
    case 'superseded': return t('signProgress.statusSuperseded', '새 버전으로 대체');
    case 'expired': return t('signProgress.statusExpired', '만료');
    case 'canceled': return t('signProgress.statusCanceled', '취소');
    default: return t('signProgress.statusPending', '대기');
  }
}

// ─── styled ───
// 아웃 라운드박스 제거 — 안에 서명자 카드가 이미 박스라 이중이었다. border-top 구분선만(AttachSection 정합, Irene).
// 좌우 여백은 부모 Body 규칙(.pq 24px)이 제공하므로 여기선 상하만.
// 본문 **위**에 선다(2026-10-22 — 보기·편집 모두). 아래 배치일 때의 위 선을 아래 선으로 바꿨다.
const Section = styled.section`
  margin-bottom: 20px; padding-bottom: 12px;
  border-bottom: 1px solid #E2E8F0;
`;
const SectionHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
  margin-bottom: 12px;
`;
const TitleToggle = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 32px; padding: 0 4px 0 0;
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 0.875rem; font-weight: 700; color: #0F172A;
  & > svg { color: #64748B; flex-shrink: 0; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.35); border-radius: 6px; }
`;
const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  height: 20px; padding: 0 8px;
  font-size: 0.6875rem; font-weight: 700; color: #0F766E;
  background: #CCFBF1; border-radius: 999px;
`;
const HeaderActions = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;`;
const CancelAllBtn = styled.button`
  height: 32px; padding: 0 10px;
  font-size: 0.75rem; font-weight: 600; color: #B91C1C;
  background: transparent; border: 1px solid #FECACA; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
// 회차 닫기 — 보조 버튼(민트 테두리, 서명 추가와 같은 톤 · 높이 32 = 모두 취소와 같은 줄 높이)
const CloseRoundBtn = styled.button`
  height: 32px; padding: 0 10px;
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
  background: #fff; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #F0FDFA; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const CloseErr = styled.div`
  font-size: 0.75rem; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; line-height: 1.5;
`;
// 이전 회차 — 접힌 기록
const History = styled.div`margin-top: 10px;`;
const HistoryToggle = styled.button`
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 4px;
  font-size: 0.75rem; font-weight: 600; color: #64748B; background: transparent; border: 0; cursor: pointer;
  &:hover { color: #0F172A; }
  & svg { transition: transform 0.15s; }
`;
const HistoryRound = styled.div`
  border: 1px solid #E2E8F0; border-radius: 8px; background: #F8FAFC; padding: 8px 12px; margin-top: 6px;
`;
const HistoryHead = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; margin-bottom: 4px;`;
const HistoryRow = styled.div`
  display: flex; justify-content: space-between; gap: 12px; padding: 3px 0;
  font-size: 0.75rem; color: #475569; line-height: 1.5;
  & > span:last-child { text-align: right; min-width: 0; overflow-wrap: anywhere; }
  @media (max-width: 640px) { flex-direction: column; gap: 0; & > span:last-child { text-align: left; } }
`;
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
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
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
const FollowupTitle = styled.span`font-size:0.8125rem;font-weight:700;color:#0F172A;`;
const FollowupDesc = styled.span`font-size:0.6875rem;color:#64748B;line-height:1.5;`;
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
  font-size: 0.6875rem; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Th = styled.div``;
const TBody = styled.div`display:flex;flex-direction:column;`;
const Tr = styled.div<{ $rejected?: boolean; $signed?: boolean }>`
  display: flex; align-items: flex-start; padding: 12px;
  font-size: 0.8125rem; color: #0F172A;
  background: ${p => p.$rejected ? '#FEF2F2' : p.$signed ? '#F0FDFA' : '#fff'};
  & + & { border-top: 1px solid #E2E8F0; }
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
  color: #fff; font-size: 0.8125rem; font-weight: 700; border-radius: 9px;
`;
const SignerInfo = styled.div`display:flex;flex-direction:column;gap:1px;min-width:0;`;
const SignerName = styled.span`
  font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SignerEmail = styled.span`
  font-size: 0.6875rem; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SignerNote = styled.span`
  font-size: 0.6875rem; color: #94A3B8; margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
`;

// 상태 badge
const StatusBadge = styled.span<{ $status: SignatureStatus }>`
  display: inline-flex; align-items: center;
  height: 22px; padding: 0 8px;
  font-size: 0.6875rem; font-weight: 700;
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
  font-size: 0.6875rem; color: #DC2626; margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
`;
const ReminderHint = styled.div`
  font-size: 0.6875rem; color: #94A3B8; margin-top: 2px;
`;
const TimeText = styled.span`font-size:0.75rem;color:#475569;`;

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
// 서명 칸이 여럿이면(사인 + 회사 스탬프) 나란히
const SigThumbs = styled.div`display: inline-flex; gap: 4px; flex-wrap: nowrap;`;
const SigPlaceholder = styled.span`
  display: inline-block; width: 60px; text-align: center;
  font-size: 0.8125rem; color: #CBD5E1;
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
  font-size: 0.75rem; font-weight: 600;
  color: ${p => p.$danger ? '#DC2626' : '#334155'};
  background: transparent; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: ${p => p.$danger ? '#FEF2F2' : '#F1F5F9'}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// 서명란 — 칸 번호 · 구분 (2026-09-22)
const PartyChip = styled.span<{ $us?: boolean }>`
  margin-left:6px;padding:1px 6px;border-radius:999px;font-size:0.625rem;font-weight:700;
  background:${p => (p.$us ? '#F0FDFA' : '#F1F5F9')};color:${p => (p.$us ? '#0F766E' : '#475569')};
`;
const SlotChip = styled.span`
  margin-left:4px;display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;padding:1px 4px;border-radius:5px;background:#F1F5F9;color:#64748B;
  font-size:0.5625rem;font-weight:700;line-height:1.2;
`;
const SignNowBtn = styled.button`
  border:1px solid #14B8A6;background:#14B8A6;color:#fff;border-radius:8px;
  padding:5px 10px;font-size:0.75rem;font-weight:700;cursor:pointer;white-space:nowrap;
  &:hover { background:#0F9488;border-color:#0F9488; }
`;
