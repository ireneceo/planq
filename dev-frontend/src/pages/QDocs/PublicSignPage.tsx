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
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import PostEditor from '../../components/Docs/PostEditor';
import {
  ActionRow, Brand, Canvas, CanvasClear, CanvasPlaceholder, CanvasWrap, ConfirmActions, ConfirmTextArea,
  ConfirmedComment, ConsentBox, ConsentHint, ConsentLabel, ConsentTitle, Content, DocBody, ErrorBox,
  ErrorCenter, ErrorHint, ErrorIcon, ErrorTitle, InlineSpinner, LoadingCenter, NoteBox, OtpActions, OtpInput,
  OtpRow, Page, PrimaryBtn, ProgressBar, ProjectChip, RejectActions, RejectBackdrop, RejectBtn, RejectDialog,
  ResendBtn, ResultCard, ResultHint, ResultIcon, ResultMeta, ResultTitle, SecondaryBtn, Section, SectionDesc,
  SectionTitle, SignatureSnap, Spinner, Step, Textarea, TopMeta, Topbar,
  AttachBox, AttachTitle, AttachRow, AttachIcon, AttachName, AttachSize,
} from './PublicSignPage.styles';

interface PublicSignData {
  token: string;
  kind?: 'sign' | 'confirm';
  confirmed_at?: string | null;
  comment?: string | null;
  signer_email: string;
  signer_name: string | null;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'canceled' | 'confirmed' | 'commented';
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
    // 별첨 — 서명 요청 시점에 동결된 목록(이후 문서에 붙은 파일은 서명 대상이 아니다)
    attachments?: { file_id: number; name: string | null; size: number | null; mime: string | null }[];
    snapshot_at?: string | null;
    project?: { id: number; name: string } | null;
  };
}

