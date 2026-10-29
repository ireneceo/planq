// 템플릿에서 시작한 AI 업무 목록 «바꿀 것만» 고치기 — 서버 POST /api/task-templates/:id/ai-refine (2026-10-29)
//   AI 는 변경 목록만 내고 서버가 원본 위에 얹는다(services/templateAiRefine). 지시가 안 건드린 업무는 설명·본문·중요도·날짜가 그대로다.
//   AiTaskCreateModal 에서 떼어 냈다(컴포넌트 800줄 한도).
import { apiFetch } from '../../contexts/AuthContext';
import type { AiCandidate } from './AiCandidateCard';

interface Args {
  templateId: number;
  businessId: number;
  projectId: number | null;
  startDate: string;
  language: string;
  instructions: string[];
  candidates: AiCandidate[];
  workstreams: Array<{ id: number; title: string }>;
  roleAssignees?: Record<string, number | null>;
}

const wsKey = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 실패하면 던진다(서버 코드 그대로 — mapApiError 가 문구로 바꾼다). 목록은 부르는 쪽이 그대로 둔다. */
export async function refineTemplateCandidates(a: Args): Promise<{ list: AiCandidate[]; note: string; rejected: number }> {
  const r = await apiFetch(`/api/task-templates/${a.templateId}/ai-refine`, {
    method: 'POST',
    retryOnNetworkError: true,   // 미리보기 — 저장하지 않는다
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: a.businessId,
      project_id: a.projectId,
      start_date: a.startDate,
      language: a.language === 'en' ? 'en' : 'ko',
      instructions: a.instructions,
      // 카드에서 고친 기간도 반영해 보낸다(duration = 마감 − 시작)
      items: a.candidates.map((c) => ({
        ...c,
        duration_days: c.start_offset_days === null || c.due_offset_days === null ? null : Math.max(0, c.due_offset_days - c.start_offset_days),
      })),
    }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  const wsNorm = new Map(a.workstreams.map((w) => [wsKey(w.title), w.id]));
  const roleMap = a.roleAssignees || {};
  const list: AiCandidate[] = (j.data?.items || []).map((c: AiCandidate) => ({
    ...c,
    ...(c.assignee_hint && !c.assignee_user_id && roleMap[c.assignee_hint] ? { assignee_user_id: roleMap[c.assignee_hint] } : {}),
    selected: c.selected !== false,
    workstream_id: c.workstream_id ?? (c.workstream_hint ? (wsNorm.get(wsKey(String(c.workstream_hint))) ?? null) : null),
  }));
  return { list, note: j.data?.note || '', rejected: Array.isArray(j.data?.rejected) ? j.data.rejected.length : 0 };
}
