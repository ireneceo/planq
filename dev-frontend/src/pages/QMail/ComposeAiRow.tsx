// #221 — 새 메일 AI 작성 줄. Irene: "메일 작성폼, 새 메일에서도 ai로 작성할 수 있어야지"
//
// MailPage.tsx 에 인라인으로 넣지 않고 분리한 이유: 그 파일은 이미 god-file 래칫 동결 대상이라
// (가드 `guard-invariants.js --category=godfile`) 증설분을 그대로 얹으면 허용 성장률을 넘긴다.
// 기능적으로도 "지시 → 초안 생성" 은 컴포저 상태와 독립적인 한 덩이다.
//
// 답장(ai-suggest)과 다른 점: 받은 메일이 없으므로 **사용자 지시가 유일한 근거**다.
// 그래서 지시가 비면 버튼이 비활성이고, 서버도 instruction 없이는 400 을 준다.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
// apiFetch 정본은 AuthContext 다 (MailPage.tsx 와 동일 경로). `utils/api` 는 존재하지 않는다.
import { apiFetch } from '../../contexts/AuthContext';
import AiActionButton from '../../components/Common/AiActionButton';
import { AiInstructionRow, AiInstructionInput } from './MailPage.styles';
import { isEnterAction } from '../../utils/imeKey';

interface Props {
  businessId: number | null;
  to: string;
  subject: string;
  /** 현재 본문 HTML — 비어 있지 않으면 '다듬기' 로 동작한다 */
  body: string;
  isEmptyBody: boolean;
  sending: boolean;
  /** 생성 결과를 본문에 적용. ★ 호출자는 이때 '사용자가 손댔다' 로 표시하면 안 된다 —
   *  시스템이 채운 값이라 자동저장이 사용자 초안을 덮어쓴다 (feedback_system_filled_not_user_input) */
  onBody: (html: string) => void;
  onError: (msg: string | null) => void;
}

export default function ComposeAiRow({ businessId, to, subject, body, isEmptyBody, sending, onBody, onError }: Props) {
  const { t } = useTranslation('qmail');
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState('');

  const run = useCallback(async () => {
    const ins = instruction.trim();
    if (!businessId || busy || !ins) return;
    setBusy(true);
    onError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/ai-compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: ins,
          to: to || undefined,
          subject: subject || undefined,
          current_draft: isEmptyBody ? undefined : body,
        }),
      });
      const j = await r.json();
      if (!j.success) {
        const map: Record<string, string> = {
          cue_usage_limit_exceeded: t('reply.aiLimitExceeded', { defaultValue: '이번 달 Cue 사용량을 모두 썼어요.' }) as string,
          ai_unavailable: t('reply.aiUnavailable', { defaultValue: 'AI 서비스를 잠시 사용할 수 없어요.' }) as string,
          instruction_required: t('compose.aiInstructionRequired', { defaultValue: '어떤 메일을 쓸지 알려 주세요.' }) as string,
        };
        onError(map[j.message] || (t('reply.aiFailed', { defaultValue: 'AI 제안 생성 실패' }) as string));
        return;
      }
      if (j.data?.suggestion) onBody(j.data.suggestion);
      setInstruction('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [businessId, busy, instruction, to, subject, body, isEmptyBody, onBody, onError, t]);

  return (
    <AiInstructionRow>
      <AiInstructionInput
        value={instruction}
        disabled={busy || sending}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (isEnterAction(e)) { e.preventDefault(); if (instruction.trim()) run(); } }}
        placeholder={t('compose.aiInstructionPlaceholder', { defaultValue: 'AI 에게 요청 (예: 미팅 일정 제안 · 견적 안내 · 정중한 거절)' }) as string}
        aria-label={t('compose.aiInstructionLabel', { defaultValue: 'AI 작성 요청' }) as string}
      />
      <AiActionButton
        size="sm"
        loading={busy}
        disabled={sending || !instruction.trim()}
        onClick={run}
        label={busy
          ? t('reply.aiThinking', { defaultValue: 'AI 작성 중…' }) as string
          : (isEmptyBody
              ? t('compose.aiWrite', { defaultValue: 'AI 로 작성' }) as string
              : t('compose.aiRefine', { defaultValue: 'AI 로 다듬기' }) as string)}
        title={t('compose.aiHint', { defaultValue: 'AI 가 요청하신 내용으로 메일 본문을 써줍니다' }) as string}
      />
    </AiInstructionRow>
  );
}
