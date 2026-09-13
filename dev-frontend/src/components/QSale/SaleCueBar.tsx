// SaleCueBar — 상담 내용을 **그대로 말하면 문의가 들어간다**. (Irene 2026-09-12)
//   "Q task 처럼 탭 아래로 AI 상담내용 넣게 큐에게 말하기 하고 필터 배치한 후 리스트 나오게 해."
//   "AI 추가는 문의추가랑 별개로 입력 바로 하게 나와야지 왜 문의추가 안에 버튼을 넣었어?"
//
// 모양·자리는 Q Task 의 CueTaskBar 와 같다(탭 바로 아래 인라인 바). 새 디자인을 만들지 않는다.
//   ★ 2026-09-13 — 그렇게 적혀 있었지만 실제 스타일은 갈라져 있었다(민트 vs 흰 배경).
//     Q task 규격(흰 배경 · Coral 포커스 링 · 테두리 없는 입력)으로 맞췄다.
// 하는 일: 붙여넣은 글 → AI 추출(POST /api/sale/:biz/inquiry/extract) → **바로 문의 등록**
//   (기존 저장 경로 `saveAsClient` 를 그대로 쓴다 — 생성 로직을 두 벌로 만들지 않는다).
//   원문은 **첫 상담 기록**으로 함께 남는다(정보가 버려지지 않는다). 값이 틀리면 우측 패널에서 고친다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AiActionButton from '../Common/AiActionButton';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { extractInquiry, saveAsClient, type InteractionKind } from '../../services/sale';

interface Props {
  businessId: number;
  /** 등록이 끝나면 부모가 목록을 다시 읽고 그 고객 패널을 연다 */
  onCreated: (clientId: number) => void;
}

/** 유입 경로 → 상담 기록 종류. 전화로 왔으면 전화 기록이다(경로와 기록이 어긋나지 않게). */
const KIND_BY_SOURCE: Record<string, InteractionKind> = {
  phone: 'call', event: 'visit', referral: 'memo', web: 'memo', email: 'memo', guest_link: 'memo',
};

const SaleCueBar: React.FC<Props> = ({ businessId, onCreated }) => {
  const { t } = useTranslation('qsale');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 쓰다 닫아도 남는다 — 긴 통화 메모를 여기 바로 붙여넣는다
  const draft = useDraftText(useDraftKey('sale-inquiry-add', 'cuebar', businessId));

  // 높이 자동 — 한 줄에서 시작해 내용만큼 늘어난다(Q Task 바와 같은 거동)
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft.text]);

  const run = async () => {
    const text = draft.text.trim();
    if (!text || busy) return;
    setBusy(true); setMsg(null);
    try {
      const got = await extractInquiry(businessId, text);
      if (!got.found) { setMsg(t('cuebar.notFound') as string); return; }
      const out = await saveAsClient(businessId, {
        from: 'manual',
        display_name: got.display_name || undefined,
        company_name: got.company_name || undefined,
        phone: got.phone || undefined,
        email: got.email || undefined,
        sales_source: got.sales_source || 'manual',
        // 원문을 첫 상담 기록으로 — 종류는 유입 경로에 맞춘다
        interaction: { kind: KIND_BY_SOURCE[got.sales_source || ''] || 'memo', body: text, direction: 'inbound' },
      });
      draft.clear();                           // 저장 성공에만 비운다
      setMsg(null);
      onCreated(out.client.id);
    } catch (e) {
      const m = (e as Error).message;
      setMsg(m === 'usage_limit' ? (t('inquiry.aiUsageLimit') as string)
        : m === 'prospects_quota_exceeded' ? (t('quota.header') as string)
          : m === 'invalid_email' ? (t('inquiry.invalidEmail') as string)
            : (t('cuebar.failed') as string));
    } finally { setBusy(false); }
  };

  return (
    <Bar data-testid="sale-cue-bar">
      <Input ref={taRef} rows={1} value={draft.text} data-draft-kind="sale-inquiry-add"
        placeholder={t('cuebar.placeholder') as string}
        onChange={(e) => { draft.setText(e.target.value); setMsg(null); }}
        onKeyDown={(e) => {
          // Enter 단독 저장 금지 (UI_DESIGN_GUIDE §1.8) — Ctrl/Cmd+Enter 만
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); }
        }} />
      <AiActionButton size="sm" testId="sale-cue-run"
        onClick={run} loading={busy} disabled={!draft.text.trim()}
        label={t('cuebar.run') as string} title={t('cuebar.hint') as string} />
      {msg && <Hint role="status">{msg}</Hint>}
    </Bar>
  );
};

export default SaleCueBar;

/* ★ 2026-09-13 (Irene: *"Cue에게 말하기는 스타일이 디자인 스타일이 Q task에 나오는 거랑
   같게 해줘."*) — 이 파일 머리말은 "모양·자리는 CueTaskBar 와 같다" 고 적혀 있었지만
   **실제로는 달랐다**: Q task 는 흰 배경 + Coral 포커스 링, 여기는 민트 배경 + 민트 테두리였다.
   주석이 사실을 보증하지 않는다(memory `feedback_comment_lies_predicate_drifts`).
   Q task 의 `BarRow`/`Field` 규격을 그대로 가져온다. */
const CORAL = '#F43F5E';
const Bar = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 8px 7px 12px; margin-bottom: 10px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  transition: border-color .15s, box-shadow .15s;
  &:focus-within { border-color: ${CORAL}; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
const Input = styled.textarea`
  flex: 1 1 260px; min-width: 0; resize: none; overflow-y: auto;
  border: none; outline: none; background: transparent;
  padding: 1px 0; max-height: 140px;
  font-family: inherit; font-size: 0.84375rem; line-height: 1.5; color: #0F172A;
  &::placeholder { color: #94A3B8; }
  &:disabled { color: #94A3B8; }
`;
const Hint = styled.span`flex: 1 1 100%; font-size: 0.75rem; color: #B91C1C;`;
