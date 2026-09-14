// SaleCueBar — 상담 내용을 **그대로 말하면** Cue 가 정리해 보여주고, 확인하면 문의가 들어간다.
//
// Irene 2026-09-14: *"Q sale에 나오는 cue에게 말하기가 Q task에 나오는 기능이랑 다르잖아.
//   엔터치면 바로 반응해야 하는데 우측패널이 열려버리네. 먼저 내용 정리해서 맞는지 말하고
//   그대로 리스트에 추가하면 되지 우측패널 왜 열려? 별표 아이콘 들어가는 거라 입력할 때 빨간 라인
//   들어가는 거 모두 완전히 스타일 기능 완벽히 똑같이 하되 Q sale에 맞춰줘."*
//
// 무엇이 달랐나 (실측)
//   ① Q task 는 **Enter 로 보낸다**(Shift+Enter 줄바꿈). 여기는 Ctrl/Cmd+Enter 만 받았다.
//   ② Q task 는 `idle → loading("Cue가 정리하는 중…") → preview("이렇게 정리했어요" + 고칠 수 있는 카드)`
//      3단계다. 여기는 **확인 단계 없이 바로 저장**하고, 저장이 끝나면 부모가 **우측 패널을 열었다.**
//   ③ 별표(Sparkle) 아이콘이 없었다.
// 지금은 셋 다 같다. 껍데기(별표·빨간 테두리·드롭)는 `components/Common/cueBarShell` **한 곳**을 쓴다 —
//   베껴 두면 또 갈라진다(2026-09-13 에 실제로 민트 vs 흰 배경으로 갈라져 있었다).
//
// 저장 경로는 종전 그대로 `saveAsClient` 다(생성 로직을 두 벌로 만들지 않는다).
//   원문은 **첫 상담 기록**으로 함께 남는다. 값이 틀리면 확인 단계에서 고친다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { isEnterAction } from '../../utils/imeKey';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import ModalActionButton from '../Common/ModalActionButton';
import {
  Wrap, BarRow, Sparkle, Field, SendBtn, SubHint, ErrorMsg,
  Drop, CueLine, Actions, Thinking, Dots,
} from '../Common/cueBarShell';
import {
  extractInquiry, saveAsClient, type InquiryExtract, type InteractionKind, type SaleSource,
} from '../../services/sale';

interface Props {
  businessId: number;
  /** 등록이 끝나면 부모가 목록을 다시 읽는다. ★ 우측 패널은 열지 않는다(위 신고). */
  onCreated: (clientId: number) => void;
}

/** 유입 경로 → 상담 기록 종류. 전화로 왔으면 전화 기록이다(경로와 기록이 어긋나지 않게). */
const KIND_BY_SOURCE: Record<string, InteractionKind> = {
  phone: 'call', event: 'visit', referral: 'memo', web: 'memo', email: 'memo', guest_link: 'memo',
};

type Stage = 'idle' | 'loading' | 'preview';

