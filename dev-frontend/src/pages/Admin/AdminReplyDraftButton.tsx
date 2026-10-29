// 플랫폼 관리자 답변 AI 초안 — 피드백·문의 화면(AdminFeedbackPage) · 손님 문의 화면(AdminInquiriesPage) 한 벌.
//
// Irene 2026-10-29: «플랫폼 관리자가 관리하는 문의에 답변하기도 AI가 답변 가능하게 넣어줘. 피드백이랑 문의 다»
//   ★ 칸을 **채우기만** 한다. 저장·알림·발송은 각 화면의 기존 버튼을 사람이 눌러야 일어난다(서버도 저장하지 않는다).
//   칸에 글이 있으면 그 글을 다듬는다(current_draft) — 덮어쓴 직전 글은 [되돌리기] 로 한 번 돌린다.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';

export default function AdminReplyDraftButton({ endpoint, value, onDraft }: {
  /** POST 주소 — /api/feedback/:id/ai-draft · /api/inquiries/admin/:id/ai-draft */
  endpoint: string;
  value: string;
  onDraft: (text: string) => void;
}) {
  const { t } = useTranslation('common');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prev, setPrev] = useState<string | null>(null);
  const hasText = !!value.trim();

  const run = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim(), current_draft: hasText ? value : '' }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success || !j.data?.draft) {
        const code = r.status === 429 ? 'limit' : (j?.code || 'ai_unavailable');
        setError(t(`adminReplyDraft.err.${code}`, { defaultValue: t('adminReplyDraft.err.ai_unavailable') }) as string);
        return;
      }
      setPrev(value);
      onDraft(j.data.draft);
      setInstruction('');
    } catch {
      setError(t('adminReplyDraft.err.ai_unavailable') as string);
    } finally { setBusy(false); }
  };

  return (
    <Wrap data-testid="admin-reply-draft">
      <Row>
        {/* draft-exempt: AI 에게 주는 한 줄 지시 — 누르면 비우고, 남겨 둘 글이 아니다 */}
        <Instr
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t(hasText ? 'adminReplyDraft.refinePh' : 'adminReplyDraft.instrPh') as string}
          maxLength={1000}
          disabled={busy}
        />
        <AiBtn type="button" onClick={() => void run()} disabled={busy} data-testid="admin-reply-draft-btn">
          {busy ? t('adminReplyDraft.busy') : t(hasText ? 'adminReplyDraft.refine' : 'adminReplyDraft.make')}
        </AiBtn>
      </Row>
      <Hint>
        {t('adminReplyDraft.hint')}
        {prev !== null && (
          <UndoBtn type="button" onClick={() => { onDraft(prev); setPrev(null); }}>{t('adminReplyDraft.undo')}</UndoBtn>
        )}
      </Hint>
      {error && <Err role="alert">{error}</Err>}
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Row = styled.div`display:flex;gap:8px;align-items:center;min-width:0;`;
const Instr = styled.input`
  flex:1;min-width:0;height:36px;padding:0 10px;border:1px solid #E2E8F0;border-radius:8px;
  font-size:0.8125rem;color:#0F172A;font-family:inherit;background:#FFFFFF;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}
`;
const AiBtn = styled.button`
  flex-shrink:0;height:36px;padding:0 14px;border:1px solid #99F6E4;border-radius:8px;background:#F0FDFA;
  color:#0F766E;font-size:0.8125rem;font-weight:600;cursor:pointer;white-space:nowrap;
  &:hover:not(:disabled){background:#CCFBF1;}
  &:disabled{opacity:0.6;cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const Hint = styled.div`font-size:0.75rem;color:#94A3B8;line-height:1.5;display:flex;gap:8px;flex-wrap:wrap;align-items:center;`;
const UndoBtn = styled.button`border:none;background:none;padding:0;color:#0D9488;font-size:0.75rem;font-weight:600;cursor:pointer;text-decoration:underline;`;
const Err = styled.div`font-size:0.75rem;font-weight:600;color:#B91C1C;`;
