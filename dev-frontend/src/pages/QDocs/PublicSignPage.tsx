// 공개 서명 페이지 — /sign/:token (인증 없음, 외부 고객용)
//
// 5 단계 흐름:
//   1) 문서 본문 미리보기 (읽기 전용)
//   2) 이메일 OTP 본인 확인 (6자리)
//   3) 서명 캔버스 (마우스/터치)
//   4) 명시 동의 박스
//   5) 서명 / 거절
//
// 모바일 friendly · 터치 캔버스 · OTP autofocus 자동 이동 · 60초 쿨다운
// 상태별 화면: 진행 / 이미 서명 / 거절됨 / 만료 / 취소

import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import PostEditor from '../../components/Docs/PostEditor';

interface PublicSignData {
  token: string;
  signer_email: string;
  signer_name: string | null;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'canceled';
  expires_at: string;
  otp_verified: boolean;
  signed_at: string | null;
  signature_image_b64: string | null;
  note: string | null;
  entity: {
    type: 'post' | 'document';
    id: number;
    title: string;
    content_json: { type: 'doc'; content: unknown[] } | null;
    project?: { id: number; name: string } | null;
  };
}

type Phase = 'review' | 'otp' | 'sign' | 'done' | 'rejected_done';

const PublicSignPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<PublicSignData | null>(null);
  const [loadErr, setLoadErr] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('review');

  // OTP
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // 서명
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // 캔버스
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasCtx = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [canvasEmpty, setCanvasEmpty] = useState(true);

  // ─── 로드 ───
  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/sign/${token}`);
      const j = await r.json();
      if (!j.success) {
        setLoadErr({ code: j.message || 'load_failed', message: j.message || '' });
      } else {
        setDoc(j.data);
        // 초기 phase 결정
        if (j.data.status === 'signed') setPhase('done');
        else if (j.data.status === 'rejected') setPhase('rejected_done');
        else if (j.data.otp_verified) setPhase('sign');
        else setPhase('review');
        // OTP 이미 verified 면 sign 으로 (단계 스킵)
      }
    } catch (e) {
      setLoadErr({ code: 'network', message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  // 쿨다운 카운트다운
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = setInterval(() => setOtpCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [otpCooldown]);

  // ─── OTP ───
  const sendOtp = async () => {
    if (otpSending || otpCooldown > 0) return;
    setOtpSending(true);
    setOtpError(null);
    try {
      const r = await fetch(`/api/sign/${token}/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!j.success) {
        if (j.message === 'locked') setOtpError(t('publicSign.otpLocked', '잠금 상태입니다. 60분 후 다시 시도해 주세요.') as string);
        else if (j.message === 'rate_limit_otp_send') setOtpError(t('publicSign.otpRate', '너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.') as string);
        else setOtpError(j.message || (t('publicSign.otpFailed', '인증 코드 발송 실패') as string));
        return;
      }
      setOtpSent(true);
      setOtpCooldown(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } finally { setOtpSending(false); }
  };

  const onOtpChange = (idx: number, v: string) => {
    const digit = v.replace(/\D/g, '').slice(0, 1);
    setOtpDigits(prev => {
      const next = [...prev];
      next[idx] = digit;
      return next;
    });
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
  };

  const onOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && idx > 0) otpRefs.current[idx - 1]?.focus();
    if (e.key === 'ArrowRight' && idx < 5) otpRefs.current[idx + 1]?.focus();
  };

  const onOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setOtpDigits(next);
    setTimeout(() => otpRefs.current[Math.min(text.length, 5)]?.focus(), 30);
  };

  const verifyOtp = async () => {
    const code = otpDigits.join('');
    if (code.length !== 6) { setOtpError(t('publicSign.otpIncomplete', '6자리를 모두 입력하세요') as string); return; }
    setOtpVerifying(true); setOtpError(null);
    try {
      const r = await fetch(`/api/sign/${token}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const j = await r.json();
      if (!j.success) {
        if (j.message === 'locked') setOtpError(t('publicSign.otpLocked', '잠금 상태입니다. 60분 후 다시 시도해 주세요.') as string);
        else if (j.message === 'invalid_code') setOtpError(t('publicSign.otpInvalid', '인증 코드가 일치하지 않습니다.') as string);
        else if (j.message === 'otp_expired') setOtpError(t('publicSign.otpExpiredErr', '인증 코드가 만료되었습니다. 다시 받아주세요.') as string);
        else setOtpError(j.message);
        return;
      }
      setPhase('sign');
      setOtpDigits(['', '', '', '', '', '']);
    } finally { setOtpVerifying(false); }
  };

  // ─── 캔버스 ───
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    canvasCtx.current = ctx;
  }, []);

  useEffect(() => {
    if (phase !== 'sign') return;
    setupCanvas();
    const handle = () => setupCanvas();
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, [phase, setupCanvas]);

  const getPos = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    if ('clientX' in e) return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return { x: 0, y: 0 };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasCtx.current; if (!ctx) return;
    drawing.current = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const moveDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasCtx.current; if (!ctx) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!hasInk.current) { hasInk.current = true; setCanvasEmpty(false); }
  };

  const endDraw = () => { drawing.current = false; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvasCtx.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setCanvasEmpty(true);
  };

  // ─── 서명 / 거절 ───
  const submitSign = async () => {
    if (signing) return;
    setSignError(null);
    if (canvasEmpty) { setSignError(t('publicSign.signRequired', '서명을 그려주세요.') as string); return; }
    if (!consent) { setSignError(t('publicSign.consentRequired', '동의를 체크해 주세요.') as string); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    setSigning(true);
    try {
      const r = await fetch(`/api/sign/${token}/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_image_b64: dataUrl, consent: true, signer_name: doc?.signer_name || null }),
      });
      const j = await r.json();
      if (!j.success) {
        if (j.message === 'consent_required') setSignError(t('publicSign.consentRequired', '동의를 체크해 주세요.') as string);
        else if (j.message === 'already_signed') { await reload(); return; }
        else if (j.message === 'expired') setSignError(t('publicSign.expired', '만료된 요청입니다.') as string);
        else setSignError(j.message || (t('publicSign.signFailed', '서명 실패') as string));
        return;
      }
      await reload();
    } finally { setSigning(false); }
  };

  const submitReject = async () => {
    if (signing) return;
    setSigning(true); setSignError(null);
    try {
      const r = await fetch(`/api/sign/${token}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() || null, consent: true }),
      });
      const j = await r.json();
      if (!j.success) { setSignError(j.message || (t('publicSign.rejectFailed', '거절 실패') as string)); return; }
      await reload();
    } finally { setSigning(false); }
  };

  // ─── 렌더 ───
  if (loading) {
    return <Page><LoadingCenter><Spinner /><span>{t('publicSign.loading', '문서 로드 중...')}</span></LoadingCenter></Page>;
  }
  if (loadErr || !doc) {
    return <Page><ErrorCenter>
      <ErrorIcon><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg></ErrorIcon>
      <ErrorTitle>{
        loadErr?.code === 'expired' ? t('publicSign.errExpired', '이 서명 요청은 만료됐습니다')
        : loadErr?.code === 'canceled' ? t('publicSign.errCanceled', '이 서명 요청은 취소됐습니다')
        : loadErr?.code === 'not_found' ? t('publicSign.errNotFound', '서명 요청을 찾을 수 없습니다')
        : t('publicSign.errLoad', '문서를 불러올 수 없습니다')
      }</ErrorTitle>
      <ErrorHint>{t('publicSign.errHint', '발송한 분에게 새 요청을 부탁해 주세요.')}</ErrorHint>
    </ErrorCenter></Page>;
  }

  const signedAlready = doc.status === 'signed';
  const rejectedAlready = doc.status === 'rejected';

  return (
    <Page>
      <Topbar>
        <Brand>PlanQ</Brand>
        <TopMeta>{doc.signer_email}</TopMeta>
      </Topbar>

      {!signedAlready && !rejectedAlready && (
        <ProgressBar>
          <Step $active={phase === 'review'} $done={phase !== 'review'}>1. {t('publicSign.step1', '문서 검토')}</Step>
          <Step $active={phase === 'otp'} $done={phase === 'sign' || phase === 'done'}>2. {t('publicSign.step2', '본인 확인')}</Step>
          <Step $active={phase === 'sign'} $done={phase === 'done'}>3. {t('publicSign.step3', '서명')}</Step>
        </ProgressBar>
      )}

      <Content>
        {/* 이미 서명 완료 / 거절 */}
        {signedAlready && (
          <ResultCard $tone="ok">
            <ResultIcon $tone="ok">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </ResultIcon>
            <ResultTitle>{t('publicSign.doneTitle', '서명 완료')}</ResultTitle>
            <ResultMeta>{t('publicSign.doneAt', '{{at}} 에 서명하셨습니다', { at: new Date(doc.signed_at!).toLocaleString('ko-KR') })}</ResultMeta>
            <ResultHint>{t('publicSign.doneHint', '양 당사자가 모두 서명을 완료하면 발송자에게 자동으로 통보됩니다. 이 창을 닫으셔도 됩니다.')}</ResultHint>
            {doc.signature_image_b64 && doc.signature_image_b64 !== '(present)' && (
              <SignatureSnap><img src={doc.signature_image_b64} alt="signature" /></SignatureSnap>
            )}
          </ResultCard>
        )}

        {rejectedAlready && (
          <ResultCard $tone="reject">
            <ResultIcon $tone="reject">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </ResultIcon>
            <ResultTitle>{t('publicSign.rejectedTitle', '서명 거절됨')}</ResultTitle>
            <ResultHint>{t('publicSign.rejectedHint', '발송자에게 자동 통보됩니다. 의견은 별도로 회신해 주시기 바랍니다.')}</ResultHint>
          </ResultCard>
        )}

        {/* 진행 중 */}
        {!signedAlready && !rejectedAlready && (
          <>
            {/* Step 1: 문서 본문 */}
            <Section>
              <SectionTitle>{doc.entity.title}</SectionTitle>
              {doc.entity.project && (
                <ProjectChip title={t('publicSign.projectTitle', '연결된 프로젝트') as string}>
                  {t('publicSign.projectLabel', '프로젝트: {{name}}', { name: doc.entity.project.name })}
                </ProjectChip>
              )}
              {doc.note && <NoteBox>{doc.note}</NoteBox>}
              <DocBody>
                <PostEditor value={doc.entity.content_json} onChange={() => {}} editable={false} />
              </DocBody>
            </Section>

            {/* Step 2: OTP */}
            {(phase === 'review' || phase === 'otp') && (
              <Section>
                <SectionTitle>{t('publicSign.otpTitle', '본인 확인')}</SectionTitle>
                <SectionDesc>
                  {t('publicSign.otpDesc', '{{email}} 으로 인증 코드를 발송해 본인을 확인합니다.', { email: doc.signer_email })}
                </SectionDesc>
                {!otpSent ? (
                  <PrimaryBtn type="button" onClick={sendOtp} disabled={otpSending}>
                    {otpSending ? <><InlineSpinner />{t('publicSign.otpSending', '발송 중…')}</> : t('publicSign.otpSend', '인증 코드 받기')}
                  </PrimaryBtn>
                ) : (
                  <>
                    <OtpRow>
                      {otpDigits.map((d, i) => (
                        <OtpInput
                          key={i}
                          ref={(el: HTMLInputElement | null) => { otpRefs.current[i] = el; }}
                          inputMode="numeric"
                          maxLength={1}
                          value={d}
                          onChange={e => onOtpChange(i, e.target.value)}
                          onKeyDown={e => onOtpKeyDown(i, e)}
                          onPaste={i === 0 ? onOtpPaste : undefined}
                          aria-label={t('publicSign.otpDigit', '{{n}} 자리', { n: i + 1 }) as string}
                        />
                      ))}
                    </OtpRow>
                    <OtpActions>
                      <ResendBtn type="button" disabled={otpSending || otpCooldown > 0} onClick={sendOtp}>
                        {otpCooldown > 0 ? t('publicSign.otpResendCooldown', '{{n}}초 후 재발송', { n: otpCooldown }) : t('publicSign.otpResend', '재발송')}
                      </ResendBtn>
                      <PrimaryBtn type="button" onClick={verifyOtp} disabled={otpVerifying || otpDigits.join('').length !== 6}>
                        {otpVerifying ? <><InlineSpinner />{t('publicSign.otpVerifying', '확인 중…')}</> : t('publicSign.otpVerify', '확인')}
                      </PrimaryBtn>
                    </OtpActions>
                  </>
                )}
                {otpError && <ErrorBox>{otpError}</ErrorBox>}
              </Section>
            )}

            {/* Step 3: 서명 */}
            {phase === 'sign' && (
              <Section>
                <SectionTitle>{t('publicSign.signTitle', '서명')}</SectionTitle>
                <SectionDesc>{t('publicSign.signDesc', '아래 영역에 서명을 그려주세요. 마우스 또는 터치 모두 사용 가능합니다.')}</SectionDesc>
                <CanvasWrap>
                  <Canvas
                    ref={canvasRef}
                    onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
                    onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={endDraw}
                    aria-label={t('publicSign.canvasAria', '서명 캔버스') as string}
                  />
                  {canvasEmpty && <CanvasPlaceholder>{t('publicSign.canvasPlaceholder', '여기에 서명해 주세요')}</CanvasPlaceholder>}
                  <CanvasClear type="button" onClick={clearCanvas} disabled={canvasEmpty}>
                    {t('publicSign.canvasClear', '지우기')}
                  </CanvasClear>
                </CanvasWrap>

                <ConsentBox>
                  <input type="checkbox" id="consent" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  <ConsentLabel htmlFor="consent">
                    <ConsentTitle>{t('publicSign.consentTitle', '본 서명을 본인의 서명으로 인정합니다.')}</ConsentTitle>
                    <ConsentHint>{t('publicSign.consentHint', '서명 시 IP·시각·이메일이 함께 기록됩니다.')}</ConsentHint>
                  </ConsentLabel>
                </ConsentBox>

                {signError && <ErrorBox>{signError}</ErrorBox>}

                <ActionRow>
                  <RejectBtn type="button" onClick={() => setShowReject(true)} disabled={signing}>
                    {t('publicSign.reject', '거절')}
                  </RejectBtn>
                  <PrimaryBtn type="button" onClick={submitSign} disabled={signing || canvasEmpty || !consent}>
                    {signing ? <><InlineSpinner />{t('publicSign.signing', '서명 중…')}</> : t('publicSign.signNow', '서명하기')}
                  </PrimaryBtn>
                </ActionRow>
              </Section>
            )}
          </>
        )}
      </Content>

      {/* 거절 확인 모달 */}
      {showReject && (
        <RejectBackdrop onClick={() => !signing && setShowReject(false)}>
          <RejectDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>{t('publicSign.rejectConfirm', '서명을 거절하시겠습니까?')}</h3>
            <p>{t('publicSign.rejectWarn', '거절 후에는 변경할 수 없으며 발송자에게 자동 통보됩니다.')}</p>
            <Textarea
              rows={3}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder={t('publicSign.rejectReasonPh', '거절 사유 (선택)') as string}
            />
            <RejectActions>
              <SecondaryBtn type="button" onClick={() => setShowReject(false)} disabled={signing}>{t('cancel', '취소')}</SecondaryBtn>
              <RejectBtn type="button" onClick={() => { submitReject(); setShowReject(false); }} disabled={signing}>
                {signing ? <><InlineSpinner />{t('publicSign.rejecting', '거절 중…')}</> : t('publicSign.rejectFinal', '거절 확정')}
              </RejectBtn>
            </RejectActions>
          </RejectDialog>
        </RejectBackdrop>
      )}
    </Page>
  );
};

export default PublicSignPage;

// ─── styled ───
const Page = styled.div`
  min-height: 100vh; background: #F8FAFC; color: #0F172A;
  display: flex; flex-direction: column;
  font-family: inherit;
`;
const Topbar = styled.header`
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  background: #fff; border-bottom: 1px solid #E2E8F0;
  position: sticky; top: 0; z-index: 10;
`;
const Brand = styled.span`font-size:15px;font-weight:800;color:#0D9488;letter-spacing:-0.3px;`;
const TopMeta = styled.span`font-size:12px;color:#64748B;`;

const ProgressBar = styled.nav`
  display: flex; gap: 0; padding: 0; background: #fff;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
const Step = styled.div<{ $active: boolean; $done: boolean }>`
  flex: 1; min-width: 100px; padding: 12px 16px;
  font-size: 12px; font-weight: 600;
  text-align: center; white-space: nowrap;
  color: ${p => p.$active ? '#0F766E' : p.$done ? '#14B8A6' : '#94A3B8'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  position: relative;
  &:not(:last-child)::after {
    content: '›'; position: absolute; right: 0; top: 50%; transform: translateY(-50%);
    color: #CBD5E1; font-weight: 400;
  }
`;

const Content = styled.main`
  flex: 1; max-width: 760px; width: 100%;
  margin: 0 auto; padding: 24px 20px 40px;
  display: flex; flex-direction: column; gap: 20px;
  @media (max-width: 640px) { padding: 16px 12px 32px; gap: 16px; }
`;

const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 24px;
  @media (max-width: 640px) { padding: 16px; border-radius: 12px; }
`;
const SectionTitle = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 8px 0; line-height: 1.4;
`;
const SectionDesc = styled.p`
  font-size: 13px; color: #64748B; margin: 0 0 16px 0; line-height: 1.55;
`;
const NoteBox = styled.div`
  margin: 8px 0 16px; padding: 12px 14px;
  font-size: 13px; color: #334155; line-height: 1.55;
  background: #F8FAFC; border-left: 3px solid #14B8A6; border-radius: 0 8px 8px 0;
  white-space: pre-wrap;
`;
const ProjectChip = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0 0 12px;
  padding: 4px 10px;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
`;
const DocBody = styled.div`
  margin-top: 12px; padding-top: 16px;
  border-top: 1px solid #EEF2F6;
`;

// OTP
const OtpRow = styled.div`
  display: flex; gap: 8px; margin: 8px 0 12px;
  @media (max-width: 480px) { gap: 4px; }
`;
const OtpInput = styled.input`
  width: 52px; height: 56px;
  text-align: center;
  font-size: 22px; font-weight: 700; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 10px; background: #fff;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  @media (max-width: 480px) { width: 44px; height: 52px; font-size: 20px; }
`;
const OtpActions = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
const ResendBtn = styled.button`
  height: 36px; padding: 0 14px;
  font-size: 12px; font-weight: 600; color: #475569;
  background: transparent; border: 1px solid transparent; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { color: #0F766E; }
  &:disabled { color: #94A3B8; cursor: not-allowed; }
`;

// 캔버스
const CanvasWrap = styled.div`
  position: relative;
  border: 2px dashed #CBD5E1; border-radius: 12px;
  background: #FAFBFC;
  height: 200px;
  display: flex; flex-direction: column;
  overflow: hidden;
  &:hover { border-color: #14B8A6; }
`;
const Canvas = styled.canvas`
  flex: 1; width: 100%; touch-action: none;
  cursor: crosshair;
`;
const CanvasPlaceholder = styled.div`
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  font-size: 14px; color: #CBD5E1;
`;
const CanvasClear = styled.button`
  position: absolute; top: 8px; right: 8px;
  height: 28px; padding: 0 12px;
  font-size: 11px; font-weight: 600; color: #64748B;
  background: rgba(255,255,255,0.95); border: 1px solid #E2E8F0; border-radius: 999px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover:not(:disabled) { background: #FEF2F2; color: #DC2626; border-color: #FCA5A5; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

// 동의
const ConsentBox = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  margin: 16px 0 8px;
  padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  & input[type="checkbox"] { width: 16px; height: 16px; margin-top: 2px; accent-color: #14B8A6; cursor: pointer; }
`;
const ConsentLabel = styled.label`flex: 1; cursor: pointer;`;
const ConsentTitle = styled.div`font-size:13px;font-weight:600;color:#0F172A;line-height:1.5;`;
const ConsentHint = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;line-height:1.5;`;

// 액션
const ActionRow = styled.div`
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 16px;
  @media (max-width: 480px) { flex-direction: column-reverse; & button { width: 100%; } }
`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  height: 40px; padding: 0 18px;
  font-size: 14px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 10px; cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #0D9488; transform: translateY(-1px); }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  height: 40px; padding: 0 16px;
  font-size: 14px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
`;
const RejectBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  height: 40px; padding: 0 16px;
  font-size: 14px; font-weight: 600; color: #DC2626;
  background: #fff; border: 1px solid #EF4444; border-radius: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const ErrorBox = styled.div`
  font-size: 12px; color: #DC2626; background: #FEF2F2;
  padding: 10px 12px; border-radius: 8px; margin-top: 8px; line-height: 1.5;
`;

// 거절 모달
const RejectBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px;
`;
const RejectDialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 460px; width: 100%;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  & h3 { margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #0F172A; }
  & p { margin: 0 0 14px; font-size: 13px; color: #64748B; line-height: 1.55; }
`;
const Textarea = styled.textarea`
  width: 100%; padding: 10px 12px;
  font-size: 13px; color: #0F172A; line-height: 1.55;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const RejectActions = styled.div`display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px;`;

// 결과
const ResultCard = styled.section<{ $tone: 'ok' | 'reject' }>`
  background: #fff; border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#EF4444'};
  border-radius: 14px; padding: 36px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  text-align: center;
`;
const ResultIcon = styled.div<{ $tone: 'ok' | 'reject' }>`
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: ${p => p.$tone === 'ok' ? '#F0FDFA' : '#FEF2F2'};
  color: ${p => p.$tone === 'ok' ? '#0F766E' : '#DC2626'};
  border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#EF4444'};
  animation: pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  @keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
`;
const ResultTitle = styled.h2`font-size:20px;font-weight:700;color:#0F172A;margin:0;`;
const ResultMeta = styled.div`font-size:13px;color:#64748B;`;
const ResultHint = styled.p`font-size:13px;color:#475569;margin:8px 0 0;line-height:1.55;max-width:480px;`;
const SignatureSnap = styled.div`
  margin-top: 12px; padding: 10px 14px;
  background: #FAFBFC; border: 1px solid #E2E8F0; border-radius: 10px;
  & img { max-width: 240px; max-height: 100px; display: block; }
`;

// 로딩 / 에러
const LoadingCenter = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px;
  color: #64748B; font-size: 14px;
`;
const ErrorCenter = styled.div`
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 40px 20px;
`;
const ErrorIcon = styled.div`
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA;
`;
const ErrorTitle = styled.h2`font-size:17px;font-weight:700;color:#0F172A;margin:0;text-align:center;`;
const ErrorHint = styled.p`font-size:13px;color:#64748B;margin:0;text-align:center;`;

const Spinner = styled.span`
  width: 16px; height: 16px;
  border: 2px solid #CBD5E1; border-top-color: #14B8A6;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const InlineSpinner = styled.span`
  width: 12px; height: 12px; margin-right: 6px;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  border-radius: 50%; animation: spin 0.7s linear infinite;
`;