// #239 — 확인 요청(kind='confirm')은 OTP·서명 캔버스를 **아예 타지 않는다**.
//   'confirm' 뷰와 'confirmed_done' 을 별도 phase 로 둬, 서명 경로와 코드가 섞이지 않게 한다.
type Phase = 'review' | 'otp' | 'sign' | 'done' | 'rejected_done' | 'confirm' | 'confirmed_done';

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

  // #239 확인
  const [confirmComment, setConfirmComment] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
        // #239 — 확인 요청이면 서명 경로(OTP/캔버스)로 절대 들어가지 않는다.
        if ((j.data.kind || 'sign') === 'confirm') {
          setPhase(j.data.confirmed_at ? 'confirmed_done' : 'confirm');
        } else if (j.data.status === 'signed') setPhase('done');
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
  // #239 — 확인 / 의견. apiFetch 가 아니라 공개 라우트라 fetch 직접. **res.ok 를 반드시 본다.**
  const postConfirm = async (path: 'confirm' | 'comment') => {
    if (confirmBusy) return;
    setConfirmBusy(true); setConfirmError(null);
    try {
      const r = await fetch(`/api/sign/${token}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: confirmComment.trim() || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setConfirmError(j?.message === 'already_confirmed'
          ? (t('publicSign.confirm.already', { defaultValue: '이미 확인하셨습니다.' }) as string)
          : (t('publicSign.confirm.failed', { defaultValue: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string));
        return;
      }
      if (path === 'confirm') setPhase('confirmed_done');
      else setConfirmComment('');
      setDoc((d) => (d ? { ...d, comment: j.data?.comment ?? d.comment, confirmed_at: path === 'confirm' ? new Date().toISOString() : d.confirmed_at } : d));
    } catch {
      setConfirmError(t('publicSign.confirm.failed', { defaultValue: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally {
      setConfirmBusy(false);
    }
  };

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
        <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />
        <TopMeta>{doc.signer_email}</TopMeta>
      </Topbar>

      {/* #239 — 확인 요청은 '본인 확인 → 서명' 단계가 없다. 3단계 표시는 거짓말이 된다. */}
      {!signedAlready && !rejectedAlready && phase !== 'confirm' && phase !== 'confirmed_done' && (
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
              {/* 서명 대상 범위 고지 — 무엇에 서명하는지 사용자 언어로 못 박는다(Fable C4). */}
              <NoteBox>
                {doc.entity.attachments?.length
                  ? t('publicSign.scopeNotice', { defaultValue: '서명 대상은 아래 본문과 별첨 {{n}}건입니다.', n: doc.entity.attachments.length }) as string
                  : t('publicSign.scopeNoticeNoAttach', { defaultValue: '서명 대상은 아래 본문입니다.' }) as string}
              </NoteBox>
              {doc.note && <NoteBox>{doc.note}</NoteBox>}
              <DocBody>
                <PostEditor value={doc.entity.content_json} onChange={() => {}} editable={false} />
              </DocBody>
              {/* ★ 2026-08-27 — 별첨. 여태 이 화면에 없었다. 본문이 "별첨 2에 정한…" 을 인용하는데
                  서명자는 그것을 볼 수 없는 상태로 서명했다(운영 계약서 실사례).
                  목록은 요청 시점에 동결된 것이라, 이후 문서에서 첨부가 바뀌어도 서명 대상은 불변이다. */}
              {!!doc.entity.attachments?.length && (
                <AttachBox>
                  <AttachTitle>
                    {t('publicSign.attachments', { defaultValue: '별첨 {{n}}건 — 이 문서의 일부입니다', n: doc.entity.attachments.length }) as string}
                  </AttachTitle>
                  {doc.entity.attachments.map((a) => (
                    <AttachRow key={a.file_id}
                      href={`/api/sign/${token}/attachments/${a.file_id}`}
                      target="_blank" rel="noreferrer">
                      <AttachIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </AttachIcon>
                      <AttachName>{a.name || `file-${a.file_id}`}</AttachName>
                      {a.size != null && <AttachSize>{Math.max(1, Math.round(a.size / 1024))} KB</AttachSize>}
                    </AttachRow>
                  ))}
                </AttachBox>
              )}
            </Section>

            {/* #239 확인 요청 — OTP·서명 캔버스를 타지 않는다. 확인 버튼 + 의견 두 가지뿐. */}
            {phase === 'confirm' && (
              <Section>
                <SectionTitle>{t('publicSign.confirm.title', { defaultValue: '문서를 확인해 주세요' }) as string}</SectionTitle>
                <SectionDesc>
                  {t('publicSign.confirm.desc', { defaultValue: '내용을 보신 뒤 아래 버튼을 눌러 주세요. 의견이 있으면 함께 남기실 수 있습니다.' }) as string}
                </SectionDesc>
                <ConfirmTextArea
                  value={confirmComment}
                  onChange={(e) => setConfirmComment(e.target.value.slice(0, 2000))}
                  maxLength={2000}
                  rows={4}
                  placeholder={t('publicSign.confirm.placeholder', { defaultValue: '의견 (선택)' }) as string}
                />
                <ConfirmActions>
                  <PrimaryBtn type="button" onClick={() => postConfirm('confirm')} disabled={confirmBusy}>
                    {confirmBusy ? <><InlineSpinner />{t('publicSign.confirm.sending', { defaultValue: '보내는 중…' }) as string}</>
                      : t('publicSign.confirm.action', { defaultValue: '확인했습니다' }) as string}
                  </PrimaryBtn>
                  <SecondaryBtn type="button" onClick={() => postConfirm('comment')} disabled={confirmBusy || !confirmComment.trim()}>
                    {t('publicSign.confirm.commentOnly', { defaultValue: '의견만 보내기' }) as string}
                  </SecondaryBtn>
                </ConfirmActions>
                {confirmError && <ErrorBox>{confirmError}</ErrorBox>}
              </Section>
            )}
            {phase === 'confirmed_done' && (
              <Section>
                <SectionTitle>{t('publicSign.confirm.doneTitle', { defaultValue: '확인해 주셔서 감사합니다' }) as string}</SectionTitle>
                <SectionDesc>
                  {t('publicSign.confirm.doneDesc', { defaultValue: '확인 사실이 담당자에게 전달되었습니다. 이 페이지는 닫으셔도 됩니다.' }) as string}
                </SectionDesc>
                {doc.comment && <ConfirmedComment>{doc.comment}</ConfirmedComment>}
              </Section>
            )}

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