const SaleCueBar: React.FC<Props> = ({ businessId, onCreated }) => {
  const { t } = useTranslation('qsale');
  const [stage, setStage] = useState<Stage>('idle');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [got, setGot] = useState<InquiryExtract | null>(null);
  /** 확인 단계에서 고친 값 — 원본(got)을 덮어쓰지 않는다(재생성하면 원본으로 돌아와야 한다) */
  const [edit, setEdit] = useState<Partial<InquiryExtract>>({});
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 쓰다 닫아도 남는다 — 긴 통화 메모를 여기 바로 붙여넣는다
  const draft = useDraftText(useDraftKey('sale-inquiry-add', 'cuebar', businessId));

  // 높이 자동 — 한 줄에서 시작해 내용만큼 늘어난다(Q task 바와 같은 거동)
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft.text]);

  const mapErr = (m: string) => (
    m === 'usage_limit' ? (t('inquiry.aiUsageLimit') as string)
      : m === 'prospects_quota_exceeded' ? (t('quota.header') as string)
        : m === 'invalid_email' ? (t('inquiry.invalidEmail') as string)
          : (t('cuebar.failed') as string)
  );

  /** ① 정리한다 — 저장하지 않는다. 맞는지 보여주는 것이 이 단계의 전부다. */
  const send = async () => {
    const text = draft.text.trim();
    if (!text || stage === 'loading') return;
    setStage('loading'); setErr(null);
    try {
      const out = await extractInquiry(businessId, text);
      if (!out.found) { setErr(t('cuebar.notFound') as string); setStage('idle'); return; }
      setGot(out); setEdit({}); setStage('preview');
    } catch (e) {
      setErr(mapErr((e as Error).message)); setStage('idle');
    }
  };

  /** ② 확인하면 들어간다 — 그 자리(상담 목록)에서 보인다. 패널은 열지 않는다. */
  const confirm = async () => {
    if (!got || saving) return;
    const text = draft.text.trim();
    const v = { ...got, ...edit };
    setSaving(true); setErr(null);
    try {
      const out = await saveAsClient(businessId, {
        from: 'manual',
        display_name: v.display_name || undefined,
        company_name: v.company_name || undefined,
        phone: v.phone || undefined,
        email: v.email || undefined,
        sales_source: (v.sales_source as SaleSource) || 'manual',
        // 원문을 첫 상담 기록으로 — 종류는 유입 경로에 맞춘다
        interaction: { kind: KIND_BY_SOURCE[v.sales_source || ''] || 'memo', body: text, direction: 'inbound' },
      });
      draft.clear();                           // 저장 성공에만 비운다
      setGot(null); setEdit({}); setStage('idle');
      onCreated(out.client.id);
    } catch (e) {
      setErr(mapErr((e as Error).message));
    } finally { setSaving(false); }
  };

  const close = () => { setGot(null); setEdit({}); setErr(null); setStage('idle'); };
  const val = (k: keyof InquiryExtract) => String((edit[k] ?? got?.[k] ?? '') || '');
  const set = (k: keyof InquiryExtract, v: string) => setEdit((p) => ({ ...p, [k]: v || null }));

  return (
    <Wrap $compact data-testid="sale-cue-bar">
      <BarRow $active={stage !== 'idle' || !!draft.text}>
        {/* 별표 — Q task 와 같은 아이콘·같은 자리 */}
        <Sparkle aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" /></svg>
        </Sparkle>
        <Field ref={taRef} rows={1} value={draft.text} data-draft-kind="sale-inquiry-add"
          placeholder={t('cuebar.placeholder') as string}
          disabled={stage === 'loading'}
          aria-label={t('cuebar.run') as string}
          onChange={(e) => { draft.setText(e.target.value); setErr(null); }}
          onKeyDown={(e) => {
            // Q task 와 같다: Enter 로 보내고 Shift+Enter 는 줄바꿈.
            // ★ `isEnterAction` 이 한글 조합 중 Enter 를 걸러낸다 — 조합 확정을 실행으로 읽으면
            //   "치다가 멋대로 보내진다"(memory `feedback_ime_enter_needs_guard`).
            if (isEnterAction(e) && !e.shiftKey) { e.preventDefault(); void send(); }
          }} />
        {draft.text.trim() && stage === 'idle' && (
          <SendBtn type="button" data-testid="sale-cue-run" onClick={() => void send()}
            aria-label={t('cuebar.run') as string} title={t('cuebar.hint') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
          </SendBtn>
        )}
      </BarRow>

      {stage === 'idle' && draft.text && (
        <SubHint>{t('cuebar.hintEnter', { defaultValue: 'Enter 로 Cue에게 보내기 · Shift+Enter 줄바꿈' }) as string}</SubHint>
      )}
      {stage === 'idle' && err && <ErrorMsg role="alert">{err}</ErrorMsg>}

      {stage === 'loading' && (
        <Drop>
          <Thinking><Dots><i /><i /><i /></Dots>{t('cuebar.thinking', { defaultValue: 'Cue가 정리하는 중...' }) as string}</Thinking>
        </Drop>
      )}

      {stage === 'preview' && got && (
        <Drop role="region" aria-label={t('cuebar.run') as string} data-testid="sale-cue-preview">
          <CueLine>
            <Sparkle aria-hidden><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" /></svg></Sparkle>
            {got.summary || (t('cuebar.organized', { defaultValue: 'Cue가 이렇게 정리했어요 — 맞는지 보고 고치세요' }) as string)}
          </CueLine>
          {/* 고칠 수 있는 칸 — 확인 단계에서 바로잡는다. 우측 패널로 보내지 않는다. */}
          <Fields>
            <F><FL>{t('inquiry.name') as string}</FL>
              <FI value={val('display_name')} data-testid="sale-cue-name"
                onChange={(e) => set('display_name', e.target.value)} /></F>
            <F><FL>{t('inquiry.company') as string}</FL>
              <FI value={val('company_name')} onChange={(e) => set('company_name', e.target.value)} /></F>
            <F><FL>{t('inquiry.phone') as string}</FL>
              <FI value={val('phone')} onChange={(e) => set('phone', e.target.value)} /></F>
            <F><FL>{t('inquiry.email') as string}</FL>
              <FI value={val('email')} onChange={(e) => set('email', e.target.value)} /></F>
          </Fields>
          {err && <ErrorMsg role="alert">{err}</ErrorMsg>}
          <Actions>
            <ModalActionButton variant="ai" onClick={() => void confirm()} disabled={saving}
              data-testid="sale-cue-confirm">
              {saving ? (t('cuebar.adding', { defaultValue: '추가 중...' }) as string)
                : (t('cuebar.confirm', { defaultValue: '이대로 추가' }) as string)}
            </ModalActionButton>
            <ModalActionButton variant="secondary" onClick={() => void send()} disabled={saving}>
              {t('cuebar.regenerate', { defaultValue: '다시 정리' }) as string}
            </ModalActionButton>
            <ModalActionButton variant="secondary" onClick={close} disabled={saving}>
              {t('cuebar.close', { defaultValue: '닫기' }) as string}
            </ModalActionButton>
          </Actions>
        </Drop>
      )}
    </Wrap>
  );
};

export default SaleCueBar;

/* 확인 단계의 칸 — Q task 는 업무 카드(AiCandidateCard)를 쓴다. 여기는 문의 4칸이라
   그 카드를 그대로 쓸 수 없어 최소한의 칸만 둔다(폭은 감기고, 높이는 36 으로 맞춘다). */
const Fields = styled.div`
  display: grid; gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
`;
const F = styled.label`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const FL = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #9F1239; white-space: nowrap; flex-shrink: 0;
`;
const FI = styled.input`
  flex: 1; min-width: 0; height: 36px; padding: 0 10px;
  border: 1px solid #FECDD3; border-radius: 8px; background: #fff;
  font-family: inherit; font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
